use crate::knowledge::{KnowledgeStore, Pattern};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use std::thread;
use std::time::Duration;

const INDEX_HTML: &str = include_str!("../web/index.html");
const STYLES_CSS: &str = include_str!("../web/styles.css");
const APP_JS: &str = include_str!("../web/app.js");
const OG_IMAGE: &[u8] = include_bytes!("../web/og.png");
const MAX_REQUEST_SIZE: usize = 64 * 1024;

#[derive(Clone)]
struct AppState {
    store: Arc<RwLock<KnowledgeStore>>,
}

#[derive(Debug)]
struct Request {
    method: String,
    path: String,
    query: HashMap<String, String>,
    host: String,
    body: Vec<u8>,
}

#[derive(Deserialize)]
struct ChatRequest {
    message: String,
}

#[derive(Deserialize)]
struct TeachRequest {
    prompt: String,
    response: String,
}

#[derive(Serialize)]
struct ChatResponse<'a> {
    status: &'a str,
    response: &'a str,
    pattern_id: Option<u64>,
}

#[derive(Debug, Serialize)]
struct MarketCandle {
    timestamp: u64,
    close: f64,
    volume: f64,
}

#[derive(Debug, Serialize)]
struct MarketDataResponse {
    provider: String,
    symbol: String,
    interval: String,
    candles: Vec<MarketCandle>,
}

#[derive(Debug, Deserialize)]
struct CoinGeckoChart {
    prices: Vec<(u64, f64)>,
    total_volumes: Vec<(u64, f64)>,
}

pub fn run(address: &str, knowledge_path: PathBuf) -> Result<(), String> {
    let store = KnowledgeStore::load(knowledge_path)?;
    let state = AppState {
        store: Arc::new(RwLock::new(store)),
    };
    let listener = TcpListener::bind(address)
        .map_err(|error| format!("Could not listen on http://{address}: {error}"))?;

    println!("\n  RustBot Knowledge Forge is ready");
    println!("  Open http://{address} in your browser");
    println!("  Press Ctrl+C to stop\n");

    for connection in listener.incoming() {
        match connection {
            Ok(stream) => {
                let state = state.clone();
                thread::spawn(move || {
                    if let Err(error) = handle_connection(stream, &state) {
                        eprintln!("Request failed: {error}");
                    }
                });
            }
            Err(error) => eprintln!("Connection failed: {error}"),
        }
    }

    Ok(())
}

fn handle_connection(mut stream: TcpStream, state: &AppState) -> Result<(), String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|error| error.to_string())?;
    let request = read_request(&mut stream)?;

    let response = match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/") | ("GET", "/index.html") => Response::html(
            200,
            "OK",
            INDEX_HTML.replace("__ORIGIN__", &format!("http://{}", request.host)),
        ),
        ("GET", "/styles.css") => Response::asset(200, "OK", "text/css; charset=utf-8", STYLES_CSS),
        ("GET", "/app.js") => Response::asset(200, "OK", "text/javascript; charset=utf-8", APP_JS),
        ("GET", "/og.png") => Response::binary(200, "OK", "image/png", OG_IMAGE),
        ("GET", "/api/health") => Response::json(200, "OK", json!({ "status": "ready" })),
        ("GET", "/api/market/candles") => match fetch_market_candles(&request.query) {
            Ok(data) => Response::json(200, "OK", data),
            Err(error) => Response::error(502, "Bad Gateway", &error),
        },
        ("GET", "/api/knowledge") => match state.store.read() {
            Ok(store) => Response::json(200, "OK", json!({ "patterns": store.patterns() })),
            Err(_) => Response::error(
                500,
                "Internal Server Error",
                "Knowledge store is unavailable.",
            ),
        },
        ("POST", "/api/chat") => match parse_json::<ChatRequest>(&request.body) {
            Ok(payload) if payload.message.trim().chars().count() > 500 => Response::error(
                400,
                "Bad Request",
                "Message must be 500 characters or fewer.",
            ),
            Ok(payload) if payload.message.trim().is_empty() => {
                Response::error(400, "Bad Request", "Message cannot be empty.")
            }
            Ok(payload) => match state.store.read() {
                Ok(store) => match store.find_best_match(&payload.message) {
                    Some(pattern) => Response::json(
                        200,
                        "OK",
                        ChatResponse {
                            status: "matched",
                            response: &pattern.response,
                            pattern_id: Some(pattern.id),
                        },
                    ),
                    None => Response::json(
                        200,
                        "OK",
                        ChatResponse {
                            status: "unknown",
                            response: "That isn't in my memory yet.",
                            pattern_id: None,
                        },
                    ),
                },
                Err(_) => Response::error(
                    500,
                    "Internal Server Error",
                    "Knowledge store is unavailable.",
                ),
            },
            Err(error) => Response::error(400, "Bad Request", &error),
        },
        ("POST", "/api/knowledge") => match parse_json::<TeachRequest>(&request.body) {
            Ok(payload) => match state.store.write() {
                Ok(mut store) => match store.teach(&payload.prompt, &payload.response) {
                    Ok(pattern) => Response::json(201, "Created", json!({ "pattern": pattern })),
                    Err(error) => Response::error(400, "Bad Request", &error),
                },
                Err(_) => Response::error(
                    500,
                    "Internal Server Error",
                    "Knowledge store is unavailable.",
                ),
            },
            Err(error) => Response::error(400, "Bad Request", &error),
        },
        ("POST", "/api/knowledge/restore") => match parse_json::<Pattern>(&request.body) {
            Ok(pattern) => match state.store.write() {
                Ok(mut store) => match store.restore(pattern) {
                    Ok(restored) => Response::json(201, "Created", json!({ "pattern": restored })),
                    Err(error) => Response::error(400, "Bad Request", &error),
                },
                Err(_) => Response::error(
                    500,
                    "Internal Server Error",
                    "Knowledge store is unavailable.",
                ),
            },
            Err(error) => Response::error(400, "Bad Request", &error),
        },
        ("DELETE", path) if path.starts_with("/api/knowledge/") => {
            let id = path.trim_start_matches("/api/knowledge/").parse::<u64>();
            match id {
                Ok(id) => match state.store.write() {
                    Ok(mut store) => match store.forget(id) {
                        Ok(pattern) => Response::json(200, "OK", json!({ "pattern": pattern })),
                        Err(error) => Response::error(404, "Not Found", &error),
                    },
                    Err(_) => Response::error(
                        500,
                        "Internal Server Error",
                        "Knowledge store is unavailable.",
                    ),
                },
                Err(_) => Response::error(400, "Bad Request", "Invalid memory id."),
            }
        }
        _ => Response::error(404, "Not Found", "The requested page does not exist."),
    };

    response.write_to(&mut stream)
}

fn parse_json<T: for<'de> Deserialize<'de>>(body: &[u8]) -> Result<T, String> {
    serde_json::from_slice(body).map_err(|_| "Request body must be valid JSON.".to_string())
}

fn read_request(stream: &mut TcpStream) -> Result<Request, String> {
    let mut bytes = Vec::new();
    let mut buffer = [0_u8; 4096];
    let header_end = loop {
        let count = stream
            .read(&mut buffer)
            .map_err(|error| error.to_string())?;
        if count == 0 {
            return Err("Connection closed before the request was complete.".to_string());
        }
        bytes.extend_from_slice(&buffer[..count]);
        if bytes.len() > MAX_REQUEST_SIZE {
            return Err("Request is too large.".to_string());
        }
        if let Some(position) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
            break position + 4;
        }
    };

    let headers = String::from_utf8_lossy(&bytes[..header_end]);
    let mut lines = headers.lines();
    let request_line = lines
        .next()
        .ok_or_else(|| "Missing request line.".to_string())?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next().unwrap_or_default().to_string();
    let raw_path = request_parts.next().unwrap_or_default();
    let (path, raw_query) = raw_path.split_once('?').unwrap_or((raw_path, ""));
    let path = path.to_string();
    let query = parse_query(raw_query);

    let content_length = lines
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse::<usize>().ok())
                .flatten()
        })
        .unwrap_or(0);

    let host = headers
        .lines()
        .skip(1)
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("host").then(|| value.trim())
        })
        .filter(|value| {
            !value.is_empty()
                && value.chars().all(|character| {
                    character.is_ascii_alphanumeric() || ".:-[]".contains(character)
                })
        })
        .unwrap_or("127.0.0.1:7878")
        .to_string();

    if header_end + content_length > MAX_REQUEST_SIZE {
        return Err("Request body is too large.".to_string());
    }

    while bytes.len() < header_end + content_length {
        let count = stream
            .read(&mut buffer)
            .map_err(|error| error.to_string())?;
        if count == 0 {
            return Err("Connection closed before the body was complete.".to_string());
        }
        bytes.extend_from_slice(&buffer[..count]);
    }

    Ok(Request {
        method,
        path,
        query,
        host,
        body: bytes[header_end..header_end + content_length].to_vec(),
    })
}

fn parse_query(raw_query: &str) -> HashMap<String, String> {
    raw_query
        .split('&')
        .filter(|pair| !pair.is_empty())
        .filter_map(|pair| {
            let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
            Some((percent_decode(key)?, percent_decode(value)?))
        })
        .collect()
}

fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'+' => decoded.push(b' '),
            b'%' if index + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).ok()?;
                decoded.push(u8::from_str_radix(hex, 16).ok()?);
                index += 2;
            }
            b'%' => return None,
            byte => decoded.push(byte),
        }
        index += 1;
    }
    String::from_utf8(decoded).ok()
}

fn fetch_market_candles(query: &HashMap<String, String>) -> Result<MarketDataResponse, String> {
    let provider = query
        .get("provider")
        .map(String::as_str)
        .unwrap_or("binance")
        .to_ascii_lowercase();
    let symbol = query
        .get("symbol")
        .map(String::as_str)
        .unwrap_or("BTCUSDT")
        .trim()
        .to_string();
    let interval = query
        .get("interval")
        .map(String::as_str)
        .unwrap_or("1h")
        .to_string();
    let limit = query
        .get("limit")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(750)
        .clamp(120, 1_000);

    if !matches!(provider.as_str(), "binance" | "coingecko" | "kraken") {
        return Err("Provider must be Binance, CoinGecko, or Kraken.".to_string());
    }
    if !matches!(interval.as_str(), "15m" | "1h" | "4h" | "1d") {
        return Err("Interval must be 15m, 1h, 4h, or 1d.".to_string());
    }
    if symbol.len() < 2
        || symbol.len() > 24
        || !symbol
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "._-".contains(character))
    {
        return Err("Market symbol contains unsupported characters.".to_string());
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(12))
        .user_agent("RustBot-Market-Lab/1.0")
        .build()
        .map_err(|error| format!("Could not initialize the market-data client: {error}"))?;

    let candles = match provider.as_str() {
        "binance" => fetch_binance_candles(&client, &symbol, &interval, limit)?,
        "coingecko" => fetch_coingecko_candles(&client, &symbol, &interval, limit)?,
        "kraken" => fetch_kraken_candles(&client, &symbol, &interval, limit)?,
        _ => unreachable!(),
    };

    Ok(MarketDataResponse {
        provider,
        symbol,
        interval,
        candles,
    })
}

fn fetch_binance_candles(
    client: &reqwest::blocking::Client,
    symbol: &str,
    interval: &str,
    limit: usize,
) -> Result<Vec<MarketCandle>, String> {
    let url = format!(
        "https://data-api.binance.vision/api/v3/klines?symbol={}&interval={}&limit={}",
        symbol.to_ascii_uppercase(),
        interval,
        limit
    );
    let value = fetch_json(client.get(url), "Binance")?;
    let rows = value
        .as_array()
        .ok_or_else(|| "Binance returned an unexpected candlestick response.".to_string())?;
    let candles = rows
        .iter()
        .filter_map(|row| {
            let values = row.as_array()?;
            Some(MarketCandle {
                timestamp: values.first()?.as_u64()?,
                close: json_number(values.get(4)?)?,
                volume: json_number(values.get(5)?)?,
            })
        })
        .collect::<Vec<_>>();
    if candles.is_empty() {
        return Err("Binance returned no usable candles for that symbol.".to_string());
    }
    Ok(candles)
}

fn fetch_coingecko_candles(
    client: &reqwest::blocking::Client,
    coin_id: &str,
    interval: &str,
    limit: usize,
) -> Result<Vec<MarketCandle>, String> {
    if interval == "15m" {
        return Err("CoinGecko's public historical endpoint does not provide 15-minute candles. Choose 1h, 4h, or 1d.".to_string());
    }
    let (days, api_interval, group_size) = match interval {
        "1h" => ((limit.div_ceil(24)).clamp(2, 90), "hourly", 1),
        "4h" => (
            (limit.saturating_mul(4).div_ceil(24)).clamp(2, 90),
            "hourly",
            4,
        ),
        "1d" => (limit.clamp(2, 1_000), "daily", 1),
        _ => unreachable!(),
    };
    let url = format!(
        "https://api.coingecko.com/api/v3/coins/{coin_id}/market_chart?vs_currency=usd&days={days}&interval={api_interval}&precision=full"
    );
    let mut request = client.get(url);
    if let Ok(api_key) = std::env::var("COINGECKO_API_KEY") {
        if !api_key.trim().is_empty() {
            request = request.header("x-cg-demo-api-key", api_key.trim());
        }
    }
    let value = fetch_json(request, "CoinGecko")?;
    let chart: CoinGeckoChart = serde_json::from_value(value)
        .map_err(|_| "CoinGecko returned an unexpected market-chart response.".to_string())?;
    let mut raw = chart
        .prices
        .into_iter()
        .enumerate()
        .map(|(index, (timestamp, close))| MarketCandle {
            timestamp,
            close,
            volume: chart
                .total_volumes
                .get(index)
                .map(|(_, volume)| *volume)
                .unwrap_or(0.0),
        })
        .collect::<Vec<_>>();
    if group_size > 1 {
        raw = raw
            .chunks(group_size)
            .filter_map(|chunk| chunk.last())
            .map(|candle| MarketCandle {
                timestamp: candle.timestamp,
                close: candle.close,
                volume: candle.volume,
            })
            .collect();
    }
    if raw.len() > limit {
        raw.drain(..raw.len() - limit);
    }
    if raw.is_empty() {
        return Err("CoinGecko returned no usable history for that coin ID.".to_string());
    }
    Ok(raw)
}

fn fetch_kraken_candles(
    client: &reqwest::blocking::Client,
    symbol: &str,
    interval: &str,
    limit: usize,
) -> Result<Vec<MarketCandle>, String> {
    let minutes = match interval {
        "15m" => 15,
        "1h" => 60,
        "4h" => 240,
        "1d" => 1_440,
        _ => unreachable!(),
    };
    let url = format!(
        "https://api.kraken.com/0/public/OHLC?pair={}&interval={minutes}",
        symbol.to_ascii_uppercase()
    );
    let value = fetch_json(client.get(url), "Kraken")?;
    if let Some(errors) = value.get("error").and_then(serde_json::Value::as_array) {
        if !errors.is_empty() {
            let detail = errors
                .iter()
                .filter_map(serde_json::Value::as_str)
                .collect::<Vec<_>>()
                .join(", ");
            return Err(format!("Kraken rejected the request: {detail}"));
        }
    }
    let result = value
        .get("result")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| "Kraken returned an unexpected OHLC response.".to_string())?;
    let rows = result
        .iter()
        .find(|(key, value)| key.as_str() != "last" && value.is_array())
        .and_then(|(_, value)| value.as_array())
        .ok_or_else(|| "Kraken returned no candle array for that pair.".to_string())?;
    let mut candles = rows
        .iter()
        .filter_map(|row| {
            let values = row.as_array()?;
            Some(MarketCandle {
                timestamp: values.first()?.as_u64()?.saturating_mul(1_000),
                close: json_number(values.get(4)?)?,
                volume: json_number(values.get(6)?)?,
            })
        })
        .collect::<Vec<_>>();
    if candles.len() > limit {
        candles.drain(..candles.len() - limit);
    }
    if candles.is_empty() {
        return Err("Kraken returned no usable candles for that pair.".to_string());
    }
    Ok(candles)
}

fn fetch_json(
    request: reqwest::blocking::RequestBuilder,
    provider: &str,
) -> Result<serde_json::Value, String> {
    let response = request
        .send()
        .map_err(|error| format!("Could not reach {provider}: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .map_err(|error| format!("Could not read the {provider} response: {error}"))?;
    if !status.is_success() {
        let detail = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|value| {
                value
                    .get("msg")
                    .or_else(|| value.get("error"))
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string)
            })
            .unwrap_or_else(|| format!("HTTP {status}"));
        return Err(format!(
            "{provider} rejected the market-data request: {detail}"
        ));
    }
    serde_json::from_str(&body)
        .map_err(|_| format!("{provider} returned market data in an unexpected format."))
}

fn json_number(value: &serde_json::Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|number| number.parse::<f64>().ok()))
}

struct Response {
    status: u16,
    reason: &'static str,
    content_type: &'static str,
    body: Vec<u8>,
}

impl Response {
    fn html(status: u16, reason: &'static str, body: String) -> Self {
        Self {
            status,
            reason,
            content_type: "text/html; charset=utf-8",
            body: body.into_bytes(),
        }
    }

    fn asset(status: u16, reason: &'static str, content_type: &'static str, body: &str) -> Self {
        Self {
            status,
            reason,
            content_type,
            body: body.as_bytes().to_vec(),
        }
    }

    fn binary(status: u16, reason: &'static str, content_type: &'static str, body: &[u8]) -> Self {
        Self {
            status,
            reason,
            content_type,
            body: body.to_vec(),
        }
    }

    fn json<T: Serialize>(status: u16, reason: &'static str, value: T) -> Self {
        let body = serde_json::to_vec(&value)
            .unwrap_or_else(|_| br#"{"error":"Could not serialize response."}"#.to_vec());
        Self {
            status,
            reason,
            content_type: "application/json; charset=utf-8",
            body,
        }
    }

    fn error(status: u16, reason: &'static str, message: &str) -> Self {
        Self::json(status, reason, json!({ "error": message }))
    }

    fn write_to(self, stream: &mut TcpStream) -> Result<(), String> {
        let headers = format!(
            "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'self'; style-src 'self'; script-src 'self' https://s3.tradingview.com; img-src 'self' data:; connect-src 'self'; frame-src https://s.tradingview.com https://www.tradingview.com https://*.tradingview-widget.com; base-uri 'none'; frame-ancestors 'none'\r\n\r\n",
            self.status,
            self.reason,
            self.content_type,
            self.body.len()
        );
        stream
            .write_all(headers.as_bytes())
            .and_then(|_| stream.write_all(&self.body))
            .and_then(|_| stream.flush())
            .map_err(|error| error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_query, percent_decode};

    #[test]
    fn query_parser_decodes_market_parameters() {
        let query = parse_query("provider=binance&symbol=BTCUSDT&interval=1h&limit=750");
        assert_eq!(query.get("provider").map(String::as_str), Some("binance"));
        assert_eq!(query.get("symbol").map(String::as_str), Some("BTCUSDT"));
        assert_eq!(query.get("interval").map(String::as_str), Some("1h"));
        assert_eq!(query.get("limit").map(String::as_str), Some("750"));
    }

    #[test]
    fn percent_decoder_handles_encoded_symbols_and_rejects_bad_input() {
        assert_eq!(percent_decode("BTC%2DUSD"), Some("BTC-USD".to_string()));
        assert_eq!(
            percent_decode("bitcoin+usd"),
            Some("bitcoin usd".to_string())
        );
        assert_eq!(percent_decode("bad%2"), None);
    }
}
