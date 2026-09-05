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
