use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

fn now_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SolanaTradeRecord {
    pub id: i64,
    pub trade_ref: String,
    pub token_symbol: String,
    pub token_name: String,
    pub dex: String,
    pub entry_price: f64,
    pub exit_price: f64,
    pub margin_usd: f64,
    pub pnl_usd: f64,
    pub pnl_pct: f64,
    pub fees_paid_usd: f64,
    pub exit_reason: String,
    pub is_win: bool,
    pub features_json: String,
    pub created_at: i64,
    pub closed_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewSolanaTrade {
    pub trade_ref: String,
    pub token_symbol: String,
    pub token_name: String,
    pub dex: String,
    pub entry_price: f64,
    pub exit_price: f64,
    pub margin_usd: f64,
    pub pnl_usd: f64,
    pub pnl_pct: f64,
    pub fees_paid_usd: f64,
    pub exit_reason: String,
    pub is_win: bool,
    pub features_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SolanaMistakeRecord {
    pub id: i64,
    pub trap_id: String,
    pub token_symbol: String,
    pub pattern_name: String,
    pub features_json: String,
    pub stage: i64, // 1 = Doubt, 2 = Re-testing (2x), 3 = Permanent Veto Trap
    pub retest_passes: i64,
    pub retest_fails: i64,
    pub initial_loss_pct: f64,
    pub times_vetoed: i64,
    pub saved_capital_usd: f64,
    pub status: String,
    pub notes: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewSolanaMistake {
    pub trap_id: String,
    pub token_symbol: String,
    pub pattern_name: String,
    pub features_json: String,
    pub stage: i64,
    pub initial_loss_pct: f64,
    pub notes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateSolanaMistakeStage {
    pub trap_id: String,
    pub stage: i64,
    pub retest_passes: i64,
    pub retest_fails: i64,
    pub status: String,
    pub notes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SolanaWalletState {
    pub current_equity: f64,
    pub cash: f64,
    pub realized_pnl: f64,
    pub total_fees: f64,
    pub peak_equity: f64,
    pub trades_won: i64,
    pub trades_lost: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SolanaAuditSummary {
    pub total_trades: usize,
    pub wins: usize,
    pub losses: usize,
    pub win_rate_pct: f64,
    pub total_pnl_usd: f64,
    pub total_fees_usd: f64,
    pub net_profit_usd: f64,
    pub recent_trades: Vec<SolanaTradeRecord>,
    pub active_traps_count: usize,
    pub stage3_traps_count: usize,
    pub most_traded_tokens: Vec<(String, usize)>,
}

#[derive(Debug, Clone)]
pub struct SolanaDb {
    conn: Arc<Mutex<Connection>>,
    db_path: String,
}

impl SolanaDb {
    pub fn open(path: &Path) -> Result<Self, String> {
        let conn = Connection::open(path).map_err(|e| format!("Failed to open Solana SQLite DB at {:?}: {e}", path))?;
        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
            db_path: path.to_string_lossy().to_string(),
        };
        db.init_schema()?;
        Ok(db)
    }

    pub fn open_in_memory() -> Result<Self, String> {
        let conn = Connection::open_in_memory().map_err(|e| format!("Failed to open in-memory SQLite DB: {e}"))?;
        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
            db_path: ":memory:".to_string(),
        };
        db.init_schema()?;
        Ok(db)
    }

    pub fn db_path(&self) -> &str {
        &self.db_path
    }

    fn init_schema(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "Database mutex poisoned".to_string())?;

        // Enable Write-Ahead Logging and busy timeout for high-frequency concurrency
        conn.execute_batch(
            "
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA busy_timeout = 5000;
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS solana_trades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trade_ref TEXT NOT NULL UNIQUE,
                token_symbol TEXT NOT NULL,
                token_name TEXT NOT NULL,
                dex TEXT NOT NULL,
                entry_price REAL NOT NULL,
                exit_price REAL NOT NULL,
                margin_usd REAL NOT NULL,
                pnl_usd REAL NOT NULL,
                pnl_pct REAL NOT NULL,
                fees_paid_usd REAL NOT NULL,
                exit_reason TEXT NOT NULL,
                is_win INTEGER NOT NULL,
                features_json TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                closed_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_solana_trades_token ON solana_trades(token_symbol);
            CREATE INDEX IF NOT EXISTS idx_solana_trades_closed ON solana_trades(closed_at DESC);

            CREATE TABLE IF NOT EXISTS solana_learned_memory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trap_id TEXT NOT NULL UNIQUE,
                token_symbol TEXT NOT NULL,
                pattern_name TEXT NOT NULL,
                features_json TEXT NOT NULL,
                stage INTEGER NOT NULL,
                retest_passes INTEGER NOT NULL DEFAULT 0,
                retest_fails INTEGER NOT NULL DEFAULT 0,
                initial_loss_pct REAL NOT NULL,
                times_vetoed INTEGER NOT NULL DEFAULT 0,
                saved_capital_usd REAL NOT NULL DEFAULT 0.0,
                status TEXT NOT NULL DEFAULT 'ACTIVE',
                notes TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_solana_memory_stage ON solana_learned_memory(stage);
            CREATE INDEX IF NOT EXISTS idx_solana_memory_token ON solana_learned_memory(token_symbol);

            CREATE TABLE IF NOT EXISTS solana_wallet_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                current_equity REAL NOT NULL,
                cash REAL NOT NULL,
                realized_pnl REAL NOT NULL,
                total_fees REAL NOT NULL,
                peak_equity REAL NOT NULL,
                trades_won INTEGER NOT NULL,
                trades_lost INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS solana_user_wallets (
                user_id TEXT PRIMARY KEY NOT NULL,
                current_equity REAL NOT NULL,
                cash REAL NOT NULL,
                realized_pnl REAL NOT NULL,
                total_fees REAL NOT NULL,
                peak_equity REAL NOT NULL,
                trades_won INTEGER NOT NULL,
                trades_lost INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            ",
        ).map_err(|e| format!("Failed to create Solana DB tables: {e}"))?;

        Ok(())
    }

    pub fn record_trade(&self, trade: &NewSolanaTrade) -> Result<i64, String> {
        let conn = self.conn.lock().map_err(|_| "Database mutex poisoned".to_string())?;
        let now = now_timestamp();

        conn.execute(
            "INSERT INTO solana_trades (
                trade_ref, token_symbol, token_name, dex, entry_price, exit_price,
                margin_usd, pnl_usd, pnl_pct, fees_paid_usd, exit_reason, is_win,
                features_json, created_at, closed_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            params![
                trade.trade_ref,
                trade.token_symbol,
                trade.token_name,
                trade.dex,
                trade.entry_price,
                trade.exit_price,
                trade.margin_usd,
                trade.pnl_usd,
                trade.pnl_pct,
                trade.fees_paid_usd,
                trade.exit_reason,
                if trade.is_win { 1 } else { 0 },
                trade.features_json,
                now,
                now,
            ],
        ).map_err(|e| format!("Failed to insert trade into solana_trades: {e}"))?;

        Ok(conn.last_insert_rowid())
    }

    pub fn list_trades(&self, limit: usize) -> Result<Vec<SolanaTradeRecord>, String> {
        let conn = self.conn.lock().map_err(|_| "Database mutex poisoned".to_string())?;
        let mut stmt = conn.prepare(
            "SELECT id, trade_ref, token_symbol, token_name, dex, entry_price, exit_price,
                    margin_usd, pnl_usd, pnl_pct, fees_paid_usd, exit_reason, is_win,
                    features_json, created_at, closed_at
             FROM solana_trades
             ORDER BY closed_at DESC, id DESC
             LIMIT ?1",
        ).map_err(|e| format!("Failed to prepare select trades: {e}"))?;

        let rows = stmt.query_map(params![limit as i64], |row| {
            Ok(SolanaTradeRecord {
                id: row.get(0)?,
                trade_ref: row.get(1)?,
                token_symbol: row.get(2)?,
                token_name: row.get(3)?,
                dex: row.get(4)?,
                entry_price: row.get(5)?,
                exit_price: row.get(6)?,
                margin_usd: row.get(7)?,
                pnl_usd: row.get(8)?,
                pnl_pct: row.get(9)?,
                fees_paid_usd: row.get(10)?,
                exit_reason: row.get(11)?,
                is_win: row.get::<_, i64>(12)? == 1,
                features_json: row.get(13)?,
                created_at: row.get(14)?,
                closed_at: row.get(15)?,
            })
        }).map_err(|e| format!("Failed to execute query on solana_trades: {e}"))?;

        let mut trades = Vec::new();
        for trade in rows {
            trades.push(trade.map_err(|e| format!("Row mapping error in solana_trades: {e}"))?);
        }
        Ok(trades)
    }

    pub fn record_or_update_mistake(&self, mistake: &NewSolanaMistake) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "Database mutex poisoned".to_string())?;
        let now = now_timestamp();

        conn.execute(
            "INSERT INTO solana_learned_memory (
                trap_id, token_symbol, pattern_name, features_json, stage,
                initial_loss_pct, notes, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            ON CONFLICT(trap_id) DO UPDATE SET
                stage = excluded.stage,
                notes = excluded.notes,
                updated_at = excluded.updated_at",
            params![
                mistake.trap_id,
                mistake.token_symbol,
                mistake.pattern_name,
                mistake.features_json,
                mistake.stage,
                mistake.initial_loss_pct,
                mistake.notes,
                now,
                now,
            ],
        ).map_err(|e| format!("Failed to insert/update learned memory: {e}"))?;

        Ok(())
    }

    pub fn update_mistake_stage(&self, update: &UpdateSolanaMistakeStage) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "Database mutex poisoned".to_string())?;
        let now = now_timestamp();

        conn.execute(
            "UPDATE solana_learned_memory
             SET stage = ?1, retest_passes = ?2, retest_fails = ?3,
                 status = ?4, notes = ?5, updated_at = ?6
             WHERE trap_id = ?7",
            params![
                update.stage,
                update.retest_passes,
                update.retest_fails,
                update.status,
                update.notes,
                now,
                update.trap_id,
            ],
        ).map_err(|e| format!("Failed to update learned memory stage: {e}"))?;

        Ok(())
    }

    pub fn record_veto(&self, trap_id: &str, saved_usd: f64) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "Database mutex poisoned".to_string())?;
        let now = now_timestamp();

        conn.execute(
            "UPDATE solana_learned_memory
             SET times_vetoed = times_vetoed + 1,
                 saved_capital_usd = saved_capital_usd + ?1,
                 updated_at = ?2
             WHERE trap_id = ?3",
            params![saved_usd, now, trap_id],
        ).map_err(|e| format!("Failed to record veto in learned memory: {e}"))?;

        Ok(())
    }

    pub fn reassess_learned_memory(&self) -> Result<usize, String> {
        let conn = self.conn.lock().map_err(|_| "Database mutex poisoned".to_string())?;
        let now = now_timestamp();
        let rows = conn.execute(
            "UPDATE solana_learned_memory
             SET stage = 2,
                 status = 'REASSESSED',
                 times_vetoed = 0,
                 notes = 'Re-assessed veto: downgraded from Stage 3 to Stage 2 Retest',
                 updated_at = ?1
             WHERE stage = 3 OR status = 'PERMANENT_VETO'",
            params![now],
        ).map_err(|e| format!("Failed to reassess learned memory: {e}"))?;
        Ok(rows)
    }

    pub fn list_learned_memory(&self) -> Result<Vec<SolanaMistakeRecord>, String> {
        let conn = self.conn.lock().map_err(|_| "Database mutex poisoned".to_string())?;
        let mut stmt = conn.prepare(
            "SELECT id, trap_id, token_symbol, pattern_name, features_json, stage,
                    retest_passes, retest_fails, initial_loss_pct, times_vetoed,
                    saved_capital_usd, status, notes, created_at, updated_at
             FROM solana_learned_memory
             ORDER BY stage DESC, updated_at DESC",
        ).map_err(|e| format!("Failed to prepare select learned memory: {e}"))?;

        let rows = stmt.query_map([], |row| {
            Ok(SolanaMistakeRecord {
                id: row.get(0)?,
                trap_id: row.get(1)?,
                token_symbol: row.get(2)?,
                pattern_name: row.get(3)?,
                features_json: row.get(4)?,
                stage: row.get(5)?,
                retest_passes: row.get(6)?,
                retest_fails: row.get(7)?,
                initial_loss_pct: row.get(8)?,
                times_vetoed: row.get(9)?,
                saved_capital_usd: row.get(10)?,
                status: row.get(11)?,
                notes: row.get(12)?,
                created_at: row.get(13)?,
                updated_at: row.get(14)?,
            })
        }).map_err(|e| format!("Failed to query solana_learned_memory: {e}"))?;

        let mut memories = Vec::new();
        for item in rows {
            memories.push(item.map_err(|e| format!("Row mapping error in solana_learned_memory: {e}"))?);
        }
        Ok(memories)
    }

    pub fn get_wallet_state(&self) -> Result<Option<SolanaWalletState>, String> {
        let conn = self.conn.lock().map_err(|_| "Database mutex poisoned".to_string())?;
        let mut stmt = conn
            .prepare("SELECT current_equity, cash, realized_pnl, total_fees, peak_equity, trades_won, trades_lost, updated_at FROM solana_wallet_state WHERE id = 1")
            .map_err(|e| format!("Failed to prepare wallet state select: {e}"))?;

        let mut rows = stmt
            .query_map([], |row| {
                Ok(SolanaWalletState {
                    current_equity: row.get(0)?,
                    cash: row.get(1)?,
                    realized_pnl: row.get(2)?,
                    total_fees: row.get(3)?,
                    peak_equity: row.get(4)?,
                    trades_won: row.get(5)?,
                    trades_lost: row.get(6)?,
                    updated_at: row.get(7)?,
                })
            })
            .map_err(|e| format!("Failed to execute wallet state query: {e}"))?;

        match rows.next() {
            Some(res) => Ok(Some(res.map_err(|e| format!("Row mapping error in solana_wallet_state: {e}"))?)),
            None => Ok(None),
        }
    }

    pub fn save_wallet_state(&self, state: &SolanaWalletState) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "Database mutex poisoned".to_string())?;
        let now = now_timestamp();
        conn.execute(
            "INSERT INTO solana_wallet_state (id, current_equity, cash, realized_pnl, total_fees, peak_equity, trades_won, trades_lost, updated_at)
             VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET
                current_equity = excluded.current_equity,
                cash = excluded.cash,
                realized_pnl = excluded.realized_pnl,
                total_fees = excluded.total_fees,
                peak_equity = excluded.peak_equity,
                trades_won = excluded.trades_won,
                trades_lost = excluded.trades_lost,
                updated_at = excluded.updated_at",
            params![
                state.current_equity,
                state.cash,
                state.realized_pnl,
                state.total_fees,
                state.peak_equity,
                state.trades_won,
                state.trades_lost,
                now
            ],
        ).map_err(|e| format!("Failed to save wallet state: {e}"))?;
        Ok(())
    }

    pub fn get_user_wallet_state(&self, user_id: &str) -> Result<Option<SolanaWalletState>, String> {
        let conn = self.conn.lock().map_err(|_| "Database mutex poisoned".to_string())?;
        let mut stmt = conn
            .prepare("SELECT current_equity, cash, realized_pnl, total_fees, peak_equity, trades_won, trades_lost, updated_at FROM solana_user_wallets WHERE user_id = ?1")
            .map_err(|e| format!("Failed to prepare user wallet state select: {e}"))?;

        let mut rows = stmt
            .query_map(params![user_id], |row| {
                Ok(SolanaWalletState {
                    current_equity: row.get(0)?,
                    cash: row.get(1)?,
                    realized_pnl: row.get(2)?,
                    total_fees: row.get(3)?,
                    peak_equity: row.get(4)?,
                    trades_won: row.get(5)?,
                    trades_lost: row.get(6)?,
                    updated_at: row.get(7)?,
                })
            })
            .map_err(|e| format!("Failed to execute user wallet state query: {e}"))?;

        match rows.next() {
            Some(res) => Ok(Some(res.map_err(|e| format!("Row mapping error in solana_user_wallets: {e}"))?)),
            None => Ok(None),
        }
    }

    pub fn save_user_wallet_state(&self, user_id: &str, state: &SolanaWalletState) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "Database mutex poisoned".to_string())?;
        let now = now_timestamp();
        conn.execute(
            "INSERT INTO solana_user_wallets (user_id, current_equity, cash, realized_pnl, total_fees, peak_equity, trades_won, trades_lost, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(user_id) DO UPDATE SET
                current_equity = excluded.current_equity,
                cash = excluded.cash,
                realized_pnl = excluded.realized_pnl,
                total_fees = excluded.total_fees,
                peak_equity = excluded.peak_equity,
                trades_won = excluded.trades_won,
                trades_lost = excluded.trades_lost,
                updated_at = excluded.updated_at",
            params![
                user_id,
                state.current_equity,
                state.cash,
                state.realized_pnl,
                state.total_fees,
                state.peak_equity,
                state.trades_won,
                state.trades_lost,
                now
            ],
        ).map_err(|e| format!("Failed to save user wallet state: {e}"))?;
        Ok(())
    }

    pub fn clear_all(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "Database mutex poisoned".to_string())?;
        conn.execute_batch(
            "DELETE FROM solana_trades;
             DELETE FROM solana_learned_memory;
             DELETE FROM solana_wallet_state;
             DELETE FROM solana_user_wallets;",
        ).map_err(|e| format!("Failed to clear Solana tables: {e}"))?;
        Ok(())
    }

    pub fn get_audit_summary(&self, limit: usize) -> Result<SolanaAuditSummary, String> {
        let recent_trades = self.list_trades(limit)?;
        let traps = self.list_learned_memory()?;

        let total_trades = recent_trades.len();
        let wins = recent_trades.iter().filter(|t| t.is_win).count();
        let losses = total_trades.saturating_sub(wins);
        let win_rate_pct = if total_trades > 0 {
            (wins as f64 / total_trades as f64) * 100.0
        } else {
            0.0
        };
        let total_pnl_usd: f64 = recent_trades.iter().map(|t| t.pnl_usd).sum();
        let total_fees_usd: f64 = recent_trades.iter().map(|t| t.fees_paid_usd).sum();
        let net_profit_usd = total_pnl_usd - total_fees_usd;

        let active_traps_count = traps.iter().filter(|t| t.status == "ACTIVE" || t.stage > 0).count();
        let stage3_traps_count = traps.iter().filter(|t| t.stage == 3).count();

        let mut token_counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
        for t in &recent_trades {
            *token_counts.entry(t.token_symbol.clone()).or_insert(0) += 1;
        }
        let mut most_traded_tokens: Vec<(String, usize)> = token_counts.into_iter().collect();
        most_traded_tokens.sort_by(|a, b| b.1.cmp(&a.1));

        Ok(SolanaAuditSummary {
            total_trades,
            wins,
            losses,
            win_rate_pct,
            total_pnl_usd,
            total_fees_usd,
            net_profit_usd,
            recent_trades,
            active_traps_count,
            stage3_traps_count,
            most_traded_tokens,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_solana_db_lifecycle() {
        let db = SolanaDb::open_in_memory().expect("In-memory DB should open");

        // 1. Record trade
        let trade = NewSolanaTrade {
            trade_ref: "TRD-001".to_string(),
            token_symbol: "BONK".to_string(),
            token_name: "Bonk".to_string(),
            dex: "raydium".to_string(),
            entry_price: 0.000021,
            exit_price: 0.000023,
            margin_usd: 20.0,
            pnl_usd: 1.90,
            pnl_pct: 9.5,
            fees_paid_usd: 0.06,
            exit_reason: "TAKE_PROFIT (Breakeven + 5x Fees Covered)".to_string(),
            is_win: true,
            features_json: "[0.02, 0.05, 88.0, 1.0]".to_string(),
        };

        let id = db.record_trade(&trade).expect("Trade should be recorded");
        assert!(id > 0);

        let trades = db.list_trades(10).expect("Should list trades");
        assert_eq!(trades.len(), 1);
        assert_eq!(trades[0].trade_ref, "TRD-001");
        assert!(trades[0].is_win);

        // 2. Record learned mistake
        let mistake = NewSolanaMistake {
            trap_id: "TRAP-101".to_string(),
            token_symbol: "WIF".to_string(),
            pattern_name: "Bullish FVG Test Fail".to_string(),
            features_json: "[-0.03, 0.02, 92.0, 1.0]".to_string(),
            stage: 1,
            initial_loss_pct: 15.0,
            notes: "Stopped out at -15% limit".to_string(),
        };

        db.record_or_update_mistake(&mistake).expect("Mistake should be recorded");

        let memories = db.list_learned_memory().expect("Should list memory");
        assert_eq!(memories.len(), 1);
        assert_eq!(memories[0].trap_id, "TRAP-101");
        assert_eq!(memories[0].stage, 1);

        // 3. Update stage to 3 (Permanent Veto)
        let update = UpdateSolanaMistakeStage {
            trap_id: "TRAP-101".to_string(),
            stage: 3,
            retest_passes: 0,
            retest_fails: 2,
            status: "PERMANENT_VETO".to_string(),
            notes: "Confirmed trap (2/2 fails). Permanently vetoing entries.".to_string(),
        };
        db.update_mistake_stage(&update).expect("Stage should update");

        // 4. Record Veto
        db.record_veto("TRAP-101", 3.0).expect("Veto should record");

        let updated_memories = db.list_learned_memory().expect("Should list memory");
        assert_eq!(updated_memories[0].stage, 3);
        assert_eq!(updated_memories[0].times_vetoed, 1);
        assert_eq!(updated_memories[0].saved_capital_usd, 3.0);

        // 5. Clear all
        db.clear_all().expect("Clear all should succeed");
        assert!(db.list_trades(10).unwrap().is_empty());
        assert!(db.list_learned_memory().unwrap().is_empty());
    }
}
