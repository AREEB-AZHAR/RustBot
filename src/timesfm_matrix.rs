use serde::{Deserialize, Serialize};

/// Output of a TimesFM-inspired patched time-series forecast.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TimesFmPrediction {
    pub horizon_steps: usize,
    pub p10_forecast: Vec<f64>,
    pub p50_forecast: Vec<f64>,
    pub p90_forecast: Vec<f64>,
    pub fair_value_gaps: Vec<FairValueGap>,
    pub volatility_score: f64,
    pub recommendation: HftSignal,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FairValueGap {
    pub gap_type: String, // "bullish" | "bearish"
    pub top: f64,
    pub bottom: f64,
    pub gap_size_pct: f64,
    pub candle_index: usize,
    pub filled: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HftSignal {
    pub action: String, // "BUY" | "SELL" | "HOLD"
    pub reason: String,
    pub confidence: f64,
    pub entry_price: f64,
    pub take_profit: f64,
    pub stop_loss: f64,
    pub risk_reward_ratio: f64,
}

/// Candle bar input
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CandleBar {
    pub timestamp: i64,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: f64,
}

/// A lightweight, high-performance TimesFM-style patched attention matrix engine.
pub struct TimesFmEngine {
    pub patch_size: usize,
    pub horizon: usize,
}

impl Default for TimesFmEngine {
    fn default() -> Self {
        Self {
            patch_size: 8,
            horizon: 10,
        }
    }
}

impl TimesFmEngine {
    pub fn new(patch_size: usize, horizon: usize) -> Self {
        Self {
            patch_size: patch_size.max(4),
            horizon: horizon.max(5),
        }
    }

    /// Run patched multi-head attention forecasting and Fair Value Gap analysis over candle series.
    pub fn forecast(&self, candles: &[CandleBar]) -> Option<TimesFmPrediction> {
        if candles.len() < self.patch_size * 2 {
            return None;
        }

        let closes: Vec<f64> = candles.iter().map(|c| c.close).collect();
        let last_close = *closes.last()?;

        // 1. Calculate logarithmic returns: r_t = ln(P_t / P_{t-1})
        let mut returns = Vec::with_capacity(candles.len() - 1);
        for i in 1..closes.len() {
            let prev = closes[i - 1];
            let curr = closes[i];
            if prev > 0.0 && curr > 0.0 {
                returns.push((curr / prev).ln());
            } else {
                returns.push(0.0);
            }
        }

        if returns.len() < self.patch_size {
            return None;
        }

        // 2. Tokenize returns into patches (e.g. 8 steps each)
        let num_patches = returns.len() / self.patch_size;
        let mut patches: Vec<Vec<f64>> = Vec::with_capacity(num_patches);
        for p in 0..num_patches {
            let start = p * self.patch_size;
            let end = start + self.patch_size;
            let patch = returns[start..end].to_vec();
            patches.push(patch);
        }

        if patches.is_empty() {
            return None;
        }

        // 3. Multi-Head Scaled Dot-Product Attention across patches
        // Target query = newest patch representing recent microstructure dynamics
        let query_patch = patches.last()?.clone();
        let q_norm = l2_norm(&query_patch);

        let mut attention_scores = Vec::with_capacity(patches.len());
        for p in &patches {
            let p_norm = l2_norm(p);
            let dot = dot_product(&query_patch, p);
            let score = if q_norm > 1e-8 && p_norm > 1e-8 {
                dot / (q_norm * p_norm)
            } else {
                0.0
            };
            // Softmax scale factor sqrt(d_k)
            let scaled = score / (self.patch_size as f64).sqrt();
            attention_scores.push(scaled);
        }

        let softmax_weights = softmax(&attention_scores);

        // 4. Compute Historical Volatility (standard deviation of returns)
        let mean_ret: f64 = returns.iter().sum::<f64>() / (returns.len() as f64);
        let variance: f64 = returns.iter().map(|r| (r - mean_ret).powi(2)).sum::<f64>()
            / (returns.len().max(2) - 1) as f64;
        let vol_sigma = variance.sqrt().max(0.001); // min 0.1% volatility
        let vol_score = (vol_sigma * (365.0 * 24.0 * 60.0_f64).sqrt() * 100.0).min(999.0);

        // 5. Projected Forward Quantiles (P10, P50, P90)
        let mut expected_drift = 0.0;
        for (i, p) in patches.iter().enumerate() {
            let patch_mean = p.iter().sum::<f64>() / (p.len() as f64);
            expected_drift += softmax_weights[i] * patch_mean;
        }

        let mut p10_forecast = Vec::with_capacity(self.horizon);
        let mut p50_forecast = Vec::with_capacity(self.horizon);
        let mut p90_forecast = Vec::with_capacity(self.horizon);

        // Quantile z-scores: P10 = -1.282, P90 = +1.282
        let z_quantile = 1.282;

        let mut curr_p50 = last_close;
        for step in 1..=self.horizon {
            let step_vol = vol_sigma * (step as f64).sqrt();
            let step_drift = expected_drift * (step as f64);

            curr_p50 = last_close * (step_drift).exp();
            let curr_p10 = last_close * (step_drift - z_quantile * step_vol).exp();
            let curr_p90 = last_close * (step_drift + z_quantile * step_vol).exp();

            p10_forecast.push(round_to_sig(curr_p10, 6));
            p50_forecast.push(round_to_sig(curr_p50, 6));
            p90_forecast.push(round_to_sig(curr_p90, 6));
        }

        // 6. Fair Value Gap (FVG) and Imbalance Detection
        let mut fair_value_gaps = Vec::new();
        if candles.len() >= 3 {
            for i in 2..candles.len() {
                let c1 = &candles[i - 2];
                let c2 = &candles[i - 1];
                let c3 = &candles[i];

                // Bullish FVG: Large impulse up where c1.high < c3.low
                if c3.low > c1.high && c2.close > c2.open {
                    let gap_size = (c3.low - c1.high) / c1.high;
                    if gap_size > 0.002 { // > 0.2% price gap
                        let filled = candles[i..].iter().any(|c| c.low <= c1.high);
                        fair_value_gaps.push(FairValueGap {
                            gap_type: "bullish".to_string(),
                            top: c3.low,
                            bottom: c1.high,
                            gap_size_pct: gap_size * 100.0,
                            candle_index: i,
                            filled,
                        });
                    }
                }
                // Bearish FVG: Large impulse down where c1.low > c3.high
                else if c1.low > c3.high && c2.close < c2.open {
                    let gap_size = (c1.low - c3.high) / c3.high;
                    if gap_size > 0.002 {
                        let filled = candles[i..].iter().any(|c| c.high >= c1.low);
                        fair_value_gaps.push(FairValueGap {
                            gap_type: "bearish".to_string(),
                            top: c1.low,
                            bottom: c3.high,
                            gap_size_pct: gap_size * 100.0,
                            candle_index: i,
                            filled,
                        });
                    }
                }
            }
        }

        // 7. Formulate HFT Recommendation based on Imbalance & Quantiles
        let active_unfilled_gaps: Vec<&FairValueGap> = fair_value_gaps.iter().filter(|g| !g.filled).collect();
        let latest_unfilled_gap = active_unfilled_gaps.last().copied();

        let mut signal_action = "HOLD";
        let mut signal_reason = "No high-probability Fair Value Gap or quantile divergence detected.".to_string();
        let mut confidence = 0.50;
        let mut take_profit = last_close * 1.025;
        let mut stop_loss = last_close * 0.985;

        if let Some(gap) = latest_unfilled_gap {
            if gap.gap_type == "bullish" && last_close <= gap.top && last_close >= gap.bottom {
                // Price retraced into a Bullish FVG discount zone -> High probability buy bounce
                signal_action = "BUY";
                signal_reason = format!(
                    "Retraced into Bullish FVG ({:.2}% gap). Predictive P50 target at ${:.4}",
                    gap.gap_size_pct, curr_p50
                );
                take_profit = gap.top * 1.03;
                stop_loss = gap.bottom * 0.985; // Strict HFT risk stop below gap invalidation
                confidence = 0.78;
            } else if gap.gap_type == "bearish" && last_close >= gap.bottom && last_close <= gap.top {
                // Price retraced into a Bearish FVG premium zone -> Sell / Short correction
                signal_action = "SELL";
                signal_reason = format!(
                    "Retraced into Bearish FVG ({:.2}% gap). Predictive P50 downside target at ${:.4}",
                    gap.gap_size_pct, curr_p50
                );
                take_profit = gap.bottom * 0.97;
                stop_loss = gap.top * 1.015;
                confidence = 0.74;
            }
        }

        let rr_ratio = if (last_close - stop_loss).abs() > 1e-8 {
            (take_profit - last_close).abs() / (last_close - stop_loss).abs()
        } else {
            1.5
        };

        Some(TimesFmPrediction {
            horizon_steps: self.horizon,
            p10_forecast,
            p50_forecast,
            p90_forecast,
            fair_value_gaps,
            volatility_score: round_to_sig(vol_score, 2),
            recommendation: HftSignal {
                action: signal_action.to_string(),
                reason: signal_reason,
                confidence: round_to_sig(confidence, 2),
                entry_price: last_close,
                take_profit: round_to_sig(take_profit, 6),
                stop_loss: round_to_sig(stop_loss, 6),
                risk_reward_ratio: round_to_sig(rr_ratio, 2),
            },
        })
    }
}

fn dot_product(a: &[f64], b: &[f64]) -> f64 {
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}

fn l2_norm(v: &[f64]) -> f64 {
    v.iter().map(|x| x * x).sum::<f64>().sqrt()
}

fn softmax(scores: &[f64]) -> Vec<f64> {
    if scores.is_empty() {
        return Vec::new();
    }
    let max_val = scores.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let exps: Vec<f64> = scores.iter().map(|s| (s - max_val).exp()).collect();
    let sum_exp: f64 = exps.iter().sum::<f64>().max(1e-8);
    exps.into_iter().map(|e| e / sum_exp).collect()
}

fn round_to_sig(val: f64, sig: usize) -> f64 {
    let factor = 10_f64.powi(sig as i32);
    (val * factor).round() / factor
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_timesfm_forecaster_generates_quantiles() {
        let engine = TimesFmEngine::new(4, 5);
        let mut candles = Vec::new();
        let mut price = 100.0;

        for i in 0..20 {
            let change = if i % 2 == 0 { 1.5 } else { -0.8 };
            let open = price;
            price += change;
            candles.push(CandleBar {
                timestamp: 1700000000 + (i * 60) as i64,
                open,
                high: open.max(price) + 0.5,
                low: open.min(price) - 0.5,
                close: price,
                volume: 1000.0,
            });
        }

        let pred = engine.forecast(&candles).expect("Forecast should succeed");
        assert_eq!(pred.p10_forecast.len(), 5);
        assert_eq!(pred.p50_forecast.len(), 5);
        assert_eq!(pred.p90_forecast.len(), 5);
        assert!(pred.p10_forecast[0] <= pred.p50_forecast[0]);
        assert!(pred.p50_forecast[0] <= pred.p90_forecast[0]);
    }

    #[test]
    fn test_detects_fair_value_gaps() {
        let engine = TimesFmEngine::new(4, 5);
        let mut candles = Vec::new();

        // 1. Initial bars
        for i in 0..10 {
            candles.push(CandleBar {
                timestamp: 1700000000 + (i * 60) as i64,
                open: 100.0,
                high: 101.0,
                low: 99.0,
                close: 100.0,
                volume: 500.0,
            });
        }

        // 2. Bar 1: high = 102.0
        candles.push(CandleBar {
            timestamp: 1700000600,
            open: 100.0,
            high: 102.0,
            low: 99.5,
            close: 101.5,
            volume: 500.0,
        });

        // 3. Bar 2 (large displacement impulse up)
        candles.push(CandleBar {
            timestamp: 1700000660,
            open: 102.0,
            high: 110.0,
            low: 101.8,
            close: 109.5,
            volume: 5000.0,
        });

        // 4. Bar 3: low = 105.0 (leaves gap between 102.0 and 105.0)
        candles.push(CandleBar {
            timestamp: 1700000720,
            open: 109.5,
            high: 112.0,
            low: 105.0,
            close: 111.0,
            volume: 2000.0,
        });

        let pred = engine.forecast(&candles).expect("Forecast should succeed");
        let target_gap = pred
            .fair_value_gaps
            .iter()
            .find(|g| g.gap_type == "bullish" && (g.bottom - 102.0).abs() < 1e-4);
        assert!(target_gap.is_some(), "Should detect bullish FVG starting at 102.0");
        let gap = target_gap.unwrap();
        assert_eq!(gap.bottom, 102.0);
        assert_eq!(gap.top, 105.0);
    }
}
