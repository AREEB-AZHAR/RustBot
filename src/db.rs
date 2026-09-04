use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use subtle::ConstantTimeEq;

pub fn now_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

/// Generates a cryptographically secure random opaque identifier.
pub fn generate_secure_id(prefix: &str) -> String {
    let mut bytes = [0u8; 16];
    getrandom::getrandom(&mut bytes).expect("Fatal error: failed to acquire OS entropy");
    format!("{prefix}_{}", hex::encode(bytes))
}

/// Generates a cryptographically secure random token (32 bytes / 256 bits).
pub fn generate_secure_token() -> String {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).expect("Fatal error: failed to acquire OS entropy");
    hex::encode(bytes)
}

/// Hashes a token with SHA-256 and an optional session pepper.
pub fn digest_token(raw_token: &str, pepper: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(raw_token.as_bytes());
    if !pepper.is_empty() {
        hasher.update(b":");
        hasher.update(pepper.as_bytes());
    }
    hex::encode(hasher.finalize())
}

/// Compares two digests in constant time to prevent timing attacks.
pub fn constant_time_eq_str(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.as_bytes().ct_eq(b.as_bytes()).into()
}

/// Hash a password using Argon2id with cryptographically random salt.
pub fn hash_password(password: &str) -> Result<String, String> {
    if password.len() < 8 {
        return Err("Password must be at least 8 characters long.".to_string());
    }
    if password.len() > 256 {
        return Err("Password exceeds maximum allowed length.".to_string());
    }

    let mut salt_bytes = [0u8; 16];
    getrandom::getrandom(&mut salt_bytes).map_err(|e| format!("Entropy failure: {e}"))?;
    let salt = SaltString::encode_b64(&salt_bytes)
        .map_err(|e| format!("Failed to encode salt: {e}"))?;

    let argon2 = Argon2::default();
    let password_hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| format!("Password hashing failed: {e}"))?
        .to_string();

    Ok(password_hash)
}

/// Verifies a plain text password against an Argon2 hash.
pub fn verify_password(password: &str, password_hash: &str) -> bool {
    let parsed_hash = match PasswordHash::new(password_hash) {
        Ok(h) => h,
        Err(_) => return false,
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UserRecord {
    pub id: String,
    pub username: String,
    pub email: Option<String>,
    pub password_hash: String,
    pub role: String,
    pub is_verified: bool,
    pub created_at: i64,
    pub disabled_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionRecord {
    pub id: String,
    pub user_id: String,
    pub token_digest: String,
    pub csrf_token_digest: String,
    pub created_at: i64,
    pub last_seen_at: i64,
    pub expires_at: i64,
    pub revoked_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConversationRecord {
    pub id: String,
    pub user_id: String,
    pub title: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MessageRecord {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub status: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MemoryRecord {
    pub id: i64,
    pub keywords: Vec<String>,
    pub response: String,
    pub match_mode: String,
    pub category: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub updated_by_user_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ImportStats {
    pub total_read: usize,
    pub inserted: usize,
    pub skipped: usize,
    pub rejected: usize,
}

#[derive(Clone)]
pub struct Database {
    conn: Arc<Mutex<Connection>>,
}

impl Database {
    /// Opens or creates SQLite database with foreign keys, WAL mode, and runs migrations.
    pub fn open(path: &Path) -> Result<Self, String> {
        let conn = Connection::open(path)
            .map_err(|e| format!("Failed to open SQLite database at {:?}: {e}", path))?;

        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
        };
        db.init_pragmas()?;
        db.run_migrations()?;
        Ok(db)
    }

    /// Creates an in-memory database instance (primarily for automated tests).
    pub fn open_in_memory() -> Result<Self, String> {
        let conn = Connection::open_in_memory()
            .map_err(|e| format!("Failed to open in-memory SQLite database: {e}"))?;

        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
        };
        db.init_pragmas()?;
        db.run_migrations()?;
        Ok(db)
    }

    fn init_pragmas(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 5000;
             PRAGMA synchronous = NORMAL;",
        )
        .map_err(|e| format!("Failed to set SQLite pragmas: {e}"))?;

        // WAL mode is applied if not in memory
        let _ = conn.execute_batch("PRAGMA journal_mode = WAL;");
        Ok(())
    }

    fn run_migrations(&self) -> Result<(), String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to start migration transaction: {e}"))?;

        tx.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                applied_at INTEGER NOT NULL
            );",
        )
        .map_err(|e| format!("Failed to initialize schema_migrations table: {e}"))?;

        let migrations: &[(i64, &str, &str)] = &[
            (
                1,
                "001_initial_users",
                "CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
                    email TEXT UNIQUE COLLATE NOCASE,
                    password_hash TEXT NOT NULL,
                    role TEXT NOT NULL CHECK(role IN ('user', 'admin')),
                    is_verified INTEGER NOT NULL DEFAULT 1,
                    created_at INTEGER NOT NULL,
                    disabled_at INTEGER
                );
                CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
                CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);",
            ),
            (
                2,
                "002_sessions",
                "CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    token_digest TEXT UNIQUE NOT NULL,
                    csrf_token_digest TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    last_seen_at INTEGER NOT NULL,
                    expires_at INTEGER NOT NULL,
                    revoked_at INTEGER
                );
                CREATE INDEX IF NOT EXISTS idx_sessions_token_digest ON sessions(token_digest);
                CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);",
            ),
            (
                3,
                "003_conversations_and_messages",
                "CREATE TABLE IF NOT EXISTS conversations (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    title TEXT,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    deleted_at INTEGER
                );
                CREATE INDEX IF NOT EXISTS idx_conversations_user_updated ON conversations(user_id, updated_at DESC);

                CREATE TABLE IF NOT EXISTS messages (
                    id TEXT PRIMARY KEY,
                    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
                    content TEXT NOT NULL,
                    status TEXT,
                    created_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at ASC);",
            ),
            (
                4,
                "004_memories",
                "CREATE TABLE IF NOT EXISTS memories (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    keywords TEXT NOT NULL,
                    response TEXT NOT NULL,
                    match_mode TEXT NOT NULL DEFAULT 'phrase',
                    category TEXT NOT NULL DEFAULT 'general',
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    updated_by_user_id TEXT REFERENCES users(id)
                );
                CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);",
            ),
            (
                5,
                "005_usage_limits",
                "CREATE TABLE IF NOT EXISTS ai_usage (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    occurred_at INTEGER NOT NULL,
                    model TEXT NOT NULL,
                    input_tokens INTEGER,
                    output_tokens INTEGER,
                    request_status TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_ai_usage_user_time ON ai_usage(user_id, occurred_at DESC);",
            ),
        ];

        for (version, name, sql) in migrations {
            let already_applied: bool = tx
                .query_row(
                    "SELECT 1 FROM schema_migrations WHERE version = ?1",
                    params![version],
                    |_| Ok(true),
                )
                .optional()
                .map_err(|e| format!("Failed to check migration {version}: {e}"))?
                .unwrap_or(false);

            if !already_applied {
                tx.execute_batch(sql)
                    .map_err(|e| format!("Failed to apply migration {version} ({name}): {e}"))?;

                let now = now_timestamp();
                tx.execute(
                    "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?1, ?2, ?3)",
                    params![version, name, now],
                )
                .map_err(|e| format!("Failed to record migration {version}: {e}"))?;
            }
        }

        tx.commit()
            .map_err(|e| format!("Failed to commit schema migrations: {e}"))?;
        Ok(())
    }

    // ==========================================
    // USER MANAGEMENT
    // ==========================================

    pub fn create_user(
        &self,
        username: &str,
        email: Option<&str>,
        password_hash: &str,
        role: &str,
    ) -> Result<UserRecord, String> {
        let username_trimmed = username.trim().to_lowercase();
        if username_trimmed.len() < 3 || username_trimmed.len() > 32 {
            return Err("Username must be between 3 and 32 characters.".to_string());
        }
        if !username_trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        {
            return Err("Username may only contain letters, numbers, hyphens, and underscores.".to_string());
        }

        let email_normalized = email.map(|e| e.trim().to_lowercase()).filter(|e| !e.is_empty());
        if let Some(ref e) = email_normalized {
            if !e.contains('@') || e.len() > 128 {
                return Err("Please provide a valid email address.".to_string());
            }
        }

        if role != "user" && role != "admin" {
            return Err("Invalid role. Role must be 'user' or 'admin'.".to_string());
        }

        let user_id = generate_secure_id("usr");
        let now = now_timestamp();

        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO users (id, username, email, password_hash, role, is_verified, created_at, disabled_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, NULL)",
            params![user_id, username_trimmed, email_normalized, password_hash, role, now],
        )
        .map_err(|e| {
            if e.to_string().contains("UNIQUE constraint failed") {
                "A user with that username or email already exists.".to_string()
            } else {
                format!("Failed to create user: {e}")
            }
        })?;

        Ok(UserRecord {
            id: user_id,
            username: username_trimmed,
            email: email_normalized,
            password_hash: password_hash.to_string(),
            role: role.to_string(),
            is_verified: true,
            created_at: now,
            disabled_at: None,
        })
    }

    pub fn get_user_by_username_or_email(&self, identity: &str) -> Result<Option<UserRecord>, String> {
        let ident = identity.trim().to_lowercase();
        let conn = self.conn.lock().map_err(|e| e.to_string())?;

        let mut stmt = conn
            .prepare(
                "SELECT id, username, email, password_hash, role, is_verified, created_at, disabled_at
                 FROM users
                 WHERE username = ?1 OR email = ?1
                 LIMIT 1",
            )
            .map_err(|e| e.to_string())?;

        let user = stmt
            .query_row(params![ident], |row| {
                Ok(UserRecord {
                    id: row.get(0)?,
                    username: row.get(1)?,
                    email: row.get(2)?,
                    password_hash: row.get(3)?,
                    role: row.get(4)?,
                    is_verified: row.get::<_, i64>(5)? != 0,
                    created_at: row.get(6)?,
                    disabled_at: row.get(7)?,
                })
            })
            .optional()
            .map_err(|e| e.to_string())?;

        Ok(user)
    }

    pub fn get_user_by_id(&self, user_id: &str) -> Result<Option<UserRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, username, email, password_hash, role, is_verified, created_at, disabled_at
                 FROM users
                 WHERE id = ?1
                 LIMIT 1",
            )
            .map_err(|e| e.to_string())?;

        let user = stmt
            .query_row(params![user_id], |row| {
                Ok(UserRecord {
                    id: row.get(0)?,
                    username: row.get(1)?,
                    email: row.get(2)?,
                    password_hash: row.get(3)?,
                    role: row.get(4)?,
                    is_verified: row.get::<_, i64>(5)? != 0,
                    created_at: row.get(6)?,
                    disabled_at: row.get(7)?,
                })
            })
            .optional()
            .map_err(|e| e.to_string())?;

        Ok(user)
    }

    pub fn has_admin_user(&self) -> Result<bool, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM users WHERE role = 'admin' AND disabled_at IS NULL",
                [],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        Ok(count > 0)
    }

    pub fn bootstrap_admin(
        &self,
        username: &str,
        email: Option<&str>,
        password: &str,
    ) -> Result<UserRecord, String> {
        if self.has_admin_user()? {
            return Err("An active administrator already exists in the system.".to_string());
        }
        let password_hash = hash_password(password)?;
        self.create_user(username, email, &password_hash, "admin")
    }

    // ==========================================
    // SESSIONS & CSRF
    // ==========================================

    pub fn create_session(
        &self,
        user_id: &str,
        token_digest: &str,
        csrf_token_digest: &str,
        ttl_seconds: i64,
    ) -> Result<SessionRecord, String> {
        let session_id = generate_secure_id("ses");
        let now = now_timestamp();
        let expires_at = now + ttl_seconds;

        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO sessions (id, user_id, token_digest, csrf_token_digest, created_at, last_seen_at, expires_at, revoked_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, NULL)",
            params![session_id, user_id, token_digest, csrf_token_digest, now, expires_at],
        )
        .map_err(|e| format!("Failed to create session: {e}"))?;

        Ok(SessionRecord {
            id: session_id,
            user_id: user_id.to_string(),
            token_digest: token_digest.to_string(),
            csrf_token_digest: csrf_token_digest.to_string(),
            created_at: now,
            last_seen_at: now,
            expires_at,
            revoked_at: None,
        })
    }

    pub fn get_valid_session_by_token_digest(&self, token_digest: &str) -> Result<Option<(SessionRecord, UserRecord)>, String> {
        let now = now_timestamp();
        let conn = self.conn.lock().map_err(|e| e.to_string())?;

        let mut stmt = conn
            .prepare(
                "SELECT s.id, s.user_id, s.token_digest, s.csrf_token_digest, s.created_at, s.last_seen_at, s.expires_at, s.revoked_at,
                        u.id, u.username, u.email, u.password_hash, u.role, u.is_verified, u.created_at, u.disabled_at
                 FROM sessions s
                 JOIN users u ON s.user_id = u.id
                 WHERE s.token_digest = ?1
                   AND s.revoked_at IS NULL
                   AND s.expires_at > ?2
                   AND u.disabled_at IS NULL
                 LIMIT 1",
            )
            .map_err(|e| e.to_string())?;

        let res = stmt
            .query_row(params![token_digest, now], |row| {
                let session = SessionRecord {
                    id: row.get(0)?,
                    user_id: row.get(1)?,
                    token_digest: row.get(2)?,
                    csrf_token_digest: row.get(3)?,
                    created_at: row.get(4)?,
                    last_seen_at: row.get(5)?,
                    expires_at: row.get(6)?,
                    revoked_at: row.get(7)?,
                };
                let user = UserRecord {
                    id: row.get(8)?,
                    username: row.get(9)?,
                    email: row.get(10)?,
                    password_hash: row.get(11)?,
                    role: row.get(12)?,
                    is_verified: row.get::<_, i64>(13)? != 0,
                    created_at: row.get(14)?,
                    disabled_at: row.get(15)?,
                };
                Ok((session, user))
            })
            .optional()
            .map_err(|e| e.to_string())?;

        Ok(res)
    }

    pub fn touch_session(&self, session_id: &str) -> Result<(), String> {
        let now = now_timestamp();
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE sessions SET last_seen_at = ?1 WHERE id = ?2 AND revoked_at IS NULL",
            params![now, session_id],
        )
        .map_err(|e| format!("Failed to touch session: {e}"))?;
        Ok(())
    }

    pub fn update_session_csrf(&self, session_id: &str, new_csrf_digest: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE sessions SET csrf_token_digest = ?1 WHERE id = ?2 AND revoked_at IS NULL",
            params![new_csrf_digest, session_id],
        )
        .map_err(|e| format!("Failed to update session CSRF: {e}"))?;
        Ok(())
    }

    pub fn revoke_session(&self, session_id: &str) -> Result<(), String> {
        let now = now_timestamp();
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE sessions SET revoked_at = ?1 WHERE id = ?2",
            params![now, session_id],
        )
        .map_err(|e| format!("Failed to revoke session: {e}"))?;
        Ok(())
    }

    pub fn revoke_all_user_sessions(&self, user_id: &str) -> Result<(), String> {
        let now = now_timestamp();
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE sessions SET revoked_at = ?1 WHERE user_id = ?2 AND revoked_at IS NULL",
            params![now, user_id],
        )
        .map_err(|e| format!("Failed to revoke user sessions: {e}"))?;
        Ok(())
    }

    pub fn prune_expired_and_revoked_sessions(&self) -> Result<usize, String> {
        let now = now_timestamp();
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let affected = conn
            .execute(
                "DELETE FROM sessions WHERE expires_at < ?1 OR revoked_at IS NOT NULL",
                params![now],
            )
            .map_err(|e| format!("Failed to prune sessions: {e}"))?;
        Ok(affected)
    }

    // ==========================================
    // CONVERSATIONS & MESSAGES
    // ==========================================

    pub fn create_conversation(&self, user_id: &str, title: Option<&str>) -> Result<ConversationRecord, String> {
        let conv_id = generate_secure_id("cnv");
        let now = now_timestamp();
        let clean_title = title.map(|t| t.trim().to_string()).filter(|t| !t.is_empty());

        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO conversations (id, user_id, title, created_at, updated_at, deleted_at)
             VALUES (?1, ?2, ?3, ?4, ?4, NULL)",
            params![conv_id, user_id, clean_title, now],
        )
        .map_err(|e| format!("Failed to create conversation: {e}"))?;

        Ok(ConversationRecord {
            id: conv_id,
            user_id: user_id.to_string(),
            title: clean_title,
            created_at: now,
            updated_at: now,
        })
    }

    pub fn list_conversations_for_user(&self, user_id: &str) -> Result<Vec<ConversationRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, user_id, title, created_at, updated_at
                 FROM conversations
                 WHERE user_id = ?1 AND deleted_at IS NULL
                 ORDER BY updated_at DESC",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![user_id], |row| {
                Ok(ConversationRecord {
                    id: row.get(0)?,
                    user_id: row.get(1)?,
                    title: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut results = Vec::new();
        for r in rows {
            results.push(r.map_err(|e| e.to_string())?);
        }
        Ok(results)
    }

    pub fn get_conversation_for_user(&self, conversation_id: &str, user_id: &str) -> Result<Option<ConversationRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, user_id, title, created_at, updated_at
                 FROM conversations
                 WHERE id = ?1 AND user_id = ?2 AND deleted_at IS NULL
                 LIMIT 1",
            )
            .map_err(|e| e.to_string())?;

        let conv = stmt
            .query_row(params![conversation_id, user_id], |row| {
                Ok(ConversationRecord {
                    id: row.get(0)?,
                    user_id: row.get(1)?,
                    title: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            })
            .optional()
            .map_err(|e| e.to_string())?;

        Ok(conv)
    }

    pub fn delete_conversation_for_user(&self, conversation_id: &str, user_id: &str) -> Result<bool, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let affected = conn
            .execute(
                "DELETE FROM conversations WHERE id = ?1 AND user_id = ?2",
                params![conversation_id, user_id],
            )
            .map_err(|e| format!("Failed to delete conversation: {e}"))?;

        Ok(affected > 0)
    }

    pub fn add_message(
        &self,
        conversation_id: &str,
        user_id: &str,
        role: &str,
        content: &str,
        status: Option<&str>,
    ) -> Result<MessageRecord, String> {
        if role != "user" && role != "assistant" && role != "system" {
            return Err("Invalid message role. Must be 'user', 'assistant', or 'system'.".to_string());
        }

        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        // 1. Verify ownership
        let belongs: bool = tx
            .query_row(
                "SELECT 1 FROM conversations WHERE id = ?1 AND user_id = ?2 AND deleted_at IS NULL",
                params![conversation_id, user_id],
                |_| Ok(true),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .unwrap_or(false);

        if !belongs {
            return Err("Conversation not found or access denied.".to_string());
        }

        let msg_id = generate_secure_id("msg");
        let now = now_timestamp();

        tx.execute(
            "INSERT INTO messages (id, conversation_id, role, content, status, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![msg_id, conversation_id, role, content, status, now],
        )
        .map_err(|e| format!("Failed to insert message: {e}"))?;

        // 2. Update conversation timestamp
        tx.execute(
            "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
            params![now, conversation_id],
        )
        .map_err(|e| format!("Failed to update conversation timestamp: {e}"))?;

        tx.commit().map_err(|e| e.to_string())?;

        Ok(MessageRecord {
            id: msg_id,
            conversation_id: conversation_id.to_string(),
            role: role.to_string(),
            content: content.to_string(),
            status: status.map(|s| s.to_string()),
            created_at: now,
        })
    }

    pub fn list_messages_for_conversation(
        &self,
        conversation_id: &str,
        user_id: &str,
    ) -> Result<Vec<MessageRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;

        // Check ownership first
        let belongs: bool = conn
            .query_row(
                "SELECT 1 FROM conversations WHERE id = ?1 AND user_id = ?2 AND deleted_at IS NULL",
                params![conversation_id, user_id],
                |_| Ok(true),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .unwrap_or(false);

        if !belongs {
            return Err("Conversation not found or access denied.".to_string());
        }

        let mut stmt = conn
            .prepare(
                "SELECT id, conversation_id, role, content, status, created_at
                 FROM messages
                 WHERE conversation_id = ?1
                 ORDER BY created_at ASC",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![conversation_id], |row| {
                Ok(MessageRecord {
                    id: row.get(0)?,
                    conversation_id: row.get(1)?,
                    role: row.get(2)?,
                    content: row.get(3)?,
                    status: row.get(4)?,
                    created_at: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut results = Vec::new();
        for r in rows {
            results.push(r.map_err(|e| e.to_string())?);
        }
        Ok(results)
    }

    // ==========================================
    // MEMORIES / KNOWLEDGE BASE
    // ==========================================

    pub fn list_memories(&self) -> Result<Vec<MemoryRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, keywords, response, match_mode, category, created_at, updated_at, updated_by_user_id
                 FROM memories
                 ORDER BY id ASC",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                let keywords_raw: String = row.get(1)?;
                let keywords: Vec<String> = serde_json::from_str(&keywords_raw).unwrap_or_default();
                Ok(MemoryRecord {
                    id: row.get(0)?,
                    keywords,
                    response: row.get(2)?,
                    match_mode: row.get(3)?,
                    category: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                    updated_by_user_id: row.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut results = Vec::new();
        for r in rows {
            results.push(r.map_err(|e| e.to_string())?);
        }
        Ok(results)
    }

    pub fn insert_memory(
        &self,
        keywords: &[String],
        response: &str,
        match_mode: &str,
        category: &str,
        user_id: Option<&str>,
    ) -> Result<MemoryRecord, String> {
        if keywords.is_empty() {
            return Err("Memory must contain at least one keyword.".to_string());
        }
        if response.trim().is_empty() {
            return Err("Memory response cannot be empty.".to_string());
        }

        let keywords_json = serde_json::to_string(keywords)
            .map_err(|e| format!("Failed to serialize keywords: {e}"))?;
        let now = now_timestamp();

        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO memories (keywords, response, match_mode, category, created_at, updated_at, updated_by_user_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6)",
            params![keywords_json, response, match_mode, category, now, user_id],
        )
        .map_err(|e| format!("Failed to insert memory: {e}"))?;

        let id = conn.last_insert_rowid();

        Ok(MemoryRecord {
            id,
            keywords: keywords.to_vec(),
            response: response.to_string(),
            match_mode: match_mode.to_string(),
            category: category.to_string(),
            created_at: now,
            updated_at: now,
            updated_by_user_id: user_id.map(|u| u.to_string()),
        })
    }

    pub fn update_memory(
        &self,
        id: i64,
        keywords: &[String],
        response: &str,
        match_mode: &str,
        category: &str,
        user_id: Option<&str>,
    ) -> Result<MemoryRecord, String> {
        if keywords.is_empty() {
            return Err("Memory must contain at least one keyword.".to_string());
        }
        if response.trim().is_empty() {
            return Err("Memory response cannot be empty.".to_string());
        }

        let keywords_json = serde_json::to_string(keywords)
            .map_err(|e| format!("Failed to serialize keywords: {e}"))?;
        let now = now_timestamp();

        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let affected = conn
            .execute(
                "UPDATE memories
                 SET keywords = ?1, response = ?2, match_mode = ?3, category = ?4, updated_at = ?5, updated_by_user_id = ?6
                 WHERE id = ?7",
                params![keywords_json, response, match_mode, category, now, user_id, id],
            )
            .map_err(|e| format!("Failed to update memory: {e}"))?;

        if affected == 0 {
            return Err(format!("Memory #{id} not found."));
        }

        // Fetch created_at
        let created_at: i64 = conn
            .query_row("SELECT created_at FROM memories WHERE id = ?1", params![id], |row| {
                row.get(0)
            })
            .map_err(|e| e.to_string())?;

        Ok(MemoryRecord {
            id,
            keywords: keywords.to_vec(),
            response: response.to_string(),
            match_mode: match_mode.to_string(),
            category: category.to_string(),
            created_at,
            updated_at: now,
            updated_by_user_id: user_id.map(|u| u.to_string()),
        })
    }

    pub fn delete_memory(&self, id: i64) -> Result<bool, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let affected = conn
            .execute("DELETE FROM memories WHERE id = ?1", params![id])
            .map_err(|e| format!("Failed to delete memory #{id}: {e}"))?;
        Ok(affected > 0)
    }

    /// Import memories from an existing `knowledge.json` file in one atomic transaction.
    /// Supports both wrapped `{"patterns": [...]}` and raw list `[...]` formats,
    /// and avoids inserting duplicates if a pattern with matching normalized keywords already exists.
    pub fn import_memories_from_json(&self, path: &Path) -> Result<ImportStats, String> {
        if !path.exists() {
            return Ok(ImportStats {
                total_read: 0,
                inserted: 0,
                skipped: 0,
                rejected: 0,
            });
        }

        let raw = std::fs::read_to_string(path)
            .map_err(|e| format!("Failed to read knowledge file {:?}: {e}", path))?;

        #[derive(Deserialize)]
        struct RawPattern {
            keywords: Vec<String>,
            response: String,
            #[serde(default = "default_match_mode")]
            match_mode: String,
            #[serde(default = "default_category")]
            category: String,
        }

        fn default_match_mode() -> String {
            "phrase".to_string()
        }
        fn default_category() -> String {
            "general".to_string()
        }

        #[derive(Deserialize)]
        #[serde(untagged)]
        enum RawKnowledgePayload {
            Wrapped { patterns: Vec<RawPattern> },
            List(Vec<RawPattern>),
        }

        let patterns = match serde_json::from_str::<RawKnowledgePayload>(&raw) {
            Ok(RawKnowledgePayload::Wrapped { patterns }) => patterns,
            Ok(RawKnowledgePayload::List(patterns)) => patterns,
            Err(e) => return Err(format!("Failed to parse knowledge json: {e}")),
        };

        let total_read = patterns.len();
        let mut inserted = 0;
        let mut skipped = 0;
        let mut rejected = 0;
        let now = now_timestamp();

        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        // Query existing keyword sets from memories table to prevent duplicate insertion
        let mut existing_keyword_sets: std::collections::HashSet<Vec<String>> =
            std::collections::HashSet::new();
        {
            let mut stmt = tx
                .prepare("SELECT keywords FROM memories")
                .map_err(|e| format!("Failed to query existing memories: {e}"))?;
            let rows = stmt
                .query_map([], |row| {
                    let kw_raw: String = row.get(0)?;
                    let mut kws: Vec<String> = serde_json::from_str(&kw_raw).unwrap_or_default();
                    kws.sort();
                    Ok(kws)
                })
                .map_err(|e| e.to_string())?;

            for r in rows {
                if let Ok(kws) = r {
                    if !kws.is_empty() {
                        existing_keyword_sets.insert(kws);
                    }
                }
            }
        }

        for p in patterns {
            let mut clean_keywords: Vec<String> = Vec::new();
            for k in p.keywords {
                let norm = k.trim().to_lowercase();
                if !norm.is_empty() && !clean_keywords.contains(&norm) {
                    clean_keywords.push(norm);
                }
            }

            if clean_keywords.is_empty() || p.response.trim().is_empty() {
                rejected += 1;
                continue;
            }

            let mut sort_key = clean_keywords.clone();
            sort_key.sort();
            if existing_keyword_sets.contains(&sort_key) {
                skipped += 1;
                continue;
            }

            let kw_json = match serde_json::to_string(&clean_keywords) {
                Ok(j) => j,
                Err(_) => {
                    rejected += 1;
                    continue;
                }
            };

            let match_mode = if p.match_mode.trim().is_empty() {
                "phrase"
            } else {
                p.match_mode.trim()
            };

            let category = if p.category.trim().is_empty() {
                "general"
            } else {
                p.category.trim()
            };

            let res = tx.execute(
                "INSERT INTO memories (keywords, response, match_mode, category, created_at, updated_at, updated_by_user_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?5, NULL)",
                params![kw_json, p.response.trim(), match_mode, category, now],
            );

            match res {
                Ok(_) => {
                    existing_keyword_sets.insert(sort_key);
                    inserted += 1;
                }
                Err(_) => rejected += 1,
            }
        }

        tx.commit().map_err(|e| format!("Failed to commit imported memories: {e}"))?;

        Ok(ImportStats {
            total_read,
            inserted,
            skipped,
            rejected,
        })
    }

    // ==========================================
    // AI USAGE & QUOTA LIMITS
    // ==========================================

    pub fn record_ai_usage(
        &self,
        user_id: &str,
        model: &str,
        input_tokens: Option<i64>,
        output_tokens: Option<i64>,
        request_status: &str,
    ) -> Result<String, String> {
        let usage_id = generate_secure_id("usg");
        let now = now_timestamp();

        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO ai_usage (id, user_id, occurred_at, model, input_tokens, output_tokens, request_status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![usage_id, user_id, now, model, input_tokens, output_tokens, request_status],
        )
        .map_err(|e| format!("Failed to record AI usage: {e}"))?;

        Ok(usage_id)
    }

    pub fn count_user_requests_since(&self, user_id: &str, since_timestamp: i64) -> Result<i64, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM ai_usage WHERE user_id = ?1 AND occurred_at >= ?2",
                params![user_id, since_timestamp],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        Ok(count)
    }

    pub fn count_global_requests_since(&self, since_timestamp: i64) -> Result<i64, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM ai_usage WHERE occurred_at >= ?1",
                params![since_timestamp],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        Ok(count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_password_hashing_and_verification() {
        let pass = "CorrectHorseBattery99!";
        let hash = hash_password(pass).expect("Should hash password");
        assert!(verify_password(pass, &hash));
        assert!(!verify_password("WrongPassword123!", &hash));
    }

    #[test]
    fn test_token_digest_and_constant_time_comparison() {
        let token = generate_secure_token();
        let pepper = "test-pepper-123";
        let digest1 = digest_token(&token, pepper);
        let digest2 = digest_token(&token, pepper);
        assert_eq!(digest1, digest2);
        assert!(constant_time_eq_str(&digest1, &digest2));
        assert!(!constant_time_eq_str(&digest1, "different-hash-value"));
    }

    #[test]
    fn test_database_migrations_and_user_creation() {
        let db = Database::open_in_memory().expect("Should create in-memory database");
        assert!(!db.has_admin_user().unwrap());

        // Create normal user
        let pass_hash = hash_password("Secret12345!").unwrap();
        let user = db
            .create_user("alice", Some("alice@example.com"), &pass_hash, "user")
            .expect("Should create user");
        assert_eq!(user.username, "alice");
        assert_eq!(user.role, "user");

        // Duplicate username should fail
        let dup_res = db.create_user("Alice", Some("alice2@example.com"), &pass_hash, "user");
        assert!(dup_res.is_err());

        // Bootstrap Admin
        let admin = db
            .bootstrap_admin("rootadmin", Some("admin@example.com"), "AdminSecretPass123!")
            .expect("Should bootstrap admin");
        assert_eq!(admin.role, "admin");
        assert!(db.has_admin_user().unwrap());

        // Second bootstrap admin must be refused
        let second_bootstrap = db.bootstrap_admin("root2", None, "AnotherSecret123!");
        assert!(second_bootstrap.is_err());
    }

    #[test]
    fn test_sessions_and_revocation() {
        let db = Database::open_in_memory().unwrap();
        let pass_hash = hash_password("Password123!").unwrap();
        let user = db.create_user("bob", None, &pass_hash, "user").unwrap();

        let raw_token = generate_secure_token();
        let token_digest = digest_token(&raw_token, "");
        let csrf_token = generate_secure_token();
        let csrf_digest = digest_token(&csrf_token, "");

        let session = db
            .create_session(&user.id, &token_digest, &csrf_digest, 3600)
            .unwrap();

        // Valid lookup
        let found = db.get_valid_session_by_token_digest(&token_digest).unwrap();
        assert!(found.is_some());
        let (s, u) = found.unwrap();
        assert_eq!(s.id, session.id);
        assert_eq!(u.id, user.id);

        // Revocation
        db.revoke_session(&session.id).unwrap();
        let after_revocation = db.get_valid_session_by_token_digest(&token_digest).unwrap();
        assert!(after_revocation.is_none());

        // Pruning removes the revoked session from the table
        let pruned = db.prune_expired_and_revoked_sessions().unwrap();
        assert_eq!(pruned, 1);
        let pruned_again = db.prune_expired_and_revoked_sessions().unwrap();
        assert_eq!(pruned_again, 0);
    }

    #[test]
    fn test_conversation_and_message_isolation() {
        let db = Database::open_in_memory().unwrap();
        let pass_hash = hash_password("PassWord123!").unwrap();
        let alice = db.create_user("alice", None, &pass_hash, "user").unwrap();
        let bob = db.create_user("bob", None, &pass_hash, "user").unwrap();

        // Alice creates conversation
        let alice_conv = db
            .create_conversation(&alice.id, Some("Alice Private Chat"))
            .unwrap();

        // Alice adds message
        let msg = db
            .add_message(&alice_conv.id, &alice.id, "user", "Hello from Alice", None)
            .unwrap();
        assert_eq!(msg.content, "Hello from Alice");

        // Bob cannot view Alice's conversation
        let bob_view = db.get_conversation_for_user(&alice_conv.id, &bob.id).unwrap();
        assert!(bob_view.is_none());

        // Bob cannot list messages in Alice's conversation
        let bob_messages = db.list_messages_for_conversation(&alice_conv.id, &bob.id);
        assert!(bob_messages.is_err());

        // Bob cannot add a message to Alice's conversation
        let bob_add = db.add_message(&alice_conv.id, &bob.id, "user", "Hacked!", None);
        assert!(bob_add.is_err());

        // Bob cannot delete Alice's conversation
        let bob_del = db.delete_conversation_for_user(&alice_conv.id, &bob.id).unwrap();
        assert!(!bob_del);

        // Alice's data still intact
        let alice_messages = db
            .list_messages_for_conversation(&alice_conv.id, &alice.id)
            .unwrap();
        assert_eq!(alice_messages.len(), 1);
        assert_eq!(alice_messages[0].content, "Hello from Alice");
    }

    #[test]
    fn test_memory_crud_and_import() {
        let db = Database::open_in_memory().unwrap();
        let memory = db
            .insert_memory(
                &["hello".to_string(), "hi".to_string()],
                "Greetings human!",
                "phrase",
                "general",
                None,
            )
            .unwrap();
        assert_eq!(memory.keywords, vec!["hello", "hi"]);

        let all = db.list_memories().unwrap();
        assert_eq!(all.len(), 1);

        let updated = db
            .update_memory(
                memory.id,
                &["hello".to_string(), "hey".to_string()],
                "Updated greeting",
                "phrase",
                "greetings",
                None,
            )
            .unwrap();
        assert_eq!(updated.response, "Updated greeting");
        assert_eq!(updated.category, "greetings");

        let deleted = db.delete_memory(memory.id).unwrap();
        assert!(deleted);
        assert_eq!(db.list_memories().unwrap().len(), 0);
    }

    #[test]
    fn test_import_memories_from_json_wrapped_and_deduplication() {
        let db = Database::open_in_memory().unwrap();
        db.insert_memory(
            &["rust".to_string()],
            "Rust language original response",
            "phrase",
            "general",
            None,
        )
        .unwrap();

        let temp_dir = std::env::temp_dir();
        let json_path = temp_dir.join(format!("test_knowledge_{}.json", now_timestamp()));

        let test_json = r#"{
            "patterns": [
                {
                    "id": 1,
                    "keywords": ["rust"],
                    "response": "Duplicate rust definition that should be skipped",
                    "match_mode": "all",
                    "category": "general"
                },
                {
                    "id": 2,
                    "keywords": ["cargo", "build"],
                    "response": "Cargo is the Rust package manager.",
                    "match_mode": "all",
                    "category": "tooling"
                },
                {
                    "id": 3,
                    "keywords": [],
                    "response": "Should be rejected because keywords are empty",
                    "match_mode": "all",
                    "category": "tooling"
                }
            ]
        }"#;

        std::fs::write(&json_path, test_json).unwrap();
        let stats = db.import_memories_from_json(&json_path).unwrap();
        let _ = std::fs::remove_file(&json_path);

        assert_eq!(stats.total_read, 3);
        assert_eq!(stats.inserted, 1);
        assert_eq!(stats.skipped, 1);
        assert_eq!(stats.rejected, 1);

        let all = db.list_memories().unwrap();
        assert_eq!(all.len(), 2);
        // Ensure existing memory was preserved and not overwritten
        let rust_mem = all.iter().find(|m| m.keywords == vec!["rust"]).unwrap();
        assert_eq!(rust_mem.response, "Rust language original response");
    }
}
