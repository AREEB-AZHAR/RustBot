use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketCandleInput {
    pub timestamp: u64,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CandleGeometry {
    pub body_size: f64,
    pub upper_wick: f64,
    pub lower_wick: f64,
    pub range: f64,
    pub body_to_range: f64,
    pub is_green: bool,
}

impl CandleGeometry {
    pub fn from_candle(c: &MarketCandleInput) -> Self {
        let body_size = (c.close - c.open).abs();
        let upper_wick = c.high - c.close.max(c.open);
        let lower_wick = c.close.min(c.open) - c.low;
        let range = (c.high - c.low).max(0.00001);
        let body_to_range = body_size / range;
        let is_green = c.close >= c.open;

        Self {
            body_size,
            upper_wick,
            lower_wick,
            range,
            body_to_range,
            is_green,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PivotLevels {
    pub pivot: f64,
    pub r1: f64,
    pub s1: f64,
    pub r2: f64,
    pub s2: f64,
}

impl PivotLevels {
    pub fn calculate(high: f64, low: f64, close: f64) -> Self {
        let pivot = (high + low + close) / 3.0;
        let r1 = 2.0 * pivot - low;
        let s1 = 2.0 * pivot - high;
        let r2 = pivot + (high - low);
        let s2 = pivot - (high - low);
        Self {
            pivot,
            r1,
            s1,
            r2,
            s2,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CandleStructureAnalysis {
    pub detected_patterns: Vec<String>,
    pub pivots: PivotLevels,
    pub structural_score: f64,
    pub summary: String,
}

pub fn analyze_candle_structure(candles: &[MarketCandleInput]) -> Option<CandleStructureAnalysis> {
    if candles.len() < 3 {
        return None;
    }

    let len = candles.len();
    let curr = &candles[len - 1];
    let prev = &candles[len - 2];

    let geom_curr = CandleGeometry::from_candle(curr);
    let geom_prev = CandleGeometry::from_candle(prev);

    let mut patterns = Vec::new();
    let mut score_acc = 0.0_f64;

    // 1. Engulfing
    if !geom_prev.is_green && geom_curr.is_green && curr.close > prev.open && curr.open < prev.close
    {
        patterns.push("Bullish Engulfing".to_string());
        score_acc += 0.35;
    } else if geom_prev.is_green
        && !geom_curr.is_green
        && curr.close < prev.open
        && curr.open > prev.close
    {
        patterns.push("Bearish Engulfing".to_string());
        score_acc -= 0.35;
    }

    // 2. Hammer / Shooting Star / Hanging Man
    if geom_curr.lower_wick >= 2.0 * geom_curr.body_size
        && geom_curr.upper_wick <= geom_curr.body_size * 0.5
    {
        if geom_curr.is_green {
            patterns.push("Bullish Hammer".to_string());
            score_acc += 0.30;
        } else {
            patterns.push("Hanging Man".to_string());
            score_acc -= 0.20;
        }
    } else if geom_curr.upper_wick >= 2.0 * geom_curr.body_size
        && geom_curr.lower_wick <= geom_curr.body_size * 0.5
    {
        patterns.push("Shooting Star".to_string());
        score_acc -= 0.30;
    }

    // 3. Doji
    if geom_curr.body_to_range < 0.10 {
        patterns.push("Doji (Indecision)".to_string());
    }

    // 4. Marubozu
    if geom_curr.body_to_range > 0.85 {
        if geom_curr.is_green {
            patterns.push("Bullish Marubozu".to_string());
            score_acc += 0.30;
        } else {
            patterns.push("Bearish Marubozu".to_string());
            score_acc -= 0.30;
        }
    }

    // 5. Three consecutive candles (Three White Soldiers / Three Black Crows)
    if len >= 3 {
        let c1 = &candles[len - 3];
        let c2 = &candles[len - 2];
        let c3 = &candles[len - 1];
        if c1.close > c1.open
            && c2.close > c2.open
            && c3.close > c3.open
            && c3.close > c2.close
            && c2.close > c1.close
        {
            patterns.push("Three White Soldiers".to_string());
            score_acc += 0.40;
        } else if c1.close < c1.open
            && c2.close < c2.open
            && c3.close < c3.open
            && c3.close < c2.close
            && c2.close < c1.close
        {
            patterns.push("Three Black Crows".to_string());
            score_acc -= 0.40;
        }
    }

    // Pivot Levels calculation
    let pivots = PivotLevels::calculate(prev.high, prev.low, prev.close);

    // Support / Resistance proximity check
    if (curr.close - pivots.s1).abs() / curr.close < 0.005 {
        patterns.push("Price Near Pivot Support S1".to_string());
        score_acc += 0.15;
    } else if (curr.close - pivots.r1).abs() / curr.close < 0.005 {
        patterns.push("Price Near Pivot Resistance R1".to_string());
        score_acc -= 0.15;
    }

    let structural_score = score_acc.clamp(-1.0, 1.0);

    let summary = if patterns.is_empty() {
        "Neutral candle structure with no strong reversal patterns.".to_string()
    } else {
        format!("Detected structural patterns: {}", patterns.join(", "))
    };

    Some(CandleStructureAnalysis {
        detected_patterns: patterns,
        pivots,
        structural_score,
        summary,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_bullish_engulfing() {
        let candles = vec![
            MarketCandleInput {
                timestamp: 1,
                open: 100.0,
                high: 105.0,
                low: 95.0,
                close: 98.0,
                volume: 10.0,
            },
            MarketCandleInput {
                timestamp: 2,
                open: 100.0,
                high: 102.0,
                low: 90.0,
                close: 92.0,
                volume: 15.0,
            }, // Bearish
            MarketCandleInput {
                timestamp: 3,
                open: 91.0,
                high: 105.0,
                low: 90.0,
                close: 102.0,
                volume: 25.0,
            }, // Engulfs 92..100
        ];
        let analysis = analyze_candle_structure(&candles).unwrap();
        assert!(analysis
            .detected_patterns
            .iter()
            .any(|p| p == "Bullish Engulfing"));
        assert!(analysis.structural_score > 0.0);
    }

    #[test]
    fn calculates_pivot_levels() {
        let pivots = PivotLevels::calculate(100.0, 90.0, 95.0);
        assert_eq!(pivots.pivot, 95.0);
        assert_eq!(pivots.r1, 100.0);
        assert_eq!(pivots.s1, 90.0);
    }
}
