use crate::config::AppConfig;
use crate::db::{
    constant_time_eq_str, digest_token, generate_secure_token, Database, MemoryRecord,
    SessionRecord, UserRecord,
};
use crate::knowledge::KnowledgeStore;
use crate::market_structure::{analyze_candle_structure, MarketCandleInput};
use crate::news_sentiment::analyze_news_sentiment;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{IpAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const INDEX_HTML: &str = include_str!("../web/index.html");
const STYLES_CSS: &str = include_str!("../web/styles.css");
const APP_JS: &str = include_str!("../web/app.js");
const OG_IMAGE: &[u8] = include_bytes!("../web/og.png");
const MAX_REQUEST_SIZE: usize = 512 * 1024; // Up to 512 KB for imports
const MAX_CONCURRENT_CONNECTIONS: usize = 64;
const LOOPBACK_ORIGINS: &[&str] = &["http://127.0.0.1:7878", "http://localhost:7878"];
const LOOPBACK_HOSTS: &[&str] = &["127.0.0.1:7878", "localhost:7878", "127.0.0.1", "localhost"];
const MAX_OPENROUTER_MESSAGES: usize = 12;
const MAX_OPENROUTER_MESSAGE_LENGTH: usize = 8_000;
const MAX_OPENROUTER_TOKENS: usize = 1_024;
const MAX_MATH_EXPRESSION_LENGTH: usize = 256;
const MAX_REQUESTS_PER_MINUTE_PER_IP: usize = 120;
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

#[derive(Clone)]
pub struct AppState {
    pub config: AppConfig,
    pub db: Database,
    pub store: Arc<RwLock<KnowledgeStore>>,
    pub openrouter_lock: Arc<Mutex<()>>,
    pub ip_limiter: Arc<Mutex<IpRateLimiter>>,
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

#[derive(Debug, Serialize)]
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

pub fn run(config: AppConfig, db: Database, knowledge_path: PathBuf) -> Result<(), String> {
    let store = if let Ok(memories) = db.list_memories() {
        if !memories.is_empty() {
            KnowledgeStore::from_memories(&memories)
        } else {
            KnowledgeStore::load(knowledge_path)?
        }
    } else {
        KnowledgeStore::load(knowledge_path)?
    };

    let bind_addr = config.bind_address();
    let state = AppState {
        config,
        db,
        store: Arc::new(RwLock::new(store)),
        openrouter_lock: Arc::new(Mutex::new(())),
        ip_limiter: Arc::new(Mutex::new(IpRateLimiter::new())),
    };

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
            if state.config.is_production() {
                o.eq_ignore_ascii_case(&state.config.public_origin)
            } else {
                is_trusted_loopback_origin(o)
                    || o.eq_ignore_ascii_case(&state.config.public_origin)
            }
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

    let request = read_request(&mut stream)?;

    let is_host_allowed = if state.config.is_production() {
        let clean_host = request.host.split(':').next().unwrap_or(&request.host);
        let expected_host = state
            .config
            .public_origin
            .trim_start_matches("https://")
            .trim_start_matches("http://")
            .split(':')
            .next()
            .unwrap_or("");
        clean_host.eq_ignore_ascii_case(expected_host)
    } else {
        is_trusted_loopback_host(&request.host)
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
            let html = INDEX_HTML
                .replace("__ORIGIN__", &state.config.public_origin)
                .replace("__CSRF_TOKEN__", "");
            Response::html(200, "OK", html)
        }
        ("GET", "/styles.css") => {
            Response::asset(200, "OK", "text/css; charset=utf-8", STYLES_CSS)
        }
        ("GET", "/app.js") => {
            Response::asset(200, "OK", "text/javascript; charset=utf-8", APP_JS)
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
        ("DELETE", path) if path.starts_with("/api/memories/") || path.starts_with("/api/knowledge/") => {
            let raw_id = if path.starts_with("/api/memories/") {
                path.trim_start_matches("/api/memories/")
            } else {
                path.trim_start_matches("/api/knowledge/")
            };
            handle_delete_memory(request, state, raw_id)
        }

        // ==========================================
        // AI / MARKET DATA
        // ==========================================
        ("POST", "/api/openrouter/chat") => handle_openrouter_chat(request, state),
        ("GET", "/api/market/candles") => match fetch_market_candles(&request.query) {
            Ok(data) => Response::json(200, "OK", data),
            Err(error) => Response::error(502, "Bad Gateway", &error),
        },

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

    Response::json(
        200,
        "OK",
        json!({
            "user_message": user_msg_record,
            "assistant_message": bot_msg_record,
            "status": bot_status
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

    let _guard = state.openrouter_lock.lock().ok()?;

    let history_messages = state
        .db
        .list_messages_for_conversation(conv_id, user_id)
        .unwrap_or_default();

    let mut messages_json = Vec::new();
    messages_json.push(json!({
        "role": "system",
        "content": "You are RustBot, a concise, high-performance, and helpful AI assistant built in Rust. Format responses with clean Markdown when helpful."
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

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(35))
        .build()
        .ok()?;

    for &model in OPENROUTER_MODELS {
        let body = json!({
            "model": model,
            "messages": messages_json,
            "max_tokens": 1000
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

fn handle_delete_memory(request: &Request, state: &AppState, raw_id: &str) -> Response {
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

    let id: i64 = match raw_id.parse() {
        Ok(i) => i,
        Err(_) => return Response::error(400, "Bad Request", "Invalid memory ID."),
    };

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

    let _guard = match state.openrouter_lock.try_lock() {
        Ok(guard) => guard,
        Err(_) => {
            return Response::error(
                429,
                "Too Many Requests",
                "Another AI request is currently in progress. Please wait a moment.",
            )
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
            "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\nStrict-Transport-Security: max-age=63072000; includeSubDomains\r\nReferrer-Policy: no-referrer\r\nPermissions-Policy: geolocation=(), camera=(), microphone=()\r\nContent-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' https://s3.tradingview.com; img-src 'self' data:; connect-src 'self' https://telemetry.tradingview.com; frame-src https://s.tradingview.com https://www.tradingview.com https://*.tradingview-widget.com; base-uri 'none'; frame-ancestors 'none'\r\n{}\r\n",
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
        || lower.contains("analysis")
        || lower.contains("technical");

    if !is_price && !is_prediction {
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

    let pivots_str = if let Some(s) = &struct_analysis {
        format!(
            "Pivot Point: **${:.2}** | Support (S1): **${:.2}** | Resistance (R1): **${:.2}**",
            s.pivots.pivot, s.pivots.s1, s.pivots.r1
        )
    } else {
        "Pivot levels unavailable".to_string()
    };

    let report = format!(
        "### Market Analysis & Prediction: {}\n\n\
        **Directional Signal**: {} **{}** (Confidence: **{:.1}%** Up Probability)\n\n\
        **Current Price**: **${:.2} USD** (1h Change: {:.2}%)\n\n\
        #### 1. Candlestick Structural Engineering\n\
        - **Detected Patterns**: `{}`\n\
        - **Structural Score**: `{:+.2}`\n\
        - {}\n\n\
        #### 2. Technical Momentum Metrics\n\
        - **RSI (14-period)**: `{:.1}`\n\
        - **Technical Score**: `{:+.2}`\n\n\
        #### 3. Sentiment & Volume Metrics\n\
        - **Sentiment Rating**: **{}** (Score: `{:+.2}`)\n\
        - **Volume Surge Factor**: `{:.2}x` average\n\
        - {}\n",
        coin_name,
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
        let state = AppState {
            config,
            db,
            store,
            openrouter_lock: Arc::new(Mutex::new(())),
            ip_limiter: Arc::new(Mutex::new(IpRateLimiter::new())),
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
}
