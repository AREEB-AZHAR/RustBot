---
name: rust-multiuser-ai-chatbot
description: >-
  Architectural blueprint and implementation guide for building secure, high-performance,
  multi-user AI chatbots and full-stack web applications in pure Rust and SQLite with
  vanilla web interfaces. Covers session cookies, CSRF protection, Argon2id hashing,
  per-user database isolation, rate limiting, and local fuzzy AI memory stores.
---

# Rust Multi-User AI Chatbot & Secure Full-Stack Architecture

A complete guide and reusable reference for building and maintaining production-ready, secure multi-user AI chat systems and applications in Rust with zero heavy framework overhead.

## Overview

This skill captures the end-to-end patterns developed for **RustBot**:
1. **Security-First Multi-User Sessions**: Argon2id password hashing, constant-time comparisons (`subtle`), double-digest session tokens (SHA-256 + pepper), `HttpOnly` / `SameSite=Strict` cookies, and origin + header CSRF validation.
2. **SQLite Multi-User Isolation**: WAL mode, foreign key enforcement, busy timeout locks, schema migrations, and per-user row scoping for conversations and messages.
3. **Pure Rust HTTP Server Engine**: Lightweight TCP stream parsing, connection concurrency limits, IP token-bucket rate limiting, and RESTful routing.
4. **Local Fuzzy Memory & AI Proxy**: Fast tokenization, Levenshtein distance matching, stemming, admin-only memory modification, and secure server-side AI API key proxying with per-user spend quotas.
5. **Modern Vanilla Web Interface**: Glassmorphic, dark-mode SPA without node build steps or frontend framework bloat.

---

## Core Security & Architecture Rules

### 1. Password Hashing & Secret Security
* **Argon2id**: Always use Argon2id with random salt (e.g. via `argon2` crate) for user password hashing.
* **Peppered Token Storage**: Never store raw session tokens or CSRF tokens in database tables. Store their SHA-256 digest combined with a server-side `SESSION_PEPPER`.
* **Timing Attack Prevention**: Always use constant-time equality comparisons (`subtle::ConstantTimeEq`) when checking token digests or authorization headers.
* **No Client Secrets**: Never send upstream API keys (e.g. OpenRouter, OpenAI, CoinGecko) to the browser. Never store secrets in browser `localStorage`. Rely exclusively on server `.env` config.

### 2. Cookie & CSRF Hardening
* **Development vs Production Cookies**:
  * Development: `rustbot_session=<token>; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800`
  * Production: `__Host-rustbot_session=<token>; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=604800`
* **CSRF Validation on State Mutations**:
  * For all `POST`, `PUT`, `PATCH`, `DELETE` requests:
    1. Verify `Origin` matches trusted origin (`http://127.0.0.1:<port>` or production `PUBLIC_ORIGIN`).
    2. Check `X-RustBot-CSRF` request header. Digest the incoming header value with `SESSION_PEPPER` and verify equality with `session.csrf_token_digest` in constant time.

### 3. Database Isolation (SQLite)
* **Connection Settings**:
  ```sql
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  PRAGMA synchronous = NORMAL;
  ```
* **Strict Per-User Row Scoping**:
  * Conversations: `SELECT * FROM conversations WHERE user_id = ?`
  * Messages: Verify parent conversation belongs to the authenticated user before insertion or retrieval.
  * Admin Features: Enforce `user.role == "admin"` on global knowledge / memory tables.

---

## Quick Reference Recipes

### Recipe 1: Argon2id Password Hashing & Verification
```rust
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};

pub fn hash_password(password: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    argon2
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|e| format!("Password hashing failed: {e}"))
}

pub fn verify_password(password: &str, hash: &str) -> bool {
    let parsed_hash = match PasswordHash::new(hash) {
        Ok(h) => h,
        Err(_) => return false,
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok()
}
```

### Recipe 2: Double-Digest Token Verification
```rust
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

pub fn digest_token(raw_token: &str, pepper: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(raw_token.as_bytes());
    hasher.update(b":");
    hasher.update(pepper.as_bytes());
    hex::encode(hasher.finalize())
}

pub fn constant_time_eq_str(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.as_bytes().ct_eq(b.as_bytes()).into()
}
```

### Recipe 3: CLI Administrative Commands
Always provide dedicated CLI bootstrapping commands in `main.rs`:
```bash
# Bootstrap administrator account safely in terminal
cargo run -- --bootstrap-admin

# Import pre-existing knowledge JSON file into SQLite
cargo run -- --import-knowledge ./knowledge.json
```

---

## Common Mistakes & Pitfalls

1. **Storing Raw Tokens in Database**: If a database backup leaks, raw session tokens allow immediate account hijacking. Always store one-way digests.
2. **Missing SameSite or Path on Cookie**: Missing `Path=/` or `SameSite=Strict` allows cross-site leakage or partial path leakage.
3. **Using Client-Side Chat Storage for Sensitive Data**: Storing full transcripts in unencrypted `localStorage` exposes them to XSS attacks and shared-browser profile leaks. Always persist conversations server-side with per-user foreign keys.
4. **SQLite Concurrency Deadlocks**: Forgetting WAL mode or busy timeout leads to `database is locked` errors during concurrent HTTP connections. Always enable `journal_mode=WAL` and `busy_timeout=5000`.
