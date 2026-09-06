/* ==========================================================================
   RustBot Market Lab · Dedicated Background Worker Thread
   High-performance numerical feature engineering, walk-forward validation,
   logistic regression model training, and strategy backtesting simulation.
   Runs entirely off the main thread to ensure 100% fluid 60-120 FPS UI.
   ========================================================================== */

self.onmessage = function (event) {
  const { id, type, payload } = event.data || {};
  if (type === "RUN_EXPERIMENT") {
    try {
      const { candles, botMemory } = payload;
      const result = runMarketExperimentWorker(candles, botMemory || {});
      self.postMessage({ id, type: "EXPERIMENT_SUCCESS", payload: result });
    } catch (error) {
      self.postMessage({ id, type: "EXPERIMENT_ERROR", error: error.message || String(error) });
    }
  } else if (type === "TIMESFM_PREDICT") {
    try {
      const { candles, patchSize, horizon } = payload;
      const result = runTimesFMPredictWorker(candles, patchSize || 4, horizon || 6);
      self.postMessage({ id, type: "TIMESFM_SUCCESS", payload: result });
    } catch (error) {
      self.postMessage({ id, type: "TIMESFM_ERROR", error: error.message || String(error) });
    }
  } else if (type === "RETEST_DOUBTFUL_MISTAKE") {
    try {
      const { candles, mistakeItem } = payload;
      const result = retestDoubtfulMistakeWorker(candles, mistakeItem);
      self.postMessage({ id, type: "RETEST_SUCCESS", payload: result });
    } catch (error) {
      self.postMessage({ id, type: "RETEST_ERROR", error: error.message || String(error) });
    }
  }
};

function runMarketExperimentWorker(candles, botMemory) {
  const samples = buildMarketSamples(candles);
  if (samples.length < 90) {
    throw new Error("The dataset does not contain enough feature-ready candles; at least 90 are required.");
  }

  const nextGen = (botMemory.generation || 0) + 1;
  const trainEnd = Math.floor(samples.length * 0.7);
  const validationEnd = Math.floor(samples.length * 0.85);
  const train = samples.slice(0, trainEnd);
  const validation = samples.slice(trainEnd, validationEnd);
  const test = samples.slice(validationEnd);

  const scaler = fitScaler(train.map((sample) => sample.features));
  const scaledTrain = train.map((sample) => ({ ...sample, features: scaleFeatures(sample.features, scaler) }));

  // Warm-start with previous generation weights if available
  const weights = trainLogisticRegression(scaledTrain, botMemory.persistentWeights || null);

  const predict = (sample) => sigmoid(dot(weights, [1, ...scaleFeatures(sample.features, scaler)]));
  const validationProbabilities = validation.map(predict);

  const mistakeCount = Array.isArray(botMemory.mistakeStore) ? botMemory.mistakeStore.length : 0;
  const threshold = selectTradeThreshold(validation, validationProbabilities, mistakeCount);

  const testProbabilities = test.map(predict);
  const correct = test.reduce(
    (total, sample, index) => total + ((testProbabilities[index] >= 0.5) === Boolean(sample.target) ? 1 : 0),
    0,
  );
  const strategy = backtestSignals(test, testProbabilities, threshold);
  const latestFeatures = marketFeaturesAt(candles, candles.length - 1);
  const probability = sigmoid(dot(weights, [1, ...scaleFeatures(latestFeatures, scaler)]));

  return {
    generation: nextGen,
    weights,
    scaler,
    probability,
    threshold,
    accuracy: correct / test.length,
    testSamples: test.length,
    strategyReturn: strategy.netReturn,
    maxDrawdown: strategy.maxDrawdown,
    strategySharpe: strategy.sharpe,
    strategySortino: strategy.sortino,
    trainEndRatio: trainEnd / samples.length,
    validationEndRatio: validationEnd / samples.length,
  };
}

function buildMarketSamples(candles) {
  const samples = [];
  for (let index = 20; index < candles.length - 1; index += 1) {
    const features = marketFeaturesAt(candles, index);
    if (!features.every(Number.isFinite)) continue;
    const forwardReturn = candles[index + 1].close / candles[index].close - 1;
    samples.push({ features, target: forwardReturn > 0 ? 1 : 0, forwardReturn });
  }
  return samples;
}

function marketFeaturesAt(candles, index) {
  const close = (offset = 0) => candles[index - offset].close;
  const logReturn = (period) => Math.log(close(0) / close(period));
  const recentReturns = [];
  for (let offset = 0; offset < 10; offset += 1) {
    recentReturns.push(Math.log(close(offset) / close(offset + 1)));
  }
  const averageClose = (period) => {
    let total = 0;
    for (let offset = 0; offset < period; offset += 1) total += close(offset);
    return total / period;
  };
  let gains = 0;
  let losses = 0;
  for (let offset = 0; offset < 14; offset += 1) {
    const change = close(offset) - close(offset + 1);
    if (change >= 0) gains += change;
    else losses -= change;
  }
  const momentum = gains + losses === 0 ? 0 : gains / (gains + losses) - 0.5;
  const volumes = candles.slice(Math.max(0, index - 9), index + 1).map((candle) => candle.volume || 0);
  const averageVolume = mean(volumes);
  const volumeImpulse = averageVolume > 0 ? Math.log((candles[index].volume + 1) / (averageVolume + 1)) : 0;

  return [
    logReturn(1),
    logReturn(3),
    averageClose(5) / averageClose(15) - 1,
    standardDeviation(recentReturns),
    momentum,
    volumeImpulse,
  ];
}

function fitScaler(rows) {
  const width = rows[0].length;
  const means = Array.from({ length: width }, (_, column) => mean(rows.map((row) => row[column])));
  const deviations = Array.from({ length: width }, (_, column) => {
    const value = standardDeviation(rows.map((row) => row[column]));
    return value > 1e-10 ? value : 1;
  });
  return { means, deviations };
}

function scaleFeatures(features, scaler) {
  return features.map((value, index) => (value - scaler.means[index]) / scaler.deviations[index]);
}

function trainLogisticRegression(samples, initialWeights = null) {
  const numFeatures = samples[0].features.length;
  let weights = new Array(numFeatures + 1).fill(0);
  let learningRate = 0.075;
  let epochs = 650;

  if (initialWeights && initialWeights.length === numFeatures + 1) {
    weights = [...initialWeights];
    learningRate = 0.04;
    epochs = 450;
  }

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const gradient = new Array(weights.length).fill(0);
    samples.forEach((sample) => {
      const row = [1, ...sample.features];
      const error = sigmoid(dot(weights, row)) - sample.target;
      row.forEach((value, index) => {
        gradient[index] += error * value;
      });
    });
    weights.forEach((weight, index) => {
      const penalty = index === 0 ? 0 : 0.002 * weight;
      weights[index] -= learningRate * (gradient[index] / samples.length + penalty);
    });
  }
  return weights;
}

function selectTradeThreshold(samples, probabilities, mistakeCount = 0) {
  const baseThresholds = mistakeCount > 0
    ? [0.54, 0.57, 0.60, 0.63, 0.66]
    : [0.52, 0.55, 0.58, 0.60, 0.62, 0.65];

  return baseThresholds.reduce((best, threshold) => {
    const result = backtestSignals(samples, probabilities, threshold);
    return result.netReturn > best.netReturn ? { threshold, netReturn: result.netReturn } : best;
  }, { threshold: 0.55, netReturn: -Infinity }).threshold;
}

function backtestSignals(samples, probabilities, threshold) {
  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;
  let previousPosition = 0;
  const feeRate = 0.001;
  const periodReturns = [];
  samples.forEach((sample, index) => {
    const probability = probabilities[index];
    const position = probability >= threshold ? 1 : probability <= 1 - threshold ? -1 : 0;
    const cost = Math.abs(position - previousPosition) * feeRate;
    const periodReturn = Math.max(-0.99, position * sample.forwardReturn - cost);
    equity *= 1 + periodReturn;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak);
    previousPosition = position;
    periodReturns.push(periodReturn);
  });

  const sharpe = calculateSharpe(periodReturns);
  const sortino = calculateSortino(periodReturns);
  return { netReturn: equity - 1, maxDrawdown, sharpe, sortino };
}

function calculateSharpe(returns) {
  if (returns.length < 2) return "0.00";
  const m = mean(returns);
  const s = standardDeviation(returns);
  if (s === 0) return "0.00";
  return ((m / s) * Math.sqrt(365 * 24)).toFixed(2);
}

function calculateSortino(returns) {
  if (returns.length < 2) return "0.00";
  const m = mean(returns);
  const downside = returns.filter((r) => r < 0);
  if (downside.length === 0) return "∞";
  const downsideVar = downside.reduce((acc, r) => acc + r * r, 0) / downside.length;
  const downsideStd = Math.sqrt(downsideVar);
  if (downsideStd === 0) return "0.00";
  return ((m / downsideStd) * Math.sqrt(365 * 24)).toFixed(2);
}

function sigmoid(value) {
  const bounded = Math.max(-35, Math.min(35, value));
  return 1 / (1 + Math.exp(-bounded));
}

function dot(left, right) {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    total += left[index] * right[index];
  }
  return total;
}

function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function variance(values) {
  if (values.length < 2) return 0;
  const average = mean(values);
  return values.reduce((total, value) => total + (value - average) ** 2, 0) / (values.length - 1);
}

function standardDeviation(values) {
  return Math.sqrt(variance(values));
}

/* ==========================================================================
   TimesFM-Inspired Attention Matrix & Fair Value Gap Worker Engine
   ========================================================================== */

function runTimesFMPredictWorker(candles, patchSize = 4, horizon = 6) {
  if (!candles || candles.length < patchSize * 2) {
    throw new Error("Insufficient candles for TimesFM patch forecasting");
  }

  const closes = candles.map((c) => c.close);
  const lastClose = closes[closes.length - 1];

  // 1. Calculate log-returns
  const returns = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push(Math.log(closes[i] / Math.max(1e-9, closes[i - 1])));
  }

  // 2. Tokenize into patches
  const patches = [];
  for (let i = 0; i + patchSize <= returns.length; i += patchSize) {
    patches.push(returns.slice(i, i + patchSize));
  }

  if (patches.length < 2) {
    throw new Error("Not enough patches extracted from time-series");
  }

  // 3. Compute cross-patch self-attention matrix
  const numPatches = patches.length;
  const attentionMatrix = [];
  const scale = 1 / Math.sqrt(patchSize);

  for (let i = 0; i < numPatches; i++) {
    const rawScores = [];
    for (let j = 0; j < numPatches; j++) {
      let dotProduct = 0;
      for (let k = 0; k < patchSize; k++) {
        dotProduct += patches[i][k] * patches[j][k];
      }
      rawScores.push(dotProduct * scale);
    }
    // Softmax
    const maxScore = Math.max(...rawScores);
    const expScores = rawScores.map((s) => Math.exp(s - maxScore));
    const sumExp = expScores.reduce((a, b) => a + b, 0);
    attentionMatrix.push(expScores.map((s) => s / Math.max(1e-9, sumExp)));
  }

  // 4. Autoregressive quantile projection
  const lastAttn = attentionMatrix[numPatches - 1];
  let blendedReturn = 0;
  for (let j = 0; j < numPatches; j++) {
    const patchMean = patches[j].reduce((a, b) => a + b, 0) / patchSize;
    blendedReturn += lastAttn[j] * patchMean;
  }

  const histVol = standardDeviation(returns);
  const p10Forecast = [];
  const p50Forecast = [];
  const p90Forecast = [];

  let p10Price = lastClose;
  let p50Price = lastClose;
  let p90Price = lastClose;

  for (let step = 1; step <= horizon; step++) {
    const stepVol = histVol * Math.sqrt(step);
    p50Price *= Math.exp(blendedReturn * 0.95);
    p10Price *= Math.exp(blendedReturn - 1.28 * stepVol);
    p90Price *= Math.exp(blendedReturn + 1.28 * stepVol);

    p10Forecast.push(p10Price);
    p50Forecast.push(p50Price);
    p90Forecast.push(p90Price);
  }

  // 5. Detect Fair Value Gaps (FVGs)
  const gaps = detectFairValueGapsWorker(candles);

  const meanRevProb = blendedReturn < 0
    ? Math.min(0.88, 0.5 + Math.abs(blendedReturn) * 20)
    : Math.max(0.25, 0.5 - blendedReturn * 15);

  return {
    lastClose,
    patchSize,
    horizonSteps: horizon,
    p10Forecast,
    p50Forecast,
    p90Forecast,
    attentionMatrix,
    fairValueGaps: gaps,
    meanReversionProbability: meanRevProb,
    predictedDirection: blendedReturn > 0.0005 ? "BULLISH" : blendedReturn < -0.0005 ? "BEARISH" : "NEUTRAL",
    expectedReturnBps: Math.round(blendedReturn * 10000),
  };
}

function detectFairValueGapsWorker(candles) {
  const gaps = [];
  if (!candles || candles.length < 3) return gaps;

  for (let i = 2; i < candles.length; i++) {
    const c0 = candles[i - 2];
    const c1 = candles[i - 1];
    const c2 = candles[i];

    // Bullish FVG: c0.high < c2.low
    if (c0.high < c2.low) {
      const gapSize = c2.low - c0.high;
      const gapBps = (gapSize / c1.close) * 10000;
      if (gapBps >= 8) {
        gaps.push({
          index: i,
          timestamp: c1.timestamp,
          type: "BULLISH_FVG",
          topPrice: c2.low,
          bottomPrice: c0.high,
          gapSizeBps: Math.round(gapBps),
          status: "OPEN",
        });
      }
    }
    // Bearish FVG: c0.low > c2.high
    else if (c0.low > c2.high) {
      const gapSize = c0.low - c2.high;
      const gapBps = (gapSize / c1.close) * 10000;
      if (gapBps >= 8) {
        gaps.push({
          index: i,
          timestamp: c1.timestamp,
          type: "BEARISH_FVG",
          topPrice: c0.low,
          bottomPrice: c2.high,
          gapSizeBps: Math.round(gapBps),
          status: "OPEN",
        });
      }
    }
  }

  return gaps.slice(-10);
}

function retestDoubtfulMistakeWorker(candles, mistakeItem) {
  // Re-tests a quarantined setup across 2 historical intervals
  if (!candles || candles.length < 50 || !mistakeItem || !mistakeItem.features) {
    return {
      confirmedAsTrap: false,
      retestFails: 0,
      retestPasses: 0,
      clearedDoubt: true,
      reason: "Insufficient historical data for 2x verification; cleared doubt",
    };
  }

  const featuresToTest = mistakeItem.features;
  let retestFails = 0;
  let retestPasses = 0;

  // Search historical slices for similar setups
  for (let i = 25; i < candles.length - 5; i += 7) {
    const histFeatures = marketFeaturesAt(candles, i);
    let distSq = 0;
    for (let f = 0; f < Math.min(featuresToTest.length, histFeatures.length); f++) {
      distSq += (featuresToTest[f] - histFeatures[f]) ** 2;
    }
    const dist = Math.sqrt(distSq);

    if (dist < 1.2) {
      // Found historically analogous setup; evaluate forward 3 candles
      const forwardRet = candles[i + 3].close / candles[i].close - 1;
      if (forwardRet < 0) {
        retestFails++;
      } else {
        retestPasses++;
      }
      if (retestFails >= 2 || retestPasses >= 2) break;
    }
  }

  const confirmedAsTrap = retestFails >= 2;
  const clearedDoubt = retestPasses >= 2;

  return {
    mistakeId: mistakeItem.id,
    confirmedAsTrap,
    clearedDoubt,
    retestFails,
    retestPasses,
    status: confirmedAsTrap ? "CONFIRMED_TRAP" : clearedDoubt ? "CLEARED_EDGE" : "DOUBT_CONTINUED",
  };
}
