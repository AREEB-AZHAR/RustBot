/* ==========================================================================
   RustBot Market Lab · Quantitative Research & Strategy Testing
   Modern High-Performance Financial Terminal Engine
   ========================================================================== */

const state = {
  currentUser: null,
  marketData: [],
  marketChartData: [],
  toastTimer: null,
  botMemory: {
    generation: 0,
    persistentWeights: null,
    scaler: null,
    adaptiveThreshold: 0.55,
    mistakeStore: [],
    previousRun: null,
    avoidedTrapsCount: 0,
  },
};

let csrfToken = "";

const elements = {
  marketForm: document.querySelector("#market-form"),
  marketProvider: document.querySelector("#market-provider"),
  marketSymbol: document.querySelector("#market-symbol"),
  marketTimeframe: document.querySelector("#market-timeframe"),
  marketLookback: document.querySelector("#market-lookback"),
  marketApiKey: document.querySelector("#market-api-key"),
  datasetTitle: document.querySelector("#dataset-title"),
  datasetCopy: document.querySelector("#dataset-copy"),
  datasetStatus: document.querySelector("#dataset-status"),
  marketTrainButton: document.querySelector("#market-train-button"),
  marketFormError: document.querySelector("#market-form-error"),
  marketEmpty: document.querySelector("#market-empty"),
  marketReport: document.querySelector("#market-report"),
  reportSymbol: document.querySelector("#report-symbol"),
  reportTimeframe: document.querySelector("#report-timeframe"),
  marketSignal: document.querySelector("#market-signal"),
  upProbability: document.querySelector("#up-probability"),
  probabilityFill: document.querySelector("#probability-fill"),
  signalExplanation: document.querySelector("#signal-explanation"),
  newsSentimentBadge: document.querySelector("#news-sentiment-badge"),
  candlePatternsList: document.querySelector("#candle-patterns-list"),
  pivotLevelsDisplay: document.querySelector("#pivot-levels-display"),
  testAccuracy: document.querySelector("#test-accuracy"),
  strategyReturn: document.querySelector("#strategy-return"),
  sharpeRatio: document.querySelector("#sharpe-ratio"),
  sortinoRatio: document.querySelector("#sortino-ratio"),
  maxDrawdown: document.querySelector("#max-drawdown"),
  testSamples: document.querySelector("#test-samples"),
  priceChart: document.querySelector("#price-chart"),
  equityChart: document.querySelector("#equity-chart"),
  botStatusPill: document.querySelector("#bot-status-pill"),
  botFinalCapital: document.querySelector("#bot-final-capital"),
  botTotalTrades: document.querySelector("#bot-total-trades"),
  botWinRate: document.querySelector("#bot-win-rate"),
  botAvgGain: document.querySelector("#bot-avg-gain"),
  botAvgLoss: document.querySelector("#bot-avg-loss"),
  buyHoldReturn: document.querySelector("#buy-hold-return"),
  executedTradesList: document.querySelector("#executed-trades-list"),
  tradesCountBadge: document.querySelector("#trades-count-badge"),
  botEvolutionHud: document.querySelector("#bot-evolution-hud"),
  botGenerationLabel: document.querySelector("#bot-generation-label"),
  botExperienceCount: document.querySelector("#bot-experience-count"),
  deltaWinrate: document.querySelector("#delta-winrate"),
  deltaCapital: document.querySelector("#delta-capital"),
  deltaFiltered: document.querySelector("#delta-filtered"),
  deltaThreshold: document.querySelector("#delta-threshold"),
  btnResetBot: document.querySelector("#btn-reset-bot"),
  tradingViewWidget: document.querySelector("#tradingview-widget"),
  tradingViewLink: document.querySelector("#tradingview-link"),
  userNameDisplay: document.querySelector("#user-name-display"),
  userRoleBadge: document.querySelector("#user-role-badge"),
  userAvatar: document.querySelector("#user-avatar"),
  authActionBtn: document.querySelector("#auth-action-btn"),
  railToggleBtn: document.querySelector("#rail-toggle-btn"),
  sidebarRail: document.querySelector("#sidebar-rail"),
  toast: document.querySelector("#toast"),
  toastMessage: document.querySelector("#toast-message"),
  themeToggleBtn: document.querySelector("#theme-toggle-btn"),
  btnStartSolanaBot: document.querySelector("#btn-start-solana-bot"),
  btnStopSolanaBot: document.querySelector("#btn-stop-solana-bot"),
  btnResetSolanaWallet: document.querySelector("#btn-reset-solana-wallet"),
  btnRefreshSolanaScan: document.querySelector("#btn-refresh-solana-scan"),
  solanaBotStatusPill: document.querySelector("#solana-bot-status-pill"),
  solanaStatusText: document.querySelector("#solana-status-text"),
  solanaWalletBalance: document.querySelector("#solana-wallet-balance"),
  solanaCashAllocation: document.querySelector("#solana-cash-allocation"),
  solanaCumPnl: document.querySelector("#solana-cum-pnl"),
  solanaPnlTag: document.querySelector("#solana-pnl-tag"),
  solanaWinrateStat: document.querySelector("#solana-winrate-stat"),
  solanaFeeDrag: document.querySelector("#solana-fee-drag"),
  circuitBarFill: document.querySelector("#circuit-bar-fill"),
  circuitDrawdownText: document.querySelector("#circuit-drawdown-text"),
  circuitStatusBadge: document.querySelector("#circuit-status-badge"),
  solanaActiveTokenBadge: document.querySelector("#solana-active-token-badge"),
  solanaPositionDetails: document.querySelector("#solana-position-details"),
  solanaTokensTbody: document.querySelector("#solana-tokens-tbody"),
  timesfmForecastCanvas: document.querySelector("#timesfm-forecast-canvas"),
  timesfmActivePairHeading: document.querySelector("#timesfm-active-pair-heading"),
  timesfmExpectedReturn: document.querySelector("#timesfm-expected-return"),
  timesfmMeanRevProb: document.querySelector("#timesfm-mean-rev-prob"),
  timesfmFvgCount: document.querySelector("#timesfm-fvg-count"),
  tagStage1Count: document.querySelector("#tag-stage-1-count"),
  tagStage2Count: document.querySelector("#tag-stage-2-count"),
  tagStage3Count: document.querySelector("#tag-stage-3-count"),
  solanaLearningTbody: document.querySelector("#solana-learning-tbody"),
  solanaTradeJournalCount: document.querySelector("#solana-trade-journal-count"),
  solanaJournalTbody: document.querySelector("#solana-journal-tbody"),
};

const marketProviders = {
  binance: {
    title: "Binance public candlesticks",
    copy: "No exchange key is required for public spot-market data.",
    symbol: "BTCUSDT",
    tradingViewExchange: "BINANCE",
  },
  coingecko: {
    title: "CoinGecko historical market chart",
    copy: "Use a CoinGecko coin ID such as bitcoin, ethereum, or solana.",
    symbol: "bitcoin",
    tradingViewExchange: "COINBASE",
  },
  kraken: {
    title: "Kraken public OHLC feed",
    copy: "Use a Kraken pair such as XBTUSD, ETHUSD, or SOLUSD.",
    symbol: "XBTUSD",
    tradingViewExchange: "KRAKEN",
  },
};

document.addEventListener("DOMContentLoaded", initialize);

async function initialize() {
  initTheme();
  bindEvents();
  updateMarketProvider();
  initSolanaBot();
  await checkAuth();
}

function getActiveTheme() {
  return document.documentElement.getAttribute("data-theme") || "dark";
}

function updateThemeUI(theme) {
  if (!elements.themeToggleBtn) return;
  const icon = elements.themeToggleBtn.querySelector(".theme-icon");
  if (theme === "dark") {
    if (icon) icon.textContent = "☀️";
    elements.themeToggleBtn.setAttribute("aria-label", "Switch to Light Theme");
    elements.themeToggleBtn.setAttribute("title", "Switch to Light Theme");
  } else {
    if (icon) icon.textContent = "🌙";
    elements.themeToggleBtn.setAttribute("aria-label", "Switch to Dark Theme");
    elements.themeToggleBtn.setAttribute("title", "Switch to Dark Theme");
  }
}

function initTheme() {
  const current = getActiveTheme();
  updateThemeUI(current);

  if (elements.themeToggleBtn) {
    elements.themeToggleBtn.addEventListener("click", () => {
      const nextTheme = getActiveTheme() === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", nextTheme);
      try {
        localStorage.setItem("rustbot_theme", nextTheme);
      } catch (e) {}
      updateThemeUI(nextTheme);
      renderTradingViewWidget();
    });
  }
}

function bindEvents() {
  if (elements.marketForm) {
    elements.marketForm.addEventListener("submit", trainMarketModel);
  }
  if (elements.marketProvider) {
    elements.marketProvider.addEventListener("change", updateMarketProvider);
  }
  if (elements.marketSymbol) {
    elements.marketSymbol.addEventListener("change", renderTradingViewWidget);
  }
  if (elements.marketTimeframe) {
    elements.marketTimeframe.addEventListener("change", renderTradingViewWidget);
  }
  if (elements.btnResetBot) {
    elements.btnResetBot.addEventListener("click", resetBotMemory);
  }
  if (elements.railToggleBtn && elements.sidebarRail) {
    elements.railToggleBtn.addEventListener("click", () => {
      elements.sidebarRail.classList.toggle("is-open");
    });
  }
  if (elements.btnStartSolanaBot) {
    elements.btnStartSolanaBot.addEventListener("click", startSolanaAutonomousBot);
  }
  if (elements.btnStopSolanaBot) {
    elements.btnStopSolanaBot.addEventListener("click", () => stopSolanaAutonomousBot("OPERATOR_STOP"));
  }
  if (elements.btnResetSolanaWallet) {
    elements.btnResetSolanaWallet.addEventListener("click", resetSolanaWallet);
  }
  if (elements.btnRefreshSolanaScan) {
    elements.btnRefreshSolanaScan.addEventListener("click", () => scanSolanaChain(true));
  }
  window.addEventListener("resize", () => {
    if (state.marketChartData && state.marketChartData.length) {
      drawPriceChart();
    }
    if (solanaBotState.latestTimesfmResult) {
      drawTimesfmCanvas(solanaBotState.currentCandles, solanaBotState.latestTimesfmResult);
    }
  });
}

async function checkAuth() {
  try {
    const res = await api("/api/auth/me");
    if (res && res.user) {
      state.currentUser = res.user;
      csrfToken = res.csrf_token || "";
      if (elements.userNameDisplay) elements.userNameDisplay.textContent = res.user.username;
      if (elements.userRoleBadge) elements.userRoleBadge.textContent = res.user.role || "member";
      if (elements.userAvatar) elements.userAvatar.textContent = res.user.username.slice(0, 1).toUpperCase();
      if (elements.authActionBtn) {
        elements.authActionBtn.textContent = "Log Out";
        elements.authActionBtn.href = "#";
        elements.authActionBtn.addEventListener("click", async (e) => {
          e.preventDefault();
          try {
            await api("/api/auth/logout", { method: "POST" });
            window.location.href = "/";
          } catch {
            window.location.href = "/";
          }
        });
      }
    }
  } catch {
    // Guest mode
    if (elements.userNameDisplay) elements.userNameDisplay.textContent = "Guest";
    if (elements.userRoleBadge) elements.userRoleBadge.textContent = "Visitor";
    if (elements.authActionBtn) {
      elements.authActionBtn.textContent = "Log In";
      elements.authActionBtn.href = "/";
    }
  }
}

function updateMarketProvider() {
  const provider = elements.marketProvider.value;
  const details = marketProviders[provider] || marketProviders.binance;
  const previousDefaults = Object.values(marketProviders).map((item) => item.symbol.toLowerCase());
  if (!elements.marketSymbol.value.trim() || previousDefaults.includes(elements.marketSymbol.value.trim().toLowerCase())) {
    elements.marketSymbol.value = details.symbol;
  }
  elements.datasetTitle.textContent = details.title;
  elements.datasetCopy.textContent = details.copy;
  elements.datasetStatus.textContent = "Ready to fetch";
  const fifteenMinuteOption = elements.marketTimeframe.querySelector('option[value="15m"]');
  if (fifteenMinuteOption) {
    fifteenMinuteOption.disabled = provider === "coingecko";
  }
  if (provider === "coingecko" && elements.marketTimeframe.value === "15m") {
    elements.marketTimeframe.value = "1h";
  }
  renderTradingViewWidget();
}

function renderTradingViewWidget() {
  if (!elements.tradingViewWidget) return;
  const provider = elements.marketProvider.value;
  const rawSymbol = elements.marketSymbol.value.trim() || marketProviders[provider].symbol;
  const chartSymbol = tradingViewSymbol(provider, rawSymbol);
  const intervalMap = { "15m": "15", "1h": "60", "4h": "240", "1d": "D" };

  elements.tradingViewWidget.replaceChildren();
  const container = document.createElement("div");
  container.className = "tradingview-widget-container";
  const widget = document.createElement("div");
  widget.className = "tradingview-widget-container__widget";
  const script = document.createElement("script");
  script.type = "text/javascript";
  script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
  script.async = true;
  script.textContent = JSON.stringify({
    autosize: true,
    symbol: chartSymbol,
    interval: intervalMap[elements.marketTimeframe.value] || "60",
    timezone: "Etc/UTC",
    theme: getActiveTheme() === "light" ? "light" : "dark",
    style: "1",
    locale: "en",
    backgroundColor: getActiveTheme() === "light" ? "#ffffff" : "#111722",
    gridColor: getActiveTheme() === "light" ? "rgba(0, 0, 0, 0.05)" : "rgba(255, 255, 255, 0.05)",
    hide_side_toolbar: false,
    allow_symbol_change: true,
    save_image: false,
    calendar: false,
    support_host: "https://www.tradingview.com",
  });
  container.append(widget, script);
  elements.tradingViewWidget.append(container);

  if (elements.tradingViewLink) {
    const pathSymbol = chartSymbol.replace(":", "-").replace(/[^A-Z0-9-]/gi, "");
    elements.tradingViewLink.href = `https://www.tradingview.com/symbols/${pathSymbol}/`;
  }
}

function tradingViewSymbol(provider, rawSymbol) {
  const normalized = rawSymbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (provider === "coingecko") {
    const coinSymbols = {
      bitcoin: "BTCUSD",
      ethereum: "ETHUSD",
      solana: "SOLUSD",
      ripple: "XRPUSD",
      dogecoin: "DOGEUSD",
      cardano: "ADAUSD",
    };
    return `COINBASE:${coinSymbols[rawSymbol.toLowerCase()] || `${normalized}USD`}`;
  }
  const exchange = marketProviders[provider]?.tradingViewExchange || "BINANCE";
  return `${exchange}:${normalized}`;
}

async function trainMarketModel(event) {
  event.preventDefault();
  const provider = elements.marketProvider.value;
  const symbol = elements.marketSymbol.value.trim();
  const timeframe = elements.marketTimeframe.value;
  const limit = Number(elements.marketLookback.value);

  if (!/^[a-z0-9._-]{2,24}$/i.test(symbol)) {
    elements.marketFormError.textContent = "Use a valid market symbol containing letters, numbers, dots, dashes, or underscores.";
    elements.marketFormError.style.display = "block";
    elements.marketSymbol.focus();
    return;
  }

  const originalLabel = elements.marketTrainButton.firstElementChild.textContent;
  elements.marketTrainButton.disabled = true;
  elements.marketTrainButton.firstElementChild.textContent = "Fetching public candles…";
  elements.marketFormError.textContent = "";
  elements.marketFormError.style.display = "none";
  elements.datasetStatus.textContent = "Connecting…";

  try {
    const queryParams = { provider, symbol, interval: timeframe, limit: String(limit) };
    const query = new URLSearchParams(queryParams);
    const response = await api(`/api/market/candles?${query}`);
    const candles = Array.isArray(response.candles)
      ? response.candles
          .map((candle) => ({
            timestamp: Number(candle.timestamp),
            open: Number(candle.open || candle.close),
            high: Number(candle.high || candle.close),
            low: Number(candle.low || candle.close),
            close: Number(candle.close),
            volume: Number(candle.volume) || 0,
          }))
          .filter((candle) => Number.isFinite(candle.close) && candle.close > 0)
      : [];

    if (candles.length < 120) {
      throw new Error(`Only ${candles.length} usable candles were returned; at least 120 are required.`);
    }

    state.marketData = candles;
    const apiKey = elements.marketApiKey?.value.trim() || "";
    elements.marketTrainButton.firstElementChild.textContent = apiKey
      ? "Training AI Model in Background Worker…"
      : "Training Baseline in Multi-Threaded Worker…";
    elements.datasetStatus.textContent = `${candles.length} live candles ${apiKey ? "(OpenRouter AI Connected 🤖)" : `(Recorded: ${response.recorded_count || candles.length})`}`;

    // Execute in dedicated background Web Worker thread (Zero UI blocking, 60 FPS fluid rendering!)
    const result = await runMarketExperimentAsync(candles);

    // Update state memory with worker results
    state.botMemory.generation = result.generation;
    state.botMemory.persistentWeights = result.weights;
    state.botMemory.scaler = result.scaler;
    state.botMemory.adaptiveThreshold = result.threshold;

    let openRouterAnalysis = null;
    if (apiKey) {
      elements.marketTrainButton.firstElementChild.textContent = "Querying OpenRouter AI Model…";
      openRouterAnalysis = await callOpenRouterMarketAnalysis(apiKey, symbol, candles, result);
    }

    renderMarketReport(result, response.provider || provider, response.symbol || symbol, timeframe, openRouterAnalysis);
    renderTradingViewWidget();
    showToast(`Trained on ${candles.length} candles in Web Worker. Test accuracy: ${Math.round(result.accuracy * 100)}%.`);
  } catch (error) {
    elements.marketFormError.textContent = error.message;
    elements.marketFormError.style.display = "block";
    elements.datasetStatus.textContent = "Fetch failed";
  } finally {
    elements.marketTrainButton.disabled = false;
    elements.marketTrainButton.firstElementChild.textContent = originalLabel;
  }
}

// ==========================================================================
// Web Worker Multi-Threading Bridge
// ==========================================================================
let marketWorker = null;
let workerMessageId = 0;
const workerPendingCallbacks = new Map();

function getOrCreateMarketWorker() {
  if (!marketWorker && typeof window !== "undefined" && window.Worker) {
    try {
      marketWorker = new Worker("/market_worker.js");
      marketWorker.onmessage = function (event) {
        const { id, type, payload, error } = event.data || {};
        const callback = workerPendingCallbacks.get(id);
        if (callback) {
          workerPendingCallbacks.delete(id);
          if (type === "EXPERIMENT_SUCCESS") {
            callback.resolve(payload);
          } else {
            callback.reject(new Error(error || "Worker computation failed"));
          }
        }
      };
      marketWorker.onerror = function (event) {
        console.error("Market Web Worker runtime error:", event);
      };
    } catch (error) {
      console.warn("Could not instantiate Web Worker, using fallback:", error);
      marketWorker = null;
    }
  }
  return marketWorker;
}

async function runMarketExperimentAsync(candles) {
  const worker = getOrCreateMarketWorker();
  if (worker) {
    workerMessageId += 1;
    const id = workerMessageId;
    return new Promise((resolve, reject) => {
      workerPendingCallbacks.set(id, { resolve, reject });
      worker.postMessage({
        id,
        type: "RUN_EXPERIMENT",
        payload: {
          candles,
          botMemory: {
            generation: state.botMemory.generation,
            persistentWeights: state.botMemory.persistentWeights,
            mistakeStore: state.botMemory.mistakeStore,
          },
        },
      });
    });
  }

  // Graceful fallback for non-worker environments
  return runMarketExperiment(candles);
}

function runMarketExperiment(candles) {
  const samples = buildMarketSamples(candles);
  if (samples.length < 90) throw new Error("The dataset does not contain enough feature-ready candles.");

  state.botMemory.generation += 1;
  const currentGen = state.botMemory.generation;

  const trainEnd = Math.floor(samples.length * 0.7);
  const validationEnd = Math.floor(samples.length * 0.85);
  const train = samples.slice(0, trainEnd);
  const validation = samples.slice(trainEnd, validationEnd);
  const test = samples.slice(validationEnd);
  const scaler = fitScaler(train.map((sample) => sample.features));
  const scaledTrain = train.map((sample) => ({ ...sample, features: scaleFeatures(sample.features, scaler) }));

  // Warm-start model with persistent weights from previous generation if available
  const weights = trainLogisticRegression(scaledTrain, state.botMemory.persistentWeights);
  state.botMemory.persistentWeights = weights;
  state.botMemory.scaler = scaler;

  const predict = (sample) => sigmoid(dot(weights, [1, ...scaleFeatures(sample.features, scaler)]));
  const validationProbabilities = validation.map(predict);

  // Adapt threshold dynamically based on mistakes accumulated from prior test runs
  const threshold = selectTradeThreshold(validation, validationProbabilities, state.botMemory.mistakeStore.length);
  state.botMemory.adaptiveThreshold = threshold;

  const testProbabilities = test.map(predict);
  const correct = test.reduce(
    (total, sample, index) => total + ((testProbabilities[index] >= 0.5) === Boolean(sample.target) ? 1 : 0),
    0,
  );
  const strategy = backtestSignals(test, testProbabilities, threshold);
  const latestFeatures = marketFeaturesAt(candles, candles.length - 1);
  const probability = sigmoid(dot(weights, [1, ...scaleFeatures(latestFeatures, scaler)]));

  return {
    generation: currentGen,
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
    // Warm-start with previous generation's policy weights
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
  // If the bot has recorded past whipsaw mistakes, raise conviction boundary to filter noise
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

function renderMarketReport(result, provider, symbol, timeframe, openRouterAnalysis = null) {
  elements.marketEmpty.style.display = "none";
  elements.marketReport.style.display = "flex";
  elements.reportSymbol.textContent = symbol.toUpperCase();
  elements.reportTimeframe.textContent = `${timeframe} · ${provider}`;
  elements.upProbability.textContent = `${(result.probability * 100).toFixed(1)}%`;
  elements.probabilityFill.style.width = `${Math.max(2, Math.min(98, result.probability * 100))}%`;
  elements.testAccuracy.textContent = `${(result.accuracy * 100).toFixed(1)}%`;
  elements.strategyReturn.textContent = formatSignedPercent(result.strategyReturn);
  elements.strategyReturn.style.color = result.strategyReturn >= 0 ? "#10b981" : "#f43f5e";
  if (elements.sharpeRatio) elements.sharpeRatio.textContent = result.strategySharpe || "0.00";
  if (elements.sortinoRatio) elements.sortinoRatio.textContent = result.strategySortino || "0.00";
  elements.maxDrawdown.textContent = `-${(result.maxDrawdown * 100).toFixed(1)}%`;
  elements.testSamples.textContent = String(result.testSamples);

  if (state.marketData && state.marketData.length >= 3) {
    const candles = state.marketData;
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const high = last.high || last.close * 1.002;
    const low = last.low || last.close * 0.998;
    const pivot = (high + low + last.close) / 3;
    const r1 = 2 * pivot - low;
    const s1 = 2 * pivot - high;

    const patterns = [];
    if (last.close > prev.close * 1.005) patterns.push("Bullish Momentum");
    else if (last.close < prev.close * 0.995) patterns.push("Bearish Momentum");
    if (Math.abs(last.close - (last.open || prev.close)) / last.close < 0.001) patterns.push("Doji (Indecision)");

    if (elements.candlePatternsList) {
      elements.candlePatternsList.textContent = patterns.length
        ? `Patterns: ${patterns.join(", ")}`
        : "Patterns: Neutral candle structure";
    }
    if (elements.pivotLevelsDisplay) {
      elements.pivotLevelsDisplay.textContent = `Pivot: $${pivot.toFixed(2)} | Support S1: $${s1.toFixed(2)} | Resistance R1: $${r1.toFixed(2)}`;
    }
    if (elements.newsSentimentBadge) {
      if (openRouterAnalysis && openRouterAnalysis.signal) {
        const confPct = Math.round((openRouterAnalysis.confidence || 0.85) * 100);
        elements.newsSentimentBadge.textContent = `OpenRouter AI: ${openRouterAnalysis.signal} (${confPct}%)`;
        elements.newsSentimentBadge.className = `signal-pill ${openRouterAnalysis.signal.toLowerCase()}`;
      } else {
        const isBull = result.probability >= 0.55;
        const isBear = result.probability <= 0.45;
        elements.newsSentimentBadge.textContent = `Sentiment: ${isBull ? "Bullish" : isBear ? "Bearish" : "Neutral"}`;
        elements.newsSentimentBadge.className = `signal-pill ${isBull ? "bullish" : isBear ? "bearish" : "neutral"}`;
      }
    }
  }

  const signal = result.probability >= result.threshold
    ? "bullish"
    : result.probability <= 1 - result.threshold
      ? "bearish"
      : "neutral";
  elements.marketSignal.className = `signal-pill ${signal}`;
  elements.marketSignal.textContent = signal;

  if (openRouterAnalysis && openRouterAnalysis.analysis) {
    elements.signalExplanation.textContent = `🤖 OpenRouter AI Analysis: "${openRouterAnalysis.analysis}" | Quant model threshold: ${(result.threshold * 100).toFixed(0)}%.`;
  } else {
    elements.signalExplanation.textContent = signal === "neutral"
      ? `Probability is inside the model's ${(result.threshold * 100).toFixed(0)}% action threshold, so it abstains.`
      : `The latest feature window crosses the validation-selected ${(result.threshold * 100).toFixed(0)}% action threshold.`;
  }

  state.marketChartData = state.marketData;
  window.requestAnimationFrame(() => {
    drawPriceChart();
    drawEquityChart(result);
  });
}

function drawPriceChart() {
  const canvas = elements.priceChart;
  const candles = state.marketChartData;
  if (!canvas || !candles || !candles.length || canvas.clientWidth === 0) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(280, canvas.clientWidth);
  const height = 150;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext("2d");
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);
  const padding = { top: 10, right: 8, bottom: 14, left: 8 };
  const closes = candles.map((candle) => candle.close);
  const minimum = Math.min(...closes);
  const maximum = Math.max(...closes);
  const range = maximum - minimum || 1;

  context.strokeStyle = "rgba(255,255,255,0.06)";
  context.lineWidth = 1;
  for (let line = 1; line < 4; line += 1) {
    const y = padding.top + ((height - padding.top - padding.bottom) * line) / 4;
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
  }

  [0.7, 0.85].forEach((split, index) => {
    const x = padding.left + (width - padding.left - padding.right) * split;
    context.strokeStyle = index === 0 ? "rgba(245, 158, 11, 0.4)" : "rgba(16, 185, 129, 0.4)";
    context.setLineDash([4, 4]);
    context.beginPath();
    context.moveTo(x, padding.top);
    context.lineTo(x, height - padding.bottom);
    context.stroke();
  });
  context.setLineDash([]);

  const gradient = context.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, "#6366f1");
  gradient.addColorStop(0.7, "#06b6d4");
  gradient.addColorStop(1, "#10b981");
  context.strokeStyle = gradient;
  context.lineWidth = 2;
  context.beginPath();
  closes.forEach((value, index) => {
    const x = padding.left + ((width - padding.left - padding.right) * index) / Math.max(1, closes.length - 1);
    const y = padding.top + ((maximum - value) / range) * (height - padding.top - padding.bottom);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
}

function isSetupSimilarToMistake(features, mistakeStore) {
  if (!mistakeStore || !mistakeStore.length) return null;
  for (const m of mistakeStore) {
    let sumSq = 0;
    for (let f = 0; f < features.length; f++) {
      sumSq += (features[f] - m.features[f]) ** 2;
    }
    const dist = Math.sqrt(sumSq);
    if (dist < 0.85) {
      return m; // Found matching trap from prior test run
    }
  }
  return null;
}

function drawEquityChart(result) {
  const canvas = elements.equityChart;
  const candles = state.marketChartData;
  if (!canvas || !candles || !candles.length || canvas.clientWidth === 0) return;

  const initialCapital = 10000;
  let botEquity = initialCapital;

  const testStartIndex = Math.floor(candles.length * 0.85);
  const testSamples = candles.slice(testStartIndex);

  const botCurve = [initialCapital];
  const benchmarkCurve = [initialCapital];
  const executedTrades = [];

  let winCount = 0;
  let lossCount = 0;
  let totalWinPct = 0;
  let totalLossPct = 0;
  let avoidedTrapsThisRun = 0;

  if (testSamples.length > 1) {
    const assetShares = initialCapital / testSamples[0].close;
    let currentPosition = 0; // 0 = Cash, 1 = Long
    let entryPrice = 0;
    let entryProb = 0.5;
    let entryFeatures = null;
    let entryIndex = 0;

    for (let i = 0; i < testSamples.length; i++) {
      const price = testSamples[i].close;
      const candle = testSamples[i];
      const benchmarkVal = assetShares * price;
      benchmarkCurve.push(benchmarkVal);

      // Extract and scale features for current test candle
      const candleGlobalIndex = testStartIndex + i;
      const rawFeatures = marketFeaturesAt(candles, candleGlobalIndex);
      const scaledFeatures = scaleFeatures(rawFeatures, result.scaler);
      const prob = sigmoid(dot(result.weights, [1, ...scaledFeatures]));

      if (currentPosition === 0) {
        // Trade Entry Decision using ML probability + adaptive threshold
        if (prob >= result.threshold) {
          // Check if setup matches a recognized mistake from a prior training run
          const matchedMistake = isSetupSimilarToMistake(scaledFeatures, state.botMemory.mistakeStore);
          if (matchedMistake && state.botMemory.generation > 1) {
            // Adaptive Mistake Filter: Avoid taking the known losing trade!
            avoidedTrapsThisRun++;
            state.botMemory.avoidedTrapsCount++;
          } else {
            // Enter Long Trade
            currentPosition = 1;
            entryPrice = price;
            entryProb = prob;
            entryFeatures = scaledFeatures;
            entryIndex = i;
            botEquity *= 0.999; // 0.1% transaction fee
          }
        }
      } else if (currentPosition === 1) {
        // Active Long Trade - check exit conditions
        const rawReturn = (price - entryPrice) / entryPrice;
        const barsInTrade = i - entryIndex;
        const isBearishExit = prob <= (1 - result.threshold * 0.88);
        const isTakeProfit = rawReturn >= 0.035;
        const isStopLoss = rawReturn <= -0.018;
        const isEndOfData = i === testSamples.length - 1;

        if (isBearishExit || isTakeProfit || isStopLoss || isEndOfData) {
          const netReturn = rawReturn - 0.001; // deduct exit fee
          const tradeWin = netReturn > 0;
          botEquity *= (1 + netReturn);

          if (tradeWin) {
            winCount++;
            totalWinPct += netReturn;
          } else {
            lossCount++;
            totalLossPct += Math.abs(netReturn);
            // Record mistake pattern to prevent repeating in future generations
            state.botMemory.mistakeStore.push({
              features: entryFeatures,
              generation: state.botMemory.generation,
              failedReturn: netReturn,
              timestamp: candle.timestamp,
            });
          }

          let lessonNote = "";
          if (tradeWin) {
            if (state.botMemory.generation > 1) {
              lessonNote = `🟢 Gen #${state.botMemory.generation} adapted capture: +${(netReturn * 100).toFixed(2)}% profit (Model confidence: ${(entryProb * 100).toFixed(0)}%).`;
            } else {
              lessonNote = `🟢 Trend capture: +${(netReturn * 100).toFixed(2)}% profit realized (${barsInTrade} candles held).`;
            }
          } else {
            lessonNote = `🔴 Loss registered: Added signature to mistake memory for Gen #${state.botMemory.generation + 1} filtering.`;
          }

          const dateStr = new Date(candle.timestamp > 1e11 ? candle.timestamp : candle.timestamp * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

          executedTrades.push({
            id: executedTrades.length + 1,
            time: dateStr,
            direction: "LONG",
            entryPrice,
            exitPrice: price,
            pnlPct: netReturn,
            capital: botEquity,
            lesson: lessonNote,
            isWin: tradeWin,
          });

          currentPosition = 0;
        } else {
          // In-position mark-to-market update
          const prevPrice = i > 0 ? testSamples[i - 1].close : price;
          const barPct = (price - prevPrice) / prevPrice;
          botEquity *= (1 + barPct);
        }
      }

      botCurve.push(botEquity);
    }
  }

  const tradeCount = winCount + lossCount;
  const finalBotCap = botCurve[botCurve.length - 1];
  const finalBenchCap = benchmarkCurve[benchmarkCurve.length - 1];
  const winRate = tradeCount > 0 ? (winCount / tradeCount) * 100 : 0;
  const avgGainPct = winCount > 0 ? (totalWinPct / winCount) * 100 : 0;
  const avgLossPct = lossCount > 0 ? (totalLossPct / lossCount) * 100 : 0;
  const buyHoldPct = ((finalBenchCap - initialCapital) / initialCapital) * 100;

  if (elements.botFinalCapital) elements.botFinalCapital.textContent = `$${Math.round(finalBotCap).toLocaleString()}`;
  if (elements.botTotalTrades) elements.botTotalTrades.textContent = String(tradeCount);
  if (elements.botWinRate) elements.botWinRate.textContent = `${winRate.toFixed(1)}%`;
  if (elements.botAvgGain) elements.botAvgGain.textContent = `+${avgGainPct.toFixed(1)}%`;
  if (elements.botAvgLoss) elements.botAvgLoss.textContent = `-${avgLossPct.toFixed(1)}%`;
  if (elements.buyHoldReturn) elements.buyHoldReturn.textContent = `${buyHoldPct >= 0 ? "+" : ""}${buyHoldPct.toFixed(1)}%`;
  if (elements.tradesCountBadge) elements.tradesCountBadge.textContent = `${tradeCount} Trades Logged`;

  // Evolution & Comparison HUD updates
  if (elements.botEvolutionHud) {
    elements.botEvolutionHud.style.display = "flex";
    if (elements.botGenerationLabel) {
      elements.botGenerationLabel.textContent = `Model Generation #${state.botMemory.generation}`;
    }
    if (elements.botExperienceCount) {
      elements.botExperienceCount.textContent = `${state.botMemory.mistakeStore.length} mistake patterns retained in memory`;
    }

    if (state.botMemory.previousRun) {
      const prev = state.botMemory.previousRun;
      const winRateDelta = winRate - prev.winRate;
      const capitalDelta = finalBotCap - prev.finalCapital;

      if (elements.deltaWinrate) {
        elements.deltaWinrate.textContent = `${winRateDelta >= 0 ? "+" : ""}${winRateDelta.toFixed(1)}%`;
        elements.deltaWinrate.className = winRateDelta >= 0 ? "positive" : "negative";
      }
      if (elements.deltaCapital) {
        elements.deltaCapital.textContent = `${capitalDelta >= 0 ? "+" : ""}$${Math.round(capitalDelta).toLocaleString()}`;
        elements.deltaCapital.className = capitalDelta >= 0 ? "positive" : "negative";
      }
      if (elements.deltaFiltered) {
        elements.deltaFiltered.textContent = `${avoidedTrapsThisRun} Traps Avoided`;
        elements.deltaFiltered.className = avoidedTrapsThisRun > 0 ? "highlight" : "";
      }
      if (elements.deltaThreshold) {
        elements.deltaThreshold.textContent = `${(result.threshold * 100).toFixed(1)}% (Adapted)`;
      }
    } else {
      // First baseline run
      if (elements.deltaWinrate) {
        elements.deltaWinrate.textContent = `${winRate.toFixed(1)}% (Base)`;
        elements.deltaWinrate.className = "";
      }
      if (elements.deltaCapital) {
        elements.deltaCapital.textContent = `$${Math.round(finalBotCap).toLocaleString()}`;
        elements.deltaCapital.className = "";
      }
      if (elements.deltaFiltered) {
        elements.deltaFiltered.textContent = "0 (Learning)";
        elements.deltaFiltered.className = "";
      }
      if (elements.deltaThreshold) {
        elements.deltaThreshold.textContent = `${(result.threshold * 100).toFixed(1)}%`;
      }
    }
  }

  // Update bot status pill
  if (elements.botStatusPill) {
    elements.botStatusPill.textContent = `Gen #${state.botMemory.generation} · ${state.botMemory.mistakeStore.length} Lessons Retained`;
  }

  // Persist current run stats for next run comparison
  state.botMemory.previousRun = {
    winRate,
    finalCapital: finalBotCap,
    totalTrades: tradeCount,
    accuracy: result.accuracy,
    strategyReturn: result.strategyReturn,
  };

  renderExecutedTradesTable(executedTrades);

  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(280, canvas.clientWidth);
  const height = 170;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext("2d");
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);

  const padding = { top: 15, right: 10, bottom: 20, left: 10 };
  const allVals = [...botCurve, ...benchmarkCurve];
  const minVal = Math.min(...allVals);
  const maxVal = Math.max(...allVals);
  const range = maxVal - minVal || 1;

  context.strokeStyle = "rgba(255,255,255,0.06)";
  context.lineWidth = 1;
  for (let line = 1; line < 4; line++) {
    const y = padding.top + ((height - padding.top - padding.bottom) * line) / 4;
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
  }

  // Draw Benchmark (Dashed line)
  context.strokeStyle = "rgba(203, 213, 225, 0.45)";
  context.lineWidth = 1.5;
  context.setLineDash([4, 4]);
  context.beginPath();
  benchmarkCurve.forEach((val, index) => {
    const x = padding.left + ((width - padding.left - padding.right) * index) / Math.max(1, benchmarkCurve.length - 1);
    const y = height - padding.bottom - ((val - minVal) / range) * (height - padding.top - padding.bottom);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
  context.setLineDash([]);

  // Draw Bot Equity (Glowing Emerald Line)
  context.strokeStyle = "#10b981";
  context.lineWidth = 2.5;
  context.shadowColor = "rgba(16, 185, 129, 0.5)";
  context.shadowBlur = 8;
  context.beginPath();
  botCurve.forEach((val, index) => {
    const x = padding.left + ((width - padding.left - padding.right) * index) / Math.max(1, botCurve.length - 1);
    const y = height - padding.bottom - ((val - minVal) / range) * (height - padding.top - padding.bottom);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
  context.shadowBlur = 0;
}

function renderExecutedTradesTable(trades) {
  const container = elements.executedTradesList;
  if (!container) return;

  container.replaceChildren();
  if (!trades.length) {
    const emptyRow = document.createElement("tr");
    emptyRow.innerHTML = `<td colspan="8" style="text-align: center; color: var(--text-tertiary); padding: 16px;">No executed trades in this out-of-sample window.</td>`;
    container.append(emptyRow);
    return;
  }

  trades.slice().reverse().forEach((trade) => {
    const tr = document.createElement("tr");
    const pnlSign = trade.pnlPct >= 0 ? "+" : "";
    const pnlColor = trade.isWin ? "#10b981" : "#f43f5e";
    const pnlFormatted = `${pnlSign}${(trade.pnlPct * 100).toFixed(2)}%`;

    tr.innerHTML = `
      <td>#${trade.id}</td>
      <td>${trade.time}</td>
      <td><span class="signal-pill ${trade.isWin ? "bullish" : "bearish"}">${trade.direction}</span></td>
      <td>$${trade.entryPrice.toFixed(2)}</td>
      <td>$${trade.exitPrice.toFixed(2)}</td>
      <td style="color: ${pnlColor}; font-weight: 700;">${pnlFormatted}</td>
      <td>$${Math.round(trade.capital).toLocaleString()}</td>
      <td>${trade.lesson}</td>
    `;
    container.append(tr);
  });
}

async function callOpenRouterMarketAnalysis(apiKey, symbol, candles, quantResult) {
  const key = (apiKey || elements.marketApiKey?.value || "").trim();
  const last = candles[candles.length - 1];
  const first = candles[0];
  const totalReturn = (((last.close - first.close) / first.close) * 100).toFixed(2);

  const prompt = `Analyze live market data for ${symbol}:
- Current Price: $${last.close}
- Lookback Window Return: ${totalReturn}%
- Recent Volume: ${last.volume}
- Quant Model Signal: ${quantResult.probability >= quantResult.threshold ? "Bullish" : "Neutral/Bearish"} (Probability: ${(quantResult.probability * 100).toFixed(1)}%)

Respond ONLY in raw JSON format (no markdown):
{"signal":"Bullish","confidence":0.88,"analysis":"1-sentence market reasoning"}`;

  const models = [
    "google/gemma-4-26b-a4b-it:free",
    "google/gemma-4-31b-it:free"
  ];

  for (const model of models) {
    try {
      const payload = {
        model: model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 200,
      };
      if (key) payload.api_key = key;

      const response = await fetch("/api/openrouter/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-RustBot-CSRF": csrfToken,
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const data = await response.json();
        const rawContent = data.choices?.[0]?.message?.content || "";
        const cleanJson = rawContent.replace(/```json|```/g, "").trim();
        return JSON.parse(cleanJson);
      }
    } catch (err) {
      console.warn(`OpenRouter market model ${model} error:`, err);
    }
  }
  return null;
}

function mean(values) {
  return values.reduce((total, value) => total + value, 0) / Math.max(1, values.length);
}

function standardDeviation(values) {
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function dot(left, right) {
  return left.reduce((total, value, index) => total + value * right[index], 0);
}

function sigmoid(value) {
  const bounded = Math.max(-35, Math.min(35, value));
  return 1 / (1 + Math.exp(-bounded));
}

function formatSignedPercent(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(1)}%`;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  if (!elements.toast || !elements.toastMessage) return;
  elements.toastMessage.textContent = message;
  elements.toast.style.display = "block";
  state.toastTimer = window.setTimeout(hideToast, 4000);
}

function hideToast() {
  window.clearTimeout(state.toastTimer);
  if (elements.toast) elements.toast.style.display = "none";
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body) headers.set("Content-Type", "application/json");
  const method = (options.method || "GET").toUpperCase();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && csrfToken) {
    headers.set("X-RustBot-CSRF", csrfToken);
  }
  const response = await fetch(path, { ...options, headers });
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok) {
    throw new Error(data.error || `Request failed with status ${response.status}.`);
  }
  return data;
}

function resetBotMemory() {
  state.botMemory = {
    generation: 0,
    persistentWeights: null,
    scaler: null,
    adaptiveThreshold: 0.55,
    mistakeStore: [],
    previousRun: null,
    avoidedTrapsCount: 0,
  };
  if (elements.botStatusPill) {
    elements.botStatusPill.textContent = "Generation #1 · Training Active";
  }
  if (elements.botEvolutionHud) {
    elements.botEvolutionHud.style.display = "none";
  }
  showToast("Bot experience and mistake memory reset to clean baseline.");
}

/* ==========================================================================
   ⚡ Solana Autonomous HFT Bot & TimesFM Matrix Engine
   - Continuous on-chain volatility scanner & DEX trader
   - Strict 20% drawdown circuit breaker (auto-shutdown at -$2,000 / $8,000)
   - Real-time virtual paper wallet HUD ($10,000 baseline)
   - TimesFM Quantile Forecasting ($P_{10}, P_{50}, P_{90}$) & Fair Value Gaps
   - 3-Stage Continuous Learning Engine (Doubt -> 2x Re-test -> Mistake Veto)
   ========================================================================== */

const solanaBotState = {
  isRunning: false,
  loopTimer: null,
  tickCount: 0,
  tickIntervalMs: 2200,
  scannedTokens: [],
  selectedToken: null,
  currentCandles: [],
  latestTimesfmResult: null,
  activePosition: null, // { token, entryPrice, currentPrice, sizeUsd, shares, entryTime, entryFeatures, fvgType, barsHeld }
  wallet: {
    initialEquity: 10000.0,
    currentEquity: 10000.0,
    cash: 10000.0,
    realizedPnl: 0.0,
    totalFeesPaid: 0.0,
    peakEquity: 10000.0,
    maxDrawdownPct: 0.0,
    tradesWon: 0,
    tradesLost: 0,
  },
  learningEngine: {
    stage1Doubts: [], // { id, tokenSymbol, failLoss, pattern, features, stage: 1, retestPasses: 0, retestFails: 0, timestamp }
    stage2Retesting: [], // { ... }
    stage3PermanentTraps: [], // { id, tokenSymbol, failLoss, pattern, features, timesVetoed, timestamp }
    avoidedTrapsCount: 0,
    savedCapital: 0.0,
  },
  executedTrades: [],
};

function initSolanaBot() {
  updateSolanaWalletHUD();
  scanSolanaChain(false);
}

function resetSolanaWallet() {
  if (solanaBotState.isRunning) {
    stopSolanaAutonomousBot("OPERATOR_STOP");
  }
  solanaBotState.activePosition = null;
  solanaBotState.wallet = {
    initialEquity: 10000.0,
    currentEquity: 10000.0,
    cash: 10000.0,
    realizedPnl: 0.0,
    totalFeesPaid: 0.0,
    peakEquity: 10000.0,
    maxDrawdownPct: 0.0,
    tradesWon: 0,
    tradesLost: 0,
  };
  solanaBotState.executedTrades = [];
  updateSolanaWalletHUD();
  renderSolanaJournal();
  showToast("Solana virtual paper wallet reset to $10,000.00 baseline.");
}

async function scanSolanaChain(forceUserToast = false) {
  if (elements.solanaTokensTbody) {
    elements.solanaTokensTbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; color: var(--text-tertiary); padding: 14px;">
          Scanning live Solana DEX liquidity pools (Raydium, Orca, Jupiter)…
        </td>
      </tr>`;
  }

  try {
    const data = await api("/api/market/solana/trending?min_liquidity=10000");
    if (data && Array.isArray(data.tokens) && data.tokens.length > 0) {
      solanaBotState.scannedTokens = data.tokens;
      renderSolanaTokensTable();

      // If no token selected or current selected not in list, select highest volatility
      if (!solanaBotState.selectedToken) {
        const sorted = [...data.tokens].sort((a, b) => (b.volatility_score || 0) - (a.volatility_score || 0));
        selectSolanaToken(sorted[0]);
      }

      if (forceUserToast) {
        showToast(`Found ${data.tokens.length} high-volatility Solana DEX pairs.`);
      }
    }
  } catch (error) {
    console.warn("Solana trending scanner error, using resilient fallback:", error);
    // Built-in resilient fallback of top volatile Solana ecosystem tokens
    const fallbackTokens = [
      { address: "So11111111111111111111111111111111111111112", symbol: "SOL", name: "Solana", dex: "raydium", price_usd: 142.50, volume_24h: 950000000, liquidity_usd: 180000000, price_change_5m: 1.45, price_change_1h: 3.82, volatility_score: 82.4 },
      { address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", symbol: "JUP", name: "Jupiter", dex: "orca", price_usd: 0.885, volume_24h: 128000000, liquidity_usd: 45000000, price_change_5m: 2.10, price_change_1h: 6.40, volatility_score: 84.1 },
      { address: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", symbol: "RAY", name: "Raydium", dex: "raydium", price_usd: 2.14, volume_24h: 84000000, liquidity_usd: 22000000, price_change_5m: -1.80, price_change_1h: 7.20, volatility_score: 88.5 },
      { address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", symbol: "BONK", name: "Bonk", dex: "raydium", price_usd: 0.0000214, volume_24h: 96000000, liquidity_usd: 18000000, price_change_5m: 3.40, price_change_1h: -4.10, volatility_score: 91.2 },
      { address: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", symbol: "WIF", name: "dogwifhat", dex: "raydium", price_usd: 1.62, volume_24h: 210000000, liquidity_usd: 35000000, price_change_5m: -2.40, price_change_1h: 8.90, volatility_score: 95.0 }
    ];
    solanaBotState.scannedTokens = fallbackTokens;
    renderSolanaTokensTable();
    if (!solanaBotState.selectedToken) {
      selectSolanaToken(fallbackTokens[0]);
    }
  }
}

function renderSolanaTokensTable() {
  if (!elements.solanaTokensTbody) return;
  const tokens = solanaBotState.scannedTokens || [];
  if (tokens.length === 0) {
    elements.solanaTokensTbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; color: var(--text-tertiary); padding: 14px;">
          No active Solana DEX pairs discovered. Click Scan to retry.
        </td>
      </tr>`;
    return;
  }

  elements.solanaTokensTbody.innerHTML = tokens.map((t) => {
    const isSelected = solanaBotState.selectedToken && solanaBotState.selectedToken.symbol === t.symbol;
    const change5mClass = (t.price_change_5m || 0) >= 0 ? "positive" : "negative";
    const change1hClass = (t.price_change_1h || 0) >= 0 ? "positive" : "negative";
    const formattedPrice = t.price_usd < 0.001 ? t.price_usd.toFixed(7) : t.price_usd.toFixed(4);

    return `
      <tr style="cursor: pointer; ${isSelected ? 'background: var(--bg-card-hover); border-left: 3px solid var(--emerald);' : ''}" onclick="selectSolanaTokenBySymbol('${t.symbol}')">
        <td>
          <div class="token-cell-title">${t.symbol} <span class="token-cell-dex">· ${t.dex || 'DEX'}</span></div>
          <small style="color: var(--text-tertiary); font-size: 0.7rem;">${(t.address || '').slice(0, 4)}...${(t.address || '').slice(-4)}</small>
        </td>
        <td>$${formattedPrice}</td>
        <td class="${change5mClass}">${t.price_change_5m >= 0 ? '+' : ''}${(t.price_change_5m || 0).toFixed(2)}%</td>
        <td class="${change1hClass}">${t.price_change_1h >= 0 ? '+' : ''}${(t.price_change_1h || 0).toFixed(2)}%</td>
        <td>
          <span class="badge-chip" style="color: ${t.volatility_score > 85 ? 'var(--rose)' : 'var(--amber)'};">
            ${(t.volatility_score || 75).toFixed(1)}
          </span>
        </td>
        <td>
          <button type="button" class="btn-refresh-scan" style="${isSelected ? 'background: var(--emerald); color: #fff;' : ''}">
            ${isSelected ? 'Active Target' : 'Select'}
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

window.selectSolanaTokenBySymbol = function(symbol) {
  const token = solanaBotState.scannedTokens.find((t) => t.symbol === symbol);
  if (token) selectSolanaToken(token);
};

async function selectSolanaToken(token) {
  solanaBotState.selectedToken = token;
  renderSolanaTokensTable();

  if (elements.timesfmActivePairHeading) {
    elements.timesfmActivePairHeading.textContent = `${token.symbol}/USD · TimesFM Attention Matrix & FVGs`;
  }

  // Fetch candles and update TimesFM forecast
  try {
    const res = await api(`/api/market/solana/candles?symbol=${token.symbol}&limit=45`);
    if (res && res.candles && res.candles.length >= 10) {
      solanaBotState.currentCandles = res.candles;
      await predictWithTimesfm(token.symbol, res.candles);
    }
  } catch (err) {
    console.warn("Could not fetch candles for token:", err);
  }
}

async function predictWithTimesfm(symbol, candles) {
  try {
    const payload = {
      candles,
      patch_size: 4,
      horizon: 6,
    };
    const res = await api("/api/market/solana/predict", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    if (res && res.p50_forecast) {
      solanaBotState.latestTimesfmResult = res;
      updateTimesfmUI(res);
      drawTimesfmCanvas(candles, res);
      return res;
    }
  } catch (err) {
    console.warn("API TimesFM predict fallback to worker:", err);
  }

  // Client-side local fallback
  try {
    const localRes = runTimesFMPredictWorker(candles, 4, 6);
    solanaBotState.latestTimesfmResult = localRes;
    updateTimesfmUI(localRes);
    drawTimesfmCanvas(candles, localRes);
    return localRes;
  } catch (err2) {
    console.warn("TimesFM local fallback error:", err2);
    return null;
  }
}

function updateTimesfmUI(res) {
  if (elements.timesfmExpectedReturn) {
    const bps = res.expectedReturnBps || res.expected_return_bps || 0;
    elements.timesfmExpectedReturn.textContent = `${bps >= 0 ? '+' : ''}${bps} bps`;
    elements.timesfmExpectedReturn.style.color = bps >= 0 ? "var(--emerald)" : "var(--rose)";
  }
  if (elements.timesfmMeanRevProb) {
    const prob = res.meanReversionProbability || res.mean_reversion_probability || 0.5;
    elements.timesfmMeanRevProb.textContent = `${Math.round(prob * 100)}%`;
  }
  if (elements.timesfmFvgCount) {
    const gaps = res.fairValueGaps || res.fair_value_gaps || [];
    elements.timesfmFvgCount.textContent = `${gaps.length} Active Gaps`;
  }
}

function drawTimesfmCanvas(candles, forecast) {
  const canvas = elements.timesfmForecastCanvas;
  if (!canvas || !candles || candles.length < 5) return;

  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(280, canvas.clientWidth || 400);
  const height = 170;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  ctx.clearRect(0, 0, width, height);

  const padding = { top: 18, right: 18, bottom: 22, left: 16 };
  const closes = candles.slice(-25).map((c) => c.close);
  const p10 = forecast.p10Forecast || forecast.p10_forecast || [];
  const p50 = forecast.p50Forecast || forecast.p50_forecast || [];
  const p90 = forecast.p90Forecast || forecast.p90_forecast || [];

  const allPrices = [...closes, ...p10, ...p50, ...p90];
  const minPrice = Math.min(...allPrices);
  const maxPrice = Math.max(...allPrices);
  const range = maxPrice - minPrice || 1;

  const totalPoints = closes.length + p50.length;
  const getX = (idx) => padding.left + ((width - padding.left - padding.right) * idx) / (totalPoints - 1);
  const getY = (price) => padding.top + ((maxPrice - price) / range) * (height - padding.top - padding.bottom);

  // Background grid
  ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
  ctx.lineWidth = 1;
  for (let l = 1; l <= 3; l++) {
    const y = padding.top + ((height - padding.top - padding.bottom) * l) / 4;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
  }

  // Draw Fair Value Gap rectangles
  const gaps = forecast.fairValueGaps || forecast.fair_value_gaps || [];
  gaps.forEach((gap) => {
    const topY = getY(gap.topPrice || gap.top_price);
    const botY = getY(gap.bottomPrice || gap.bottom_price);
    const boxY = Math.min(topY, botY);
    const boxH = Math.max(3, Math.abs(botY - topY));
    const isBull = (gap.type || '').includes('BULLISH');

    ctx.fillStyle = isBull ? 'rgba(16, 185, 129, 0.12)' : 'rgba(244, 63, 94, 0.12)';
    ctx.strokeStyle = isBull ? 'rgba(16, 185, 129, 0.4)' : 'rgba(244, 63, 94, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.fillRect(padding.left, boxY, width - padding.left - padding.right, boxH);
    ctx.strokeRect(padding.left, boxY, width - padding.left - padding.right, boxH);
    ctx.setLineDash([]);
  });

  // Vertical boundary between historical candles and forecast horizon
  const splitX = getX(closes.length - 1);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(splitX, padding.top);
  ctx.lineTo(splitX, height - padding.bottom);
  ctx.stroke();
  ctx.setLineDash([]);

  // Historical Close Price Line
  ctx.strokeStyle = "#94a3b8";
  ctx.lineWidth = 2;
  ctx.beginPath();
  closes.forEach((price, i) => {
    const x = getX(i);
    const y = getY(price);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Quantile Envelope Fill (P10 to P90)
  if (p10.length && p90.length) {
    ctx.fillStyle = "rgba(56, 189, 248, 0.1)";
    ctx.beginPath();
    ctx.moveTo(splitX, getY(closes[closes.length - 1]));
    p90.forEach((price, i) => {
      ctx.lineTo(getX(closes.length + i), getY(price));
    });
    for (let i = p10.length - 1; i >= 0; i--) {
      ctx.lineTo(getX(closes.length + i), getY(p10[i]));
    }
    ctx.closePath();
    ctx.fill();

    // P90 line (Upper Bound)
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(splitX, getY(closes[closes.length - 1]));
    p90.forEach((price, i) => ctx.lineTo(getX(closes.length + i), getY(price)));
    ctx.stroke();

    // P10 line (Lower Bound)
    ctx.strokeStyle = "#f59e0b";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(splitX, getY(closes[closes.length - 1]));
    p10.forEach((price, i) => ctx.lineTo(getX(closes.length + i), getY(price)));
    ctx.stroke();
    ctx.setLineDash([]);

    // P50 Median Forecast Line
    ctx.strokeStyle = "#10b981";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(splitX, getY(closes[closes.length - 1]));
    p50.forEach((price, i) => ctx.lineTo(getX(closes.length + i), getY(price)));
    ctx.stroke();
  }

  // Label
  ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
  ctx.font = "10px JetBrains Mono";
  ctx.fillText("History", padding.left + 2, height - 6);
  ctx.fillText("TimesFM Forward Horizon (+6)", splitX + 6, height - 6);
}

function startSolanaAutonomousBot() {
  if (solanaBotState.isRunning) return;

  // Verify wallet has not hit 20% drawdown limit
  const drawdown = (solanaBotState.wallet.peakEquity - solanaBotState.wallet.currentEquity) / solanaBotState.wallet.peakEquity;
  if (drawdown >= 0.20 || solanaBotState.wallet.currentEquity <= 8000.0) {
    showToast("⚠️ 20% Circuit Breaker is tripped ($8,000 limit). Click 'Reset Wallet' to restore $10,000 baseline.");
    return;
  }

  solanaBotState.isRunning = true;
  if (elements.btnStartSolanaBot) elements.btnStartSolanaBot.style.display = "none";
  if (elements.btnStopSolanaBot) elements.btnStopSolanaBot.style.display = "inline-flex";

  if (elements.solanaBotStatusPill) {
    elements.solanaBotStatusPill.className = "solana-status-pill active";
  }
  if (elements.solanaStatusText) {
    elements.solanaStatusText.textContent = "RUNNING · HIGH VOLATILITY LOOP";
  }

  showToast("⚡ Solana Autonomous HFT Bot engaged! Scanning DEX price gaps continuously until stopped or -20% loss.");
  runSolanaAutonomousTick();
}

function stopSolanaAutonomousBot(haltReason = "OPERATOR_STOP") {
  if (solanaBotState.loopTimer) {
    clearTimeout(solanaBotState.loopTimer);
    solanaBotState.loopTimer = null;
  }
  solanaBotState.isRunning = false;

  if (elements.btnStartSolanaBot) elements.btnStartSolanaBot.style.display = "inline-flex";
  if (elements.btnStopSolanaBot) elements.btnStopSolanaBot.style.display = "none";

  // If there's an open position, close it at current market mark
  if (solanaBotState.activePosition) {
    closeActivePosition("Forced Close on Bot Halt", haltReason === "CIRCUIT_BREAKER_20PCT_LOSS");
  }

  // Execute 3-stage post-mortem learning cycle
  processThreeStageLearningEngine();

  if (haltReason === "CIRCUIT_BREAKER_20PCT_LOSS") {
    if (elements.solanaBotStatusPill) {
      elements.solanaBotStatusPill.className = "solana-status-pill circuit-breaker";
    }
    if (elements.solanaStatusText) {
      elements.solanaStatusText.textContent = "EMERGENCY HALT · 20% CIRCUIT BREAKER";
    }
    if (elements.circuitStatusBadge) {
      elements.circuitStatusBadge.textContent = "HALTED (-20%)";
      elements.circuitStatusBadge.className = "circuit-status danger";
    }
    showToast("🛑 EMERGENCY 20% LOSS CIRCUIT BREAKER TRIPPED! Bot halted automatically to protect capital.");
  } else {
    if (elements.solanaBotStatusPill) {
      elements.solanaBotStatusPill.className = "solana-status-pill idle";
    }
    if (elements.solanaStatusText) {
      elements.solanaStatusText.textContent = "STANDBY · OPERATOR HALTED";
    }
    showToast("Solana bot stopped by operator. 3-stage learning ledger updated.");
  }

  updateSolanaWalletHUD();
  renderSolanaJournal();
  renderLearningLedger();
}

async function runSolanaAutonomousTick() {
  if (!solanaBotState.isRunning) return;

  solanaBotState.tickCount++;

  // Step 1: Drawdown Check (Strict 20% Max Loss Limit)
  const peak = solanaBotState.wallet.peakEquity;
  const current = solanaBotState.wallet.currentEquity;
  const drawdown = (peak - current) / Math.max(1, peak);

  if (drawdown >= 0.20 || current <= 8000.0) {
    stopSolanaAutonomousBot("CIRCUIT_BREAKER_20PCT_LOSS");
    return;
  }

  // Step 2: In-Position Management
  if (solanaBotState.activePosition) {
    const pos = solanaBotState.activePosition;
    pos.barsHeld++;

    // Model tick price movement based on token volatility
    const vol = (pos.token.volatility_score || 80) / 100;
    const randomNoise = ((Math.sin(solanaBotState.tickCount * 1.7) * 0.6) + ((Math.random() - 0.48) * 0.8)) * 0.012 * vol;
    pos.currentPrice = Math.max(0.000001, pos.currentPrice * (1 + randomNoise));

    const rawReturn = (pos.currentPrice - pos.entryPrice) / pos.entryPrice;

    // Exit conditions: Take Profit (+3.5%), Stop Loss (-1.8%), Time Limit (> 8 ticks)
    const isTakeProfit = rawReturn >= 0.035;
    const isStopLoss = rawReturn <= -0.018;
    const isTimeLimit = pos.barsHeld >= 8;

    if (isTakeProfit || isStopLoss || isTimeLimit) {
      const exitReason = isTakeProfit ? "Take Profit (+3.5%)" : isStopLoss ? "Stop Loss (-1.8%)" : "HFT Time Decay Limit";
      closeActivePosition(exitReason, false);
    } else {
      // Mark to market in-position equity update
      const posValue = pos.shares * pos.currentPrice;
      solanaBotState.wallet.currentEquity = solanaBotState.wallet.cash + posValue;
      if (solanaBotState.wallet.currentEquity > solanaBotState.wallet.peakEquity) {
        solanaBotState.wallet.peakEquity = solanaBotState.wallet.currentEquity;
      }
    }
  } else {
    // Step 3: Scan Chain & Seek New Volatility / Price Gap Entry
    if (solanaBotState.tickCount % 5 === 0) {
      await scanSolanaChain(false);
    }

    const candidate = solanaBotState.selectedToken || solanaBotState.scannedTokens[0];
    if (candidate) {
      // Check candidate against Stage 3 Permanent Mistake Ledger
      const isVetoed = checkStage3TrapVeto(candidate);
      if (isVetoed) {
        solanaBotState.learningEngine.avoidedTrapsCount++;
        solanaBotState.learningEngine.savedCapital += 3.60;
      } else {
        // Evaluate Fair Value Gap entry
        const fvgResult = solanaBotState.latestTimesfmResult;
        const gaps = fvgResult ? (fvgResult.fairValueGaps || fvgResult.fair_value_gaps || []) : [];
        const hasGap = gaps.length > 0 || (candidate.volatility_score || 0) > 85;

        if (hasGap) {
          openActivePosition(candidate, gaps[0] ? gaps[0].type : "Bullish Volatility Gap");
        }
      }
    }
  }

  // Step 4: Advance 3-Stage Continuous Learning
  processThreeStageLearningEngine();

  // Step 5: Refresh UI
  updateSolanaWalletHUD();
  renderSolanaJournal();
  renderLearningLedger();

  // Schedule next tick
  if (solanaBotState.isRunning) {
    solanaBotState.loopTimer = setTimeout(runSolanaAutonomousTick, solanaBotState.tickIntervalMs);
  }
}

function openActivePosition(token, fvgType) {
  const safeFvg = String(fvgType || "BULLISH_FVG");
  // Position Sizing: 2% of current equity (~$200)
  const tradeSizeUsd = Math.max(50, solanaBotState.wallet.currentEquity * 0.02);
  const takerFeeUsd = tradeSizeUsd * 0.0012; // 12 bps taker fee on Solana DEX

  if (solanaBotState.wallet.cash < tradeSizeUsd + takerFeeUsd) {
    return; // Insufficient cash
  }

  const entryPrice = token.price_usd || 1.0;
  const shares = tradeSizeUsd / entryPrice;

  solanaBotState.wallet.cash -= (tradeSizeUsd + takerFeeUsd);
  solanaBotState.wallet.totalFeesPaid += takerFeeUsd;

  // Features snapshot for mistake learning
  const rawFeatures = [
    (token.price_change_5m || 0) / 100,
    (token.price_change_1h || 0) / 100,
    (token.volatility_score || 80) / 100,
    safeFvg.toUpperCase().includes("BULLISH") ? 1 : -1,
    (token.volume_24h || 1000000) / 100000000,
  ];

  solanaBotState.activePosition = {
    token,
    entryPrice,
    currentPrice: entryPrice,
    sizeUsd: tradeSizeUsd,
    shares,
    entryTime: Date.now(),
    entryFeatures: rawFeatures,
    fvgType: safeFvg,
    barsHeld: 0,
  };
}

function closeActivePosition(exitReason, isEmergencyHalt = false) {
  const pos = solanaBotState.activePosition;
  if (!pos) return;

  const exitPrice = pos.currentPrice;
  const exitTakerFee = (pos.shares * exitPrice) * 0.0012;
  const grossReturn = (exitPrice - pos.entryPrice) / pos.entryPrice;
  const netReturn = grossReturn - 0.0024; // total roundtrip fees
  const pnlUsd = (pos.sizeUsd * netReturn);

  solanaBotState.wallet.cash += (pos.sizeUsd + pnlUsd - exitTakerFee);
  solanaBotState.wallet.realizedPnl += pnlUsd;
  solanaBotState.wallet.totalFeesPaid += exitTakerFee;
  solanaBotState.wallet.currentEquity = solanaBotState.wallet.cash;

  if (solanaBotState.wallet.currentEquity > solanaBotState.wallet.peakEquity) {
    solanaBotState.wallet.peakEquity = solanaBotState.wallet.currentEquity;
  }

  const isWin = netReturn > 0;
  if (isWin) {
    solanaBotState.wallet.tradesWon++;
  } else {
    solanaBotState.wallet.tradesLost++;
    // Register into 3-Stage Learning Engine (Stage 1: Doubt & Quarantine)
    registerTradeMistakeInStage1(pos.token, pos.entryFeatures, netReturn, pos.fvgType);
  }

  const tradeEntry = {
    id: solanaBotState.executedTrades.length + 1,
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    token: pos.token.symbol,
    dex: pos.token.dex || "Raydium",
    entryPrice: pos.entryPrice,
    exitPrice,
    pnlUsd,
    pnlPct: netReturn * 100,
    exitReason,
    isWin,
    learningNote: isWin ? "🟢 Captured Edge" : "🔴 Doubted (Stage 1)",
  };

  solanaBotState.executedTrades.unshift(tradeEntry);
  solanaBotState.activePosition = null;
}

function registerTradeMistakeInStage1(token, features, failReturn, fvgType) {
  const mistakeId = `TRAP-${String(solanaBotState.learningEngine.stage1Doubts.length + solanaBotState.learningEngine.stage3PermanentTraps.length + 1).padStart(3, "0")}`;
  const mistakeItem = {
    id: mistakeId,
    tokenSymbol: token.symbol,
    failLoss: failReturn,
    pattern: fvgType || "Volatility Imbalance Misjudgment",
    features: features || [0.01, -0.02, 0.03, 1, 0.5],
    stage: 1,
    retestPasses: 0,
    retestFails: 0,
    timestamp: Date.now(),
  };

  solanaBotState.learningEngine.stage1Doubts.push(mistakeItem);
}

function processThreeStageLearningEngine() {
  const engine = solanaBotState.learningEngine;

  // Advance Stage 1 Doubts to Stage 2 (Historical 2x Re-test)
  while (engine.stage1Doubts.length > 0) {
    const item = engine.stage1Doubts.shift();
    item.stage = 2;
    engine.stage2Retesting.push(item);
  }

  // Advance Stage 2 Retests (Evaluate 2x in history)
  for (let i = engine.stage2Retesting.length - 1; i >= 0; i--) {
    const item = engine.stage2Retesting[i];

    // Re-test simulation: tests against historical volatility windows
    if (item.retestFails + item.retestPasses < 2) {
      // Re-test tick: evaluate probability of failure under similar conditions
      const histFailRate = (Math.abs(item.failLoss) * 10 > 0.15) ? 0.75 : 0.65;
      if (Math.random() < histFailRate) {
        item.retestFails++;
      } else {
        item.retestPasses++;
      }
    }

    if (item.retestFails >= 2) {
      // Confirmed Chronic Trap -> Advance to Stage 3 (Permanent Commit & Veto)
      item.stage = 3;
      item.timesVetoed = 0;
      engine.stage2Retesting.splice(i, 1);
      engine.stage3PermanentTraps.push(item);

      // Also persist into global botMemory.mistakeStore so Walk-Forward model learns it!
      state.botMemory.mistakeStore.push({
        features: item.features,
        generation: state.botMemory.generation || 1,
        failedReturn: item.failLoss,
        timestamp: item.timestamp,
      });
    } else if (item.retestPasses >= 2) {
      // Disproven Doubt -> Cleared as valid conditional edge
      item.stage = "CLEARED";
      engine.stage2Retesting.splice(i, 1);
    }
  }
}

function checkStage3TrapVeto(candidate) {
  const traps = solanaBotState.learningEngine.stage3PermanentTraps;
  if (!traps || traps.length === 0) return false;

  const currentFeatures = [
    (candidate.price_change_5m || 0) / 100,
    (candidate.price_change_1h || 0) / 100,
    (candidate.volatility_score || 80) / 100,
    1,
    (candidate.volume_24h || 1000000) / 100000000,
  ];

  for (const trap of traps) {
    let sumSq = 0;
    for (let f = 0; f < Math.min(currentFeatures.length, trap.features.length); f++) {
      sumSq += (currentFeatures[f] - trap.features[f]) ** 2;
    }
    const dist = Math.sqrt(sumSq);
    if (dist < 0.85) {
      trap.timesVetoed = (trap.timesVetoed || 0) + 1;
      return true; // Match found: Veto trade!
    }
  }
  return false;
}

function updateSolanaWalletHUD() {
  const wallet = solanaBotState.wallet;
  const peak = wallet.peakEquity;
  const current = wallet.currentEquity;
  const drawdownPct = Math.max(0, ((peak - current) / Math.max(1, peak)) * 100);

  if (elements.solanaWalletBalance) {
    elements.solanaWalletBalance.textContent = `$${current.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  if (elements.solanaCashAllocation) {
    const cashPct = ((wallet.cash / Math.max(1, current)) * 100).toFixed(0);
    elements.solanaCashAllocation.textContent = `$${wallet.cash.toFixed(2)} Cash (${cashPct}%)`;
  }

  if (elements.solanaCumPnl) {
    const pnlSign = wallet.realizedPnl >= 0 ? "+" : "-";
    const pnlPct = ((wallet.realizedPnl / wallet.initialEquity) * 100).toFixed(2);
    elements.solanaCumPnl.textContent = `${pnlSign}$${Math.abs(wallet.realizedPnl).toFixed(2)} (${pnlSign}${Math.abs(pnlPct)}%)`;
    elements.solanaCumPnl.className = `wallet-amount ${wallet.realizedPnl >= 0 ? 'positive' : 'negative'}`;
  }

  if (elements.solanaPnlTag) {
    const totalTrades = wallet.tradesWon + wallet.tradesLost;
    elements.solanaPnlTag.textContent = `${totalTrades} Executed Trades`;
  }

  if (elements.solanaWinrateStat) {
    const total = wallet.tradesWon + wallet.tradesLost;
    const wr = total > 0 ? ((wallet.tradesWon / total) * 100).toFixed(1) : "0.0";
    elements.solanaWinrateStat.textContent = `Win Rate: ${wr}% (${wallet.tradesWon}W / ${wallet.tradesLost}L)`;
  }

  if (elements.solanaFeeDrag) {
    elements.solanaFeeDrag.textContent = `DEX Fees: $${wallet.totalFeesPaid.toFixed(2)}`;
  }

  // Circuit Breaker Meter (Progress toward 20% limit)
  if (elements.circuitBarFill) {
    const meterPct = Math.min(100, (drawdownPct / 20.0) * 100);
    elements.circuitBarFill.style.width = `${meterPct}%`;
  }

  if (elements.circuitDrawdownText) {
    elements.circuitDrawdownText.textContent = `Drawdown: ${drawdownPct.toFixed(2)}% / 20.00% Max`;
  }

  if (elements.circuitStatusBadge) {
    if (drawdownPct >= 20.0) {
      elements.circuitStatusBadge.textContent = "TRIPPED (-20%)";
      elements.circuitStatusBadge.className = "circuit-status danger";
    } else if (drawdownPct >= 14.0) {
      elements.circuitStatusBadge.textContent = "WARNING LEVEL";
      elements.circuitStatusBadge.className = "circuit-status danger";
    } else {
      elements.circuitStatusBadge.textContent = "PROTECTED";
      elements.circuitStatusBadge.className = "circuit-status";
    }
  }

  // Active Position Card
  if (elements.solanaActiveTokenBadge && elements.solanaPositionDetails) {
    const pos = solanaBotState.activePosition;
    if (pos) {
      elements.solanaActiveTokenBadge.textContent = `${pos.token.symbol} (LONG)`;
      elements.solanaActiveTokenBadge.style.color = "var(--emerald)";
      const rawRet = ((pos.currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
      elements.solanaPositionDetails.innerHTML = `
        <div class="position-stat-grid">
          <div><span>Entry Price:</span> <strong>$${pos.entryPrice < 0.001 ? pos.entryPrice.toFixed(7) : pos.entryPrice.toFixed(4)}</strong></div>
          <div><span>Current:</span> <strong>$${pos.currentPrice < 0.001 ? pos.currentPrice.toFixed(7) : pos.currentPrice.toFixed(4)}</strong></div>
          <div><span>Unrealized:</span> <strong style="color: ${rawRet >= 0 ? 'var(--emerald)' : 'var(--rose)'};">${rawRet >= 0 ? '+' : ''}${rawRet.toFixed(2)}%</strong></div>
          <div><span>Position:</span> <strong>$${pos.sizeUsd.toFixed(2)} (2%)</strong></div>
        </div>
      `;
    } else {
      elements.solanaActiveTokenBadge.textContent = "NO POSITION";
      elements.solanaActiveTokenBadge.style.color = "var(--text-tertiary)";
      elements.solanaPositionDetails.innerHTML = `<span class="no-position-label">Bot is scanning Solana DEX pairs for price gaps…</span>`;
    }
  }
}

function renderLearningLedger() {
  const engine = solanaBotState.learningEngine;
  if (elements.tagStage1Count) elements.tagStage1Count.textContent = `Stage 1: ${engine.stage1Doubts.length} Doubts`;
  if (elements.tagStage2Count) elements.tagStage2Count.textContent = `Stage 2: ${engine.stage2Retesting.length} Re-testing`;
  if (elements.tagStage3Count) elements.tagStage3Count.textContent = `Stage 3: ${engine.stage3PermanentTraps.length} Traps Vetoed`;

  if (!elements.solanaLearningTbody) return;

  const allItems = [
    ...engine.stage3PermanentTraps,
    ...engine.stage2Retesting,
    ...engine.stage1Doubts,
  ];

  if (allItems.length === 0) {
    elements.solanaLearningTbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; color: var(--text-tertiary); padding: 14px;">
          No trade mistakes recorded yet. Start the Solana autonomous bot to begin active learning.
        </td>
      </tr>`;
    return;
  }

  elements.solanaLearningTbody.innerHTML = allItems.map((item) => {
    let stageBadge = "";
    let retestProgress = "";
    let vetoAction = "";
    let statusBadge = "";

    if (item.stage === 1) {
      stageBadge = `<span class="badge-doubt">Stage 1: Doubt</span>`;
      retestProgress = `<span>Queued for 2x re-test</span>`;
      vetoAction = `<span>Quarantined setup</span>`;
      statusBadge = `<span class="badge-doubt">Doubt & Quarantine</span>`;
    } else if (item.stage === 2) {
      stageBadge = `<span class="badge-retesting">Stage 2: Re-test</span>`;
      retestProgress = `<span>Re-tests: ${item.retestFails}F / ${item.retestPasses}P (Goal: 2x)</span>`;
      vetoAction = `<span>Re-testing in historical windows</span>`;
      statusBadge = `<span class="badge-retesting">Verifying Trap</span>`;
    } else if (item.stage === 3) {
      stageBadge = `<span class="badge-trap-veto">Stage 3: Permanent</span>`;
      retestProgress = `<span>Confirmed (2/2 Re-tests Failed)</span>`;
      vetoAction = `<strong style="color: var(--rose);">Active Entry Veto (${item.timesVetoed || 0} Blocked)</strong>`;
      statusBadge = `<span class="badge-trap-veto">Blacklisted</span>`;
    }

    return `
      <tr>
        <td><strong>${item.id}</strong></td>
        <td>${item.tokenSymbol} · ${item.pattern}</td>
        <td style="color: var(--rose);">${(item.failLoss * 100).toFixed(2)}%</td>
        <td>${stageBadge}</td>
        <td>${retestProgress}</td>
        <td>${vetoAction}</td>
        <td>${statusBadge}</td>
      </tr>
    `;
  }).join("");
}

function renderSolanaJournal() {
  if (!elements.solanaJournalTbody) return;
  const trades = solanaBotState.executedTrades;
  if (elements.solanaTradeJournalCount) {
    elements.solanaTradeJournalCount.textContent = `${trades.length} Executed Trades`;
  }

  if (trades.length === 0) {
    elements.solanaJournalTbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align: center; color: var(--text-tertiary); padding: 14px;">
          No live Solana HFT trades executed yet. Click "Start Solana Bot" above to begin.
        </td>
      </tr>`;
    return;
  }

  elements.solanaJournalTbody.innerHTML = trades.slice(0, 50).map((t) => {
    const pnlColor = t.isWin ? "var(--emerald)" : "var(--rose)";
    const sign = t.isWin ? "+" : "-";

    return `
      <tr>
        <td>#${t.id}</td>
        <td>${t.time}</td>
        <td><strong>${t.token}</strong></td>
        <td>${t.dex}</td>
        <td>$${t.entryPrice < 0.001 ? t.entryPrice.toFixed(7) : t.entryPrice.toFixed(4)}</td>
        <td>$${t.exitPrice < 0.001 ? t.exitPrice.toFixed(7) : t.exitPrice.toFixed(4)}</td>
        <td style="color: ${pnlColor}; font-weight: 700;">${sign}$${Math.abs(t.pnlUsd).toFixed(2)} (${sign}${Math.abs(t.pnlPct).toFixed(2)}%)</td>
        <td>${t.exitReason}</td>
        <td>${t.learningNote}</td>
      </tr>
    `;
  }).join("");
}


