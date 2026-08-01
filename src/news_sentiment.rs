use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewsSentimentAnalysis {
    pub symbol: String,
    pub sentiment_score: f64,    // -1.0 to +1.0
    pub sentiment_label: String, // Bullish, Bearish, Neutral
    pub headline_count: usize,
    pub volume_surge_ratio: f64,
    pub summary: String,
}

pub fn analyze_news_sentiment(
    symbol: &str,
    recent_volumes: &[f64],
    price_change_pct: f64,
) -> NewsSentimentAnalysis {
    let clean_symbol = symbol.to_ascii_uppercase();

    // Volume surge calculation
    let avg_volume: f64 = if recent_volumes.is_empty() {
        1.0
    } else {
        recent_volumes.iter().sum::<f64>() / recent_volumes.len() as f64
    };

    let latest_volume = recent_volumes.last().copied().unwrap_or(avg_volume);
    let volume_surge_ratio = if avg_volume > 0.0 {
        latest_volume / avg_volume
    } else {
        1.0
    };

    // Headline / Market momentum sentiment score calculation
    let mut raw_score = 0.0_f64;

    // Price change factor
    raw_score += (price_change_pct / 2.0).clamp(-0.5, 0.5);

    // Volume surge multiplier
    if volume_surge_ratio > 1.5 {
        if price_change_pct >= 0.0 {
            raw_score += 0.25;
        } else {
            raw_score -= 0.25;
        }
    }

    // Static heuristic templates, not live or sourced news headlines.
    let sample_headlines = get_symbol_headlines(&clean_symbol);
    let (headline_score, positive_matches, negative_matches) = score_headlines(&sample_headlines);

    let final_sentiment_score = (raw_score * 0.4 + headline_score * 0.6).clamp(-1.0, 1.0);

    let sentiment_label = if final_sentiment_score >= 0.20 {
        "Bullish".to_string()
    } else if final_sentiment_score <= -0.20 {
        "Bearish".to_string()
    } else {
        "Neutral".to_string()
    };

    let summary = format!(
        "Applied a static sentiment heuristic to {} built-in templates ({} bullish signals, {} bearish signals). Volume surge ratio: {:.2}x.",
        sample_headlines.len(),
        positive_matches,
        negative_matches,
        volume_surge_ratio
    );

    NewsSentimentAnalysis {
        symbol: clean_symbol,
        sentiment_score: final_sentiment_score,
        sentiment_label,
        headline_count: sample_headlines.len(),
        volume_surge_ratio,
        summary,
    }
}

fn get_symbol_headlines(symbol: &str) -> Vec<String> {
    match symbol {
        "BTCUSDT" | "BTC" | "BITCOIN" => vec![
            "Bitcoin institutional inflows surge as ETF adoption grows".to_string(),
            "Analysts highlight strong support for BTC at key technical level".to_string(),
            "Crypto market volume expands amid steady network growth".to_string(),
        ],
        "ETHUSDT" | "ETH" | "ETHEREUM" => vec![
            "Ethereum layer-2 activity reaches new record high".to_string(),
            "ETH staking yields remain attractive for long-term holders".to_string(),
            "DeFi TVL rises as market liquidity improves".to_string(),
        ],
        "SOLUSDT" | "SOL" | "SOLANA" => vec![
            "Solana DEX trading volume jumps past major benchmark".to_string(),
            "Developer activity on Solana ecosystem gains momentum".to_string(),
        ],
        _ => vec![
            "Market sentiment remains steady with moderate volume".to_string(),
            "Traders monitor macro economic indicators and liquidity".to_string(),
        ],
    }
}

fn score_headlines(headlines: &[String]) -> (f64, usize, usize) {
    let positive_words = [
        "bullish",
        "rally",
        "surge",
        "breakout",
        "record",
        "adoption",
        "growth",
        "partnership",
        "profit",
        "gain",
        "upward",
        "ath",
        "inflow",
        "institutional",
        "approval",
        "etf",
        "attract",
        "jumps",
        "improves",
    ];

    let negative_words = [
        "bearish",
        "crash",
        "plunge",
        "dump",
        "lawsuit",
        "hack",
        "ban",
        "sec",
        "inflation",
        "panic",
        "loss",
        "decline",
        "outflow",
        "liquidation",
        "fear",
        "recession",
        "drop",
        "risk",
    ];

    let mut pos_count = 0;
    let mut neg_count = 0;

    for headline in headlines {
        let lower = headline.to_lowercase();
        for pos in &positive_words {
            if lower.contains(pos) {
                pos_count += 1;
            }
        }
        for neg in &negative_words {
            if lower.contains(neg) {
                neg_count += 1;
            }
        }
    }

    let total = (pos_count + neg_count) as f64;
    let score = if total == 0.0 {
        0.0
    } else {
        (pos_count as f64 - neg_count as f64) / total
    };

    (score, pos_count, neg_count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn news_sentiment_scores_properly() {
        let analysis = analyze_news_sentiment("BTCUSDT", &[100.0, 110.0, 180.0], 2.5);
        assert_eq!(analysis.symbol, "BTCUSDT");
        assert!(analysis.sentiment_score > 0.0);
        assert_eq!(analysis.sentiment_label, "Bullish");
    }
}
