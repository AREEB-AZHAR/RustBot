use base64::prelude::*;
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::time::{Duration, Instant};

/// Standard Wrapped SOL mint address on Solana mainnet
pub const SOL_MINT: &str = "So11111111111111111111111111111111111111112";

/// Minimum SOL reserve kept untouched for gas fees and account rent exemptions
pub const MIN_SOL_GAS_RESERVE: f64 = 0.05;

/// Represents an on-chain SPL token account holding
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiveTokenAccount {
    pub mint: String,
    pub token_account: String,
    pub balance_ui: f64,
    pub decimals: u8,
    pub amount_raw: String,
}

/// Status summary of the live Solana trading client
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiveSolanaStatus {
    pub available: bool,
    pub live_enabled: bool,
    pub public_key: Option<String>,
    pub rpc_url: String,
    pub sol_balance: f64,
    pub min_gas_reserve_sol: f64,
    pub spendable_sol: f64,
    pub token_holdings: Vec<LiveTokenAccount>,
}

/// Result of an executed on-chain swap
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiveSwapResult {
    pub success: bool,
    pub tx_signature: String,
    pub input_mint: String,
    pub output_mint: String,
    pub in_amount_lamports: u64,
    pub out_amount_estimated: u64,
    pub solscan_url: String,
    pub price_impact_pct: Option<f64>,
}

/// Decodes Solana compact-u16 variable length integer.
/// Returns (decoded_value, bytes_consumed).
pub fn decode_compact_u16(bytes: &[u8]) -> Result<(usize, usize), String> {
    if bytes.is_empty() {
        return Err("Compact-u16 buffer is empty".to_string());
    }
    let mut val = 0usize;
    let mut shift = 0;
    let mut idx = 0;
    loop {
        if idx >= bytes.len() {
            return Err("Unexpected EOF while decoding Solana compact-u16".to_string());
        }
        let byte = bytes[idx];
        idx += 1;
        val |= ((byte & 0x7f) as usize) << shift;
        if (byte & 0x80) == 0 {
            break;
        }
        shift += 7;
        if shift > 28 {
            return Err("Solana compact-u16 integer overflow".to_string());
        }
    }
    Ok((val, idx))
}

/// The Live Solana Trading Client that manages on-chain RPC calls and Jupiter swaps.
#[derive(Clone)]
pub struct SolanaLiveClient {
    pub rpc_url: String,
    signing_key: SigningKey,
    pub verifying_key: VerifyingKey,
    pub public_key_base58: String,
    http_client: reqwest::blocking::Client,
    pub jupiter_api_key: Option<String>,
}

impl SolanaLiveClient {
    /// Creates a client from a base58-encoded private key string (supports 64-byte keypair or 32-byte raw seed).
    pub fn from_base58_key(key_b58: &str, rpc_url: &str) -> Result<Self, String> {
        let trimmed = key_b58.trim();
        if trimmed.is_empty() {
            return Err("Solana private key cannot be empty".to_string());
        }

        let raw_bytes = bs58::decode(trimmed)
            .into_vec()
            .map_err(|e| format!("Invalid base58 private key encoding: {e}"))?;

        let signing_key = match raw_bytes.len() {
            64 => {
                // Standard Solana CLI / Phantom exported keypair: first 32 bytes are seed, last 32 bytes are pubkey
                let seed: [u8; 32] = raw_bytes[..32]
                    .try_into()
                    .map_err(|_| "Failed to extract 32-byte secret seed from 64-byte keypair")?;
                let sk = SigningKey::from_bytes(&seed);
                let derived_pk = sk.verifying_key();
                if derived_pk.as_bytes() != &raw_bytes[32..64] {
                    return Err("Public key in 64-byte keypair does not match secret seed derivation".to_string());
                }
                sk
            }
            32 => {
                let seed: [u8; 32] = raw_bytes
                    .try_into()
                    .map_err(|_| "Failed to convert 32-byte seed")?;
                SigningKey::from_bytes(&seed)
            }
            other => {
                return Err(format!(
                    "Invalid Solana private key length: expected 32 or 64 bytes, got {other} bytes."
                ));
            }
        };

        let verifying_key = signing_key.verifying_key();
        let public_key_base58 = bs58::encode(verifying_key.as_bytes()).into_string();

        let http_client = reqwest::blocking::Client::builder()
            .user_agent("RustBot/1.0 (Solana Autonomous Trading Agent)")
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

        let effective_rpc = if rpc_url.trim().is_empty() {
            "https://api.mainnet-beta.solana.com".to_string()
        } else {
            rpc_url.trim().to_string()
        };

        Ok(Self {
            rpc_url: effective_rpc,
            signing_key,
            verifying_key,
            public_key_base58,
            http_client,
            jupiter_api_key: None,
        })
    }

    /// Attaches an optional Jupiter Developer Platform API key for higher rate limits.
    pub fn with_jupiter_api_key(mut self, api_key: Option<String>) -> Self {
        self.jupiter_api_key = api_key;
        self
    }

    /// Queries live SOL balance in native SOL units.
    pub fn get_sol_balance(&self) -> Result<f64, String> {
        let payload = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getBalance",
            "params": [
                self.public_key_base58,
                { "commitment": "confirmed" }
            ]
        });

        let resp: serde_json::Value = self
            .http_client
            .post(&self.rpc_url)
            .json(&payload)
            .send()
            .map_err(|e| format!("RPC getBalance request failed: {e}"))?
            .json()
            .map_err(|e| format!("RPC getBalance invalid JSON response: {e}"))?;

        if let Some(err_obj) = resp.get("error") {
            return Err(format!("RPC error in getBalance: {err_obj}"));
        }

        let lamports = resp
            .get("result")
            .and_then(|r| r.get("value"))
            .and_then(|v| v.as_u64())
            .ok_or_else(|| "Missing or invalid result.value in getBalance response".to_string())?;

        Ok(lamports as f64 / 1_000_000_000.0)
    }

    /// Queries all SPL token holdings owned by this wallet.
    pub fn get_token_accounts(&self) -> Result<Vec<LiveTokenAccount>, String> {
        let payload = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getTokenAccountsByOwner",
            "params": [
                self.public_key_base58,
                { "programId": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
                {
                    "encoding": "jsonParsed",
                    "commitment": "confirmed"
                }
            ]
        });

        let resp: serde_json::Value = self
            .http_client
            .post(&self.rpc_url)
            .json(&payload)
            .send()
            .map_err(|e| format!("RPC getTokenAccountsByOwner failed: {e}"))?
            .json()
            .map_err(|e| format!("RPC getTokenAccountsByOwner invalid JSON: {e}"))?;

        let mut accounts = Vec::new();

        if let Some(items) = resp
            .get("result")
            .and_then(|r| r.get("value"))
            .and_then(|v| v.as_array())
        {
            for item in items {
                if let Some(info) = item
                    .get("account")
                    .and_then(|a| a.get("data"))
                    .and_then(|d| d.get("parsed"))
                    .and_then(|p| p.get("info"))
                {
                    let mint = info
                        .get("mint")
                        .and_then(|m| m.as_str())
                        .unwrap_or_default()
                        .to_string();
                    let token_account = item
                        .get("pubkey")
                        .and_then(|p| p.as_str())
                        .unwrap_or_default()
                        .to_string();
                    let token_amount = info.get("tokenAmount");
                    let balance_ui = token_amount
                        .and_then(|t| t.get("uiAmount"))
                        .and_then(|u| u.as_f64())
                        .unwrap_or(0.0);
                    let decimals = token_amount
                        .and_then(|t| t.get("decimals"))
                        .and_then(|d| d.as_u64())
                        .unwrap_or(0) as u8;
                    let amount_raw = token_amount
                        .and_then(|t| t.get("amount"))
                        .and_then(|a| a.as_str())
                        .unwrap_or("0")
                        .to_string();

                    if balance_ui > 0.000001 {
                        accounts.push(LiveTokenAccount {
                            mint,
                            token_account,
                            balance_ui,
                            decimals,
                            amount_raw,
                        });
                    }
                }
            }
        }

        Ok(accounts)
    }

    /// Fetches an optimal swap quote from Jupiter Aggregator API (https://api.jup.ag/swap/v1/quote).
    pub fn get_jupiter_quote(
        &self,
        input_mint: &str,
        output_mint: &str,
        amount_lamports: u64,
        slippage_bps: u16,
    ) -> Result<serde_json::Value, String> {
        let safe_slippage = slippage_bps.clamp(10, 250); // Min 0.1%, max 2.5% slippage guard
        let url = format!(
            "https://api.jup.ag/swap/v1/quote?inputMint={}&outputMint={}&amount={}&slippageBps={}",
            input_mint, output_mint, amount_lamports, safe_slippage
        );

        let mut req = self.http_client.get(&url);
        if let Some(ref key) = self.jupiter_api_key {
            req = req.header("x-api-key", key);
        }

        let resp: serde_json::Value = req
            .send()
            .map_err(|e| format!("Jupiter Quote API request failed: {e}"))?
            .json()
            .map_err(|e| format!("Jupiter Quote API invalid JSON: {e}"))?;

        if let Some(err_msg) = resp.get("error") {
            return Err(format!("Jupiter quote error: {err_msg}"));
        }

        if resp.get("outAmount").is_none() {
            return Err("Jupiter quote returned no outAmount route".to_string());
        }

        Ok(resp)
    }

    /// Requests an unsigned serialized swap transaction from Jupiter API (https://api.jup.ag/swap/v1/swap).
    pub fn build_jupiter_swap(&self, quote_response: &serde_json::Value) -> Result<String, String> {
        let payload = json!({
            "quoteResponse": quote_response,
            "userPublicKey": self.public_key_base58,
            "wrapAndUnwrapSol": true,
            "dynamicComputeUnitLimit": true,
            "prioritizationFeeLamports": "auto"
        });

        let mut req = self
            .http_client
            .post("https://api.jup.ag/swap/v1/swap")
            .json(&payload);

        if let Some(ref key) = self.jupiter_api_key {
            req = req.header("x-api-key", key);
        }

        let resp: serde_json::Value = req
            .send()
            .map_err(|e| format!("Jupiter Swap API build request failed: {e}"))?
            .json()
            .map_err(|e| format!("Jupiter Swap API invalid JSON: {e}"))?;

        if let Some(err) = resp.get("error") {
            return Err(format!("Jupiter swap build error: {err}"));
        }

        let swap_tx = resp
            .get("swapTransaction")
            .and_then(|s| s.as_str())
            .ok_or_else(|| "Missing swapTransaction in Jupiter response".to_string())?;

        Ok(swap_tx.to_string())
    }

    /// Signs the wire-serialized transaction bytes with our Ed25519 signing key
    /// and injects the 64-byte signature into the primary signer slot.
    pub fn sign_transaction_bytes(&self, mut tx_bytes: Vec<u8>) -> Result<(Vec<u8>, String), String> {
        let (num_sigs, compact_len) = decode_compact_u16(&tx_bytes)?;
        if num_sigs == 0 {
            return Err("Transaction specifies 0 signatures".to_string());
        }

        let sigs_start = compact_len;
        let sigs_end = sigs_start + num_sigs * 64;
        if tx_bytes.len() < sigs_end {
            return Err("Malformed transaction wire: buffer shorter than signatures block".to_string());
        }

        let message_bytes = &tx_bytes[sigs_end..];
        let signature: Signature = self.signing_key.sign(message_bytes);
        let sig_bytes = signature.to_bytes();

        // Primary signer (fee payer / user wallet) is the first 64 bytes of the signatures block
        tx_bytes[sigs_start..sigs_start + 64].copy_from_slice(&sig_bytes);

        let tx_signature_base58 = bs58::encode(&sig_bytes).into_string();
        Ok((tx_bytes, tx_signature_base58))
    }

    /// Broadcasts a signed base64 transaction to the Solana RPC via sendTransaction.
    pub fn broadcast_transaction(&self, signed_tx_base64: &str) -> Result<String, String> {
        let payload = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "sendTransaction",
            "params": [
                signed_tx_base64,
                {
                    "encoding": "base64",
                    "skipPreflight": false,
                    "preflightCommitment": "confirmed",
                    "maxRetries": 3
                }
            ]
        });

        let resp: serde_json::Value = self
            .http_client
            .post(&self.rpc_url)
            .json(&payload)
            .send()
            .map_err(|e| format!("RPC sendTransaction failed: {e}"))?
            .json()
            .map_err(|e| format!("RPC sendTransaction invalid JSON: {e}"))?;

        if let Some(err_obj) = resp.get("error") {
            return Err(format!("RPC sendTransaction rejected: {err_obj}"));
        }

        let sig = resp
            .get("result")
            .and_then(|r| r.as_str())
            .ok_or_else(|| "Missing transaction signature in sendTransaction response".to_string())?;

        Ok(sig.to_string())
    }

    /// Polls transaction status for confirmation.
    pub fn poll_transaction_confirmation(&self, signature: &str, timeout_secs: u64) -> Result<bool, String> {
        let start = Instant::now();
        let payload = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getSignatureStatuses",
            "params": [
                [signature],
                { "searchTransactionHistory": true }
            ]
        });

        while start.elapsed() < Duration::from_secs(timeout_secs) {
            std::thread::sleep(Duration::from_millis(1500));

            if let Ok(resp) = self
                .http_client
                .post(&self.rpc_url)
                .json(&payload)
                .send()
                .and_then(|r| r.json::<serde_json::Value>())
            {
                if let Some(statuses) = resp
                    .get("result")
                    .and_then(|r| r.get("value"))
                    .and_then(|v| v.as_array())
                {
                    if let Some(first) = statuses.first().and_then(|s| s.as_object()) {
                        if let Some(err) = first.get("err") {
                            if !err.is_null() {
                                return Err(format!("Transaction failed on-chain: {err}"));
                            }
                        }

                        if let Some(status_str) = first.get("confirmationStatus").and_then(|c| c.as_str()) {
                            if status_str == "confirmed" || status_str == "finalized" {
                                return Ok(true);
                            }
                        }
                    }
                }
            }
        }

        // Return true if broadcasted, transaction might still finalize
        Ok(false)
    }

    /// High-level method: Executes a live token swap via Jupiter from end to end.
    pub fn execute_live_swap(
        &self,
        input_mint: &str,
        output_mint: &str,
        amount_lamports: u64,
        slippage_bps: u16,
    ) -> Result<LiveSwapResult, String> {
        // Step 1: Get Quote
        let quote = self.get_jupiter_quote(input_mint, output_mint, amount_lamports, slippage_bps)?;
        let out_estimated = quote
            .get("outAmount")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);

        let price_impact_pct = quote
            .get("priceImpactPct")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<f64>().ok());

        // Step 2: Build Swap Transaction
        let swap_tx_base64 = self.build_jupiter_swap(&quote)?;

        // Step 3: Decode and sign wire transaction
        let tx_bytes = BASE64_STANDARD
            .decode(&swap_tx_base64)
            .map_err(|e| format!("Failed to base64-decode Jupiter swapTransaction: {e}"))?;

        let (signed_bytes, expected_sig) = self.sign_transaction_bytes(tx_bytes)?;
        let signed_tx_base64 = BASE64_STANDARD.encode(&signed_bytes);

        // Step 4: Broadcast to Solana RPC
        let broadcast_sig = self.broadcast_transaction(&signed_tx_base64)?;
        let final_sig = if broadcast_sig.is_empty() {
            expected_sig
        } else {
            broadcast_sig
        };

        let solscan_url = format!("https://solscan.io/tx/{final_sig}");

        Ok(LiveSwapResult {
            success: true,
            tx_signature: final_sig,
            input_mint: input_mint.to_string(),
            output_mint: output_mint.to_string(),
            in_amount_lamports: amount_lamports,
            out_amount_estimated: out_estimated,
            solscan_url,
            price_impact_pct,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::Verifier;

    #[test]
    fn test_decode_compact_u16() {
        // 1 byte test (< 128)
        let single = [1u8, 2, 3];
        let (val, len) = decode_compact_u16(&single).unwrap();
        assert_eq!(val, 1);
        assert_eq!(len, 1);

        // Multi-byte test (128 -> 0x80, 0x01)
        let multi = [0x80, 0x01, 4, 5];
        let (val, len) = decode_compact_u16(&multi).unwrap();
        assert_eq!(val, 128);
        assert_eq!(len, 2);
    }

    #[test]
    fn test_keypair_derivation_from_32_byte_seed() {
        // Known 32-byte test vector
        let seed = [7u8; 32];
        let seed_b58 = bs58::encode(&seed).into_string();
        let client = SolanaLiveClient::from_base58_key(&seed_b58, "https://api.mainnet-beta.solana.com").unwrap();

        assert!(!client.public_key_base58.is_empty());
        assert_eq!(client.rpc_url, "https://api.mainnet-beta.solana.com");

        // Verify that verifying key matches derived public key
        let expected_b58 = bs58::encode(client.verifying_key.as_bytes()).into_string();
        assert_eq!(client.public_key_base58, expected_b58);
    }

    #[test]
    fn test_keypair_derivation_from_64_byte_keypair() {
        let seed = [42u8; 32];
        let sk = SigningKey::from_bytes(&seed);
        let pk = sk.verifying_key();

        let mut keypair_64 = [0u8; 64];
        keypair_64[..32].copy_from_slice(&seed);
        keypair_64[32..].copy_from_slice(pk.as_bytes());

        let keypair_b58 = bs58::encode(&keypair_64).into_string();
        let client = SolanaLiveClient::from_base58_key(&keypair_b58, "").unwrap();

        assert_eq!(client.public_key_base58, bs58::encode(pk.as_bytes()).into_string());
    }

    #[test]
    fn test_transaction_signature_injection_and_verification() {
        let seed = [99u8; 32];
        let seed_b58 = bs58::encode(&seed).into_string();
        let client = SolanaLiveClient::from_base58_key(&seed_b58, "").unwrap();

        // Synthetic transaction wire:
        // [num_signatures = 1 (1 byte)]
        // [placeholder signature (64 bytes)]
        // [message bytes: "Test Solana Transaction Message"]
        let message = b"Test Solana Transaction Message";
        let mut tx_wire = Vec::new();
        tx_wire.push(1u8); // 1 signature
        tx_wire.extend_from_slice(&[0u8; 64]); // empty signature slot
        tx_wire.extend_from_slice(message);

        let (signed_wire, sig_b58) = client.sign_transaction_bytes(tx_wire).unwrap();

        // Check that signature slot is filled
        assert_ne!(&signed_wire[1..65], &[0u8; 64]);

        // Verify with VerifyingKey
        let sig_bytes: [u8; 64] = signed_wire[1..65].try_into().unwrap();
        let sig = Signature::from_bytes(&sig_bytes);
        assert!(client.verifying_key.verify(message, &sig).is_ok());

        // Verify base58 signature matches
        assert_eq!(sig_b58, bs58::encode(&sig_bytes).into_string());
    }

    #[test]
    fn test_live_jupiter_quote_and_swap_build() {
        let seed = [77u8; 32];
        let seed_b58 = bs58::encode(&seed).into_string();
        let client = SolanaLiveClient::from_base58_key(&seed_b58, "https://api.mainnet-beta.solana.com").unwrap();

        // Query real quote from SOL to USDC via active api.jup.ag endpoint
        let sol_mint = "So11111111111111111111111111111111111111112";
        let usdc_mint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
        let quote = client.get_jupiter_quote(sol_mint, usdc_mint, 10_000_000, 50);
        assert!(quote.is_ok(), "Jupiter quote should succeed: {:?}", quote.err());

        let quote_val = quote.unwrap();
        assert!(quote_val.get("outAmount").is_some());

        // Build swap transaction
        let swap_tx = client.build_jupiter_swap(&quote_val);
        assert!(swap_tx.is_ok(), "Jupiter swap build should succeed: {:?}", swap_tx.err());
        let swap_base64 = swap_tx.unwrap();
        assert!(!swap_base64.is_empty());

        // Test signing the wire transaction
        let tx_bytes = BASE64_STANDARD.decode(&swap_base64).unwrap();
        let (signed_wire, sig) = client.sign_transaction_bytes(tx_bytes).unwrap();
        assert!(!sig.is_empty());
        assert!(!signed_wire.is_empty());
    }
}
