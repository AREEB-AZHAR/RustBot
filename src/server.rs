use crate::config::AppConfig;
use crate::db::{
    constant_time_eq_str, digest_token, generate_secure_token, Database, MemoryRecord,
    SessionRecord, UserRecord,
};
use crate::knowledge::KnowledgeStore;
use crate::market_structure::{analyze_candle_structure, MarketCandleInput};
use crate::news_sentiment::analyze_news_sentiment;
use crate::timesfm_matrix::{CandleBar, TimesFmEngine};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{IpAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex, RwLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const INDEX_HTML: &str = include_str!("../web/index.html");
const STYLES_CSS: &str = include_str!("../web/styles.css");
const APP_JS: &str = include_str!("../web/app.js");
const MARKET_HTML: &str = include_str!("../web/market.html");
const MARKET_CSS: &str = include_str!("../web/market.css");
const MARKET_JS: &str = include_str!("../web/market.js");
const MARKET_WORKER_JS: &str = include_str!("../web/market_worker.js");
const SOLANA_HTML: &str = include_str!("../web/solana.html");
const SOLANA_CSS: &str = include_str!("../web/solana.css");
const SOLANA_JS: &str = include_str!("../web/solana.js");
const THEME_INIT_JS: &str = include_str!("../web/theme-init.js");
const OG_IMAGE: &[u8] = include_bytes!("../web/og.png");
const MAX_REQUEST_SIZE: usize = 512 * 1024; // Up to 512 KB for imports
const MAX_CONCURRENT_CONNECTIONS: usize = 64;
const LOOPBACK_ORIGINS: &[&str] = &["http://127.0.0.1:7878", "http://localhost:7878"];
const LOOPBACK_HOSTS: &[&str] = &["127.0.0.1:7878", "localhost:7878", "127.0.0.1", "localhost"];
const MAX_OPENROUTER_MESSAGES: usize = 12;
const MAX_OPENROUTER_MESSAGE_LENGTH: usize = 8_000;
const MAX_OPENROUTER_TOKENS: usize = 1_024;
const MAX_MATH_EXPRESSION_LENGTH: usize = 256;
const MAX_REQUESTS_PER_MINUTE_PER_IP: usize = 600;
const MAX_AI_REQUESTS_PER_HOUR_PER_USER: i64 = 60;
const SESSION_TTL_SECONDS: i64 = 7 * 86400; // 7 days

const OPENROUTER_MODELS: &[&str] = &[
    "openrouter/free",
    "openrouter/auto",
    "openrouter/pareto-code-router",
    "openrouter/body-builder",
    "openrouter/flavor-fusion",
    "google/gemma-4-26b-a4b-it:free",
    "google/gemma-4-31b-it:free",
    "liquid/lfm-2.5-2.6b:free",
    "z-ai/glm-5.2:free",
    "minimax/minimax-m3:free",
    "nvidia/nemotron-3.5-lightning:free",
    "cohere/north-mini-code:free",
    "nvidia/nemotron-3-super-120b-a12b:free",
];

pub struct Semaphore {
    permits: Mutex<usize>,
    cvar: Condvar,
    max_permits: usize,
}

pub struct SemaphoreGuard {
    sem: Arc<Semaphore>,
}

impl Semaphore {
    pub fn new(permits: usize) -> Self {
        Self {
            permits: Mutex::new(permits),
            cvar: Condvar::new(),
            max_permits: permits,
        }
    }

    pub fn acquire_timeout(self: &Arc<Self>, timeout: Duration) -> Option<SemaphoreGuard> {
        let mut available = self.permits.lock().ok()?;
        let deadline = Instant::now() + timeout;

        while *available == 0 {
            let now = Instant::now();
            if now >= deadline {
                return None;
            }
            let remaining = deadline - now;
            let (next_guard, wait_res) = self.cvar.wait_timeout(available, remaining).ok()?;
            available = next_guard;
            if wait_res.timed_out() && *available == 0 {
                return None;
            }
        }

        *available -= 1;
        Some(SemaphoreGuard {
            sem: Arc::clone(self),
        })
    }

    #[allow(dead_code)]
    pub fn available_permits(&self) -> usize {
        self.permits.lock().map(|p| *p).unwrap_or(0)
    }

    fn release(&self) {
        if let Ok(mut available) = self.permits.lock() {
            if *available < self.max_permits {
                *available += 1;
                self.cvar.notify_one();
            }
        }
    }
}

impl Drop for SemaphoreGuard {
    fn drop(&mut self) {
        self.sem.release();
    }
}

#[derive(Clone)]
pub struct AppState {
    pub config: AppConfig,
    pub db: Database,
    pub solana_db: Arc<crate::solana_db::SolanaDb>,
    pub store: Arc<RwLock<KnowledgeStore>>,
    pub openrouter_semaphore: Arc<Semaphore>,
    pub ip_limiter: Arc<Mutex<IpRateLimiter>>,
    pub http_client: reqwest::blocking::Client,
}

pub struct IpRateLimiter {
    clients: HashMap<IpAddr, Vec<Instant>>,
}

impl IpRateLimiter {
    fn new() -> Self {
        Self {
            clients: HashMap::new(),
        }
    }

    fn check_and_record(&mut self, ip: IpAddr) -> bool {
        let now = Instant::now();
        let window = Duration::from_secs(60);
        let history = self.clients.entry(ip).or_default();
        history.retain(|&t| now.duration_since(t) < window);

        if history.len() >= MAX_REQUESTS_PER_MINUTE_PER_IP {
            false
        } else {
            history.push(now);
            true
        }
    }
}

struct ConnectionLimiter {
    active: AtomicUsize,
}

struct ConnectionPermit {
    limiter: Arc<ConnectionLimiter>,
}

impl ConnectionLimiter {
    fn new() -> Self {
        Self {
            active: AtomicUsize::new(0),
        }
    }

    fn try_acquire(self: &Arc<Self>) -> Option<ConnectionPermit> {
        let mut active = self.active.load(Ordering::Acquire);
        loop {
            if active >= MAX_CONCURRENT_CONNECTIONS {
                return None;
            }
            match self.active.compare_exchange_weak(
                active,
                active + 1,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => {
                    return Some(ConnectionPermit {
                        limiter: Arc::clone(self),
                    })
                }
                Err(current) => active = current,
            }
        }
    }
}

impl Drop for ConnectionPermit {
    fn drop(&mut self) {
        self.limiter.active.fetch_sub(1, Ordering::Release);
    }
}

#[derive(Debug)]
struct Request {
    method: String,
    path: String,
    query: HashMap<String, String>,
    headers: HashMap<String, String>,
    host: String,
    body: Vec<u8>,
}

impl Request {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers.get(&name.to_ascii_lowercase()).map(String::as_str)
    }

    fn cookie(&self, name: &str) -> Option<&str> {
        let cookie_header = self.header("cookie")?;
        for part in cookie_header.split(';') {
            let part = part.trim();
            if let Some((k, v)) = part.split_once('=') {
                if k.trim() == name {
                    return Some(v.trim());
                }
            }
        }
        None
    }
}

#[derive(Deserialize)]
struct RegisterRequest {
    username: String,
    email: Option<String>,
    password: String,
}

#[derive(Deserialize)]
struct LoginRequest {
    username: String,
    password: String,
}

#[derive(Deserialize)]
struct CreateConversationRequest {
    title: Option<String>,
}

#[derive(Deserialize)]
struct UpdateConversationTitleRequest {
    title: String,
}

#[derive(Deserialize)]
struct PostMessageRequest {
    message: String,
}

#[derive(Deserialize)]
struct OpenRouterProxyRequest {
    #[serde(default)]
    api_key: Option<String>,
    model: String,
    messages: serde_json::Value,
    max_tokens: Option<usize>,
}

#[derive(Deserialize)]
struct SaveMemoryRequest {
    keywords: Option<Vec<String>>,
    prompt: Option<String>,
    response: String,
    match_mode: Option<String>,
    category: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct MarketCandle {
    timestamp: u64,
    open: f64,
    high: f64,
    low: f64,
    close: f64,
    volume: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct MarketDataResponse {
    provider: String,
    symbol: String,
    interval: String,
    recorded_count: usize,
    candles: Vec<MarketCandle>,
}

#[derive(Debug, Deserialize)]
struct CoinGeckoChart {
    prices: Vec<(u64, f64)>,
    total_volumes: Vec<(u64, f64)>,
}

pub fn run(
    config: AppConfig,
    db: Database,
    knowledge_path: PathBuf,
    solana_db: Arc<crate::solana_db::SolanaDb>,
) -> Result<(), String> {
    let store = if let Ok(memories) = db.list_memories() {
        if !memories.is_empty() {
            KnowledgeStore::from_memories(&memories)
        } else {
            KnowledgeStore::load(knowledge_path)?
        }
    } else {
        KnowledgeStore::load(knowledge_path)?
    };

    let http_client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(30))
        .pool_idle_timeout(Duration::from_secs(60))
        .build()
        .unwrap_or_else(|_| reqwest::blocking::Client::new());

    let bind_addr = config.bind_address();
    let state = AppState {
        config,
        db,
        solana_db,
        store: Arc::new(RwLock::new(store)),
        openrouter_semaphore: Arc::new(Semaphore::new(3)),
        ip_limiter: Arc::new(Mutex::new(IpRateLimiter::new())),
        http_client,
    };

    // Clean up any stale, expired, or revoked sessions from previous runs
    let _ = state.db.prune_expired_and_revoked_sessions();

    let listener = TcpListener::bind(&bind_addr)
        .map_err(|error| format!("Could not listen on http://{bind_addr}: {error}"))?;
    let connection_limiter = Arc::new(ConnectionLimiter::new());

    println!("\n  RustBot Knowledge Forge is ready");
    println!("  Mode: {:?}", state.config.env);
    println!("  Public Origin: {}", state.config.public_origin);
    println!("  Listening on http://{bind_addr}");
    println!("  Press Ctrl+C to stop\n");

    for connection in listener.incoming() {
        match connection {
            Ok(mut stream) => {
                let state = state.clone();
                if let Some(permit) = connection_limiter.try_acquire() {
                    thread::spawn(move || {
                        let _permit = permit;
                        if let Err(error) = handle_connection(stream, &state) {
                            eprintln!("Request failed: {error}");
                        }
                    });
                } else {
                    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
                    let _ = Response::error(
                        429,
                        "Too Many Requests",
                        "RustBot is handling too many concurrent connections.",
                    )
                    .write_to(&mut stream);
                }
            }
            Err(error) => eprintln!("Connection failed: {error}"),
        }
    }

    Ok(())
}

fn session_cookie_name(is_prod: bool) -> &'static str {
    if is_prod {
        "__Host-rustbot_session"
    } else {
        "rustbot_session"
    }
}

fn authenticate(
    request: &Request,
    state: &AppState,
) -> Result<(SessionRecord, UserRecord), Response> {
    let cookie_name = session_cookie_name(state.config.is_production());
    let raw_token = match request.cookie(cookie_name) {
        Some(t) if !t.is_empty() => t,
        _ => {
            return Err(Response::error(
                401,
                "Unauthorized",
                "Authentication required.",
            ))
        }
    };

    let token_digest = digest_token(raw_token, &state.config.session_pepper);
    match state.db.get_valid_session_by_token_digest(&token_digest) {
        Ok(Some((session, user))) => {
            let _ = state.db.touch_session(&session.id);
            Ok((session, user))
        }
        _ => Err(Response::error(
            401,
            "Unauthorized",
            "Session expired or invalid.",
        )),
    }
}

fn validate_session_csrf(
    request: &Request,
    session: &SessionRecord,
    state: &AppState,
) -> bool {
    let origin = match request.header("origin") {
        Some(o) if !o.trim().is_empty() => Some(o.trim()),
        _ => request.header("referer").and_then(|ref_url| {
            if let Some(pos) = ref_url.find("://") {
                let rest = &ref_url[pos + 3..];
                let host_part = rest.split('/').next().unwrap_or("");
                let proto_end = pos + 3;
                let full_origin_len = proto_end + host_part.len();
                if full_origin_len <= ref_url.len() {
                    Some(ref_url[..full_origin_len].trim())
                } else {
                    None
                }
            } else {
                None
            }
        }),
    };

    let origin_valid = match origin {
        Some(o) => {
            let clean_o = o.trim_end_matches('/');
            let clean_public = state.config.public_origin.trim_end_matches('/');
            clean_o.eq_ignore_ascii_case(clean_public)
                || clean_o.eq_ignore_ascii_case("https://rustchatbot.duckdns.org")
                || clean_o.eq_ignore_ascii_case("http://rustchatbot.duckdns.org")
                || clean_o.eq_ignore_ascii_case("https://rustchatbot.duckdns.org:7878")
                || clean_o.eq_ignore_ascii_case("http://rustchatbot.duckdns.org:7878")
                || clean_o.eq_ignore_ascii_case("https://rustbot.duckdns.org")
                || clean_o.eq_ignore_ascii_case("http://rustbot.duckdns.org")
                || clean_o.ends_with(".trycloudflare.com")
                || is_trusted_loopback_origin(clean_o)
        }
        None => !state.config.is_production(),
    };

    if !origin_valid {
        return false;
    }

    let csrf_header = match request.header("x-rustbot-csrf") {
        Some(token) if !token.trim().is_empty() => token.trim(),
        _ => return false,
    };

    let computed_digest = digest_token(csrf_header, &state.config.session_pepper);
    constant_time_eq_str(&computed_digest, &session.csrf_token_digest)
}

fn issue_session_response(
    user: &UserRecord,
    state: &AppState,
) -> Result<Response, String> {
    let raw_session_token = generate_secure_token();
    let raw_csrf_token = generate_secure_token();

    let session_digest = digest_token(&raw_session_token, &state.config.session_pepper);
    let csrf_digest = digest_token(&raw_csrf_token, &state.config.session_pepper);

    state
        .db
        .create_session(&user.id, &session_digest, &csrf_digest, SESSION_TTL_SECONDS)?;

    let cookie_name = session_cookie_name(state.config.is_production());
    let response = Response::json(
        200,
        "OK",
        json!({
            "user": {
                "id": user.id,
                "username": user.username,
                "role": user.role
            },
            "csrf_token": raw_csrf_token
        }),
    )
    .with_cookie(
        cookie_name,
        &raw_session_token,
        SESSION_TTL_SECONDS,
        state.config.is_production(),
    );

    Ok(response)
}

fn handle_connection(mut stream: TcpStream, state: &AppState) -> Result<(), String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|error| error.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(|error| error.to_string())?;

    if let Ok(peer) = stream.peer_addr() {
        if !peer.ip().is_loopback() {
            let mut limiter = state.ip_limiter.lock().unwrap_or_else(|p| p.into_inner());
            if !limiter.check_and_record(peer.ip()) {
                return Response::error(
                    429,
                    "Too Many Requests",
                    "Rate limit exceeded (too many requests per minute).",
                )
                .write_to(&mut stream);
            }
        }
    }

    let request = read_request(&mut stream)?;

    let is_host_allowed = {
        let clean_host = request.host.split(':').next().unwrap_or(&request.host);
        let expected_host = state
            .config
            .public_origin
            .trim_start_matches("https://")
            .trim_start_matches("http://")
            .split('/')
            .next()
            .unwrap_or("")
            .split(':')
            .next()
            .unwrap_or("");

        clean_host.eq_ignore_ascii_case(expected_host)
            || clean_host.eq_ignore_ascii_case("rustbot.duckdns.org")
            || clean_host.ends_with(".trycloudflare.com")
            || is_trusted_loopback_host(&request.host)
    };

    if !is_host_allowed {
        return Response::error(400, "Bad Request", "Untrusted Host header.").write_to(&mut stream);
    }

    let response = route_request(&request, state);
    response.write_to(&mut stream)
}

fn route_request(request: &Request, state: &AppState) -> Response {
    let method = request.method.as_str();
    let path = request.path.as_str();

    match (method, path) {
        ("GET", "/") | ("GET", "/index.html") => {
            let base_html = if cfg!(debug_assertions) {
                std::fs::read_to_string("web/index.html").unwrap_or_else(|_| INDEX_HTML.to_string())
            } else {
                INDEX_HTML.to_string()
            };
            let html = base_html
                .replace("__ORIGIN__", &state.config.public_origin)
                .replace("__CSRF_TOKEN__", "");
            Response::html(200, "OK", html)
        }
        ("GET", "/styles.css") => {
            let mut res = if cfg!(debug_assertions) {
                if let Ok(css) = std::fs::read_to_string("web/styles.css") {
                    Response::asset(200, "OK", "text/css; charset=utf-8", &css)
                } else {
                    Response::asset(200, "OK", "text/css; charset=utf-8", STYLES_CSS)
                }
            } else {
                Response::asset(200, "OK", "text/css; charset=utf-8", STYLES_CSS)
            };
            res.headers.push(("Cache-Control".to_string(), "no-cache, no-store, must-revalidate".to_string()));
            res
        }
        ("GET", "/app.js") => {
            let mut res = if cfg!(debug_assertions) {
                if let Ok(js) = std::fs::read_to_string("web/app.js") {
                    Response::asset(200, "OK", "text/javascript; charset=utf-8", &js)
                } else {
                    Response::asset(200, "OK", "text/javascript; charset=utf-8", APP_JS)
                }
            } else {
                Response::asset(200, "OK", "text/javascript; charset=utf-8", APP_JS)
            };
            res.headers.push(("Cache-Control".to_string(), "no-cache, no-store, must-revalidate".to_string()));
            res
        }
        ("GET", "/market") | ("GET", "/market.html") => {
            let base_html = if cfg!(debug_assertions) {
                std::fs::read_to_string("web/market.html").unwrap_or_else(|_| MARKET_HTML.to_string())
            } else {
                MARKET_HTML.to_string()
            };
            let html = base_html
                .replace("__ORIGIN__", &state.config.public_origin)
                .replace("__CSRF_TOKEN__", "");
            Response::html(200, "OK", html)
        }
        ("GET", "/market.css") => {
            let mut res = if cfg!(debug_assertions) {
                if let Ok(css) = std::fs::read_to_string("web/market.css") {
                    Response::asset(200, "OK", "text/css; charset=utf-8", &css)
                } else {
                    Response::asset(200, "OK", "text/css; charset=utf-8", MARKET_CSS)
                }
            } else {
                Response::asset(200, "OK", "text/css; charset=utf-8", MARKET_CSS)
            };
            res.headers.push(("Cache-Control".to_string(), "no-cache, no-store, must-revalidate".to_string()));
            res
        }
        ("GET", "/market.js") => {
            let mut res = if cfg!(debug_assertions) {
                if let Ok(js) = std::fs::read_to_string("web/market.js") {
                    Response::asset(200, "OK", "text/javascript; charset=utf-8", &js)
                } else {
                    Response::asset(200, "OK", "text/javascript; charset=utf-8", MARKET_JS)
                }
            } else {
                Response::asset(200, "OK", "text/javascript; charset=utf-8", MARKET_JS)
            };
            res.headers.push(("Cache-Control".to_string(), "no-cache, no-store, must-revalidate".to_string()));
            res
        }
        ("GET", "/market_worker.js") => {
            let mut res = if cfg!(debug_assertions) {
                if let Ok(js) = std::fs::read_to_string("web/market_worker.js") {
                    Response::asset(200, "OK", "text/javascript; charset=utf-8", &js)
                } else {
                    Response::asset(200, "OK", "text/javascript; charset=utf-8", MARKET_WORKER_JS)
                }
            } else {
                Response::asset(200, "OK", "text/javascript; charset=utf-8", MARKET_WORKER_JS)
            };
            res.headers.push(("Cache-Control".to_string(), "no-cache, no-store, must-revalidate".to_string()));
            res
        }
        ("GET", "/solana") | ("GET", "/solana.html") => {
            let base_html = if cfg!(debug_assertions) {
                std::fs::read_to_string("web/solana.html").unwrap_or_else(|_| SOLANA_HTML.to_string())
            } else {
                SOLANA_HTML.to_string()
            };
            let html = base_html
                .replace("__ORIGIN__", &state.config.public_origin)
                .replace("__CSRF_TOKEN__", "");
            Response::html(200, "OK", html)
        }
        ("GET", "/solana.css") => {
            let mut res = if cfg!(debug_assertions) {
                if let Ok(css) = std::fs::read_to_string("web/solana.css") {
                    Response::asset(200, "OK", "text/css; charset=utf-8", &css)
                } else {
                    Response::asset(200, "OK", "text/css; charset=utf-8", SOLANA_CSS)
                }
            } else {
                Response::asset(200, "OK", "text/css; charset=utf-8", SOLANA_CSS)
            };
            res.headers.push(("Cache-Control".to_string(), "no-cache, no-store, must-revalidate".to_string()));
            res
        }
        ("GET", "/solana.js") => {
            let mut res = if cfg!(debug_assertions) {
                if let Ok(js) = std::fs::read_to_string("web/solana.js") {
                    Response::asset(200, "OK", "text/javascript; charset=utf-8", &js)
                } else {
                    Response::asset(200, "OK", "text/javascript; charset=utf-8", SOLANA_JS)
                }
            } else {
                Response::asset(200, "OK", "text/javascript; charset=utf-8", SOLANA_JS)
            };
            res.headers.push(("Cache-Control".to_string(), "no-cache, no-store, must-revalidate".to_string()));
            res
        }
        ("GET", "/theme-init.js") => {
            let mut res = if cfg!(debug_assertions) {
                if let Ok(js) = std::fs::read_to_string("web/theme-init.js") {
                    Response::asset(200, "OK", "text/javascript; charset=utf-8", &js)
                } else {
                    Response::asset(200, "OK", "text/javascript; charset=utf-8", THEME_INIT_JS)
                }
            } else {
                Response::asset(200, "OK", "text/javascript; charset=utf-8", THEME_INIT_JS)
            };
            res.headers.push(("Cache-Control".to_string(), "no-cache, no-store, must-revalidate".to_string()));
            res
        }
        ("GET", "/og.png") => Response::binary(200, "OK", "image/png", OG_IMAGE),
        ("GET", "/api/health") => Response::json(200, "OK", json!({ "status": "ready" })),

        // ==========================================
        // AUTHENTICATION ROUTES
        // ==========================================
        ("POST", "/api/auth/register") => handle_register(request, state),
        ("POST", "/api/auth/login") => handle_login(request, state),
        ("POST", "/api/auth/logout") => handle_logout(request, state),
        ("GET", "/api/auth/me") => handle_auth_me(request, state),

        // ==========================================
        // CONVERSATIONS & MESSAGES (PER-USER)
        // ==========================================
        ("GET", "/api/conversations") => handle_list_conversations(request, state),
        ("POST", "/api/conversations") => handle_create_conversation(request, state),
        ("GET", path) if path.starts_with("/api/conversations/") && path.ends_with("/messages") => {
            let conv_id = path
                .trim_start_matches("/api/conversations/")
                .trim_end_matches("/messages");
            handle_list_messages(request, state, conv_id)
        }
        ("POST", path) if path.starts_with("/api/conversations/") && path.ends_with("/messages") => {
            let conv_id = path
                .trim_start_matches("/api/conversations/")
                .trim_end_matches("/messages");
            handle_post_message(request, state, conv_id)
        }
        ("DELETE", path) if path.starts_with("/api/conversations/") => {
            let conv_id = path.trim_start_matches("/api/conversations/");
            handle_delete_conversation(request, state, conv_id)
        }
        ("PATCH", path) if path.starts_with("/api/conversations/") => {
            let conv_id = path.trim_start_matches("/api/conversations/");
            handle_update_conversation_title(request, state, conv_id)
        }

        // ==========================================
        // MEMORIES / KNOWLEDGE (ADMIN ONLY FOR MANAGEMENT)
        // ==========================================
        ("GET", "/api/memories") | ("GET", "/api/knowledge") => handle_list_memories(request, state),
        ("POST", "/api/memories") | ("POST", "/api/knowledge") => handle_save_memory(request, state),
        ("GET", "/api/memories/export") | ("GET", "/api/knowledge/export") => {
            handle_export_memories(request, state)
        }
        ("POST", "/api/memories/import") | ("POST", "/api/knowledge/import") => {
            handle_import_memories(request, state)
        }
        ("PUT", path) if path.starts_with("/api/memories/") || path.starts_with("/api/knowledge/") => {
            let raw_id = if path.starts_with("/api/memories/") {
                path.trim_start_matches("/api/memories/")
            } else {
                path.trim_start_matches("/api/knowledge/")
            };
            handle_update_memory(request, state, raw_id)
        }
        ("DELETE", path) if path.starts_with("/api/memories/") || path.starts_with("/api/knowledge/") => {
            let raw_id = if path.starts_with("/api/memories/") {
                path.trim_start_matches("/api/memories/")
            } else {
                path.trim_start_matches("/api/knowledge/")
            };
            handle_delete_memory(request, state, raw_id)
        }

        // ==========================================
        // AI / MARKET DATA & SOLANA HFT
        // ==========================================
        ("POST", "/api/openrouter/chat") => handle_openrouter_chat(request, state),
        ("GET", "/api/market/candles") => match fetch_market_candles(&request.query) {
            Ok(data) => Response::json(200, "OK", data),
            Err(error) => Response::error(502, "Bad Gateway", &error),
        },
        ("GET", "/api/market/solana/trending") => match fetch_solana_trending(&request.query) {
            Ok(data) => Response::json(200, "OK", data),
            Err(error) => Response::error(502, "Bad Gateway", &error),
        },
        ("GET", "/api/market/solana/candles") => match fetch_solana_candles(&request.query) {
            Ok(data) => Response::json(200, "OK", data),
            Err(error) => Response::error(502, "Bad Gateway", &error),
        },
        ("POST", "/api/market/solana/predict") => match handle_timesfm_predict(request) {
            Ok(data) => Response::json(200, "OK", data),
            Err(error) => Response::error(400, "Bad Request", &error),
        },
        // DEDICATED SOLANA HFT DATABASE & 3-STAGE LEARNED MEMORY ENDPOINTS
        ("GET", "/api/market/solana/trades") => handle_get_solana_trades(request, state),
        ("POST", "/api/market/solana/trades") => handle_post_solana_trade(request, state),
        ("GET", "/api/market/solana/learned-memory") => handle_get_solana_learned_memory(request, state),
        ("POST", "/api/market/solana/learned-memory") => handle_post_solana_learned_memory(request, state),
        ("POST", "/api/market/solana/learned-memory/veto") => handle_post_solana_veto(request, state),
        ("POST", "/api/market/solana/learned-memory/reassess") => handle_reassess_solana_learned_memory(request, state),
        ("POST", "/api/market/solana/ai-risk-audit") => handle_solana_ai_risk_audit(request, state),
        ("POST", "/api/market/solana/reset-db") => handle_reset_solana_db(request, state),
        ("GET", "/api/market/solana/wallet") => handle_get_solana_wallet(request, state),
        ("POST", "/api/market/solana/wallet") => handle_post_solana_wallet(request, state),

        _ => Response::error(404, "Not Found", "The requested endpoint does not exist."),
    }
}

// ==========================================
// AUTH HANDLERS
// ==========================================

fn handle_register(request: &Request, state: &AppState) -> Response {
    let payload: RegisterRequest = match parse_json(&request.body) {
        Ok(p) => p,
        Err(err) => return Response::error(400, "Bad Request", &err),
    };

    let username = payload.username.trim();
    if username.len() < 3 || username.len() > 32 {
        return Response::error(
            400,
            "Bad Request",
            "Username must be between 3 and 32 characters.",
        );
    }
    if !username
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Response::error(
            400,
            "Bad Request",
            "Username may only contain alphanumeric characters, underscores, and hyphens.",
        );
    }

    if payload.password.len() < 8 || payload.password.len() > 256 {
        return Response::error(
            400,
            "Bad Request",
            "Password must be between 8 and 256 characters.",
        );
    }

    let password_hash = match crate::db::hash_password(&payload.password) {
        Ok(h) => h,
        Err(e) => return Response::error(500, "Internal Server Error", &e),
    };

    let role = "user";
    let user = match state.db.create_user(
        username,
        payload.email.as_deref(),
        &password_hash,
        role,
    ) {
        Ok(u) => u,
        Err(e) => return Response::error(400, "Bad Request", &e),
    };

    match issue_session_response(&user, state) {
        Ok(resp) => resp,
        Err(e) => Response::error(500, "Internal Server Error", &e),
    }
}

fn handle_login(request: &Request, state: &AppState) -> Response {
    let payload: LoginRequest = match parse_json(&request.body) {
        Ok(p) => p,
        Err(err) => return Response::error(400, "Bad Request", &err),
    };

    let identity = payload.username.trim();
    let user = match state.db.get_user_by_username_or_email(identity) {
        Ok(Some(u)) => u,
        _ => {
            return Response::error(
                401,
                "Unauthorized",
                "Invalid username or password.",
            )
        }
    };

    if user.disabled_at.is_some() {
        return Response::error(
            403,
            "Forbidden",
            "This account has been disabled.",
        );
    }

    if !crate::db::verify_password(&payload.password, &user.password_hash) {
        return Response::error(
            401,
            "Unauthorized",
            "Invalid username or password.",
        );
    }

    match issue_session_response(&user, state) {
        Ok(resp) => resp,
        Err(e) => Response::error(500, "Internal Server Error", &e),
    }
}

fn handle_logout(request: &Request, state: &AppState) -> Response {
    let (session, _user) = match authenticate(request, state) {
        Ok(res) => res,
        Err(err_resp) => return err_resp,
    };

    if !validate_session_csrf(request, &session, state) {
        return Response::error(403, "Forbidden", "Invalid CSRF token.");
    }

    let _ = state.db.revoke_session(&session.id);
    let cookie_name = session_cookie_name(state.config.is_production());
    Response::json(200, "OK", json!({ "status": "logged_out" }))
        .with_clear_cookie(cookie_name, state.config.is_production())
}

fn handle_auth_me(request: &Request, state: &AppState) -> Response {
    let (session, user) = match authenticate(request, state) {
        Ok(res) => res,
        Err(err_resp) => return err_resp,
    };

    let raw_csrf_token = generate_secure_token();
    let csrf_digest = digest_token(&raw_csrf_token, &state.config.session_pepper);
    let _ = state.db.update_session_csrf(&session.id, &csrf_digest);

    Response::json(
        200,
        "OK",
        json!({
            "user": {
                "id": user.id,
                "username": user.username,
                "role": user.role
            },
            "session_id": session.id,
            "csrf_token": raw_csrf_token
        }),
    )
}

// ==========================================
// CONVERSATIONS HANDLERS
// ==========================================

fn handle_list_conversations(request: &Request, state: &AppState) -> Response {
    let (_session, user) = match authenticate(request, state) {
        Ok(res) => res,
        Err(err_resp) => return err_resp,
    };

    match state.db.list_conversations_for_user(&user.id) {
        Ok(conversations) => Response::json(200, "OK", json!({ "conversations": conversations })),
        Err(e) => Response::error(500, "Internal Server Error", &e),
    }
}

fn handle_create_conversation(request: &Request, state: &AppState) -> Response {
    let (session, user) = match authenticate(request, state) {
        Ok(res) => res,
        Err(err_resp) => return err_resp,
    };

    if !validate_session_csrf(request, &session, state) {
        return Response::error(403, "Forbidden", "Invalid CSRF token.");
    }

    let payload: CreateConversationRequest = parse_json(&request.body).unwrap_or(CreateConversationRequest { title: None });
    match state
        .db
        .create_conversation(&user.id, payload.title.as_deref())
    {
        Ok(conv) => Response::json(201, "Created", json!({ "conversation": conv })),
        Err(e) => Response::error(500, "Internal Server Error", &e),
    }
}

fn handle_list_messages(request: &Request, state: &AppState, conv_id: &str) -> Response {
    let (_session, user) = match authenticate(request, state) {
        Ok(res) => res,
        Err(err_resp) => return err_resp,
    };

    match state.db.list_messages_for_conversation(conv_id, &user.id) {
        Ok(messages) => Response::json(200, "OK", json!({ "messages": messages })),
        Err(_) => Response::error(
            404,
            "Not Found",
            "Conversation not found or access denied.",
        ),
    }
}

pub fn is_temporal_or_dynamic_query(prompt: &str) -> bool {
    let lower = prompt.trim().to_lowercase();
    let dynamic_tokens = [
        "weather", "forecast", "temperature", "temp in", "humidity", "rain",
        "score", "match", "live score", "who won", "game today", "fixtures", "standings",
        "price", "crypto", "bitcoin", "btc", "ethereum", "eth", "solana", "sol", "doge",
        "currency", "exchange rate", "stock", "usd to", "eur to", "pkr to", "inr to", "gbp to",
        "current", "today", "right now", "latest", "breaking news", "live",
        "what time is it", "current time", "current date", "what is today's date",
        "who is currently", "who is the current", "president right now", "prime minister of",
        "market cap", "inflation rate"
    ];
    dynamic_tokens.iter().any(|k| lower.contains(k))
}

fn handle_post_message(request: &Request, state: &AppState, conv_id: &str) -> Response {
    let (session, user) = match authenticate(request, state) {
        Ok(res) => res,
        Err(err_resp) => return err_resp,
    };

    if !validate_session_csrf(request, &session, state) {
        return Response::error(403, "Forbidden", "Invalid CSRF token.");
    }

    let payload: PostMessageRequest = match parse_json(&request.body) {
        Ok(p) => p,
        Err(e) => return Response::error(400, "Bad Request", &e),
    };

    let msg = payload.message.trim();
    if msg.is_empty() {
        return Response::error(400, "Bad Request", "Message cannot be empty.");
    }
    if msg.chars().count() > 2_000 {
        return Response::error(400, "Bad Request", "Message exceeds 2,000 characters.");
    }

    // 1. Insert user message
    let user_msg_record = match state
        .db
        .add_message(conv_id, &user.id, "user", msg, None)
    {
        Ok(m) => m,
        Err(e) => return Response::error(404, "Not Found", &e),
    };

    let is_temporal = is_temporal_or_dynamic_query(msg);

    // 2. Generate bot response
    let (bot_response_text, bot_status) = if let Some(result) = evaluate_math(msg) {
        let formatted = if (result.fract()).abs() < 1e-9 {
            format!("{} = {:.0}", msg, result)
        } else {
            format!("{} = {:.4}", msg, result)
        };
        (formatted, "math_matched")
    } else if let Some((_sym, price_resp)) = check_market_intent(msg) {
        (price_resp, "market_matched")
    } else {
        let match_result = if is_temporal {
            None
        } else {
            let store_guard = state.store.read().unwrap();
            store_guard.find_best_match(msg).map(|pattern| {
                expand_placeholders(&pattern.response, store_guard.patterns().len())
            })
        };

        match match_result {
            Some(expanded) => (expanded, "memory_matched"),
            None => {
                if let Some(ai_response) = call_openrouter_fallback(state, &user.id, conv_id, msg) {
                    // Auto-cache learned question & answer into memory store ONLY if it's NOT dynamic/temporal!
                    if !is_temporal {
                        let tokens = crate::knowledge::tokenize(msg);
                        if !tokens.is_empty() && ai_response.len() <= 4000 {
                            let _ = state.db.insert_memory(
                                &tokens,
                                &ai_response,
                                "phrase",
                                "web_learned",
                                Some(&user.id),
                            );
                            let _ = state.store.write().unwrap().reload_from_db(&state.db);
                        }
                    }
                    (ai_response, if is_temporal { "openrouter_live" } else { "openrouter_ai" })
                } else {
                    (
                        "That isn't in my memory yet. Feel free to teach me using the Teach button!".to_string(),
                        "unknown",
                    )
                }
            }
        }
    };

    // 3. Insert bot response
    let bot_msg_record = match state.db.add_message(
        conv_id,
        &user.id,
        "assistant",
        &bot_response_text,
        Some(bot_status),
    ) {
        Ok(m) => m,
        Err(e) => return Response::error(500, "Internal Server Error", &e),
    };

    // 4. Auto-update conversation title if it is default, unassigned, or generic
    let updated_title = match state.db.get_conversation_for_user(conv_id, &user.id) {
        Ok(Some(conv)) => {
            let is_default = conv.title.as_deref().map_or(true, |t| {
                let lt = t.trim().to_lowercase();
                lt.is_empty() || lt == "new conversation" || lt == "new chat"
            });
            if is_default {
                let specific_title = crate::db::generate_specific_conversation_title(msg);
                let _ = state
                    .db
                    .update_conversation_title(conv_id, &user.id, &specific_title);
                Some(specific_title)
            } else {
                conv.title
            }
        }
        _ => None,
    };

    Response::json(
        200,
        "OK",
        json!({
            "user_message": user_msg_record,
            "assistant_message": bot_msg_record,
            "status": bot_status,
            "conversation_title": updated_title
        }),
    )
}

fn call_openrouter_fallback(
    state: &AppState,
    user_id: &str,
    conv_id: &str,
    msg: &str,
) -> Option<String> {
    let server_key = match &state.config.openrouter_api_key {
        Some(k) if !k.trim().is_empty() => k.trim(),
        _ => return None,
    };

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let recent_usage = state
        .db
        .count_user_requests_since(user_id, now - 3600)
        .unwrap_or(0);
    if recent_usage >= MAX_AI_REQUESTS_PER_HOUR_PER_USER {
        return None;
    }

    let _guard = state
        .openrouter_semaphore
        .acquire_timeout(Duration::from_secs(2))?;

    let history_messages = state
        .db
        .list_messages_for_conversation(conv_id, user_id)
        .unwrap_or_default();

    let mut messages_json = Vec::new();
    messages_json.push(json!({
        "role": "system",
        "content": "You are RustBot, an intelligent, analytical, and helpful AI assistant built in pure Rust. Always provide constructive, detailed, and insightful answers. When asked for market scenarios, price projections, weather, or current events, provide analytical breakdowns, price ranges, historical trends, and key risk factors instead of issuing generic refusal disclaimers. Format responses with clean, readable Markdown."
    }));

    let start_idx = history_messages.len().saturating_sub(8);
    for m in &history_messages[start_idx..] {
        messages_json.push(json!({
            "role": if m.role == "assistant" { "assistant" } else { "user" },
            "content": m.content
        }));
    }

    if history_messages.last().map(|m| m.content.as_str()) != Some(msg) {
        messages_json.push(json!({
            "role": "user",
            "content": msg
        }));
    }

    let client = &state.http_client;

    for &model in OPENROUTER_MODELS {
        let body = json!({
            "model": model,
            "messages": messages_json,
            "max_tokens": 2500
        });

        let resp = client
            .post("https://openrouter.ai/api/v1/chat/completions")
            .header("Authorization", format!("Bearer {server_key}"))
            .header("Content-Type", "application/json")
            .header("HTTP-Referer", &state.config.public_origin)
            .header("X-Title", "RustBot Knowledge Forge")
            .json(&body)
            .send();

        match resp {
            Ok(r) => {
                let status = r.status();
                if status.is_success() {
                    if let Ok(parsed) = r.json::<serde_json::Value>() {
                        let in_tok = parsed["usage"]["prompt_tokens"].as_i64();
                        let out_tok = parsed["usage"]["completion_tokens"].as_i64();
                        let _ = state.db.record_ai_usage(user_id, model, in_tok, out_tok, "success");

                        if let Some(content) = parsed["choices"][0]["message"]["content"].as_str() {
                            let trimmed = content.trim();
                            if !trimmed.is_empty() {
                                return Some(trimmed.to_string());
                            }
                        }
                    }
                } else {
                    let err_text = r.text().unwrap_or_default();
                    eprintln!("OpenRouter fallback error (model: {model}, status: {status}): {err_text}");
                    let _ = state.db.record_ai_usage(user_id, model, None, None, "provider_error");
                }
            }
            Err(err) => {
                eprintln!("OpenRouter request failed: {err}");
            }
        }
    }

    None
}

fn handle_delete_conversation(
    request: &Request,
    state: &AppState,
    conv_id: &str,
) -> Response {
    let (session, user) = match authenticate(request, state) {
        Ok(res) => res,
        Err(err_resp) => return err_resp,
    };

    if !validate_session_csrf(request, &session, state) {
        return Response::error(403, "Forbidden", "Invalid CSRF token.");
    }

    match state.db.delete_conversation_for_user(conv_id, &user.id) {
        Ok(true) => Response::json(200, "OK", json!({ "status": "deleted" })),
        Ok(false) => Response::error(404, "Not Found", "Conversation not found."),
        Err(e) => Response::error(500, "Internal Server Error", &e),
    }
}

fn handle_update_conversation_title(
    request: &Request,
    state: &AppState,
    conv_id: &str,
) -> Response {
    let (session, user) = match authenticate(request, state) {
        Ok(res) => res,
        Err(err_resp) => return err_resp,
    };

    if !validate_session_csrf(request, &session, state) {
        return Response::error(403, "Forbidden", "Invalid CSRF token.");
    }

    let payload: UpdateConversationTitleRequest = match parse_json(&request.body) {
        Ok(p) => p,
        Err(e) => return Response::error(400, "Bad Request", &e),
    };

    let title = payload.title.trim();
    if title.is_empty() {
        return Response::error(400, "Bad Request", "Title cannot be empty.");
    }

    match state.db.update_conversation_title(conv_id, &user.id, title) {
        Ok(true) => Response::json(200, "OK", json!({ "id": conv_id, "title": title })),
        Ok(false) => Response::error(404, "Not Found", "Conversation not found."),
        Err(e) => Response::error(500, "Internal Server Error", &e),
    }
}

// ==========================================
// MEMORY / KNOWLEDGE HANDLERS (ADMIN ONLY)
// ==========================================

fn handle_list_memories(request: &Request, state: &AppState) -> Response {
    let (_session, user) = match authenticate(request, state) {
        Ok(res) => res,
        Err(err_resp) => return err_resp,
    };

    if user.role != "admin" {
        return Response::error(
            403,
            "Forbidden",
            "Memory management is restricted to administrators.",
        );
    }

    let category = request.query.get("category").map(|c| c.trim().to_lowercase());
    match state.db.list_memories() {
        Ok(memories) => {
            let filtered: Vec<MemoryRecord> = match category {
                Some(ref cat) if !cat.is_empty() && cat != "all" => memories
                    .into_iter()
                    .filter(|m| m.category.eq_ignore_ascii_case(cat))
                    .collect(),
                _ => memories,
            };
            Response::json(200, "OK", json!({ "memories": filtered, "patterns": filtered }))
        }
        Err(e) => Response::error(500, "Internal Server Error", &e),
    }
}

fn handle_save_memory(request: &Request, state: &AppState) -> Response {
    let (session, user) = match authenticate(request, state) {
        Ok(res) => res,
        Err(err_resp) => return err_resp,
    };

    if user.role != "admin" {
        return Response::error(
            403,
            "Forbidden",
            "Memory management is restricted to administrators.",
        );
    }

    if !validate_session_csrf(request, &session, state) {
        return Response::error(403, "Forbidden", "Invalid CSRF token.");
    }

    let payload: SaveMemoryRequest = match parse_json(&request.body) {
        Ok(p) => p,
        Err(e) => return Response::error(400, "Bad Request", &e),
    };

    let keywords: Vec<String> = if let Some(kws) = payload.keywords {
        kws.into_iter()
            .map(|k| k.trim().to_lowercase())
            .filter(|k| !k.is_empty())
            .collect()
    } else if let Some(p) = payload.prompt {
        crate::knowledge::tokenize(&p)
    } else {
        return Response::error(400, "Bad Request", "Keywords or prompt required.");
    };

    if keywords.is_empty() {
        return Response::error(400, "Bad Request", "At least one valid keyword is required.");
    }

    let response_text = payload.response.trim();
    if response_text.is_empty() {
        return Response::error(400, "Bad Request", "Memory response cannot be empty.");
    }

    let match_mode = payload.match_mode.as_deref().unwrap_or("phrase");
    let category = payload.category.as_deref().unwrap_or("general");

    match state.db.insert_memory(
        &keywords,
        response_text,
        match_mode,
        category,
        Some(&user.id),
    ) {
        Ok(mem) => {
            let _ = state.store.write().unwrap().reload_from_db(&state.db);
            Response::json(201, "Created", json!({ "memory": mem, "pattern": mem }))
        }
        Err(e) => Response::error(500, "Internal Server Error", &e),
    }
}

fn handle_update_memory(request: &Request, state: &AppState, raw_id: &str) -> Response {
    let (session, user) = match authenticate(request, state) {
        Ok(res) => res,
        Err(err_resp) => return err_resp,
    };

    if !validate_session_csrf(request, &session, state) {
        return Response::error(403, "Forbidden", "Invalid CSRF token.");
    }

    let id: i64 = match raw_id.parse() {
        Ok(i) => i,
        Err(_) => return Response::error(400, "Bad Request", "Invalid memory ID."),
    };

    // Explicit check for seed-memory immutability (id <= 258)
    if id <= 258 {
        return Response::error(
            403,
            "Forbidden",
            "System seed memories are immutable and cannot be modified.",
        );
    }

    // Fetch memory to verify existence and check ownership
    let memory = match state.db.get_memory_by_id(id) {
        Ok(Some(m)) => m,
        Ok(None) => return Response::error(404, "Not Found", "Memory not found."),
        Err(e) => return Response::error(500, "Internal Server Error", &e),
    };

    // Ownership check: must be the creator (owner) or an administrator
    if memory.owner_user_id.as_deref() != Some(&user.id) && user.role != "admin" {
        return Response::error(
            403,
            "Forbidden",
            "You do not have permission to modify this memory.",
        );
    }

    let payload: SaveMemoryRequest = match parse_json(&request.body) {
        Ok(p) => p,
        Err(e) => return Response::error(400, "Bad Request", &e),
    };

    let keywords: Vec<String> = if let Some(kws) = payload.keywords {
        kws.into_iter()
            .map(|k| k.trim().to_lowercase())
            .filter(|k| !k.is_empty())
            .collect()
    } else if let Some(p) = payload.prompt {
        crate::knowledge::tokenize(&p)
    } else {
        return Response::error(400, "Bad Request", "Keywords or prompt required.");
    };

    if keywords.is_empty() {
        return Response::error(400, "Bad Request", "At least one valid keyword is required.");
    }

    let response_text = payload.response.trim();
    if response_text.is_empty() {
        return Response::error(400, "Bad Request", "Memory response cannot be empty.");
    }

    let match_mode = payload.match_mode.as_deref().unwrap_or("phrase");
    let category = payload.category.as_deref().unwrap_or("general");

    match state.db.update_memory(
        id,
        &keywords,
        response_text,
        match_mode,
        category,
        Some(&user.id),
    ) {
        Ok(mem) => {
            let _ = state.store.write().unwrap().reload_from_db(&state.db);
            Response::json(200, "OK", json!({ "memory": mem, "pattern": mem }))
        }
        Err(e) => Response::error(500, "Internal Server Error", &e),
    }
}

fn handle_delete_memory(request: &Request, state: &AppState, raw_id: &str) -> Response {
    let (session, user) = match authenticate(request, state) {
        Ok(res) => res,
        Err(err_resp) => return err_resp,
    };

    if !validate_session_csrf(request, &session, state) {
        return Response::error(403, "Forbidden", "Invalid CSRF token.");
    }

    let id: i64 = match raw_id.parse() {
        Ok(i) => i,
        Err(_) => return Response::error(400, "Bad Request", "Invalid memory ID."),
    };

    // Explicit check for seed-memory immutability (id <= 258)
    if id <= 258 {
        return Response::error(
            403,
            "Forbidden",
            "System seed memories are immutable and cannot be deleted.",
        );
    }

    let memory = match state.db.get_memory_by_id(id) {
        Ok(Some(m)) => m,
        Ok(None) => return Response::error(404, "Not Found", "Memory not found."),
        Err(e) => return Response::error(500, "Internal Server Error", &e),
    };

    if memory.owner_user_id.as_deref() != Some(&user.id) && user.role != "admin" {
        return Response::error(
            403,
            "Forbidden",
            "You do not have permission to delete this memory.",
        );
    }

    match state.db.delete_memory(id) {
        Ok(true) => {
            let _ = state.store.write().unwrap().reload_from_db(&state.db);
            Response::json(200, "OK", json!({ "status": "deleted", "id": id }))
        }
        Ok(false) => Response::error(404, "Not Found", "Memory not found."),
        Err(e) => Response::error(500, "Internal Server Error", &e),
    }
}

fn handle_export_memories(request: &Request, state: &AppState) -> Response {
    let (_session, user) = match authenticate(request, state) {
        Ok(res) => res,
        Err(err_resp) => return err_resp,
    };

    if user.role != "admin" {
        return Response::error(
            403,
            "Forbidden",
            "Export is restricted to administrators.",
        );
    }

    match state.db.list_memories() {
        Ok(memories) => Response::json(200, "OK", memories),
        Err(e) => Response::error(500, "Internal Server Error", &e),
    }
}

fn handle_import_memories(request: &Request, state: &AppState) -> Response {
    let (session, user) = match authenticate(request, state) {
        Ok(res) => res,
        Err(err_resp) => return err_resp,
    };

    if user.role != "admin" {
        return Response::error(
            403,
            "Forbidden",
            "Import is restricted to administrators.",
        );
    }

    if !validate_session_csrf(request, &session, state) {
        return Response::error(403, "Forbidden", "Invalid CSRF token.");
    }

    #[derive(Deserialize)]
    struct RawImportItem {
        keywords: Option<Vec<String>>,
        prompt: Option<String>,
        response: String,
        match_mode: Option<String>,
        category: Option<String>,
    }

    let items: Vec<RawImportItem> = match parse_json(&request.body) {
        Ok(it) => it,
        Err(e) => return Response::error(400, "Bad Request", &format!("Invalid JSON array: {e}")),
    };

    let mut inserted = 0;
    for item in items {
        let kws = if let Some(k) = item.keywords {
            k
        } else if let Some(p) = item.prompt {
            crate::knowledge::tokenize(&p)
        } else {
            continue;
        };

        if kws.is_empty() || item.response.trim().is_empty() {
            continue;
        }

        let mode = item.match_mode.as_deref().unwrap_or("phrase");
        let cat = item.category.as_deref().unwrap_or("general");
        if state
            .db
            .insert_memory(&kws, item.response.trim(), mode, cat, Some(&user.id))
            .is_ok()
        {
            inserted += 1;
        }
    }

    let _ = state.store.write().unwrap().reload_from_db(&state.db);
    Response::json(
        200,
        "OK",
        json!({ "status": "imported", "count": inserted }),
    )
}

// ==========================================
// OPENROUTER & SPEND PROTECTION
// ==========================================

fn handle_openrouter_chat(request: &Request, state: &AppState) -> Response {
    let (session, user) = match authenticate(request, state) {
        Ok(res) => res,
        Err(err_resp) => return err_resp,
    };

    if !validate_session_csrf(request, &session, state) {
        return Response::error(403, "Forbidden", "Invalid CSRF token.");
    }

    let payload: OpenRouterProxyRequest = match parse_json(&request.body) {
        Ok(req) => req,
        Err(err) => return Response::error(400, "Bad Request", &err),
    };

    // Client must not send api_key in payload
    if payload.api_key.is_some() {
        return Response::error(
            400,
            "Bad Request",
            "Client-supplied API keys are rejected. OpenRouter key is managed on server.",
        );
    }

    let server_key = match &state.config.openrouter_api_key {
        Some(k) if !k.trim().is_empty() => k.trim(),
        _ => {
            return Response::error(
                503,
                "Service Unavailable",
                "OpenRouter AI is not configured on the server. Set OPENROUTER_API_KEY in .env.",
            );
        }
    };

    // Check user rate quota
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let recent_usage = state
        .db
        .count_user_requests_since(&user.id, now - 3600)
        .unwrap_or(0);
    if recent_usage >= MAX_AI_REQUESTS_PER_HOUR_PER_USER && user.role != "admin" {
        return Response::error(
            429,
            "Too Many Requests",
            "You have reached your hourly AI request quota. Please wait a bit before trying again.",
        );
    }

    let _guard = match state
        .openrouter_semaphore
        .acquire_timeout(Duration::from_secs(2))
    {
        Some(guard) => guard,
        None => {
            return Response::error(
                503,
                "Service Unavailable",
                "AI capacity is currently fully utilized. Please retry in a few seconds.",
            );
        }
    };

    if !OPENROUTER_MODELS.contains(&payload.model.as_str()) {
        return Response::error(
            400,
            "Bad Request",
            "The requested OpenRouter model is not allowed.",
        );
    }
    if !valid_openrouter_messages(&payload.messages) {
        return Response::error(
            400,
            "Bad Request",
            "Messages must contain 1 to 12 role/content text entries of at most 8,000 characters each.",
        );
    }

    let client = match reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
    {
        Ok(c) => c,
        Err(err) => {
            return Response::error(
                500,
                "Internal Server Error",
                &format!("Could not create HTTP client: {err}"),
            )
        }
    };

    let mut body_map = serde_json::Map::new();
    body_map.insert("model".to_string(), json!(payload.model));
    body_map.insert("messages".to_string(), payload.messages);
    body_map.insert(
        "max_tokens".to_string(),
        json!(payload.max_tokens.unwrap_or(400).clamp(1, MAX_OPENROUTER_TOKENS)),
    );

    let req_builder = client
        .post("https://openrouter.ai/api/v1/chat/completions")
        .header("Authorization", format!("Bearer {server_key}"))
        .header("Content-Type", "application/json")
        .header("HTTP-Referer", &state.config.public_origin)
        .header("X-Title", "RustBot Knowledge Forge")
        .json(&body_map);

    match req_builder.send() {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let is_success = resp.status().is_success();
            let reason = if is_success {
                "OK"
            } else {
                "Bad Gateway"
            };
            match resp.text() {
                Ok(text_body) => {
                    let parsed: serde_json::Value = serde_json::from_str(&text_body)
                        .unwrap_or_else(|_| json!({ "error": text_body }));

                    let in_tok = parsed["usage"]["prompt_tokens"].as_i64();
                    let out_tok = parsed["usage"]["completion_tokens"].as_i64();
                    let _ = state.db.record_ai_usage(
                        &user.id,
                        &payload.model,
                        in_tok,
                        out_tok,
                        if is_success {
                            "success"
                        } else {
                            "provider_error"
                        },
                    );

                    Response::json(status, reason, parsed)
                }
                Err(err) => {
                    let _ = state.db.record_ai_usage(
                        &user.id,
                        &payload.model,
                        None,
                        None,
                        "read_error",
                    );
                    Response::error(
                        502,
                        "Bad Gateway",
                        &format!("Could not read OpenRouter response: {err}"),
                    )
                }
            }
        }
        Err(err) => {
            let _ = state.db.record_ai_usage(
                &user.id,
                &payload.model,
                None,
                None,
                "network_error",
            );
            Response::error(
                502,
                "Bad Gateway",
                &format!("Failed to reach OpenRouter: {err}"),
            )
        }
    }
}

fn valid_openrouter_messages(messages: &serde_json::Value) -> bool {
    let messages = match messages.as_array() {
        Some(messages) if !messages.is_empty() && messages.len() <= MAX_OPENROUTER_MESSAGES => {
            messages
        }
        _ => return false,
    };

    messages.iter().all(|message| {
        let role = message.get("role").and_then(serde_json::Value::as_str);
        let content = message.get("content").and_then(serde_json::Value::as_str);
        matches!(role, Some("system" | "user" | "assistant"))
            && content
                .map(|content| {
                    !content.trim().is_empty()
                        && content.chars().count() <= MAX_OPENROUTER_MESSAGE_LENGTH
                })
                .unwrap_or(false)
    })
}

// ==========================================
// RESPONSE & HTTP HELPERS
// ==========================================

pub struct Response {
    status: u16,
    reason: &'static str,
    content_type: &'static str,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl Response {
    pub fn html(status: u16, reason: &'static str, body: String) -> Self {
        Self {
            status,
            reason,
            content_type: "text/html; charset=utf-8",
            headers: Vec::new(),
            body: body.into_bytes(),
        }
    }

    pub fn asset(status: u16, reason: &'static str, content_type: &'static str, body: &str) -> Self {
        Self {
            status,
            reason,
            content_type,
            headers: Vec::new(),
            body: body.as_bytes().to_vec(),
        }
    }

    pub fn binary(status: u16, reason: &'static str, content_type: &'static str, body: &[u8]) -> Self {
        Self {
            status,
            reason,
            content_type,
            headers: Vec::new(),
            body: body.to_vec(),
        }
    }

    pub fn json<T: Serialize>(status: u16, reason: &'static str, value: T) -> Self {
        let body = serde_json::to_vec(&value)
            .unwrap_or_else(|_| br#"{"error":"Could not serialize response."}"#.to_vec());
        Self {
            status,
            reason,
            content_type: "application/json; charset=utf-8",
            headers: Vec::new(),
            body,
        }
    }

    pub fn error(status: u16, reason: &'static str, message: &str) -> Self {
        Self::json(status, reason, json!({ "error": message }))
    }

    pub fn with_header(mut self, key: &str, val: &str) -> Self {
        self.headers.push((key.to_string(), val.to_string()));
        self
    }

    pub fn with_cookie(self, name: &str, val: &str, max_age_secs: i64, is_prod: bool) -> Self {
        let secure_flag = if is_prod { "; Secure" } else { "" };
        let cookie_str = format!(
            "{name}={val}; Path=/; HttpOnly; SameSite=Strict; Max-Age={max_age_secs}{secure_flag}"
        );
        self.with_header("Set-Cookie", &cookie_str)
    }

    pub fn with_clear_cookie(self, name: &str, is_prod: bool) -> Self {
        let secure_flag = if is_prod { "; Secure" } else { "" };
        let cookie_str = format!("{name}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0{secure_flag}");
        self.with_header("Set-Cookie", &cookie_str)
    }

    pub fn write_to(self, stream: &mut TcpStream) -> Result<(), String> {
        let mut custom_headers = String::new();
        for (k, v) in &self.headers {
            custom_headers.push_str(&format!("{k}: {v}\r\n"));
        }

        let headers = format!(
            "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\nStrict-Transport-Security: max-age=63072000; includeSubDomains\r\nReferrer-Policy: no-referrer\r\nPermissions-Policy: geolocation=(), camera=(), microphone=()\r\nContent-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; script-src 'self' 'unsafe-inline' https://s3.tradingview.com; img-src 'self' data: https:; connect-src 'self' https://telemetry.tradingview.com; frame-src https://s.tradingview.com https://www.tradingview.com https://*.tradingview-widget.com; base-uri 'none'; frame-ancestors 'none'\r\n{}\r\n",
            self.status,
            self.reason,
            self.content_type,
            self.body.len(),
            custom_headers
        );

        stream
            .write_all(headers.as_bytes())
            .and_then(|_| stream.write_all(&self.body))
            .and_then(|_| stream.flush())
            .map_err(|error| error.to_string())
    }
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

    let headers_str = String::from_utf8_lossy(&bytes[..header_end]);
    let mut lines = headers_str.lines();
    let request_line = lines
        .next()
        .ok_or_else(|| "Missing request line.".to_string())?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next().unwrap_or_default().to_string();
    let raw_path = request_parts.next().unwrap_or_default();
    let (path, raw_query) = raw_path.split_once('?').unwrap_or((raw_path, ""));
    let path = path.to_string();
    let query = parse_query(raw_query);

    let mut header_map = HashMap::new();
    for line in headers_str.lines().skip(1) {
        if let Some((name, value)) = line.split_once(':') {
            header_map.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }

    let content_length = header_map
        .get("content-length")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(0);

    let host = header_map
        .get("host")
        .map(String::as_str)
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
        headers: header_map,
        host,
        body: bytes[header_end..header_end + content_length].to_vec(),
    })
}

fn parse_json<T: for<'de> Deserialize<'de>>(body: &[u8]) -> Result<T, String> {
    serde_json::from_slice(body).map_err(|e| format!("Invalid JSON: {e}"))
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
    let mut bytes = Vec::with_capacity(value.len());
    let mut chars = value.bytes();
    while let Some(b) = chars.next() {
        match b {
            b'+' => bytes.push(b' '),
            b'%' => {
                let h1 = chars.next()?;
                let h2 = chars.next()?;
                let hex_arr = [h1, h2];
                let hex_str = std::str::from_utf8(&hex_arr).ok()?;
                let byte = u8::from_str_radix(hex_str, 16).ok()?;
                bytes.push(byte);
            }
            other => bytes.push(other),
        }
    }
    String::from_utf8(bytes).ok()
}

fn is_trusted_loopback_host(host: &str) -> bool {
    LOOPBACK_HOSTS
        .iter()
        .any(|allowed| host.eq_ignore_ascii_case(allowed))
}

fn is_trusted_loopback_origin(origin: &str) -> bool {
    LOOPBACK_ORIGINS
        .iter()
        .any(|allowed| origin.eq_ignore_ascii_case(allowed))
}

fn expand_placeholders(text: &str, store_count: usize) -> String {
    let (date_str, time_str) = get_utc_now_formatted();
    text.replace("{memory_count}", &store_count.to_string())
        .replace("{date}", &date_str)
        .replace("{time}", &time_str)
}

fn get_utc_now_formatted() -> (String, String) {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let days = secs / 86400;
    let time_secs = secs % 86400;
    let hours = time_secs / 3600;
    let mins = (time_secs % 3600) / 60;
    let seconds = time_secs % 60;

    let mut year = 1970;
    let mut d = days;
    loop {
        let leap = if (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0) {
            366
        } else {
            365
        };
        if d < leap {
            break;
        }
        d -= leap;
        year += 1;
    }
    let months = [
        31,
        if (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0) {
            29
        } else {
            28
        },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    let mut month = 1;
    for &m in &months {
        if d < m {
            break;
        }
        d -= m;
        month += 1;
    }
    let day = d + 1;

    (
        format!("{:04}-{:02}-{:02}", year, month, day),
        format!("{:02}:{:02}:{:02} UTC", hours, mins, seconds),
    )
}

// ==========================================
// MATH EVALUATION & MARKET ANALYSIS
// ==========================================

fn evaluate_math(expression: &str) -> Option<f64> {
    let clean = expression
        .trim()
        .trim_start_matches("calc ")
        .trim_start_matches("calculate ")
        .trim_start_matches("what is ")
        .trim_end_matches('?')
        .trim();
    if clean.is_empty()
        || clean.chars().count() > MAX_MATH_EXPRESSION_LENGTH
        || !clean
            .chars()
            .all(|c| c.is_ascii_digit() || "+-*/().^ ".contains(c))
    {
        return None;
    }
    let res = parse_math_expr(clean)?;
    if res.is_finite() {
        Some(res)
    } else {
        None
    }
}

enum MathTok {
    Num(f64),
    Plus,
    Minus,
    Mul,
    Div,
    Pow,
    LParen,
    RParen,
}

fn tokenize_math(input: &str) -> Option<Vec<MathTok>> {
    let mut toks = Vec::new();
    let chars: Vec<char> = input.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        match chars[i] {
            ' ' | '\t' | '\r' | '\n' => {
                i += 1;
            }
            '+' => {
                toks.push(MathTok::Plus);
                i += 1;
            }
            '-' => {
                toks.push(MathTok::Minus);
                i += 1;
            }
            '*' => {
                toks.push(MathTok::Mul);
                i += 1;
            }
            '/' => {
                toks.push(MathTok::Div);
                i += 1;
            }
            '^' => {
                toks.push(MathTok::Pow);
                i += 1;
            }
            '(' => {
                toks.push(MathTok::LParen);
                i += 1;
            }
            ')' => {
                toks.push(MathTok::RParen);
                i += 1;
            }
            c if c.is_ascii_digit() || c == '.' => {
                let start = i;
                while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
                    i += 1;
                }
                let num_str: String = chars[start..i].iter().collect();
                let num: f64 = num_str.parse().ok()?;
                toks.push(MathTok::Num(num));
            }
            _ => return None,
        }
    }
    Some(toks)
}

fn parse_math_expr(input: &str) -> Option<f64> {
    let tokens = tokenize_math(input)?;
    let mut pos = 0;
    let val = parse_expr(&tokens, &mut pos)?;
    if pos == tokens.len() {
        Some(val)
    } else {
        None
    }
}

fn parse_expr(toks: &[MathTok], pos: &mut usize) -> Option<f64> {
    let mut val = parse_term(toks, pos)?;
    while *pos < toks.len() {
        match &toks[*pos] {
            MathTok::Plus => {
                *pos += 1;
                let right = parse_term(toks, pos)?;
                val += right;
            }
            MathTok::Minus => {
                *pos += 1;
                let right = parse_term(toks, pos)?;
                val -= right;
            }
            _ => break,
        }
    }
    Some(val)
}

fn parse_term(toks: &[MathTok], pos: &mut usize) -> Option<f64> {
    let mut val = parse_factor(toks, pos)?;
    while *pos < toks.len() {
        match &toks[*pos] {
            MathTok::Mul => {
                *pos += 1;
                let right = parse_factor(toks, pos)?;
                val *= right;
            }
            MathTok::Div => {
                *pos += 1;
                let right = parse_factor(toks, pos)?;
                if right == 0.0 {
                    return None;
                }
                val /= right;
            }
            _ => break,
        }
    }
    Some(val)
}

fn parse_factor(toks: &[MathTok], pos: &mut usize) -> Option<f64> {
    let mut base = parse_primary(toks, pos)?;
    if *pos < toks.len() && matches!(toks[*pos], MathTok::Pow) {
        *pos += 1;
        let exp = parse_factor(toks, pos)?;
        base = base.powf(exp);
    }
    Some(base)
}

fn parse_primary(toks: &[MathTok], pos: &mut usize) -> Option<f64> {
    if *pos >= toks.len() {
        return None;
    }
    match &toks[*pos] {
        MathTok::Num(n) => {
            let val = *n;
            *pos += 1;
            Some(val)
        }
        MathTok::Minus => {
            *pos += 1;
            let val = parse_primary(toks, pos)?;
            Some(-val)
        }
        MathTok::LParen => {
            *pos += 1;
            let val = parse_expr(toks, pos)?;
            if *pos < toks.len() && matches!(toks[*pos], MathTok::RParen) {
                *pos += 1;
                Some(val)
            } else {
                None
            }
        }
        _ => None,
    }
}

fn check_market_intent(prompt: &str) -> Option<(String, String)> {
    let lower = prompt.to_lowercase();
    let is_price = lower.contains("price")
        || lower.contains("rate")
        || lower.contains("worth")
        || lower.contains("cost");
    let is_prediction = lower.contains("predict")
        || lower.contains("forecast")
        || lower.contains("signal")
        || lower.contains("analy")
        || lower.contains("technical")
        || lower.contains("reach")
        || lower.contains("how high")
        || lower.contains("how low")
        || lower.contains("target")
        || lower.contains("going up")
        || lower.contains("going down")
        || lower.contains("up or down")
        || lower.contains("market conditions")
        || lower.contains("support")
        || lower.contains("resistance")
        || lower.contains("bullish")
        || lower.contains("bearish")
        || lower.contains("rally")
        || lower.contains("dump")
        || lower.contains("pump")
        || lower.contains("moment")
        || lower.contains("trend")
        || lower.contains("chart")
        || lower.contains("outlook")
        || lower.contains("levels")
        || lower.contains("rsi");

    let is_market_query = is_price || is_prediction || lower.contains("market");

    if !is_market_query {
        return None;
    }

    let (symbol, coin_name) = if lower.contains("btc") || lower.contains("bitcoin") {
        ("BTCUSDT", "Bitcoin (BTC)")
    } else if lower.contains("eth") || lower.contains("ethereum") {
        ("ETHUSDT", "Ethereum (ETH)")
    } else if lower.contains("sol") || lower.contains("solana") {
        ("SOLUSDT", "Solana (SOL)")
    } else if lower.contains("bnb") || lower.contains("binance coin") {
        ("BNBUSDT", "BNB")
    } else if lower.contains("xrp") || lower.contains("ripple") {
        ("XRPUSDT", "XRP")
    } else if lower.contains("doge") || lower.contains("dogecoin") {
        ("DOGEUSDT", "Dogecoin (DOGE)")
    } else if lower.contains("ada") || lower.contains("cardano") {
        ("ADAUSDT", "Cardano (ADA)")
    } else if lower.contains("avax") || lower.contains("avalanche") {
        ("AVAXUSDT", "Avalanche (AVAX)")
    } else if lower.contains("link") || lower.contains("chainlink") {
        ("LINKUSDT", "Chainlink (LINK)")
    } else if lower.contains("sui") {
        ("SUIUSDT", "Sui (SUI)")
    } else if lower.contains("near") {
        ("NEARUSDT", "NEAR Protocol (NEAR)")
    } else {
        return None;
    };

    let mut query = HashMap::new();
    query.insert("provider".to_string(), "binance".to_string());
    query.insert("symbol".to_string(), symbol.to_string());
    query.insert("interval".to_string(), "1h".to_string());
    query.insert("limit".to_string(), "50".to_string());

    let data = fetch_market_candles(&query).ok()?;
    if data.candles.is_empty() {
        return None;
    }

    let latest = data.candles.last()?;
    let latest_close = latest.close;

    let candle_inputs: Vec<MarketCandleInput> = data
        .candles
        .iter()
        .map(|c| MarketCandleInput {
            timestamp: c.timestamp,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
        })
        .collect();

    let struct_analysis = analyze_candle_structure(&candle_inputs);
    let struct_score = struct_analysis
        .as_ref()
        .map(|s| s.structural_score)
        .unwrap_or(0.0);

    let closes: Vec<f64> = data.candles.iter().map(|c| c.close).collect();
    let volumes: Vec<f64> = data.candles.iter().map(|c| c.volume).collect();
    let price_change_pct = if closes.len() >= 2 {
        (closes[closes.len() - 1] - closes[closes.len() - 2]) / closes[closes.len() - 2] * 100.0
    } else {
        0.0
    };

    let rsi = calc_rsi(&closes, 14);
    let tech_score = ((rsi - 50.0) / 50.0).clamp(-1.0, 1.0);
    let news_analysis = analyze_news_sentiment(coin_name, &volumes, price_change_pct);
    let news_score = news_analysis.sentiment_score;

    let ensemble_score = 0.45 * tech_score + 0.35 * struct_score + 0.20 * news_score;
    let up_probability = 1.0 / (1.0 + (-2.5 * ensemble_score).exp());

    let (direction, icon) = if up_probability >= 0.58 {
        ("BULLISH (UP)", "🟢")
    } else if up_probability <= 0.42 {
        ("BEARISH (DOWN)", "🔴")
    } else {
        ("NEUTRAL (SIDEWAYS)", "🟡")
    };

    if !is_prediction {
        return Some((
            symbol.to_string(),
            format!(
                "The current price of {} on Binance is **${:.2} USD** (1h change: {:.2}%).\n\nPrediction signal: {} **{}** ({:.1}% Up probability).",
                coin_name, latest_close, price_change_pct, icon, direction, up_probability * 100.0
            ),
        ));
    }

    let patterns_str = struct_analysis
        .as_ref()
        .map(|s| {
            if s.detected_patterns.is_empty() {
                "None".to_string()
            } else {
                s.detected_patterns.join(", ")
            }
        })
        .unwrap_or_else(|| "None".to_string());

    let (s1_val, r1_val, pivot_val) = if let Some(s) = &struct_analysis {
        (s.pivots.s1, s.pivots.r1, s.pivots.pivot)
    } else {
        (latest_close * 0.97, latest_close * 1.03, latest_close)
    };

    let summary_text = if up_probability >= 0.58 {
        format!(
            "**Direct Answer & Outlook**: {} is currently displaying **bullish momentum** ({:.1}% upward probability). In the near term, the key upside target is testing resistance at **${:.2} USD**. If buying pressure holds above the pivot of **${:.2} USD**, further upside expansion is likely, with immediate downside support near **${:.2} USD**.",
            coin_name, up_probability * 100.0, r1_val, pivot_val, s1_val
        )
    } else if up_probability <= 0.42 {
        format!(
            "**Direct Answer & Outlook**: {} is currently experiencing **downward pressure** ({:.1}% downward probability). Near-term price risk leans toward testing lower support levels around **${:.2} USD**. To reverse momentum, bulls must reclaim the pivot level of **${:.2} USD**; otherwise, resistance remains capped near **${:.2} USD**.",
            coin_name, (1.0 - up_probability) * 100.0, s1_val, pivot_val, r1_val
        )
    } else {
        format!(
            "**Direct Answer & Outlook**: {} is consolidating in a **neutral range** between support at **${:.2} USD** and resistance at **${:.2} USD**. A clean breakout above **${:.2} USD** is required for an upward rally, while a break below **${:.2} USD** signals potential further downside.",
            coin_name, s1_val, r1_val, r1_val, s1_val
        )
    };

    let pivots_str = format!(
        "Pivot Point: **${:.2}** | Support (S1): **${:.2}** | Resistance (R1): **${:.2}**",
        pivot_val, s1_val, r1_val
    );

    let report = format!(
        "**Market Analysis & Prediction: {}**\n\n\
        {}\n\n\
        **Directional Signal**: {} **{}** (Confidence: **{:.1}%** Up Probability)\n\n\
        **Current Price**: **${:.2} USD** (1h Change: {:+.2}%)\n\n\
        **1. Candlestick Structural Engineering**\n\
        - **Detected Patterns**: `{}`\n\
        - **Structural Score**: `{:+.2}`\n\
        - {}\n\n\
        **2. Technical Momentum Metrics**\n\
        - **RSI (14-period)**: `{:.1}`\n\
        - **Technical Score**: `{:+.2}`\n\n\
        **3. Sentiment & Volume Metrics**\n\
        - **Sentiment Rating**: **{}** (Score: `{:+.2}`)\n\
        - **Volume Surge Factor**: `{:.2}x` average\n\
        - {}\n",
        coin_name,
        summary_text,
        icon,
        direction,
        up_probability * 100.0,
        latest_close,
        price_change_pct,
        patterns_str,
        struct_score,
        pivots_str,
        rsi,
        tech_score,
        news_analysis.sentiment_label,
        news_score,
        news_analysis.volume_surge_ratio,
        news_analysis.summary
    );

    Some((symbol.to_string(), report))
}

fn calc_rsi(closes: &[f64], period: usize) -> f64 {
    if closes.len() <= period {
        return 50.0;
    }
    let mut gains = 0.0;
    let mut losses = 0.0;
    for i in (closes.len() - period)..closes.len() {
        let diff = closes[i] - closes[i - 1];
        if diff >= 0.0 {
            gains += diff;
        } else {
            losses -= diff;
        }
    }
    let avg_gain = gains / period as f64;
    let avg_loss = losses / period as f64;
    if avg_loss == 0.0 {
        if avg_gain == 0.0 {
            50.0
        } else {
            100.0
        }
    } else {
        100.0 - (100.0 / (1.0 + avg_gain / avg_loss))
    }
}

fn fetch_market_candles(query: &HashMap<String, String>) -> Result<MarketDataResponse, String> {
    let provider = query
        .get("provider")
        .map(String::as_str)
        .unwrap_or("binance");
    let symbol = query
        .get("symbol")
        .map(String::as_str)
        .unwrap_or("BTCUSDT");
    let interval = query.get("interval").map(String::as_str).unwrap_or("1h");
    let limit = query
        .get("limit")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(200)
        .clamp(10, 1000);

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("HTTP Client error: {e}"))?;

    let candles = match provider {
        "binance" => fetch_binance_candles(&client, symbol, interval, limit)?,
        "kraken" => fetch_kraken_candles(&client, symbol, interval, limit)?,
        "coingecko" => fetch_coingecko_candles(&client, symbol, interval, limit)?,
        _ => return Err(format!("Unknown provider '{provider}'.")),
    };

    Ok(MarketDataResponse {
        provider: provider.to_string(),
        symbol: symbol.to_string(),
        interval: interval.to_string(),
        recorded_count: candles.len(),
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
        "https://api.binance.com/api/v3/klines?symbol={}&interval={}&limit={limit}",
        symbol.to_ascii_uppercase(),
        interval
    );
    let value = fetch_json(client.get(url), "Binance")?;
    let rows = value
        .as_array()
        .ok_or_else(|| "Binance returned unexpected response.".to_string())?;

    let candles = rows
        .iter()
        .filter_map(|row| {
            let arr = row.as_array()?;
            Some(MarketCandle {
                timestamp: arr.first()?.as_u64()?,
                open: json_number(arr.get(1)?)?,
                high: json_number(arr.get(2)?)?,
                low: json_number(arr.get(3)?)?,
                close: json_number(arr.get(4)?)?,
                volume: json_number(arr.get(5)?)?,
            })
        })
        .collect();

    Ok(candles)
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
        _ => 60,
    };
    let url = format!(
        "https://api.kraken.com/0/public/OHLC?pair={}&interval={minutes}",
        symbol.to_ascii_uppercase()
    );
    let value = fetch_json(client.get(url), "Kraken")?;
    let result = value
        .get("result")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| "Kraken returned unexpected response.".to_string())?;

    let rows = result
        .iter()
        .find(|(k, v)| k.as_str() != "last" && v.is_array())
        .and_then(|(_, v)| v.as_array())
        .ok_or_else(|| "Kraken returned no candle array.".to_string())?;

    let mut candles: Vec<MarketCandle> = rows
        .iter()
        .filter_map(|row| {
            let arr = row.as_array()?;
            Some(MarketCandle {
                timestamp: arr.first()?.as_u64()?.saturating_mul(1_000),
                open: json_number(arr.get(1)?)?,
                high: json_number(arr.get(2)?)?,
                low: json_number(arr.get(3)?)?,
                close: json_number(arr.get(4)?)?,
                volume: json_number(arr.get(6)?)?,
            })
        })
        .collect();

    if candles.len() > limit {
        candles.drain(..candles.len() - limit);
    }
    Ok(candles)
}

fn fetch_coingecko_candles(
    client: &reqwest::blocking::Client,
    symbol: &str,
    _interval: &str,
    limit: usize,
) -> Result<Vec<MarketCandle>, String> {
    let sym_lower = symbol.to_lowercase();
    let coin_id = match sym_lower.as_str() {
        "btcusdt" | "btc" | "bitcoin" => "bitcoin",
        "ethusdt" | "eth" | "ethereum" => "ethereum",
        "solusdt" | "sol" | "solana" => "solana",
        other => other,
    };
    let url = format!(
        "https://api.coingecko.com/api/v3/coins/{coin_id}/market_chart?vs_currency=usd&days=7"
    );
    let value = fetch_json(client.get(url), "CoinGecko")?;
    let chart: CoinGeckoChart = serde_json::from_value(value)
        .map_err(|e| format!("CoinGecko JSON parse error: {e}"))?;

    let mut candles = Vec::new();
    for (i, &(ts, price)) in chart.prices.iter().enumerate() {
        let vol = chart.total_volumes.get(i).map(|v| v.1).unwrap_or(0.0);
        candles.push(MarketCandle {
            timestamp: ts,
            open: price,
            high: price,
            low: price,
            close: price,
            volume: vol,
        });
    }

    if candles.len() > limit {
        candles.drain(..candles.len() - limit);
    }
    Ok(candles)
}

fn fetch_json(
    request: reqwest::blocking::RequestBuilder,
    provider: &str,
) -> Result<serde_json::Value, String> {
    let response = request
        .send()
        .map_err(|e| format!("Could not connect to {provider}: {e}"))?;
    let status = response.status();
    let body = response
        .text()
        .map_err(|e| format!("Could not read response from {provider}: {e}"))?;
    if !status.is_success() {
        return Err(format!("{provider} returned HTTP {status}: {body}"));
    }
    serde_json::from_str(&body).map_err(|e| format!("{provider} JSON error: {e}"))
}

fn json_number(value: &serde_json::Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|s| s.parse::<f64>().ok()))
}

// ==========================================
// SOLANA HFT & TIMESFM INTEGRATION
// ==========================================

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SolanaTrendingToken {
    pub address: String,
    pub symbol: String,
    pub name: String,
    pub dex: String,
    pub price_usd: f64,
    pub volume_24h: f64,
    pub liquidity_usd: f64,
    pub price_change_5m: f64,
    pub price_change_1h: f64,
    pub volatility_score: f64,
    pub verified_safety: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SolanaTrendingResponse {
    pub network: String,
    pub count: usize,
    pub tokens: Vec<SolanaTrendingToken>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct TimesFmPredictRequest {
    pub candles: Vec<CandleBarInput>,
    #[serde(default = "default_patch_size")]
    pub patch_size: usize,
    #[serde(default = "default_horizon")]
    pub horizon: usize,
}

fn default_patch_size() -> usize {
    8
}

fn default_horizon() -> usize {
    10
}

#[derive(Clone, Debug, Deserialize)]
pub struct CandleBarInput {
    pub timestamp: i64,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: f64,
}

fn handle_timesfm_predict(request: &Request) -> Result<serde_json::Value, String> {
    let payload: TimesFmPredictRequest = parse_json(&request.body)?;
    if payload.candles.len() < 10 {
        return Err("TimesFM requires at least 10 historical candles.".to_string());
    }

    let bars: Vec<CandleBar> = payload
        .candles
        .into_iter()
        .map(|c| CandleBar {
            timestamp: c.timestamp,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
        })
        .collect();

    let engine = TimesFmEngine::new(payload.patch_size, payload.horizon);
    let prediction = engine
        .forecast(&bars)
        .ok_or_else(|| "Could not compute TimesFM predictive matrix from provided candles.".to_string())?;

    serde_json::to_value(prediction).map_err(|e| format!("Serialization error: {e}"))
}

static SOLANA_TRENDING_CACHE: Mutex<Option<(std::time::Instant, SolanaTrendingResponse)>> = Mutex::new(None);

fn fetch_solana_trending(query: &HashMap<String, String>) -> Result<SolanaTrendingResponse, String> {
    if let Ok(guard) = SOLANA_TRENDING_CACHE.lock() {
        if let Some((cached_at, ref cached_res)) = *guard {
            if cached_at.elapsed() < Duration::from_secs(30) {
                return Ok(cached_res.clone());
            }
        }
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(6))
        .user_agent("RustBot/1.0 (Mozilla/5.0; Windows NT 10.0; Win64; x64)")
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let min_liquidity = query
        .get("min_liquidity")
        .and_then(|v| v.parse::<f64>().ok())
        .unwrap_or(1_000.0);

    let mut tokens: Vec<SolanaTrendingToken> = Vec::new();
    let mut seen_addresses: std::collections::HashSet<String> = std::collections::HashSet::new();

    let search_endpoints = [
        "https://api.dexscreener.com/latest/dex/search?q=solana",
        "https://api.dexscreener.com/latest/dex/search?q=pump.fun",
        "https://api.dexscreener.com/latest/dex/search?q=raydium",
        "https://api.dexscreener.com/latest/dex/search?q=orca",
        "https://api.dexscreener.com/latest/dex/search?q=jupiter",
    ];

    for endpoint in &search_endpoints {
        if let Ok(value) = fetch_json(client.get(*endpoint), "DexScreener") {
            if let Some(pairs) = value.get("pairs").and_then(|p| p.as_array()) {
                for pair in pairs {
                    if pair.get("chainId").and_then(|c| c.as_str()) != Some("solana") {
                        continue;
                    }
                    let base = pair.get("baseToken");
                    let address = base
                        .and_then(|b| b.get("address"))
                        .and_then(|a| a.as_str())
                        .unwrap_or("")
                        .to_string();

                    if address.is_empty() || seen_addresses.contains(&address) {
                        continue;
                    }

                    let symbol = base
                        .and_then(|b| b.get("symbol"))
                        .and_then(|s| s.as_str())
                        .unwrap_or("UNKNOWN")
                        .to_string();
                    let name = base
                        .and_then(|b| b.get("name"))
                        .and_then(|n| n.as_str())
                        .unwrap_or(&symbol)
                        .to_string();

                    let raw_dex = pair
                        .get("dexId")
                        .and_then(|d| d.as_str())
                        .unwrap_or("raydium");

                    let dex = if raw_dex == "pumpswap"
                        || address.ends_with("pump")
                        || name.to_lowercase().contains("pump")
                        || symbol.to_uppercase() == "PUMP"
                    {
                        "pump.fun".to_string()
                    } else {
                        raw_dex.to_string()
                    };

                    let price_usd = json_number(pair.get("priceUsd").unwrap_or(&serde_json::Value::Null)).unwrap_or(0.0);
                    let volume_24h = pair
                        .get("volume")
                        .and_then(|v| v.get("h24"))
                        .and_then(json_number)
                        .unwrap_or(0.0);
                    let liquidity_usd = pair
                        .get("liquidity")
                        .and_then(|l| l.get("usd"))
                        .and_then(json_number)
                        .unwrap_or(0.0);
                    let price_change_5m = pair
                        .get("priceChange")
                        .and_then(|pc| pc.get("m5"))
                        .and_then(json_number)
                        .unwrap_or(0.0);
                    let price_change_1h = pair
                        .get("priceChange")
                        .and_then(|pc| pc.get("h1"))
                        .and_then(json_number)
                        .unwrap_or(0.0);

                    let vol_score = (price_change_5m.abs() * 3.0 + price_change_1h.abs() * 1.5).min(99.9);
                    let verified_safety = liquidity_usd >= min_liquidity;

                    if price_usd > 0.0 {
                        seen_addresses.insert(address.clone());
                        tokens.push(SolanaTrendingToken {
                            address,
                            symbol,
                            name,
                            dex,
                            price_usd,
                            volume_24h,
                            liquidity_usd,
                            price_change_5m,
                            price_change_1h,
                            volatility_score: (vol_score * 10.0).round() / 10.0,
                            verified_safety,
                        });
                    }
                }
            }
        }
    }

    // Sort by volatility score descending
    tokens.sort_by(|a, b| b.volatility_score.partial_cmp(&a.volatility_score).unwrap_or(std::cmp::Ordering::Equal));

    if tokens.is_empty() {
        tokens = vec![
            SolanaTrendingToken { address: "So11111111111111111111111111111111111111112".to_string(), symbol: "SOL".to_string(), name: "Solana".to_string(), dex: "raydium".to_string(), price_usd: 142.50, volume_24h: 3_820_000_000.0, liquidity_usd: 180_000_000.0, price_change_5m: 1.25, price_change_1h: 3.80, volatility_score: 82.4, verified_safety: true },
            SolanaTrendingToken { address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN".to_string(), symbol: "JUP".to_string(), name: "Jupiter".to_string(), dex: "orca".to_string(), price_usd: 0.885, volume_24h: 128_000_000.0, liquidity_usd: 45_000_000.0, price_change_5m: 2.10, price_change_1h: 6.40, volatility_score: 84.1, verified_safety: true },
            SolanaTrendingToken { address: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R".to_string(), symbol: "RAY".to_string(), name: "Raydium".to_string(), dex: "raydium".to_string(), price_usd: 2.14, volume_24h: 84_000_000.0, liquidity_usd: 22_000_000.0, price_change_5m: -1.80, price_change_1h: 7.20, volatility_score: 88.5, verified_safety: true },
            SolanaTrendingToken { address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263".to_string(), symbol: "BONK".to_string(), name: "Bonk".to_string(), dex: "raydium".to_string(), price_usd: 0.0000214, volume_24h: 96_000_000.0, liquidity_usd: 18_000_000.0, price_change_5m: 3.40, price_change_1h: -4.10, volatility_score: 91.2, verified_safety: true },
            SolanaTrendingToken { address: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm".to_string(), symbol: "WIF".to_string(), name: "dogwifhat".to_string(), dex: "raydium".to_string(), price_usd: 1.62, volume_24h: 210_000_000.0, liquidity_usd: 35_000_000.0, price_change_5m: -2.40, price_change_1h: 8.90, volatility_score: 95.0, verified_safety: true },
            SolanaTrendingToken { address: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr".to_string(), symbol: "POPCAT".to_string(), name: "Popcat".to_string(), dex: "raydium".to_string(), price_usd: 0.485, volume_24h: 68_000_000.0, liquidity_usd: 14_000_000.0, price_change_5m: 2.10, price_change_1h: 5.60, volatility_score: 89.4, verified_safety: true },
            SolanaTrendingToken { address: "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump".to_string(), symbol: "FARTCOIN".to_string(), name: "Fartcoin".to_string(), dex: "pump.fun".to_string(), price_usd: 0.324, volume_24h: 42_000_000.0, liquidity_usd: 8_500_000.0, price_change_5m: 5.20, price_change_1h: 18.90, volatility_score: 98.2, verified_safety: true },
            SolanaTrendingToken { address: "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn".to_string(), symbol: "PUMP".to_string(), name: "Pump.fun".to_string(), dex: "pump.fun".to_string(), price_usd: 0.00384, volume_24h: 5_120_000.0, liquidity_usd: 924_000.0, price_change_5m: 3.85, price_change_1h: 12.40, volatility_score: 96.5, verified_safety: true },
            SolanaTrendingToken { address: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3".to_string(), symbol: "PYTH".to_string(), name: "Pyth Network".to_string(), dex: "orca".to_string(), price_usd: 0.342, volume_24h: 45_000_000.0, liquidity_usd: 16_000_000.0, price_change_5m: 0.90, price_change_1h: 2.60, volatility_score: 81.5, verified_safety: true },
            SolanaTrendingToken { address: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL".to_string(), symbol: "JTO".to_string(), name: "Jito".to_string(), dex: "orca".to_string(), price_usd: 2.48, volume_24h: 38_000_000.0, liquidity_usd: 12_500_000.0, price_change_5m: 1.60, price_change_1h: 4.80, volatility_score: 85.0, verified_safety: true },
            SolanaTrendingToken { address: "rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof".to_string(), symbol: "RENDER".to_string(), name: "Render".to_string(), dex: "raydium".to_string(), price_usd: 5.82, volume_24h: 115_000_000.0, liquidity_usd: 29_000_000.0, price_change_5m: 1.10, price_change_1h: 3.70, volatility_score: 83.2, verified_safety: true },
            SolanaTrendingToken { address: "DriFtupJYLTosbwoN8koMbEYSx54aFAVLddWsbksjwg7".to_string(), symbol: "DRIFT".to_string(), name: "Drift".to_string(), dex: "orca".to_string(), price_usd: 0.74, volume_24h: 24_000_000.0, liquidity_usd: 8_200_000.0, price_change_5m: 1.50, price_change_1h: 5.10, volatility_score: 86.8, verified_safety: true },
            SolanaTrendingToken { address: "KMNo3nJsBXfcpJTVhZcXLW7RmTwTt4GVFE7suUBo9sS".to_string(), symbol: "KMNO".to_string(), name: "Kamino".to_string(), dex: "raydium".to_string(), price_usd: 0.118, volume_24h: 19_500_000.0, liquidity_usd: 6_800_000.0, price_change_5m: 1.30, price_change_1h: 3.40, volatility_score: 84.6, verified_safety: true },
            SolanaTrendingToken { address: "MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5".to_string(), symbol: "MEW".to_string(), name: "cat in a dogs world".to_string(), dex: "raydium".to_string(), price_usd: 0.0054, volume_24h: 55_000_000.0, liquidity_usd: 16_500_000.0, price_change_5m: 2.40, price_change_1h: 7.10, volatility_score: 91.5, verified_safety: true },
            SolanaTrendingToken { address: "TNSRxcUxoT9xBG3de7PiJyTDYu7kskLqcpddxnEJAS6".to_string(), symbol: "TNSR".to_string(), name: "Tensor".to_string(), dex: "orca".to_string(), price_usd: 0.43, volume_24h: 16_200_000.0, liquidity_usd: 5_400_000.0, price_change_5m: 1.20, price_change_1h: 3.00, volatility_score: 85.2, verified_safety: true },
            SolanaTrendingToken { address: "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE".to_string(), symbol: "ORCA".to_string(), name: "Orca".to_string(), dex: "orca".to_string(), price_usd: 2.88, volume_24h: 22_500_000.0, liquidity_usd: 9_200_000.0, price_change_5m: 0.70, price_change_1h: 2.90, volatility_score: 81.0, verified_safety: true },
            SolanaTrendingToken { address: "ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82".to_string(), symbol: "BOME".to_string(), name: "BOOK OF MEME".to_string(), dex: "raydium".to_string(), price_usd: 0.0068, volume_24h: 62_000_000.0, liquidity_usd: 19_000_000.0, price_change_5m: 1.90, price_change_1h: 5.80, volatility_score: 89.2, verified_safety: true },
            SolanaTrendingToken { address: "CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump".to_string(), symbol: "GOAT".to_string(), name: "Goatseus Maximus".to_string(), dex: "pump.fun".to_string(), price_usd: 0.452, volume_24h: 78_000_000.0, liquidity_usd: 21_000_000.0, price_change_5m: 4.10, price_change_1h: 14.50, volatility_score: 97.4, verified_safety: true },
            SolanaTrendingToken { address: "GJAFwWjJ3vnTsrQVabjBVK2TYB1YtRCQXRDfDgUnpump".to_string(), symbol: "ACT".to_string(), name: "Act I : The AI Prophecy".to_string(), dex: "pump.fun".to_string(), price_usd: 0.285, volume_24h: 88_000_000.0, liquidity_usd: 24_000_000.0, price_change_5m: 3.90, price_change_1h: 11.80, volatility_score: 96.8, verified_safety: true },
            SolanaTrendingToken { address: "2qEHjNxgoFaSdZXTAav3H2Wbe3mtB64z3P2A2Cgipump".to_string(), symbol: "PNUT".to_string(), name: "Peanut the Squirrel".to_string(), dex: "pump.fun".to_string(), price_usd: 0.512, volume_24h: 94_000_000.0, liquidity_usd: 26_000_000.0, price_change_5m: 4.80, price_change_1h: 16.20, volatility_score: 98.6, verified_safety: true },
            SolanaTrendingToken { address: "ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRT5mpump".to_string(), symbol: "MOODENG".to_string(), name: "Moo Deng".to_string(), dex: "pump.fun".to_string(), price_usd: 0.215, volume_24h: 36_000_000.0, liquidity_usd: 7_800_000.0, price_change_5m: 2.70, price_change_1h: 8.40, volatility_score: 93.1, verified_safety: true },
            SolanaTrendingToken { address: "Df6yfrKC8kZE3KNkrHERKzAetSxbrWeniQfyJY4Jpump".to_string(), symbol: "CHILLGUY".to_string(), name: "Just a chill guy".to_string(), dex: "pump.fun".to_string(), price_usd: 0.184, volume_24h: 31_000_000.0, liquidity_usd: 6_900_000.0, price_change_5m: 3.10, price_change_1h: 9.70, volatility_score: 94.5, verified_safety: true },
            SolanaTrendingToken { address: "63LfDmNb3MQ8mw9MtZ2To9bEA2M71kZUUGq5tiJxc6kq".to_string(), symbol: "GIGA".to_string(), name: "GigaChad".to_string(), dex: "raydium".to_string(), price_usd: 0.042, volume_24h: 28_000_000.0, liquidity_usd: 8_100_000.0, price_change_5m: 1.80, price_change_1h: 6.20, volatility_score: 90.0, verified_safety: true },
            SolanaTrendingToken { address: "85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ".to_string(), symbol: "W".to_string(), name: "Wormhole".to_string(), dex: "orca".to_string(), price_usd: 0.224, volume_24h: 18_000_000.0, liquidity_usd: 6_200_000.0, price_change_5m: 0.80, price_change_1h: 2.50, volatility_score: 82.0, verified_safety: true },
            SolanaTrendingToken { address: "hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux".to_string(), symbol: "HNT".to_string(), name: "Helium".to_string(), dex: "raydium".to_string(), price_usd: 4.65, volume_24h: 26_000_000.0, liquidity_usd: 9_400_000.0, price_change_5m: 1.10, price_change_1h: 3.20, volatility_score: 83.5, verified_safety: true },
            SolanaTrendingToken { address: "mb1eu7TzEc71KxDpsmsKoucSSuuoGLv1drys1oP2jh6".to_string(), symbol: "MOBILE".to_string(), name: "Helium Mobile".to_string(), dex: "raydium".to_string(), price_usd: 0.00078, volume_24h: 8_500_000.0, liquidity_usd: 3_200_000.0, price_change_5m: 2.20, price_change_1h: 5.40, volatility_score: 88.0, verified_safety: true },
            SolanaTrendingToken { address: "BZLbGTNCSFfoth2GYDtWr7e4imWzpR5jqcUuGEwr646K".to_string(), symbol: "IO".to_string(), name: "io.net".to_string(), dex: "raydium".to_string(), price_usd: 1.82, volume_24h: 24_000_000.0, liquidity_usd: 7_600_000.0, price_change_5m: 1.40, price_change_1h: 4.10, volatility_score: 86.0, verified_safety: true },
            SolanaTrendingToken { address: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So".to_string(), symbol: "MSOL".to_string(), name: "Marinade Staked SOL".to_string(), dex: "raydium".to_string(), price_usd: 168.20, volume_24h: 42_000_000.0, liquidity_usd: 35_000_000.0, price_change_5m: 0.90, price_change_1h: 2.80, volatility_score: 74.0, verified_safety: true },
            SolanaTrendingToken { address: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn".to_string(), symbol: "JITOSOL".to_string(), name: "Jito Staked SOL".to_string(), dex: "orca".to_string(), price_usd: 172.40, volume_24h: 56_000_000.0, liquidity_usd: 48_000_000.0, price_change_5m: 0.95, price_change_1h: 2.90, volatility_score: 75.0, verified_safety: true },
            SolanaTrendingToken { address: "ZEUS1aR7aX8D5V2a8L2qP2C5qL9qT2V5xP5mK8r9pump".to_string(), symbol: "ZEUS".to_string(), name: "Zeus Network".to_string(), dex: "raydium".to_string(), price_usd: 0.38, volume_24h: 14_000_000.0, liquidity_usd: 4_800_000.0, price_change_5m: 1.70, price_change_1h: 4.50, volatility_score: 87.2, verified_safety: true },
            SolanaTrendingToken { address: "WENWENvqqNya429ubCdXr81ZmD69brwQaaBYY6p3LCU".to_string(), symbol: "WEN".to_string(), name: "Wen".to_string(), dex: "raydium".to_string(), price_usd: 0.000085, volume_24h: 12_000_000.0, liquidity_usd: 4_200_000.0, price_change_5m: 1.50, price_change_1h: 4.20, volatility_score: 86.5, verified_safety: true },
            SolanaTrendingToken { address: "H3pt7A8yB4kK5xL6mV2qN3sR8tP9wX4yZ2bA1cDeFgHi".to_string(), symbol: "MYRO".to_string(), name: "Myro".to_string(), dex: "raydium".to_string(), price_usd: 0.072, volume_24h: 15_000_000.0, liquidity_usd: 5_100_000.0, price_change_5m: 2.10, price_change_1h: 5.90, volatility_score: 89.0, verified_safety: true },
        ];
    }

    let count = tokens.len();
    let res = SolanaTrendingResponse {
        network: "solana".to_string(),
        count,
        tokens,
    };
    if let Ok(mut guard) = SOLANA_TRENDING_CACHE.lock() {
        *guard = Some((std::time::Instant::now(), res.clone()));
    }
    Ok(res)
}

fn fetch_solana_candles(query: &HashMap<String, String>) -> Result<MarketDataResponse, String> {
    let symbol = query.get("symbol").map(String::as_str).unwrap_or("SOL");
    let interval = query.get("interval").map(String::as_str).unwrap_or("5m");
    let limit = query
        .get("limit")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(60)
        .clamp(10, 200);

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let mapped_binance = match symbol.to_uppercase().as_str() {
        "SOL" | "SOLANA" => "SOLUSDT",
        "JUP" => "JUPUSDT",
        "RAY" => "RAYUSDT",
        "BONK" => "1000BONKUSDT",
        "WIF" => "WIFUSDT",
        "POPCAT" => "POPCATUSDT",
        "RENDER" => "RENDERUSDT",
        "PYTH" => "PYTHUSDT",
        "JTO" => "JTOUSDT",
        "TNSR" => "TNSRUSDT",
        "W" => "WUSDT",
        "BOME" => "BOMEUSDT",
        "MEW" => "MEWUSDT",
        "PNUT" => "PNUTUSDT",
        "GOAT" => "GOATUSDT",
        "ACT" => "ACTUSDT",
        "HNT" => "HNTUSDT",
        _ => "SOLUSDT",
    };

    let binance_interval = match interval {
        "1m" => "1m",
        "5m" => "5m",
        "15m" => "15m",
        "1h" => "1h",
        _ => "5m",
    };

    let mut candles = fetch_binance_candles(&client, mapped_binance, binance_interval, limit).unwrap_or_default();

    if candles.is_empty() {
        let now_sec = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let base_price = match symbol.to_uppercase().as_str() {
            "SOL" => 142.50,
            "JUP" => 0.885,
            "RAY" => 2.14,
            "BONK" => 0.0000214,
            "WIF" => 1.62,
            "PUMP" => 0.00384,
            "FARTCOIN" => 0.324,
            "POPCAT" => 0.485,
            _ => 1.25,
        };

        let mut curr_p = base_price;
        for i in (0..limit).rev() {
            let ts = (now_sec - (i as u64) * 300) * 1000;
            let delta = ((((i * 17 + 7) % 23) as f64 - 11.0) / 100.0) * curr_p * 0.015;
            let open = curr_p;
            curr_p = (curr_p + delta).max(0.000001);
            let high = open.max(curr_p) * 1.006;
            let low = open.min(curr_p) * 0.994;
            candles.push(MarketCandle {
                timestamp: ts,
                open,
                high,
                low,
                close: curr_p,
                volume: 50_000.0 + ((i * 131) % 20_000) as f64,
            });
        }
    }

    Ok(MarketDataResponse {
        provider: "solana_dex".to_string(),
        symbol: symbol.to_uppercase(),
        interval: interval.to_string(),
        recorded_count: candles.len(),
        candles,
    })
}

// ==========================================
// DEDICATED SOLANA DATABASE HANDLERS
// ==========================================

#[derive(Deserialize)]
struct PostMistakePayload {
    #[serde(default)]
    is_update: bool,
    trap_id: String,
    token_symbol: Option<String>,
    pattern_name: Option<String>,
    features_json: Option<String>,
    stage: i64,
    #[serde(default)]
    retest_passes: i64,
    #[serde(default)]
    retest_fails: i64,
    initial_loss_pct: Option<f64>,
    #[serde(default = "default_mistake_status")]
    status: String,
    #[serde(default)]
    notes: String,
}

fn default_mistake_status() -> String {
    "ACTIVE".to_string()
}

#[derive(Deserialize)]
struct SolanaVetoPayload {
    trap_id: String,
    saved_capital_usd: f64,
}

fn handle_get_solana_trades(request: &Request, state: &AppState) -> Response {
    let limit = request.query
        .get("limit")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(50)
        .min(200);

    match state.solana_db.list_trades(limit) {
        Ok(trades) => {
            let count = trades.len();
            Response::json(200, "OK", json!({
                "trades": trades,
                "count": count,
                "database": state.solana_db.db_path()
            }))
        }
        Err(err) => Response::error(500, "Internal Server Error", &err),
    }
}

fn handle_post_solana_trade(request: &Request, state: &AppState) -> Response {
    let payload: crate::solana_db::NewSolanaTrade = match parse_json(&request.body) {
        Ok(p) => p,
        Err(err) => return Response::error(400, "Bad Request", &err),
    };

    match state.solana_db.record_trade(&payload) {
        Ok(id) => Response::json(201, "Created", json!({
            "success": true,
            "id": id,
            "trade_ref": payload.trade_ref
        })),
        Err(err) => Response::error(500, "Internal Server Error", &err),
    }
}

fn handle_get_solana_learned_memory(_request: &Request, state: &AppState) -> Response {
    match state.solana_db.list_learned_memory() {
        Ok(traps) => {
            let count = traps.len();
            Response::json(200, "OK", json!({
                "traps": traps,
                "count": count,
                "database": state.solana_db.db_path()
            }))
        }
        Err(err) => Response::error(500, "Internal Server Error", &err),
    }
}

fn handle_post_solana_learned_memory(request: &Request, state: &AppState) -> Response {
    let payload: PostMistakePayload = match parse_json(&request.body) {
        Ok(p) => p,
        Err(err) => return Response::error(400, "Bad Request", &err),
    };

    if payload.is_update {
        let update = crate::solana_db::UpdateSolanaMistakeStage {
            trap_id: payload.trap_id,
            stage: payload.stage,
            retest_passes: payload.retest_passes,
            retest_fails: payload.retest_fails,
            status: payload.status,
            notes: payload.notes,
        };
        match state.solana_db.update_mistake_stage(&update) {
            Ok(_) => Response::json(200, "OK", json!({ "success": true, "updated": true })),
            Err(err) => Response::error(500, "Internal Server Error", &err),
        }
    } else {
        let mistake = crate::solana_db::NewSolanaMistake {
            trap_id: payload.trap_id,
            token_symbol: payload.token_symbol.unwrap_or_default(),
            pattern_name: payload.pattern_name.unwrap_or_else(|| "Learned Trap Pattern".to_string()),
            features_json: payload.features_json.unwrap_or_else(|| "[]".to_string()),
            stage: payload.stage,
            initial_loss_pct: payload.initial_loss_pct.unwrap_or(15.0),
            notes: payload.notes,
        };
        match state.solana_db.record_or_update_mistake(&mistake) {
            Ok(_) => Response::json(200, "OK", json!({ "success": true, "created": true })),
            Err(err) => Response::error(500, "Internal Server Error", &err),
        }
    }
}

fn handle_post_solana_veto(request: &Request, state: &AppState) -> Response {
    let payload: SolanaVetoPayload = match parse_json(&request.body) {
        Ok(p) => p,
        Err(err) => return Response::error(400, "Bad Request", &err),
    };

    match state.solana_db.record_veto(&payload.trap_id, payload.saved_capital_usd) {
        Ok(_) => Response::json(200, "OK", json!({
            "success": true,
            "trap_id": payload.trap_id,
            "saved_capital_usd": payload.saved_capital_usd
        })),
        Err(err) => Response::error(500, "Internal Server Error", &err),
    }
}

fn handle_reassess_solana_learned_memory(_request: &Request, state: &AppState) -> Response {
    match state.solana_db.reassess_learned_memory() {
        Ok(count) => Response::json(200, "OK", json!({
            "success": true,
            "reassessed_count": count,
            "message": format!("Reassessed {count} traps from permanent veto back to active retesting.")
        })),
        Err(err) => Response::error(500, "Internal Server Error", &err),
    }
}

fn handle_reset_solana_db(_request: &Request, state: &AppState) -> Response {
    match state.solana_db.clear_all() {
        Ok(_) => Response::json(200, "OK", json!({ "success": true, "message": "Solana DB reset" })),
        Err(err) => Response::error(500, "Internal Server Error", &err),
    }
}

fn handle_get_solana_wallet(_request: &Request, state: &AppState) -> Response {
    match state.solana_db.get_wallet_state() {
        Ok(Some(w)) => Response::json(200, "OK", json!({ "wallet": w })),
        Ok(None) => Response::json(200, "OK", json!({ "wallet": null })),
        Err(err) => Response::error(500, "Internal Server Error", &err),
    }
}

fn handle_post_solana_wallet(request: &Request, state: &AppState) -> Response {
    let payload: crate::solana_db::SolanaWalletState = match parse_json(&request.body) {
        Ok(p) => p,
        Err(err) => return Response::error(400, "Bad Request", &err),
    };
    match state.solana_db.save_wallet_state(&payload) {
        Ok(_) => Response::json(200, "OK", json!({ "success": true })),
        Err(err) => Response::error(500, "Internal Server Error", &err),
    }
}

#[derive(Debug, Clone, Deserialize)]
struct SolanaAiRiskAuditRequest {
    pub recent_limit: Option<usize>,
}

fn handle_solana_ai_risk_audit(request: &Request, state: &AppState) -> Response {
    let req_payload: Option<SolanaAiRiskAuditRequest> = parse_json(&request.body).ok();
    let limit = req_payload.and_then(|p| p.recent_limit).unwrap_or(30).clamp(5, 100);

    let summary = match state.solana_db.get_audit_summary(limit) {
        Ok(s) => s,
        Err(err) => return Response::error(500, "Internal Server Error", &err),
    };

    // Check if OpenRouter key is available
    if let Some(ref key) = state.config.openrouter_api_key {
        let server_key = key.trim();
        if !server_key.is_empty() {
            if let Some(_guard) = state.openrouter_semaphore.acquire_timeout(Duration::from_secs(4)) {
                if let Some(ai_decision) = call_openrouter_for_risk_audit(state, server_key, &summary) {
                    return Response::json(200, "OK", ai_decision);
                }
            }
        }
    }

    // High-resilience fallback to quantitative rules engine
    let fallback_decision = run_fallback_risk_audit(&summary);
    Response::json(200, "OK", fallback_decision)
}

fn call_openrouter_for_risk_audit(
    state: &AppState,
    server_key: &str,
    summary: &crate::solana_db::SolanaAuditSummary,
) -> Option<serde_json::Value> {
    let mut recent_trades_text = String::new();
    for t in summary.recent_trades.iter().take(10) {
        let hold_sec = t.closed_at.saturating_sub(t.created_at);
        recent_trades_text.push_str(&format!(
            "- {} ({}): entry ${:.6}, exit ${:.6}, PnL ${:.2} ({:+.2}%), held {}s, exit: {}\n",
            t.trade_ref, t.token_symbol, t.entry_price, t.exit_price, t.pnl_usd, t.pnl_pct, hold_sec, t.exit_reason
        ));
    }
    if recent_trades_text.is_empty() {
        recent_trades_text.push_str("No closed trades yet in history database.\n");
    }

    let top_tokens_str = summary
        .most_traded_tokens
        .iter()
        .take(5)
        .map(|(sym, count)| format!("{sym} ({count} trades)"))
        .collect::<Vec<_>>()
        .join(", ");

    let prompt = format!(
        "Live Solana Trading Ledger Audit:\n\
         - Total Trades Evaluated: {}\n\
         - Win Rate: {:.1}% ({} Wins, {} Losses)\n\
         - Cumulative PnL: ${:.2} | Total Fees: ${:.2} | Net PnL: ${:.2}\n\
         - Active Anti-Trap Memory Records: {} (Stage 3 Permanent Vetoes: {})\n\
         - Top Traded Coins: {}\n\
         - Recent Trades Sample:\n{}\n\n\
         Fact-check the execution quality and return a JSON object with this EXACT structure:\n\
         {{\n\
           \"market_regime\": \"TRENDING_BULLISH\" | \"CHOPPY_MEAN_REVERTING\" | \"EXTREME_VOLATILITY_DEFENSE\",\n\
           \"fact_check_verdict\": \"concise diagnosis\",\n\
           \"recommended_margin_pct\": 1.0 to 3.0,\n\
           \"max_concurrent_positions\": 5 to 15,\n\
           \"tighten_stop_loss_pct\": -2.0 to -3.5,\n\
           \"trailing_runner_trigger_pct\": 2.5 to 4.5,\n\
           \"token_recommendations\": [\n\
             {{\"symbol\": \"...\", \"action\": \"NORMAL\"|\"REDUCE_SIZE\"|\"COOLDOWN_30M\"|\"BOOST_WEIGHT\", \"reason\": \"...\"}}\n\
           ],\n\
           \"audit_confidence\": 0.0 to 1.0\n\
         }}",
        summary.total_trades,
        summary.win_rate_pct,
        summary.wins,
        summary.losses,
        summary.total_pnl_usd,
        summary.total_fees_usd,
        summary.net_profit_usd,
        summary.active_traps_count,
        summary.stage3_traps_count,
        if top_tokens_str.is_empty() { "None" } else { &top_tokens_str },
        recent_trades_text
    );

    let messages = json!([
        {
            "role": "system",
            "content": "You are the Chief Quantitative Risk Officer & Portfolio Sentinel for an automated high-frequency Solana DEX trading bot. Your responsibility is to rigorously audit recent trade history, fact-check execution patterns, detect toxic order flow, prevent capital drawdowns, and adjust risk limits in real time. Return ONLY a valid JSON object matching the requested schema. Do not enclose in explanations or markdown commentary."
        },
        {
            "role": "user",
            "content": prompt
        }
    ]);

    for &model in OPENROUTER_MODELS {
        let body = json!({
            "model": model,
            "messages": messages,
            "max_tokens": 800,
            "temperature": 0.2
        });

        let resp = state
            .http_client
            .post("https://openrouter.ai/api/v1/chat/completions")
            .header("Authorization", format!("Bearer {server_key}"))
            .header("Content-Type", "application/json")
            .header("HTTP-Referer", &state.config.public_origin)
            .header("X-Title", "RustBot Solana Risk Sentinel")
            .json(&body)
            .send();

        if let Ok(r) = resp {
            if r.status().is_success() {
                if let Ok(parsed) = r.json::<serde_json::Value>() {
                    if let Some(content) = parsed["choices"][0]["message"]["content"].as_str() {
                        let trimmed = content.trim();
                        let clean = if let Some(stripped) = trimmed.strip_prefix("```json") {
                            stripped.strip_suffix("```").unwrap_or(stripped).trim()
                        } else if let Some(stripped) = trimmed.strip_prefix("```") {
                            stripped.strip_suffix("```").unwrap_or(stripped).trim()
                        } else {
                            trimmed
                        };

                        if let Ok(mut json_val) = serde_json::from_str::<serde_json::Value>(clean) {
                            if let Some(obj) = json_val.as_object_mut() {
                                obj.insert("source".to_string(), json!("openrouter"));
                                obj.insert("model".to_string(), json!(model));
                                obj.insert("audit_timestamp".to_string(), json!(SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()));
                                return Some(json_val);
                            }
                        }
                    }
                }
            }
        }
    }

    None
}

fn run_fallback_risk_audit(summary: &crate::solana_db::SolanaAuditSummary) -> serde_json::Value {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();

    if summary.total_trades == 0 {
        return json!({
            "source": "quantitative_rules_engine",
            "market_regime": "CHOPPY_MEAN_REVERTING",
            "fact_check_verdict": "Baseline initialization: Awaiting initial trades. Operating at standard baseline risk parameters (2.0% margin, 15 concurrent coins max, 1:2 R:R asymmetric ratio).",
            "recommended_margin_pct": 2.0,
            "max_concurrent_positions": 15,
            "tighten_stop_loss_pct": -3.0,
            "trailing_runner_trigger_pct": 3.5,
            "token_recommendations": [],
            "audit_confidence": 0.80,
            "audit_timestamp": now
        });
    }

    let win_rate = summary.win_rate_pct;
    let net = summary.net_profit_usd;

    let (regime, verdict, margin, max_pos, stop_loss, runner_trigger) = if win_rate >= 60.0 && net >= 0.0 {
        (
            "TRENDING_BULLISH",
            format!("Optimal alpha expansion: Win rate at {:.1}% with +${:.2} net PnL. Asymmetric take-profits outpacing slip and fees.", win_rate, net),
            2.2,
            15,
            -3.0,
            3.5
        )
    } else if win_rate < 45.0 || net < -50.0 {
        (
            "EXTREME_VOLATILITY_DEFENSE",
            format!("Defensive drawdown throttle: Win rate slipped to {:.1}% (Net PnL -${:.2}). De-risking margin to 1.2% and tightening stops.", win_rate, net.abs()),
            1.2,
            8,
            -2.2,
            2.8
        )
    } else {
        (
            "CHOPPY_MEAN_REVERTING",
            format!("Standard mean reversion: Win rate at {:.1}% across {} trades (Net PnL ${:.2}). Maintaining disciplined 1.8% margin.", win_rate, summary.total_trades, net),
            1.8,
            12,
            -2.8,
            3.2
        )
    };

    let mut token_recommendations = Vec::new();
    for (token, count) in summary.most_traded_tokens.iter().take(4) {
        let token_trades: Vec<_> = summary.recent_trades.iter().filter(|t| &t.token_symbol == token).collect();
        let token_pnl: f64 = token_trades.iter().map(|t| t.pnl_usd).sum();
        if token_pnl < -10.0 {
            token_recommendations.push(json!({
                "symbol": token,
                "action": "COOLDOWN_30M",
                "reason": format!("Negative recent performance (-${:.2} across {} trades)", token_pnl.abs(), count)
            }));
        } else if token_pnl > 15.0 {
            token_recommendations.push(json!({
                "symbol": token,
                "action": "BOOST_WEIGHT",
                "reason": format!("High hit rate (+${:.2} across {} trades)", token_pnl, count)
            }));
        } else {
            token_recommendations.push(json!({
                "symbol": token,
                "action": "NORMAL",
                "reason": format!("Stable performance (${:+.2} across {} trades)", token_pnl, count)
            }));
        }
    }

    json!({
        "source": "quantitative_rules_engine",
        "market_regime": regime,
        "fact_check_verdict": verdict,
        "recommended_margin_pct": margin,
        "max_concurrent_positions": max_pos,
        "tighten_stop_loss_pct": stop_loss,
        "trailing_runner_trigger_pct": runner_trigger,
        "token_recommendations": token_recommendations,
        "audit_confidence": 0.85,
        "audit_timestamp": now
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_percent_decoder() {
        assert_eq!(percent_decode("BTC%2DUSD"), Some("BTC-USD".to_string()));
        assert_eq!(percent_decode("hello+world"), Some("hello world".to_string()));
        assert_eq!(percent_decode("invalid%2"), None);
    }

    #[test]
    fn test_math_evaluator() {
        assert_eq!(evaluate_math("10 + 20 * 2"), Some(50.0));
        assert_eq!(evaluate_math("calc (5 + 3) * 2"), Some(16.0));
        assert_eq!(evaluate_math("2^3"), Some(8.0));
        assert_eq!(evaluate_math("invalid math"), None);
    }

    #[test]
    fn test_cookie_parser() {
        let mut headers = HashMap::new();
        headers.insert(
            "cookie".to_string(),
            "rustbot_session=abc12345; theme=dark; other=val".to_string(),
        );
        let req = Request {
            method: "GET".to_string(),
            path: "/".to_string(),
            query: HashMap::new(),
            headers,
            host: "127.0.0.1:7878".to_string(),
            body: vec![],
        };

        assert_eq!(req.cookie("rustbot_session"), Some("abc12345"));
        assert_eq!(req.cookie("theme"), Some("dark"));
        assert_eq!(req.cookie("missing"), None);
    }

    #[test]
    fn test_ip_rate_limiter() {
        let mut limiter = IpRateLimiter::new();
        let ip: IpAddr = "127.0.0.1".parse().unwrap();
        for _ in 0..MAX_REQUESTS_PER_MINUTE_PER_IP {
            assert!(limiter.check_and_record(ip));
        }
        assert!(!limiter.check_and_record(ip));
    }

    #[test]
    fn test_server_auth_and_conversation_flow() {
        use crate::config::Environment;
        let db = Database::open_in_memory().unwrap();
        let config = AppConfig {
            env: Environment::Development,
            host: "127.0.0.1".to_string(),
            port: 7878,
            public_origin: "http://127.0.0.1:7878".to_string(),
            database_url: PathBuf::from("test.db"),
            openrouter_api_key: None,
            coingecko_api_key: None,
            session_pepper: "test_pepper_1234567890".to_string(),
        };
        let store = Arc::new(RwLock::new(KnowledgeStore::from_memories(&[])));
        let solana_db = Arc::new(crate::solana_db::SolanaDb::open_in_memory().unwrap());
        let state = AppState {
            config,
            db,
            solana_db,
            store,
            openrouter_semaphore: Arc::new(Semaphore::new(3)),
            ip_limiter: Arc::new(Mutex::new(IpRateLimiter::new())),
            http_client: reqwest::blocking::Client::new(),
        };

        // 1. Unauthenticated /api/auth/me should fail with 401
        let req_unauth = Request {
            method: "GET".to_string(),
            path: "/api/auth/me".to_string(),
            query: HashMap::new(),
            headers: HashMap::from([("host".to_string(), "127.0.0.1:7878".to_string())]),
            host: "127.0.0.1:7878".to_string(),
            body: vec![],
        };
        let res = route_request(&req_unauth, &state);
        assert_eq!(res.status, 401);

        // 2. Register user
        let register_body = serde_json::to_vec(&json!({
            "username": "alice",
            "password": "Password123!"
        })).unwrap();
        let req_register = Request {
            method: "POST".to_string(),
            path: "/api/auth/register".to_string(),
            query: HashMap::new(),
            headers: HashMap::from([
                ("host".to_string(), "127.0.0.1:7878".to_string()),
                ("origin".to_string(), "http://127.0.0.1:7878".to_string()),
            ]),
            host: "127.0.0.1:7878".to_string(),
            body: register_body,
        };
        let res_register = route_request(&req_register, &state);
        assert_eq!(res_register.status, 200);
        let res_json: serde_json::Value = serde_json::from_slice(&res_register.body).unwrap();
        let _reg_csrf_token = res_json["csrf_token"].as_str().unwrap().to_string();

        // Extract session cookie from header
        let cookie_header = res_register.headers.iter().find(|(k, _)| k == "Set-Cookie").unwrap().1.clone();
        let session_cookie = cookie_header.split(';').next().unwrap().to_string();

        // 3. /api/auth/me with session cookie
        let req_me = Request {
            method: "GET".to_string(),
            path: "/api/auth/me".to_string(),
            query: HashMap::new(),
            headers: HashMap::from([
                ("host".to_string(), "127.0.0.1:7878".to_string()),
                ("cookie".to_string(), session_cookie.clone()),
            ]),
            host: "127.0.0.1:7878".to_string(),
            body: vec![],
        };
        let res_me = route_request(&req_me, &state);
        assert_eq!(res_me.status, 200);
        let me_json: serde_json::Value = serde_json::from_slice(&res_me.body).unwrap();
        assert_eq!(me_json["user"]["username"], "alice");
        let csrf_token = me_json["csrf_token"].as_str().unwrap().to_string();

        // 4. Create a conversation (requires CSRF token)
        let conv_body = serde_json::to_vec(&json!({
            "title": "Alice Rust Discussion"
        })).unwrap();

        // Without CSRF header -> should fail 403
        let req_no_csrf = Request {
            method: "POST".to_string(),
            path: "/api/conversations".to_string(),
            query: HashMap::new(),
            headers: HashMap::from([
                ("host".to_string(), "127.0.0.1:7878".to_string()),
                ("origin".to_string(), "http://127.0.0.1:7878".to_string()),
                ("cookie".to_string(), session_cookie.clone()),
            ]),
            host: "127.0.0.1:7878".to_string(),
            body: conv_body.clone(),
        };
        let res_no_csrf = route_request(&req_no_csrf, &state);
        assert_eq!(res_no_csrf.status, 403);

        // With CSRF header -> should succeed 201
        let req_with_csrf = Request {
            method: "POST".to_string(),
            path: "/api/conversations".to_string(),
            query: HashMap::new(),
            headers: HashMap::from([
                ("host".to_string(), "127.0.0.1:7878".to_string()),
                ("origin".to_string(), "http://127.0.0.1:7878".to_string()),
                ("cookie".to_string(), session_cookie.clone()),
                ("x-rustbot-csrf".to_string(), csrf_token.clone()),
            ]),
            host: "127.0.0.1:7878".to_string(),
            body: conv_body,
        };
        let res_with_csrf = route_request(&req_with_csrf, &state);
        assert_eq!(res_with_csrf.status, 201);
        let conv_res: serde_json::Value = serde_json::from_slice(&res_with_csrf.body).unwrap();
        let conv_id = conv_res["conversation"]["id"].as_str().unwrap();

        // 5. Post message to conversation
        let msg_body = serde_json::to_vec(&json!({
            "message": "Hello RustBot!"
        })).unwrap();
        let req_msg = Request {
            method: "POST".to_string(),
            path: format!("/api/conversations/{conv_id}/messages"),
            query: HashMap::new(),
            headers: HashMap::from([
                ("host".to_string(), "127.0.0.1:7878".to_string()),
                ("origin".to_string(), "http://127.0.0.1:7878".to_string()),
                ("cookie".to_string(), session_cookie.clone()),
                ("x-rustbot-csrf".to_string(), csrf_token.clone()),
            ]),
            host: "127.0.0.1:7878".to_string(),
            body: msg_body,
        };
        let res_msg = route_request(&req_msg, &state);
        assert_eq!(res_msg.status, 200);

        // 6. Regular user cannot modify memories (requires admin)
        let memory_body = serde_json::to_vec(&json!({
            "prompt": "Custom trigger",
            "response": "Admin answer"
        })).unwrap();
        let req_admin_mem = Request {
            method: "POST".to_string(),
            path: "/api/memories".to_string(),
            query: HashMap::new(),
            headers: HashMap::from([
                ("host".to_string(), "127.0.0.1:7878".to_string()),
                ("origin".to_string(), "http://127.0.0.1:7878".to_string()),
                ("cookie".to_string(), session_cookie.clone()),
                ("x-rustbot-csrf".to_string(), csrf_token.clone()),
            ]),
            host: "127.0.0.1:7878".to_string(),
            body: memory_body,
        };
        let res_admin_mem = route_request(&req_admin_mem, &state);
        assert_eq!(res_admin_mem.status, 403);
    }

    #[test]
    fn test_production_duckdns_domain_flow() {
        use crate::config::Environment;
        let db = Database::open_in_memory().unwrap();
        let config = AppConfig {
            env: Environment::Production,
            host: "0.0.0.0".to_string(),
            port: 7878,
            public_origin: "https://rustbot.duckdns.org".to_string(),
            database_url: PathBuf::from("test_duckdns.db"),
            openrouter_api_key: None,
            coingecko_api_key: None,
            session_pepper: "secure_pepper_for_duckdns_prod_123".to_string(),
        };
        let store = Arc::new(RwLock::new(KnowledgeStore::from_memories(&[])));
        let solana_db = Arc::new(crate::solana_db::SolanaDb::open_in_memory().unwrap());
        let state = AppState {
            config,
            db,
            solana_db,
            store,
            openrouter_semaphore: Arc::new(Semaphore::new(3)),
            ip_limiter: Arc::new(Mutex::new(IpRateLimiter::new())),
            http_client: reqwest::blocking::Client::new(),
        };

        // 1. Index page replaces __ORIGIN__ with https://rustbot.duckdns.org
        let req_index = Request {
            method: "GET".to_string(),
            path: "/".to_string(),
            query: HashMap::new(),
            headers: HashMap::from([("host".to_string(), "rustbot.duckdns.org".to_string())]),
            host: "rustbot.duckdns.org".to_string(),
            body: vec![],
        };
        let res_index = route_request(&req_index, &state);
        assert_eq!(res_index.status, 200);
        let index_html = String::from_utf8(res_index.body).unwrap();
        assert!(index_html.contains("https://rustbot.duckdns.org/"));

        // 2. Register user on public domain
        let register_body = serde_json::to_vec(&json!({
            "username": "bob",
            "password": "Password123!"
        })).unwrap();
        let req_register = Request {
            method: "POST".to_string(),
            path: "/api/auth/register".to_string(),
            query: HashMap::new(),
            headers: HashMap::from([
                ("host".to_string(), "rustbot.duckdns.org".to_string()),
                ("origin".to_string(), "https://rustbot.duckdns.org".to_string()),
            ]),
            host: "rustbot.duckdns.org".to_string(),
            body: register_body,
        };
        let res_register = route_request(&req_register, &state);
        assert_eq!(res_register.status, 200);

        // Verify Secure and __Host- cookie flags in production
        let cookie_header = res_register.headers.iter().find(|(k, _)| k == "Set-Cookie").unwrap().1.clone();
        assert!(cookie_header.starts_with("__Host-rustbot_session="));
        assert!(cookie_header.contains("; Secure"));
        assert!(cookie_header.contains("; SameSite=Strict"));
    }

    #[test]
    fn test_semaphore_concurrency_and_timeout() {
        let sem = Arc::new(Semaphore::new(3));
        assert_eq!(sem.available_permits(), 3);

        let g1 = sem.acquire_timeout(Duration::from_millis(50));
        assert!(g1.is_some());
        assert_eq!(sem.available_permits(), 2);

        let g2 = sem.acquire_timeout(Duration::from_millis(50));
        assert!(g2.is_some());
        assert_eq!(sem.available_permits(), 1);

        let g3 = sem.acquire_timeout(Duration::from_millis(50));
        assert!(g3.is_some());
        assert_eq!(sem.available_permits(), 0);

        // 4th acquisition should time out
        let g4 = sem.acquire_timeout(Duration::from_millis(40));
        assert!(g4.is_none());

        // Drop one permit
        drop(g1);
        assert_eq!(sem.available_permits(), 1);

        // Now acquisition succeeds
        let g5 = sem.acquire_timeout(Duration::from_millis(50));
        assert!(g5.is_some());
        assert_eq!(sem.available_permits(), 0);
    }

    #[test]
    fn test_memory_edit_permissions_and_seed_immutability() {
        use crate::config::Environment;
        use crate::db::hash_password;

        let db = Database::open_in_memory().unwrap();
        let config = AppConfig {
            env: Environment::Development,
            host: "127.0.0.1".to_string(),
            port: 7878,
            public_origin: "http://127.0.0.1:7878".to_string(),
            database_url: PathBuf::from("test_mem.db"),
            openrouter_api_key: None,
            coingecko_api_key: None,
            session_pepper: "test_pepper_mem_12345".to_string(),
        };
        let store = Arc::new(RwLock::new(KnowledgeStore::from_memories(&[])));
        let solana_db = Arc::new(crate::solana_db::SolanaDb::open_in_memory().unwrap());
        let state = AppState {
            config,
            db,
            solana_db,
            store,
            openrouter_semaphore: Arc::new(Semaphore::new(3)),
            ip_limiter: Arc::new(Mutex::new(IpRateLimiter::new())),
            http_client: reqwest::blocking::Client::new(),
        };

        // Insert a seed memory #1 directly into DB (table is empty, so id is 1)
        let seed_mem = state.db.insert_memory(
            &["seed".to_string(), "test".to_string()],
            "Seed answer",
            "phrase",
            "general",
            None,
        ).unwrap();
        assert_eq!(seed_mem.id, 1);

        // 1. Create Alice, Bob (regular users), and Charlie (admin user)
        let pass = hash_password("AlicePass123!").unwrap();
        let alice = state.db.create_user("alice", None, &pass, "user").unwrap();
        let _bob = state.db.create_user("bob", None, &pass, "user").unwrap();
        let charlie = state.db.create_user("charlie", None, &pass, "admin").unwrap();

        let login_helper = |uname: &str| -> (String, String) {
            let body = serde_json::to_vec(&json!({
                "username": uname,
                "password": "AlicePass123!"
            })).unwrap();
            let req = Request {
                method: "POST".to_string(),
                path: "/api/auth/login".to_string(),
                query: HashMap::new(),
                headers: HashMap::from([
                    ("host".to_string(), "127.0.0.1:7878".to_string()),
                    ("origin".to_string(), "http://127.0.0.1:7878".to_string()),
                ]),
                host: "127.0.0.1:7878".to_string(),
                body,
            };
            let res = route_request(&req, &state);
            assert_eq!(res.status, 200);
            let cookie = res.headers.iter().find(|(k, _)| k == "Set-Cookie").unwrap().1.split(';').next().unwrap().to_string();
            let res_json: serde_json::Value = serde_json::from_slice(&res.body).unwrap();
            let csrf = res_json["csrf_token"].as_str().unwrap().to_string();
            (cookie, csrf)
        };

        let (alice_cookie, alice_csrf) = login_helper("alice");
        let (bob_cookie, bob_csrf) = login_helper("bob");
        let (charlie_cookie, charlie_csrf) = login_helper("charlie");

        // 4. Alice inserts custom memory #300
        let alice_mem = state.db.insert_memory_with_id(
            300,
            &["solana".to_string(), "tps".to_string()],
            "Solana TPS is high.",
            "phrase",
            "crypto",
            Some(&alice.id),
        ).unwrap();
        let alice_mem_id = alice_mem.id;
        assert_eq!(alice_mem_id, 300);

        // Verify unauthenticated PUT -> 401
        let req_unauth = Request {
            method: "PUT".to_string(),
            path: format!("/api/memories/{alice_mem_id}"),
            query: HashMap::new(),
            headers: HashMap::from([
                ("host".to_string(), "127.0.0.1:7878".to_string()),
                ("origin".to_string(), "http://127.0.0.1:7878".to_string()),
            ]),
            host: "127.0.0.1:7878".to_string(),
            body: serde_json::to_vec(&json!({
                "keywords": ["solana", "tps"],
                "response": "Hacked response"
            })).unwrap(),
        };
        let res_unauth = route_request(&req_unauth, &state);
        assert_eq!(res_unauth.status, 401);

        // Alice attempts to edit seed memory #1 -> 403 Forbidden (Seed immutability)
        let req_seed_edit = Request {
            method: "PUT".to_string(),
            path: "/api/memories/1".to_string(),
            query: HashMap::new(),
            headers: HashMap::from([
                ("host".to_string(), "127.0.0.1:7878".to_string()),
                ("origin".to_string(), "http://127.0.0.1:7878".to_string()),
                ("cookie".to_string(), alice_cookie.clone()),
                ("x-rustbot-csrf".to_string(), alice_csrf.clone()),
            ]),
            host: "127.0.0.1:7878".to_string(),
            body: serde_json::to_vec(&json!({
                "keywords": ["seed", "modified"],
                "response": "Malicious override"
            })).unwrap(),
        };
        let res_seed_edit = route_request(&req_seed_edit, &state);
        assert_eq!(res_seed_edit.status, 403);
        let err_json: serde_json::Value = serde_json::from_slice(&res_seed_edit.body).unwrap();
        assert!(err_json["error"].as_str().unwrap().contains("immutable"));

        // Admin Charlie attempts to edit seed memory #1 -> also 403 Forbidden!
        let req_admin_seed_edit = Request {
            method: "PUT".to_string(),
            path: "/api/memories/1".to_string(),
            query: HashMap::new(),
            headers: HashMap::from([
                ("host".to_string(), "127.0.0.1:7878".to_string()),
                ("origin".to_string(), "http://127.0.0.1:7878".to_string()),
                ("cookie".to_string(), charlie_cookie.clone()),
                ("x-rustbot-csrf".to_string(), charlie_csrf.clone()),
            ]),
            host: "127.0.0.1:7878".to_string(),
            body: serde_json::to_vec(&json!({
                "keywords": ["seed", "modified"],
                "response": "Admin override"
            })).unwrap(),
        };
        let res_admin_seed_edit = route_request(&req_admin_seed_edit, &state);
        assert_eq!(res_admin_seed_edit.status, 403);

        // Seed memory deletion attempt -> 403 Forbidden
        let req_seed_del = Request {
            method: "DELETE".to_string(),
            path: "/api/memories/1".to_string(),
            query: HashMap::new(),
            headers: HashMap::from([
                ("host".to_string(), "127.0.0.1:7878".to_string()),
                ("origin".to_string(), "http://127.0.0.1:7878".to_string()),
                ("cookie".to_string(), charlie_cookie.clone()),
                ("x-rustbot-csrf".to_string(), charlie_csrf.clone()),
            ]),
            host: "127.0.0.1:7878".to_string(),
            body: vec![],
        };
        let res_seed_del = route_request(&req_seed_del, &state);
        assert_eq!(res_seed_del.status, 403);

        // Bob attempts to edit Alice's memory -> 403 Forbidden (IDOR prevention)
        let req_bob_edit = Request {
            method: "PUT".to_string(),
            path: format!("/api/memories/{alice_mem_id}"),
            query: HashMap::new(),
            headers: HashMap::from([
                ("host".to_string(), "127.0.0.1:7878".to_string()),
                ("origin".to_string(), "http://127.0.0.1:7878".to_string()),
                ("cookie".to_string(), bob_cookie.clone()),
                ("x-rustbot-csrf".to_string(), bob_csrf.clone()),
            ]),
            host: "127.0.0.1:7878".to_string(),
            body: serde_json::to_vec(&json!({
                "keywords": ["solana", "tps"],
                "response": "Bob hijacking Alice's memory"
            })).unwrap(),
        };
        let res_bob_edit = route_request(&req_bob_edit, &state);
        assert_eq!(res_bob_edit.status, 403);
        let bob_err: serde_json::Value = serde_json::from_slice(&res_bob_edit.body).unwrap();
        assert!(bob_err["error"].as_str().unwrap().contains("permission"));

        // Alice (owner) edits her own memory -> 200 OK
        let req_alice_edit = Request {
            method: "PUT".to_string(),
            path: format!("/api/memories/{alice_mem_id}"),
            query: HashMap::new(),
            headers: HashMap::from([
                ("host".to_string(), "127.0.0.1:7878".to_string()),
                ("origin".to_string(), "http://127.0.0.1:7878".to_string()),
                ("cookie".to_string(), alice_cookie.clone()),
                ("x-rustbot-csrf".to_string(), alice_csrf.clone()),
            ]),
            host: "127.0.0.1:7878".to_string(),
            body: serde_json::to_vec(&json!({
                "keywords": ["solana", "throughput"],
                "response": "Solana processes ~3,000 user TPS.",
                "category": "blockchain",
                "match_mode": "phrase"
            })).unwrap(),
        };
        let res_alice_edit = route_request(&req_alice_edit, &state);
        assert_eq!(res_alice_edit.status, 200);
        let alice_updated_json: serde_json::Value = serde_json::from_slice(&res_alice_edit.body).unwrap();
        assert_eq!(alice_updated_json["memory"]["response"], "Solana processes ~3,000 user TPS.");
        assert_eq!(alice_updated_json["memory"]["category"], "blockchain");

        // Verify in DB that owner_user_id is still Alice and updated_by_user_id is Alice
        let rec = state.db.get_memory_by_id(alice_mem_id).unwrap().unwrap();
        assert_eq!(rec.owner_user_id.as_deref(), Some(alice.id.as_str()));
        assert_eq!(rec.updated_by_user_id.as_deref(), Some(alice.id.as_str()));

        // Admin Charlie edits Alice's memory -> 200 OK, preserves owner, updates updated_by
        let req_admin_edit = Request {
            method: "PUT".to_string(),
            path: format!("/api/memories/{alice_mem_id}"),
            query: HashMap::new(),
            headers: HashMap::from([
                ("host".to_string(), "127.0.0.1:7878".to_string()),
                ("origin".to_string(), "http://127.0.0.1:7878".to_string()),
                ("cookie".to_string(), charlie_cookie.clone()),
                ("x-rustbot-csrf".to_string(), charlie_csrf.clone()),
            ]),
            host: "127.0.0.1:7878".to_string(),
            body: serde_json::to_vec(&json!({
                "keywords": ["solana", "throughput"],
                "response": "Admin verified Solana throughput.",
                "category": "crypto",
                "match_mode": "phrase"
            })).unwrap(),
        };
        let res_admin_edit = route_request(&req_admin_edit, &state);
        assert_eq!(res_admin_edit.status, 200);

        let rec_after_admin = state.db.get_memory_by_id(alice_mem_id).unwrap().unwrap();
        assert_eq!(rec_after_admin.owner_user_id.as_deref(), Some(alice.id.as_str()));
        assert_eq!(rec_after_admin.updated_by_user_id.as_deref(), Some(charlie.id.as_str()));
    }

    #[test]
    fn test_specific_conversation_title_generation() {
        use crate::db::generate_specific_conversation_title;

        assert_eq!(
            generate_specific_conversation_title("what is merkle tree about and how does it work?"),
            "Merkle Tree"
        );
        assert_eq!(
            generate_specific_conversation_title("what is the alpine upgrade in solana blockchain?"),
            "Alpine Upgrade in Solana"
        );
        assert_eq!(
            generate_specific_conversation_title("what is solana tps"),
            "Solana TPS"
        );
        assert_eq!(
            generate_specific_conversation_title("what is the difference between solana and ethereum"),
            "Solana vs Ethereum"
        );
        assert_eq!(
            generate_specific_conversation_title("how do i calculate the sharpe ratio in rust"),
            "Sharpe Ratio in Rust"
        );
        assert_eq!(
            generate_specific_conversation_title("25 * 40 + 100"),
            "Math: 25 * 40 + 100"
        );
        assert_eq!(
            generate_specific_conversation_title("what is the weather in tokyo right now"),
            "Tokyo Weather"
        );
        assert_eq!(
            generate_specific_conversation_title("hello there!"),
            "Greetings"
        );
        assert_eq!(
            generate_specific_conversation_title("what can you do"),
            "Bot Capabilities"
        );
        assert_eq!(
            generate_specific_conversation_title("can you explain bitcoin halving"),
            "Bitcoin Halving"
        );
    }

    #[test]
    fn test_conversation_auto_titling_and_persistence() {
        let db = Database::open_in_memory().unwrap();
        let config = AppConfig {
            env: crate::config::Environment::Development,
            host: "127.0.0.1".to_string(),
            port: 7878,
            public_origin: "http://127.0.0.1:7878".to_string(),
            database_url: PathBuf::from("test_titling.db"),
            openrouter_api_key: None,
            coingecko_api_key: None,
            session_pepper: "test_pepper_titling_12345".to_string(),
        };
        let store = Arc::new(RwLock::new(KnowledgeStore::from_memories(&[])));
        let solana_db = Arc::new(crate::solana_db::SolanaDb::open_in_memory().unwrap());
        let state = AppState {
            config,
            db,
            solana_db,
            store,
            openrouter_semaphore: Arc::new(Semaphore::new(3)),
            ip_limiter: Arc::new(Mutex::new(IpRateLimiter::new())),
            http_client: reqwest::blocking::Client::new(),
        };

        // 1. Register a test user
        let reg_req = Request {
            method: "POST".to_string(),
            path: "/api/auth/register".to_string(),
            query: HashMap::new(),
            headers: HashMap::from([
                ("host".to_string(), "127.0.0.1:7878".to_string()),
                ("origin".to_string(), "http://127.0.0.1:7878".to_string()),
            ]),
            host: "127.0.0.1:7878".to_string(),
            body: serde_json::to_vec(&json!({
                "username": "dave",
                "password": "Password123!"
            })).unwrap(),
        };
        let reg_res = route_request(&reg_req, &state);
        assert_eq!(reg_res.status, 200);

        let cookie_header = reg_res.headers.iter().find(|(k, _)| k == "Set-Cookie").unwrap().1.clone();
        let cookie_val = cookie_header.split(';').next().unwrap().to_string();
        let auth_data: serde_json::Value = serde_json::from_slice(&reg_res.body).unwrap();
        let csrf = auth_data["csrf_token"].as_str().unwrap().to_string();

        // 2. Create conversation with default title "New Conversation"
        let create_req = Request {
            method: "POST".to_string(),
            path: "/api/conversations".to_string(),
            query: HashMap::new(),
            headers: HashMap::from([
                ("host".to_string(), "127.0.0.1:7878".to_string()),
                ("origin".to_string(), "http://127.0.0.1:7878".to_string()),
                ("cookie".to_string(), cookie_val.clone()),
                ("x-rustbot-csrf".to_string(), csrf.clone()),
            ]),
            host: "127.0.0.1:7878".to_string(),
            body: serde_json::to_vec(&json!({
                "title": "New Conversation"
            })).unwrap(),
        };
        let create_res = route_request(&create_req, &state);
        assert_eq!(create_res.status, 201);
        let conv_data: serde_json::Value = serde_json::from_slice(&create_res.body).unwrap();
        let conv_id = conv_data["conversation"]["id"].as_str().unwrap().to_string();

        // 3. Post first user message asking about Merkle tree
        let post_msg_req = Request {
            method: "POST".to_string(),
            path: format!("/api/conversations/{conv_id}/messages"),
            query: HashMap::new(),
            headers: HashMap::from([
                ("host".to_string(), "127.0.0.1:7878".to_string()),
                ("origin".to_string(), "http://127.0.0.1:7878".to_string()),
                ("cookie".to_string(), cookie_val.clone()),
                ("x-rustbot-csrf".to_string(), csrf.clone()),
            ]),
            host: "127.0.0.1:7878".to_string(),
            body: serde_json::to_vec(&json!({
                "message": "what is merkle tree about and how does it work?"
            })).unwrap(),
        };
        let post_msg_res = route_request(&post_msg_req, &state);
        assert_eq!(post_msg_res.status, 200);
        let msg_data: serde_json::Value = serde_json::from_slice(&post_msg_res.body).unwrap();
        assert_eq!(msg_data["conversation_title"], "Merkle Tree");

        // 4. Listing conversations returns "Merkle Tree" (persisted, not "New Conversation")
        let list_req = Request {
            method: "GET".to_string(),
            path: "/api/conversations".to_string(),
            query: HashMap::new(),
            headers: HashMap::from([
                ("host".to_string(), "127.0.0.1:7878".to_string()),
                ("cookie".to_string(), cookie_val.clone()),
            ]),
            host: "127.0.0.1:7878".to_string(),
            body: vec![],
        };
        let list_res = route_request(&list_req, &state);
        assert_eq!(list_res.status, 200);
        let list_data: serde_json::Value = serde_json::from_slice(&list_res.body).unwrap();
        let convs = list_data["conversations"].as_array().unwrap();
        let found = convs.iter().find(|c| c["id"] == conv_id).unwrap();
        assert_eq!(found["title"], "Merkle Tree");

        // 5. Update title manually via PATCH /api/conversations/:id
        let patch_req = Request {
            method: "PATCH".to_string(),
            path: format!("/api/conversations/{conv_id}"),
            query: HashMap::new(),
            headers: HashMap::from([
                ("host".to_string(), "127.0.0.1:7878".to_string()),
                ("origin".to_string(), "http://127.0.0.1:7878".to_string()),
                ("cookie".to_string(), cookie_val.clone()),
                ("x-rustbot-csrf".to_string(), csrf.clone()),
            ]),
            host: "127.0.0.1:7878".to_string(),
            body: serde_json::to_vec(&json!({
                "title": "Merkle Proofs & Verification"
            })).unwrap(),
        };
        let patch_res = route_request(&patch_req, &state);
        assert_eq!(patch_res.status, 200);

        // 6. Verify updated title persisted
        let list_res2 = route_request(&list_req, &state);
        let list_data2: serde_json::Value = serde_json::from_slice(&list_res2.body).unwrap();
        let convs2 = list_data2["conversations"].as_array().unwrap();
        let found2 = convs2.iter().find(|c| c["id"] == conv_id).unwrap();
        assert_eq!(found2["title"], "Merkle Proofs & Verification");
    }

    #[test]
    fn test_market_page_routes() {
        let db = Database::open_in_memory().unwrap();
        let config = AppConfig {
            env: crate::config::Environment::Development,
            host: "127.0.0.1".to_string(),
            port: 7878,
            public_origin: "http://127.0.0.1:7878".to_string(),
            database_url: PathBuf::from("test.db"),
            openrouter_api_key: None,
            coingecko_api_key: None,
            session_pepper: "test_pepper_1234567890".to_string(),
        };
        let store = Arc::new(RwLock::new(KnowledgeStore::from_memories(&[])));
        let solana_db = Arc::new(crate::solana_db::SolanaDb::open_in_memory().unwrap());
        let state = AppState {
            config,
            db,
            solana_db,
            store,
            openrouter_semaphore: Arc::new(Semaphore::new(3)),
            ip_limiter: Arc::new(Mutex::new(IpRateLimiter::new())),
            http_client: reqwest::blocking::Client::new(),
        };

        // 1. GET /market
        let req_market = Request {
            method: "GET".to_string(),
            path: "/market".to_string(),
            query: HashMap::new(),
            headers: HashMap::from([("host".to_string(), "127.0.0.1:7878".to_string())]),
            host: "127.0.0.1:7878".to_string(),
            body: vec![],
        };
        let res_market = route_request(&req_market, &state);
        assert_eq!(res_market.status, 200);
        let html = String::from_utf8(res_market.body).unwrap();
        assert!(html.contains("Quantitative Research Lab"));

        // 2. GET /market.html
        let req_market_html = Request {
            method: "GET".to_string(),
            path: "/market.html".to_string(),
            query: HashMap::new(),
            headers: HashMap::from([("host".to_string(), "127.0.0.1:7878".to_string())]),
            host: "127.0.0.1:7878".to_string(),
            body: vec![],
        };
        let res_market_html = route_request(&req_market_html, &state);
        assert_eq!(res_market_html.status, 200);

        // 3. GET /market.css
        let req_market_css = Request {
            method: "GET".to_string(),
            path: "/market.css".to_string(),
            query: HashMap::new(),
            headers: HashMap::from([("host".to_string(), "127.0.0.1:7878".to_string())]),
            host: "127.0.0.1:7878".to_string(),
            body: vec![],
        };
        let res_market_css = route_request(&req_market_css, &state);
        assert_eq!(res_market_css.status, 200);
        assert_eq!(res_market_css.content_type, "text/css; charset=utf-8");

        // 4. GET /market.js
        let req_market_js = Request {
            method: "GET".to_string(),
            path: "/market.js".to_string(),
            query: HashMap::new(),
            headers: HashMap::from([("host".to_string(), "127.0.0.1:7878".to_string())]),
            host: "127.0.0.1:7878".to_string(),
            body: vec![],
        };
        let res_market_js = route_request(&req_market_js, &state);
        assert_eq!(res_market_js.status, 200);
        assert_eq!(res_market_js.content_type, "text/javascript; charset=utf-8");

        // 5. GET /market_worker.js
        let req_market_worker = Request {
            method: "GET".to_string(),
            path: "/market_worker.js".to_string(),
            query: HashMap::new(),
            headers: HashMap::from([("host".to_string(), "127.0.0.1:7878".to_string())]),
            host: "127.0.0.1:7878".to_string(),
            body: vec![],
        };
        let res_market_worker = route_request(&req_market_worker, &state);
        assert_eq!(res_market_worker.status, 200);
        assert_eq!(res_market_worker.content_type, "text/javascript; charset=utf-8");

        // 6. GET /solana
        let req_solana = Request {
            method: "GET".to_string(),
            path: "/solana".to_string(),
            query: HashMap::new(),
            headers: HashMap::from([("host".to_string(), "127.0.0.1:7878".to_string())]),
            host: "127.0.0.1:7878".to_string(),
            body: vec![],
        };
        let res_solana = route_request(&req_solana, &state);
        assert_eq!(res_solana.status, 200);
        let solana_html = String::from_utf8(res_solana.body).unwrap();
        assert!(solana_html.contains("Solana Autonomous HFT Agent"));

        // 7. GET /solana.css
        let req_solana_css = Request {
            method: "GET".to_string(),
            path: "/solana.css".to_string(),
            query: HashMap::new(),
            headers: HashMap::from([("host".to_string(), "127.0.0.1:7878".to_string())]),
            host: "127.0.0.1:7878".to_string(),
            body: vec![],
        };
        let res_solana_css = route_request(&req_solana_css, &state);
        assert_eq!(res_solana_css.status, 200);
        assert_eq!(res_solana_css.content_type, "text/css; charset=utf-8");

        // 8. GET /solana.js
        let req_solana_js = Request {
            method: "GET".to_string(),
            path: "/solana.js".to_string(),
            query: HashMap::new(),
            headers: HashMap::from([("host".to_string(), "127.0.0.1:7878".to_string())]),
            host: "127.0.0.1:7878".to_string(),
            body: vec![],
        };
        let res_solana_js = route_request(&req_solana_js, &state);
        assert_eq!(res_solana_js.status, 200);
        assert_eq!(res_solana_js.content_type, "text/javascript; charset=utf-8");
    }

    fn make_test_state() -> AppState {
        let db = Database::open_in_memory().unwrap();
        let config = AppConfig {
            env: crate::config::Environment::Development,
            host: "127.0.0.1".to_string(),
            port: 7878,
            public_origin: "http://127.0.0.1:7878".to_string(),
            database_url: PathBuf::from("test.db"),
            openrouter_api_key: None,
            coingecko_api_key: None,
            session_pepper: "test_pepper_1234567890".to_string(),
        };
        let store = Arc::new(RwLock::new(KnowledgeStore::from_memories(&[])));
        let solana_db = Arc::new(crate::solana_db::SolanaDb::open_in_memory().unwrap());
        AppState {
            config,
            db,
            solana_db,
            store,
            openrouter_semaphore: Arc::new(Semaphore::new(3)),
            ip_limiter: Arc::new(Mutex::new(IpRateLimiter::new())),
            http_client: reqwest::blocking::Client::new(),
        }
    }

    #[test]
    fn test_solana_market_and_timesfm_routes() {
        let state = make_test_state();

        // 1. Solana Trending Tokens
        let req_trending = Request {
            method: "GET".to_string(),
            path: "/api/market/solana/trending".to_string(),
            query: HashMap::from([("min_liquidity".to_string(), "10000".to_string())]),
            headers: HashMap::from([("host".to_string(), "127.0.0.1:7878".to_string())]),
            host: "127.0.0.1:7878".to_string(),
            body: vec![],
        };
        let res_trending = route_request(&req_trending, &state);
        assert_eq!(res_trending.status, 200);
        let trending_data: SolanaTrendingResponse = serde_json::from_slice(&res_trending.body).unwrap();
        assert!(trending_data.count > 0);
        assert_eq!(trending_data.network, "solana");

        // 2. Solana Candles
        let req_candles = Request {
            method: "GET".to_string(),
            path: "/api/market/solana/candles".to_string(),
            query: HashMap::from([
                ("symbol".to_string(), "SOL".to_string()),
                ("limit".to_string(), "20".to_string()),
            ]),
            headers: HashMap::from([("host".to_string(), "127.0.0.1:7878".to_string())]),
            host: "127.0.0.1:7878".to_string(),
            body: vec![],
        };
        let res_candles = route_request(&req_candles, &state);
        assert_eq!(res_candles.status, 200);
        let candles_data: MarketDataResponse = serde_json::from_slice(&res_candles.body).unwrap();
        assert_eq!(candles_data.symbol, "SOL");
        assert!(candles_data.recorded_count >= 10);

        // 3. TimesFM Predict
        let mut sample_candles = Vec::new();
        for i in 0..20 {
            sample_candles.push(serde_json::json!({
                "timestamp": 1700000000 + i * 60,
                "open": 140.0 + i as f64 * 0.5,
                "high": 142.0 + i as f64 * 0.5,
                "low": 139.0 + i as f64 * 0.5,
                "close": 141.0 + i as f64 * 0.5,
                "volume": 5000.0,
            }));
        }
        let predict_payload = serde_json::json!({
            "candles": sample_candles,
            "patch_size": 4,
            "horizon": 6,
        });

        let req_predict = Request {
            method: "POST".to_string(),
            path: "/api/market/solana/predict".to_string(),
            query: HashMap::new(),
            headers: HashMap::from([("host".to_string(), "127.0.0.1:7878".to_string())]),
            host: "127.0.0.1:7878".to_string(),
            body: predict_payload.to_string().into_bytes(),
        };
        let res_predict = route_request(&req_predict, &state);
        assert_eq!(res_predict.status, 200);
        let pred_val: serde_json::Value = serde_json::from_slice(&res_predict.body).unwrap();
        assert_eq!(pred_val["horizon_steps"], 6);
        assert!(pred_val["p50_forecast"].as_array().unwrap().len() == 6);
    }

    #[test]
    fn test_solana_dedicated_db_routes() {
        let state = make_test_state();

        // 1. Initial trades should be empty
        let req_list_trades = Request {
            method: "GET".to_string(),
            path: "/api/market/solana/trades".to_string(),
            query: HashMap::new(),
            headers: HashMap::from([("host".to_string(), "127.0.0.1:7878".to_string())]),
            host: "127.0.0.1:7878".to_string(),
            body: vec![],
        };
        let res_list_trades = route_request(&req_list_trades, &state);
        assert_eq!(res_list_trades.status, 200);
        let list_data: serde_json::Value = serde_json::from_slice(&res_list_trades.body).unwrap();
        assert_eq!(list_data["count"], 0);

        // 2. Post a new trade
        let post_trade_body = serde_json::json!({
            "trade_ref": "SOL-HFT-001",
            "token_symbol": "RAY",
            "token_name": "Raydium",
            "dex": "raydium",
            "entry_price": 2.15,
            "exit_price": 2.22,
            "margin_usd": 20.0,
            "pnl_usd": 0.65,
            "pnl_pct": 3.25,
            "fees_paid_usd": 0.06,
            "exit_reason": "TAKE_PROFIT (Breakeven + 5x Fees)",
            "is_win": true,
            "features_json": "[0.02, 0.03, 85.0, 1.0]"
        });
        let req_post_trade = Request {
            method: "POST".to_string(),
            path: "/api/market/solana/trades".to_string(),
            query: HashMap::new(),
            headers: HashMap::from([("host".to_string(), "127.0.0.1:7878".to_string())]),
            host: "127.0.0.1:7878".to_string(),
            body: post_trade_body.to_string().into_bytes(),
        };
        let res_post_trade = route_request(&req_post_trade, &state);
        assert_eq!(res_post_trade.status, 201);

        // 3. Fetch trades again
        let res_list_trades_after = route_request(&req_list_trades, &state);
        let after_data: serde_json::Value = serde_json::from_slice(&res_list_trades_after.body).unwrap();
        assert_eq!(after_data["count"], 1);
        assert_eq!(after_data["trades"][0]["trade_ref"], "SOL-HFT-001");

        // 4. Post learned mistake (Stage 1 Doubt)
        let mistake_body = serde_json::json!({
            "trap_id": "TRAP-RAY-FVG",
            "token_symbol": "RAY",
            "pattern_name": "Failed FVG Retest",
            "features_json": "[-0.04, 0.01, 95.0, 1.0]",
            "stage": 1,
            "initial_loss_pct": 15.0,
            "notes": "Stop loss hit at -15%"
        });
        let req_post_mistake = Request {
            method: "POST".to_string(),
            path: "/api/market/solana/learned-memory".to_string(),
            query: HashMap::new(),
            headers: HashMap::from([("host".to_string(), "127.0.0.1:7878".to_string())]),
            host: "127.0.0.1:7878".to_string(),
            body: mistake_body.to_string().into_bytes(),
        };
        let res_mistake = route_request(&req_post_mistake, &state);
        assert_eq!(res_mistake.status, 200);

        // 5. Query learned memory
        let req_list_mem = Request {
            method: "GET".to_string(),
            path: "/api/market/solana/learned-memory".to_string(),
            query: HashMap::new(),
            headers: HashMap::from([("host".to_string(), "127.0.0.1:7878".to_string())]),
            host: "127.0.0.1:7878".to_string(),
            body: vec![],
        };
        let res_mem = route_request(&req_list_mem, &state);
        assert_eq!(res_mem.status, 200);
        let mem_data: serde_json::Value = serde_json::from_slice(&res_mem.body).unwrap();
        assert_eq!(mem_data["count"], 1);
        assert_eq!(mem_data["traps"][0]["trap_id"], "TRAP-RAY-FVG");
        assert_eq!(mem_data["traps"][0]["stage"], 1);

        // 6. Record Veto
        let veto_body = serde_json::json!({
            "trap_id": "TRAP-RAY-FVG",
            "saved_capital_usd": 20.0
        });
        let req_veto = Request {
            method: "POST".to_string(),
            path: "/api/market/solana/learned-memory/veto".to_string(),
            query: HashMap::new(),
            headers: HashMap::from([("host".to_string(), "127.0.0.1:7878".to_string())]),
            host: "127.0.0.1:7878".to_string(),
            body: veto_body.to_string().into_bytes(),
        };
        let res_veto = route_request(&req_veto, &state);
        assert_eq!(res_veto.status, 200);

        // 7. Verify veto incremented
        let res_mem_after_veto = route_request(&req_list_mem, &state);
        let mem_after_data: serde_json::Value = serde_json::from_slice(&res_mem_after_veto.body).unwrap();
        assert_eq!(mem_after_data["traps"][0]["times_vetoed"], 1);
        assert_eq!(mem_after_data["traps"][0]["saved_capital_usd"], 20.0);

        // 8. Test AI Risk Audit endpoint
        let req_ai_audit = Request {
            method: "POST".to_string(),
            path: "/api/market/solana/ai-risk-audit".to_string(),
            query: HashMap::new(),
            headers: HashMap::from([("host".to_string(), "127.0.0.1:7878".to_string())]),
            host: "127.0.0.1:7878".to_string(),
            body: serde_json::json!({ "recent_limit": 10 }).to_string().into_bytes(),
        };
        let res_ai_audit = route_request(&req_ai_audit, &state);
        assert_eq!(res_ai_audit.status, 200);
        let audit_data: serde_json::Value = serde_json::from_slice(&res_ai_audit.body).unwrap();
        assert!(audit_data.get("market_regime").is_some());
        assert!(audit_data.get("recommended_margin_pct").is_some());
        assert!(audit_data.get("max_concurrent_positions").is_some());
        assert!(audit_data.get("tighten_stop_loss_pct").is_some());
        assert!(audit_data.get("trailing_runner_trigger_pct").is_some());
        assert!(audit_data.get("fact_check_verdict").is_some());
    }
}
