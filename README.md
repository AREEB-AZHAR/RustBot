# 🦀 RustBot — Knowledge Forge & AI System

RustBot is a high-performance, secure, multi-user AI chatbot and quantitative market analysis platform built in pure Rust and vanilla web technologies. 

It features sub-millisecond local fuzzy knowledge matching, self-learning memory caching, strict per-user database isolation, enterprise-grade authentication, and an embedded glassmorphic single-page web application.

---

## 🌟 Key Highlights & Features

* **⚡ Pure Rust Architecture**: Zero heavy web framework dependencies. The HTTP engine, session middleware, SQLite data layer, and fuzzy matching engine compile into a single lightweight native binary.
* **🧠 Sub-Millisecond Knowledge Matching (<1ms)**: Custom in-memory NLP pipeline using Porter stemming, stopword filtering, and Levenshtein edit distance for typo tolerance.
* **🌐 Self-Learning AI Engine**: Automatically queries upstream AI routers (`openrouter/free`, `openrouter/auto`, and free LLM endpoints) for unmatched questions, auto-tokenizes the answers, and permanently caches them into the local Knowledge Forge for instant future recall.
* **👥 Multi-User Isolation**: Built-in user accounts, secure sessions, and isolated private conversation threads. Users can create, switch between, and delete their own chat threads.
* **🧮 Built-in Tool Engines**:
  * **Math Solver**: Instant evaluation of mathematical expressions (e.g., `25 * 40 + 15`).
  * **Live Market Lab**: Quantitative cryptocurrency market structure analysis, candlestick charting, and machine learning directional models.
* **🎨 Modern Vanilla Web Interface**: Zero Node.js or npm build steps required. HTML, CSS, and JavaScript are bundled directly into the Rust binary.

---

## 🔒 Security Architecture

RustBot is engineered with a security-first approach to protect user privacy and system integrity:

### 1. Password Hashing with Argon2id
* Passwords are never stored in plaintext or weak hashes.
* User credentials are encrypted using **Argon2id** (the PHC winner) with cryptographically secure random salts.

### 2. Double-Digest Session Storage
* Raw session tokens and CSRF tokens are generated via a Cryptographically Secure Pseudo-Random Number Generator (CSPRNG).
* Raw tokens are **never stored in the database**. The server computes a one-way `SHA-256` digest combined with a secret server pepper before database insertion. Even if a database backup is leaked, active sessions cannot be hijacked.

### 3. Timing Attack Mitigation
* All token and header comparisons use **constant-time byte equality verification** (`subtle::ConstantTimeEq`), eliminating side-channel timing attacks.

### 4. Hardened Cookie & CSRF Defense
* Session identifiers are transmitted exclusively via `HttpOnly`, `SameSite=Strict`, and `Path=/` cookies (with `Secure` and `__Host-` prefixes enforced in production).
* All state-mutating requests (`POST`, `DELETE`) require origin verification and a synchronized `X-RustBot-CSRF` token header.

### 5. 100% SQL Injection Immunity
* All SQLite queries are executed using **parameterized prepared statements** (`rusqlite::params!`).
* User inputs are treated strictly as data bytes by the query engine, completely preventing SQL injection.

### 6. Zero Client-Side Data Leakage
* The browser `localStorage` stores **zero private chat logs, database files, or API keys**.
* All conversation data is stored server-side and fetched on demand by authenticated sessions.

### 7. Traffic Throttling & Connection Safety
* **Sliding-Window IP Rate Limiter**: Automatically rate-limits rapid requests to prevent brute-force attacks.
* **Atomic Connection Concurrency Limiter**: Limits concurrent TCP worker threads to protect system resources.

---

## 🗄️ How Memory is Managed

| Question | Architectural Answer |
| :--- | :--- |
| **Where is memory stored?** | **100% Server-Side.** Persisted on disk in SQLite (`rustbot.db` in WAL mode) and cached in RAM inside a thread-safe `Arc<RwLock<KnowledgeStore>>` for instant lookups. |
| **How is memory fetched?** | Queries are tokenized, stemmed, and scored against in-memory patterns. Exact matches and typo-tolerant fuzzy matches resolve in under 1 millisecond. |
| **What if a prompt has multiple questions?** | Candidate memories are ranked by match density. If a multi-topic prompt exceeds local memory boundaries, it automatically escalates to Web AI, which answers all components cleanly without corrupting local data. |
| **Are conversations private?** | **Yes.** Chat threads and messages are strictly constrained to the authenticated user ID (`WHERE user_id = ?`). |

---

## 🚀 Quick Start Guide

### Prerequisites
* [Rust & Cargo](https://rustup.rs/) (version 1.75 or newer)
* **No external databases or Node.js required!** (SQLite is bundled directly inside the Rust build).

### 1. Clone & Run

```bash
# Clone the repository
git clone <repository-url>
cd RustBot

# Start the server (Development Mode)
cargo run
```

The application will start listening on:  
👉 **`http://127.0.0.1:7878`**

### 2. User Registration & Login
1. Open [http://127.0.0.1:7878](http://127.0.0.1:7878) in your web browser.
2. Click **Create Account** in the authentication modal.
3. Enter your desired **Username** (3–32 characters) and **Password** (min 8 characters).
4. You are immediately logged in with your private workspace, persistent conversation sidebar, and personal chat history!

---

## ⚙️ Optional Environment Configuration

To configure optional external AI features or production settings, create a `.env` file in the project root:

```ini
# Environment Mode (development | production)
RUSTBOT_ENV=development

# Server Binding
RUSTBOT_HOST=127.0.0.1
RUSTBOT_PORT=7878

# Optional: OpenRouter AI Key for live web fallback
OPENROUTER_API_KEY="your-openrouter-key-here"

# Optional: CoinGecko API Key for crypto market data
COINGECKO_API_KEY="your-coingecko-key-here"
```

*(Note: RustBot runs completely offline with full local knowledge matching, math solving, and market analysis even without API keys).*

---

## 🧪 Verification & Automated Testing

RustBot includes a comprehensive automated test suite verifying password hashing, database isolation, token digests, session expiration, and fuzzy text search:

```bash
# Run all unit and integration tests
cargo test
```

```bash
# Check formatting and linting
cargo fmt -- --check
cargo clippy -- -D warnings
```

---

## 📄 License
This project is developed for educational and research purposes.
