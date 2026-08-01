use crate::knowledge::{KnowledgeStore, Pattern};
use crate::market_structure::{analyze_candle_structure, MarketCandleInput};
use crate::news_sentiment::analyze_news_sentiment;
use getrandom::getrandom;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::thread;
use std::time::Duration;

static CHAT_LOG_LOCK: Mutex<()> = Mutex::new(());
static MARKET_LOG_LOCK: Mutex<()> = Mutex::new(());

const INDEX_HTML: &str = include_str!("../web/index.html");
const STYLES_CSS: &str = include_str!("../web/styles.css");
const APP_JS: &str = include_str!("../web/app.js");
const OG_IMAGE: &[u8] = include_bytes!("../web/og.png");
const MAX_REQUEST_SIZE: usize = 512 * 1024; // Up to 512 KB for imports
const MAX_CONCURRENT_CONNECTIONS: usize = 64;
const MAX_MARKET_HISTORY_SYMBOLS: usize = 32;
const MAX_MARKET_HISTORY_CANDLES_PER_SYMBOL: usize = 2_000;
const LOOPBACK_ORIGINS: &[&str] = &["http://127.0.0.1:7878", "http://localhost:7878"];
const LOOPBACK_HOSTS: &[&str] = &["127.0.0.1:7878", "localhost:7878"];
const MAX_OPENROUTER_MESSAGES: usize = 12;
const MAX_OPENROUTER_MESSAGE_LENGTH: usize = 8_000;
const MAX_OPENROUTER_TOKENS: usize = 1_024;
const MAX_MATH_EXPRESSION_LENGTH: usize = 256;
const OPENROUTER_MODELS: &[&str] = &[
    "google/gemma-4-26b-a4b-it:free",
    "google/gemma-4-31b-it:free",
];

use std::net::IpAddr;
use std::time::Instant;

const MAX_REQUESTS_PER_MINUTE_PER_IP: usize = 120;

#[derive(Clone)]
struct AppState {
    store: Arc<RwLock<KnowledgeStore>>,
    csrf_token: String,
    openrouter_lock: Arc<Mutex<()>>,
    ip_limiter: Arc<Mutex<IpRateLimiter>>,
}

struct IpRateLimiter {
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

#[derive(Deserialize)]
struct ChatRequest {
    message: String,
}

#[derive(Deserialize)]
struct OpenRouterProxyRequest {
    api_key: Option<String>,
    model: String,
    messages: serde_json::Value,
    max_tokens: Option<usize>,
}

#[derive(Deserialize)]
struct TeachRequest {
    prompt: String,
    response: String,
    category: Option<String>,
}

#[derive(Serialize)]
struct ChatResponse<'a> {
    status: &'a str,
    response: &'a str,
    pattern_id: Option<u64>,
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

pub fn run(address: &str, knowledge_path: PathBuf) -> Result<(), String> {
    load_dotenv();
    let store = KnowledgeStore::load(knowledge_path)?;
    let state = AppState {
        store: Arc::new(RwLock::new(store)),
        csrf_token: generate_csrf_token()?,
        openrouter_lock: Arc::new(Mutex::new(())),
        ip_limiter: Arc::new(Mutex::new(IpRateLimiter::new())),
    };
    let listener = TcpListener::bind(address)
        .map_err(|error| format!("Could not listen on http://{address}: {error}"))?;
    let connection_limiter = Arc::new(ConnectionLimiter::new());

    println!("\n  RustBot Knowledge Forge is ready");
    println!("  Open http://{address} in your browser");
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

    if !is_trusted_loopback_host(&request.host) {
        return Response::error(400, "Bad Request", "Untrusted Host header.").write_to(&mut stream);
    }

    if matches!(request.method.as_str(), "POST" | "PUT" | "DELETE" | "PATCH")
        && !validate_csrf(&request, &state.csrf_token)
    {
        return Response::error(
            403,
            "Forbidden",
            "Cross-origin request rejected (CSRF check failed).",
        )
        .write_to(&mut stream);
    }

    let response = match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/") | ("GET", "/index.html") => Response::html(
            200,
            "OK",
            INDEX_HTML
                .replace("__ORIGIN__", LOOPBACK_ORIGINS[0])
                .replace("__CSRF_TOKEN__", &state.csrf_token),
        ),
        ("GET", "/styles.css") => Response::asset(200, "OK", "text/css; charset=utf-8", STYLES_CSS),
        ("GET", "/app.js") => Response::asset(200, "OK", "text/javascript; charset=utf-8", APP_JS),
        ("GET", "/og.png") => Response::binary(200, "OK", "image/png", OG_IMAGE),
        ("GET", "/api/health") => Response::json(200, "OK", json!({ "status": "ready" })),
        ("POST", "/api/openrouter/chat") => {
            handle_openrouter_chat(&request.body, &state.openrouter_lock)
        }
        ("GET", "/api/market/candles") => match fetch_market_candles(&request.query) {
            Ok(data) => Response::json(200, "OK", data),
            Err(error) => Response::error(502, "Bad Gateway", &error),
        },
        ("GET", "/api/knowledge") => {
            let category = request
                .query
                .get("category")
                .map(|value| normalize_category_filter(value))
                .transpose();

            match category {
                Ok(category) => match state.store.read() {
                    Ok(store) => {
                        let patterns = store.patterns_by_category(category.as_deref());
                        Response::json(200, "OK", json!({ "patterns": patterns }))
                    }
                    Err(_) => Response::error(
                        500,
                        "Internal Server Error",
                        "Knowledge store is unavailable.",
                    ),
                },
                Err(error) => Response::error(400, "Bad Request", &error),
            }
        }
        ("GET", "/api/knowledge/export") => match state.store.read() {
            Ok(store) => match store.export_json() {
                Ok(json_data) => {
                    Response::asset(200, "OK", "application/json; charset=utf-8", &json_data)
                }
                Err(error) => Response::error(500, "Internal Server Error", &error),
            },
            Err(_) => Response::error(500, "Internal Server Error", "Knowledge store unavailable."),
        },
        ("POST", "/api/knowledge/import") => match String::from_utf8(request.body.clone()) {
            Ok(json_str) => match state.store.write() {
                Ok(mut store) => match store.import_json(&json_str) {
                    Ok(count) => {
                        Response::json(200, "OK", json!({ "status": "imported", "count": count }))
                    }
                    Err(error) => Response::error(400, "Bad Request", &error),
                },
                Err(_) => {
                    Response::error(500, "Internal Server Error", "Knowledge store unavailable.")
                }
            },
            Err(_) => Response::error(400, "Bad Request", "Invalid UTF-8 payload."),
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
            Ok(payload) => {
                let msg = payload.message.trim();
                // 1. Math calculation intent check
                if let Some(result) = evaluate_math(msg) {
                    let formatted = if (result.fract()).abs() < 1e-9 {
                        format!("{} = {:.0}", msg, result)
                    } else {
                        format!("{} = {:.4}", msg, result)
                    };
                    record_chat_entry(msg, &formatted, "matched", None);
                    return Response::json(
                        200,
                        "OK",
                        json!({
                            "status": "matched",
                            "response": formatted,
                            "pattern_id": null
                        }),
                    )
                    .write_to(&mut stream);
                }

                // 2. Market price intent check
                if let Some((_sym, price_resp)) = check_market_intent(msg) {
                    record_chat_entry(msg, &price_resp, "matched", None);
                    return Response::json(
                        200,
                        "OK",
                        json!({
                            "status": "matched",
                            "response": price_resp,
                            "pattern_id": null
                        }),
                    )
                    .write_to(&mut stream);
                }

                // 3. Knowledge base lookup
                match state.store.read() {
                    Ok(store) => match store.find_best_match(msg) {
                        Some(pattern) => {
                            let expanded =
                                expand_placeholders(&pattern.response, store.patterns().len());
                            record_chat_entry(msg, &expanded, "matched", Some(pattern.id));
                            Response::json(
                                200,
                                "OK",
                                json!({
                                    "status": "matched",
                                    "response": expanded,
                                    "pattern_id": pattern.id,
                                    "category": pattern.category
                                }),
                            )
                        }
                        None => {
                            record_chat_entry(msg, "That isn't in my memory yet.", "unknown", None);
                            Response::json(
                                200,
                                "OK",
                                ChatResponse {
                                    status: "unknown",
                                    response: "That isn't in my memory yet.",
                                    pattern_id: None,
                                },
                            )
                        }
                    },
                    Err(_) => Response::error(
                        500,
                        "Internal Server Error",
                        "Knowledge store is unavailable.",
                    ),
                }
            }
            Err(error) => Response::error(400, "Bad Request", &error),
        },
        ("GET", "/api/chat/history") => {
            let path = std::path::Path::new("chat_history.json");
            let history: serde_json::Value = if path.exists() {
                std::fs::read_to_string(path)
                    .ok()
                    .and_then(|s| serde_json::from_str(&s).ok())
                    .unwrap_or_else(|| json!([]))
            } else {
                json!([])
            };
            Response::json(200, "OK", json!({ "history": history }))
        }
        ("DELETE", "/api/chat/history") => {
            match std::fs::remove_file("chat_history.json") {
                Ok(()) => {
                    Response::json(200, "OK", json!({ "status": "cleared" }))
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    Response::json(200, "OK", json!({ "status": "cleared" }))
                }
                Err(error) => Response::error(
                    500,
                    "Internal Server Error",
                    &format!("Could not clear chat history: {error}"),
                ),
            }
        }
        ("POST", "/api/knowledge") => match parse_json::<TeachRequest>(&request.body) {
            Ok(payload) => match state.store.write() {
                Ok(mut store) => {
                    match store.teach_with_category(
                        &payload.prompt,
                        &payload.response,
                        payload.category,
                    ) {
                        Ok(pattern) => {
                            Response::json(201, "Created", json!({ "pattern": pattern }))
                        }
                        Err(error) => Response::error(400, "Bad Request", &error),
                    }
                }
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

fn expand_placeholders(text: &str, store_count: usize) -> String {
    let (date_str, time_str) = get_utc_now_formatted();
    text.replace("{memory_count}", &store_count.to_string())
        .replace("{date}", &date_str)
        .replace("{time}", &time_str)
}

fn get_utc_now_formatted() -> (String, String) {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
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

fn normalize_category_filter(category: &str) -> Result<String, String> {
    let category = category.trim().to_lowercase();
    if category.is_empty()
        || category.chars().count() > 32
        || !category
            .chars()
            .all(|character| character.is_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("Category must use letters, numbers, hyphens, or underscores and be 32 characters or fewer.".to_string());
    }
    Ok(category)
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

fn check_market_intent(message: &str) -> Option<(String, String)> {
    let lower = message.trim().to_lowercase();
    let is_prediction = lower.contains("predict")
        || lower.contains("go up")
        || lower.contains("go down")
        || lower.contains("buy")
        || lower.contains("sell")
        || lower.contains("trend")
        || lower.contains("analysis")
        || lower.contains("forecast");

    let is_price_or_market = lower.contains("price")
        || lower.contains("market")
        || lower.contains("cost of")
        || is_prediction;

    if !is_price_or_market {
        return None;
    }

    let symbol = if lower.contains("btc") || lower.contains("bitcoin") {
        "BTCUSDT"
    } else if lower.contains("eth") || lower.contains("ethereum") {
        "ETHUSDT"
    } else if lower.contains("sol") || lower.contains("solana") {
        "SOLUSDT"
    } else if lower.contains("bnb") {
        "BNBUSDT"
    } else if lower.contains("xrp") || lower.contains("ripple") {
        "XRPUSDT"
    } else {
        return None;
    };

    let coin_name = symbol.trim_end_matches("USDT");

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

    // Structural Candle Analysis
    let struct_analysis = analyze_candle_structure(&candle_inputs);
    let struct_score = struct_analysis
        .as_ref()
        .map(|s| s.structural_score)
        .unwrap_or(0.0);

    // Technical Momentum Signal (RSI & EMA)
    let closes: Vec<f64> = data.candles.iter().map(|c| c.close).collect();
    let volumes: Vec<f64> = data.candles.iter().map(|c| c.volume).collect();
    let price_change_pct = if closes.len() >= 2 {
        (closes[closes.len() - 1] - closes[closes.len() - 2]) / closes[closes.len() - 2] * 100.0
    } else {
        0.0
    };

    let rsi = calc_rsi(&closes, 14);
    let tech_score = ((rsi - 50.0) / 50.0).clamp(-1.0, 1.0);

    // Static sentiment heuristic; this is not live news analysis.
    let news_analysis = analyze_news_sentiment(coin_name, &volumes, price_change_pct);
    let news_score = news_analysis.sentiment_score;

    // Ensemble Score
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
        - **RSI (14-period)**: `{:.1}` ({})\n\
        - **Technical Score**: `{:+.2}`\n\n\
        #### 3. Static Sentiment Heuristic\n\
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
        if rsi > 70.0 {
            "Overbought"
        } else if rsi < 30.0 {
            "Oversold"
        } else {
            "Neutral Zone"
        },
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

    let mut header_map = HashMap::new();
    for line in headers.lines().skip(1) {
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

fn validate_csrf(request: &Request, expected_token: &str) -> bool {
    let origin = match request.headers.get("origin") {
        Some(origin) if is_trusted_loopback_origin(origin.trim()) => origin,
        _ => return false,
    };
    let token = match request.headers.get("x-rustbot-csrf") {
        Some(token) => token.trim(),
        None => return false,
    };

    is_trusted_loopback_origin(origin.trim()) && constant_time_eq(token, expected_token)
}

fn constant_time_eq(left: &str, right: &str) -> bool {
    if left.len() != right.len() {
        return false;
    }

    left.bytes()
        .zip(right.bytes())
        .fold(0_u8, |difference, (a, b)| difference | (a ^ b))
        == 0
}

fn generate_csrf_token() -> Result<String, String> {
    let mut bytes = [0_u8; 32];
    getrandom(&mut bytes).map_err(|error| format!("Could not generate a CSRF token: {error}"))?;

    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut token = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        token.push(HEX[(byte >> 4) as usize] as char);
        token.push(HEX[(byte & 0x0f) as usize] as char);
    }
    Ok(token)
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
        .clamp(1, 1_000);

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

    let recorded_count = record_live_candles(&symbol, &candles);

    Ok(MarketDataResponse {
        provider,
        symbol,
        interval,
        recorded_count,
        candles,
    })
}

fn record_live_candles(symbol: &str, candles: &[MarketCandle]) -> usize {
    let _guard = match MARKET_LOG_LOCK.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    let path = std::path::Path::new("market_history.json");
    let mut history: HashMap<String, Vec<MarketCandle>> = if path.exists() {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|content| serde_json::from_str(&content).ok())
            .unwrap_or_default()
    } else {
        HashMap::new()
    };

    let symbol_key = symbol.to_uppercase();
    {
        let entry = history.entry(symbol_key.clone()).or_default();
        let mut existing_timestamps: std::collections::HashSet<u64> =
            entry.iter().map(|c| c.timestamp).collect();

        for candle in candles {
            if existing_timestamps.insert(candle.timestamp) {
                entry.push(candle.clone());
            }
        }
        entry.sort_by_key(|c| c.timestamp);
    }
    prune_market_history(&mut history);
    let total_count = history.get(&symbol_key).map(Vec::len).unwrap_or(0);

    if let Ok(json) = serde_json::to_string_pretty(&history) {
        let tmp_path = path.with_extension("json.tmp");
        if std::fs::write(&tmp_path, json).is_ok() {
            let _ = std::fs::rename(tmp_path, path);
        }
    }

    total_count
}

fn prune_market_history(history: &mut HashMap<String, Vec<MarketCandle>>) {
    for candles in history.values_mut() {
        candles.sort_by_key(|candle| candle.timestamp);
        candles.dedup_by_key(|candle| candle.timestamp);
        if candles.len() > MAX_MARKET_HISTORY_CANDLES_PER_SYMBOL {
            candles.drain(..candles.len() - MAX_MARKET_HISTORY_CANDLES_PER_SYMBOL);
        }
    }

    while history.len() > MAX_MARKET_HISTORY_SYMBOLS {
        let oldest_symbol = history
            .iter()
            .min_by_key(|(_, candles)| candles.last().map(|candle| candle.timestamp).unwrap_or(0))
            .map(|(symbol, _)| symbol.clone());
        if let Some(symbol) = oldest_symbol {
            history.remove(&symbol);
        } else {
            break;
        }
    }
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
            let open = json_number(values.get(1)?)?;
            let high = json_number(values.get(2)?)?;
            let low = json_number(values.get(3)?)?;
            let close = json_number(values.get(4)?)?;
            let volume = json_number(values.get(5)?)?;
            Some(MarketCandle {
                timestamp: values.first()?.as_u64()?,
                open,
                high,
                low,
                close,
                volume,
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
        .iter()
        .enumerate()
        .map(|(index, (timestamp, close))| {
            let close_val = *close;
            let prev_close = if index > 0 {
                chart.prices[index - 1].1
            } else {
                close_val
            };
            let open = prev_close;
            let high = close_val.max(open);
            let low = close_val.min(open);
            MarketCandle {
                timestamp: *timestamp,
                open,
                high,
                low,
                close: close_val,
                volume: chart
                    .total_volumes
                    .get(index)
                    .map(|(_, volume)| *volume)
                    .unwrap_or(0.0),
            }
        })
        .collect::<Vec<_>>();
    if group_size > 1 {
        raw = raw
            .chunks(group_size)
            .filter_map(|chunk| chunk.last())
            .cloned()
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
            let open = json_number(values.get(1)?)?;
            let high = json_number(values.get(2)?)?;
            let low = json_number(values.get(3)?)?;
            let close = json_number(values.get(4)?)?;
            let volume = json_number(values.get(6)?)?;
            Some(MarketCandle {
                timestamp: values.first()?.as_u64()?.saturating_mul(1_000),
                open,
                high,
                low,
                close,
                volume,
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
    let response = request.send().map_err(|error| {
        eprintln!("Market data request error for {provider}: {error}");
        format!("Could not connect to {provider}.")
    })?;
    let status = response.status();
    let body = response.text().map_err(|error| {
        eprintln!("Market data response read error for {provider}: {error}");
        format!("Could not read response from {provider}.")
    })?;
    if !status.is_success() {
        eprintln!("{provider} returned HTTP {status}: {body}");
        return Err(format!("{provider} rejected the market-data request."));
    }
    serde_json::from_str(&body).map_err(|error| {
        eprintln!("{provider} JSON parse error: {error}");
        format!("{provider} returned market data in an unexpected format.")
    })
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
            "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\nStrict-Transport-Security: max-age=63072000; includeSubDomains\r\nReferrer-Policy: no-referrer\r\nPermissions-Policy: geolocation=(), camera=(), microphone=()\r\nContent-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' https://s3.tradingview.com; img-src 'self' data:; connect-src 'self' https://telemetry.tradingview.com; frame-src https://s.tradingview.com https://www.tradingview.com https://*.tradingview-widget.com; base-uri 'none'; frame-ancestors 'none'\r\n\r\n",
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

fn load_dotenv() {
    if let Ok(content) = std::fs::read_to_string(".env") {
        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if let Some((key, val)) = line.split_once('=') {
                let key = key.trim();
                let val = val.trim().trim_matches('"').trim_matches('\'');
                if !key.is_empty() && std::env::var(key).is_err() {
                    std::env::set_var(key, val);
                }
            }
        }
    }
}

fn handle_openrouter_chat(body: &[u8], request_lock: &Mutex<()>) -> Response {
    let _guard = match request_lock.try_lock() {
        Ok(guard) => guard,
        Err(_) => {
            return Response::error(
                429,
                "Too Many Requests",
                "Another OpenRouter request is already in progress.",
            )
        }
    };

    let payload: OpenRouterProxyRequest = match parse_json(body) {
        Ok(req) => req,
        Err(err) => return Response::error(400, "Bad Request", &err),
    };

    if !OPENROUTER_MODELS.contains(&payload.model.as_str()) {
        return Response::error(400, "Bad Request", "The requested OpenRouter model is not allowed.");
    }
    if !valid_openrouter_messages(&payload.messages) {
        return Response::error(
            400,
            "Bad Request",
            "Messages must contain 1 to 12 role/content text entries of at most 8,000 characters each.",
        );
    }

    let api_key = payload
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
        .or_else(|| std::env::var("OPENROUTER_API_KEY").ok().filter(|s| !s.trim().is_empty()));

    let api_key = match api_key {
        Some(key) => key,
        None => {
            return Response::error(
                400,
                "Bad Request",
                "OpenRouter API key is missing. Enter an API key in the UI or set OPENROUTER_API_KEY in .env.",
            );
        }
    };

    let client = match reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
    {
        Ok(c) => c,
        Err(err) => return Response::error(500, "Internal Server Error", &format!("Could not create HTTP client: {err}")),
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
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .header("HTTP-Referer", "http://127.0.0.1:7878")
        .header("X-Title", "RustBot Knowledge Forge")
        .json(&body_map);

    match req_builder.send() {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let reason = if resp.status().is_success() { "OK" } else { "Bad Gateway" };
            match resp.text() {
                Ok(text_body) => {
                    let parsed: serde_json::Value = serde_json::from_str(&text_body)
                        .unwrap_or_else(|_| json!({ "error": text_body }));
                    Response::json(status, reason, parsed)
                }
                Err(err) => Response::error(502, "Bad Gateway", &format!("Could not read OpenRouter response: {err}")),
            }
        }
        Err(err) => Response::error(502, "Bad Gateway", &format!("Failed to reach OpenRouter: {err}")),
    }
}

fn valid_openrouter_messages(messages: &serde_json::Value) -> bool {
    let messages = match messages.as_array() {
        Some(messages) if !messages.is_empty() && messages.len() <= MAX_OPENROUTER_MESSAGES => messages,
        _ => return false,
    };

    messages.iter().all(|message| {
        let role = message.get("role").and_then(serde_json::Value::as_str);
        let content = message.get("content").and_then(serde_json::Value::as_str);
        matches!(role, Some("system" | "user" | "assistant"))
            && content
                .map(|content| !content.trim().is_empty() && content.chars().count() <= MAX_OPENROUTER_MESSAGE_LENGTH)
                .unwrap_or(false)
    })
}

fn record_chat_entry(user_msg: &str, bot_resp: &str, status: &str, pattern_id: Option<u64>) {
    let _guard = match CHAT_LOG_LOCK.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    let path = std::path::Path::new("chat_history.json");
    let mut history: Vec<serde_json::Value> = if path.exists() {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let entry = json!({
        "timestamp": secs,
        "user": user_msg,
        "bot": bot_resp,
        "status": status,
        "pattern_id": pattern_id
    });

    history.push(entry);
    if history.len() > 1000 {
        history = history.split_off(history.len() - 1000);
    }

    if let Ok(json_str) = serde_json::to_string_pretty(&history) {
        let tmp_path = path.with_extension("json.tmp");
        if std::fs::write(&tmp_path, json_str).is_ok() {
            let _ = std::fs::rename(tmp_path, path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        calc_rsi, evaluate_math, expand_placeholders, normalize_category_filter, parse_query,
        percent_decode, prune_market_history, valid_openrouter_messages, MarketCandle,
        MAX_MARKET_HISTORY_CANDLES_PER_SYMBOL, MAX_MARKET_HISTORY_SYMBOLS,
    };
    use std::collections::HashMap;

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

    #[test]
    fn math_evaluator_handles_arithmetic() {
        assert_eq!(evaluate_math("15 + 45"), Some(60.0));
        assert_eq!(evaluate_math("calc (10 + 2) * 5"), Some(60.0));
        assert_eq!(evaluate_math("2^3"), Some(8.0));
    }

    #[test]
    fn math_evaluator_rejects_oversized_input() {
        assert_eq!(evaluate_math(&"1".repeat(257)), None);
    }

    #[test]
    fn category_filters_are_normalized_and_bounded() {
        assert_eq!(normalize_category_filter("  Tech  "), Ok("tech".to_string()));
        assert!(normalize_category_filter("bad/category").is_err());
        assert!(normalize_category_filter(&"x".repeat(33)).is_err());
    }

    #[test]
    fn placeholder_expander_replaces_variables() {
        let res = expand_placeholders("Count: {memory_count}, Date: {date}", 42);
        assert!(res.contains("Count: 42"));
        assert!(!res.contains("{date}"));
    }

    #[test]
    fn rsi_calculator_computes_values() {
        let prices = vec![
            10.0, 11.0, 12.0, 11.5, 12.5, 13.0, 12.8, 13.5, 14.0, 13.8, 14.5, 15.0, 14.7, 15.5,
            16.0,
        ];
        let rsi = calc_rsi(&prices, 14);
        assert!(rsi > 50.0);
    }

    #[test]
    fn csrf_validator_blocks_cross_origin_requests() {
        use super::{validate_csrf, Request};
        use std::collections::HashMap;

        let mut valid_req = Request {
            method: "POST".to_string(),
            path: "/api/knowledge".to_string(),
            query: HashMap::new(),
            headers: HashMap::new(),
            host: "127.0.0.1:7878".to_string(),
            body: vec![],
        };
        valid_req.headers.insert("origin".to_string(), "http://127.0.0.1:7878".to_string());
        valid_req.headers.insert("x-rustbot-csrf".to_string(), "test-token".to_string());
        assert!(validate_csrf(&valid_req, "test-token"));

        let mut invalid_req = Request {
            method: "POST".to_string(),
            path: "/api/knowledge".to_string(),
            query: HashMap::new(),
            headers: HashMap::new(),
            host: "127.0.0.1:7878".to_string(),
            body: vec![],
        };
        invalid_req.headers.insert("origin".to_string(), "http://attacker.com".to_string());
        invalid_req.headers.insert("x-rustbot-csrf".to_string(), "test-token".to_string());
        assert!(!validate_csrf(&invalid_req, "test-token"));

        let mut missing_origin = valid_req;
        missing_origin.headers.remove("origin");
        assert!(!validate_csrf(&missing_origin, "test-token"));
    }

    #[test]
    fn math_evaluator_rejects_overflow_to_infinity() {
        assert_eq!(evaluate_math("2^10000"), None);
    }

    #[test]
    fn openrouter_messages_require_a_small_text_only_shape() {
        let valid = serde_json::json!([
            { "role": "system", "content": "You are RustBot." },
            { "role": "user", "content": "Hello" }
        ]);
        assert!(valid_openrouter_messages(&valid));
        assert!(!valid_openrouter_messages(&serde_json::json!([])));
        assert!(!valid_openrouter_messages(&serde_json::json!([{ "role": "tool", "content": "x" }])));
    }

    #[test]
    fn market_history_is_bounded() {
        let candle = |timestamp| MarketCandle {
            timestamp,
            open: 1.0,
            high: 1.0,
            low: 1.0,
            close: 1.0,
            volume: 1.0,
        };
        let mut history = HashMap::new();
        for index in 0..=MAX_MARKET_HISTORY_SYMBOLS {
            history.insert(format!("SYMBOL{index}"), vec![candle(index as u64)]);
        }
        history.insert(
            "BTC".to_string(),
            (0..=MAX_MARKET_HISTORY_CANDLES_PER_SYMBOL as u64)
                .map(candle)
                .collect(),
        );

        prune_market_history(&mut history);

        assert!(history.len() <= MAX_MARKET_HISTORY_SYMBOLS);
        assert!(history
            .values()
            .all(|candles| candles.len() <= MAX_MARKET_HISTORY_CANDLES_PER_SYMBOL));
    }

    #[test]
    fn ip_rate_limiter_blocks_excessive_requests() {
        use super::{IpRateLimiter, MAX_REQUESTS_PER_MINUTE_PER_IP};
        use std::net::IpAddr;

        let mut limiter = IpRateLimiter::new();
        let ip: IpAddr = "127.0.0.1".parse().unwrap();

        for _ in 0..MAX_REQUESTS_PER_MINUTE_PER_IP {
            assert!(limiter.check_and_record(ip));
        }

        assert!(!limiter.check_and_record(ip));
    }
}
