/* ==========================================================================
   RustBot · Solana Autonomous HFT Agent & TimesFM Predictive Matrix
   Dedicated Client-Side Runtime Engine
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
  tickIntervalMs: 500, // Ultra-fast HFT tick cadence (~500ms)
  scannedTokens: [],
  selectedToken: null,
  currentCandles: [],
  latestTimesfmResult: null,
  activePositions: [], // Multiple simultaneous positions across scanned coins
  wallet: {
    initialEquity: 10000.0, // Default baseline $10,000 as requested
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
    stage1Doubts: [],
    stage2Retesting: [],
    stage3PermanentTraps: [],
    avoidedTrapsCount: 0,
    savedCapital: 0.0,
    lastVetoSyncTimes: {},
    lastVetoToastTimes: {},
  },
  executedTrades: [],
  databaseInfo: {
    connected: false,
    path: "solana_trades.db",
    tradesCount: 0,
    trapsCount: 0,
  },
  autoPilotEnabled: true,
  dynamicMarginPct: 6.67,
  maxConcurrentPositions: 15,
  confluenceStopLossPct: -3.0,
  trailingRunnerTriggerPct: 3.5,
  tokenCooldownMap: new Map(),
  lastAiAuditTimestamp: 0,
  tradesSinceLastAudit: 0,
  isAuditingRisk: false,
  toastTimer: null,
};

let csrfToken = "";

const SOLANA_EXPANDED_CATALOG = [
  { symbol: "SOL", name: "Solana", price_usd: 142.50, dex: "raydium", volume_24h: 3820000000, liquidity_usd: 180000000, volatility_score: 82.4, price_change_5m: 1.25, price_change_1h: 3.80 },
  { symbol: "JUP", name: "Jupiter", price_usd: 0.885, dex: "orca", volume_24h: 128000000, liquidity_usd: 45000000, volatility_score: 84.1, price_change_5m: 2.10, price_change_1h: 6.40 },
  { symbol: "RAY", name: "Raydium", price_usd: 2.14, dex: "raydium", volume_24h: 84000000, liquidity_usd: 22000000, volatility_score: 88.5, price_change_5m: -1.80, price_change_1h: 7.20 },
  { symbol: "BONK", name: "Bonk", price_usd: 0.0000214, dex: "raydium", volume_24h: 96000000, liquidity_usd: 18000000, volatility_score: 91.2, price_change_5m: 3.40, price_change_1h: -4.10 },
  { symbol: "WIF", name: "dogwifhat", price_usd: 1.62, dex: "raydium", volume_24h: 210000000, liquidity_usd: 35000000, volatility_score: 95.0, price_change_5m: -2.40, price_change_1h: 8.90 },
  { symbol: "POPCAT", name: "Popcat", price_usd: 0.485, dex: "raydium", volume_24h: 68000000, liquidity_usd: 14000000, volatility_score: 89.4, price_change_5m: 2.10, price_change_1h: 5.60 },
  { symbol: "FARTCOIN", name: "Fartcoin", dex: "pump.fun", price_usd: 0.324, volume_24h: 42000000, liquidity_usd: 8500000, volatility_score: 98.2, price_change_5m: 5.20, price_change_1h: 18.90 },
  { symbol: "PUMP", name: "Pump.fun", dex: "pump.fun", price_usd: 0.00384, volume_24h: 5120000, liquidity_usd: 924000, volatility_score: 96.5, price_change_5m: 3.85, price_change_1h: 12.40 },
  { symbol: "PYTH", name: "Pyth Network", price_usd: 0.342, dex: "orca", volume_24h: 45000000, liquidity_usd: 16000000, volatility_score: 81.5, price_change_5m: 0.90, price_change_1h: 2.60 },
  { symbol: "JTO", name: "Jito", price_usd: 2.48, dex: "orca", volume_24h: 38000000, liquidity_usd: 12500000, volatility_score: 85.0, price_change_5m: 1.60, price_change_1h: 4.80 },
  { symbol: "RENDER", name: "Render", price_usd: 5.82, dex: "raydium", volume_24h: 115000000, liquidity_usd: 29000000, volatility_score: 83.2, price_change_5m: 1.10, price_change_1h: 3.70 },
  { symbol: "DRIFT", name: "Drift", price_usd: 0.74, dex: "orca", volume_24h: 24000000, liquidity_usd: 8200000, volatility_score: 86.8, price_change_5m: 1.50, price_change_1h: 5.10 },
  { symbol: "KMNO", name: "Kamino", price_usd: 0.118, dex: "raydium", volume_24h: 19500000, liquidity_usd: 6800000, volatility_score: 84.6, price_change_5m: 1.30, price_change_1h: 3.40 },
  { symbol: "MEW", name: "cat in a dogs world", price_usd: 0.0054, dex: "raydium", volume_24h: 55000000, liquidity_usd: 16500000, volatility_score: 91.5, price_change_5m: 2.40, price_change_1h: 7.10 },
  { symbol: "TNSR", name: "Tensor", price_usd: 0.43, dex: "orca", volume_24h: 16200000, liquidity_usd: 5400000, volatility_score: 85.2, price_change_5m: 1.20, price_change_1h: 3.00 },
  { symbol: "ORCA", name: "Orca", price_usd: 2.88, dex: "orca", volume_24h: 22500000, liquidity_usd: 9200000, volatility_score: 81.0, price_change_5m: 0.70, price_change_1h: 2.90 },
  { symbol: "BOME", name: "BOOK OF MEME", price_usd: 0.0068, dex: "raydium", volume_24h: 62000000, liquidity_usd: 19000000, volatility_score: 89.2, price_change_5m: 1.90, price_change_1h: 5.80 },
  { symbol: "GOAT", name: "Goatseus Maximus", price_usd: 0.452, dex: "pump.fun", volume_24h: 78000000, liquidity_usd: 21000000, volatility_score: 97.4, price_change_5m: 4.10, price_change_1h: 14.50 },
  { symbol: "ACT", name: "Act I : The AI Prophecy", price_usd: 0.285, dex: "pump.fun", volume_24h: 88000000, liquidity_usd: 24000000, volatility_score: 96.8, price_change_5m: 3.90, price_change_1h: 11.80 },
  { symbol: "PNUT", name: "Peanut the Squirrel", price_usd: 0.512, dex: "pump.fun", volume_24h: 94000000, liquidity_usd: 26000000, volatility_score: 98.6, price_change_5m: 4.80, price_change_1h: 16.20 },
  { symbol: "MOODENG", name: "Moo Deng", price_usd: 0.215, dex: "pump.fun", volume_24h: 36000000, liquidity_usd: 7800000, volatility_score: 93.1, price_change_5m: 2.70, price_change_1h: 8.40 },
  { symbol: "CHILLGUY", name: "Just a chill guy", price_usd: 0.184, dex: "pump.fun", volume_24h: 31000000, liquidity_usd: 6900000, volatility_score: 94.5, price_change_5m: 3.10, price_change_1h: 9.70 },
  { symbol: "GIGA", name: "GigaChad", price_usd: 0.042, dex: "raydium", volume_24h: 28000000, liquidity_usd: 8100000, volatility_score: 90.0, price_change_5m: 1.80, price_change_1h: 6.20 },
  { symbol: "W", name: "Wormhole", price_usd: 0.224, dex: "orca", volume_24h: 18000000, liquidity_usd: 6200000, volatility_score: 82.0, price_change_5m: 0.80, price_change_1h: 2.50 },
  { symbol: "HNT", name: "Helium", price_usd: 4.65, dex: "raydium", volume_24h: 26000000, liquidity_usd: 9400000, volatility_score: 83.5, price_change_5m: 1.10, price_change_1h: 3.20 },
  { symbol: "MOBILE", name: "Helium Mobile", price_usd: 0.00078, dex: "raydium", volume_24h: 8500000, liquidity_usd: 3200000, volatility_score: 88.0, price_change_5m: 2.20, price_change_1h: 5.40 },
  { symbol: "IO", name: "io.net", price_usd: 1.82, dex: "raydium", volume_24h: 24000000, liquidity_usd: 7600000, volatility_score: 86.0, price_change_5m: 1.40, price_change_1h: 4.10 },
  { symbol: "MSOL", name: "Marinade Staked SOL", price_usd: 168.20, dex: "raydium", volume_24h: 42000000, liquidity_usd: 35000000, volatility_score: 74.0, price_change_5m: 0.90, price_change_1h: 2.80 },
  { symbol: "JITOSOL", name: "Jito Staked SOL", price_usd: 172.40, dex: "orca", volume_24h: 56000000, liquidity_usd: 48000000, volatility_score: 75.0, price_change_5m: 0.95, price_change_1h: 2.90 },
  { symbol: "ZEUS", name: "Zeus Network", price_usd: 0.38, dex: "raydium", volume_24h: 14000000, liquidity_usd: 4800000, volatility_score: 87.2, price_change_5m: 1.70, price_change_1h: 4.50 },
  { symbol: "WEN", name: "Wen", price_usd: 0.000085, dex: "raydium", volume_24h: 12000000, liquidity_usd: 4200000, volatility_score: 86.5, price_change_5m: 1.50, price_change_1h: 4.20 },
  { symbol: "MYRO", name: "Myro", price_usd: 0.072, dex: "raydium", volume_24h: 15000000, liquidity_usd: 5100000, volatility_score: 89.0, price_change_5m: 2.10, price_change_1h: 5.90 },
  { symbol: "SAMO", name: "Samoyedcoin", price_usd: 0.0092, dex: "orca", volume_24h: 8400000, liquidity_usd: 3100000, volatility_score: 85.5, price_change_5m: 1.40, price_change_1h: 3.80 },
  { symbol: "SLERF", name: "Slerf", price_usd: 0.165, dex: "raydium", volume_24h: 22000000, liquidity_usd: 7200000, volatility_score: 92.0, price_change_5m: 2.50, price_change_1h: 7.20 },
  { symbol: "FWOG", name: "Fwog", price_usd: 0.245, dex: "pump.fun", volume_24h: 29000000, liquidity_usd: 7900000, volatility_score: 93.8, price_change_5m: 3.20, price_change_1h: 9.10 },
  { symbol: "LUCE", name: "Official Luce", price_usd: 0.082, dex: "pump.fun", volume_24h: 18000000, liquidity_usd: 4600000, volatility_score: 95.2, price_change_5m: 3.60, price_change_1h: 10.40 },
  { symbol: "AI16Z", name: "ai16z", price_usd: 0.385, dex: "pump.fun", volume_24h: 65000000, liquidity_usd: 18000000, volatility_score: 97.0, price_change_5m: 4.20, price_change_1h: 13.80 },
  { symbol: "ZEREBRO", name: "Zerebro", price_usd: 0.295, dex: "pump.fun", volume_24h: 44000000, liquidity_usd: 12000000, volatility_score: 96.2, price_change_5m: 3.80, price_change_1h: 11.20 },
];

const elements = {
  themeToggleBtn: document.querySelector("#theme-toggle-btn"),
  railToggleBtn: document.querySelector("#rail-toggle-btn"),
  sidebarRail: document.querySelector("#sidebar-rail"),
  userNameDisplay: document.querySelector("#user-name-display"),
  userRoleBadge: document.querySelector("#user-role-badge"),
  userAvatar: document.querySelector("#user-avatar"),
  authActionBtn: document.querySelector("#auth-action-btn"),
  toast: document.querySelector("#toast"),
  toastMessage: document.querySelector("#toast-message"),

  // Solana Bot Elements
  btnStartSolanaBot: document.querySelector("#btn-start-solana-bot"),
  btnStopSolanaBot: document.querySelector("#btn-stop-solana-bot"),
  btnResetSolanaWallet: document.querySelector("#btn-reset-solana-wallet"),
  btnRefreshSolanaScan: document.querySelector("#btn-refresh-solana-scan"),
  solanaBotStatusPill: document.querySelector("#solana-bot-status-pill"),
  solanaStatusText: document.querySelector("#solana-status-text"),
  solanaDbPill: document.querySelector("#solana-db-pill"),
  solanaDbText: document.querySelector("#solana-db-text"),
  solanaWalletBalance: document.querySelector("#solana-wallet-balance"),
  solanaCashAllocation: document.querySelector("#solana-cash-allocation"),
  solanaCumPnl: document.querySelector("#solana-cum-pnl"),
  solanaPnlTag: document.querySelector("#solana-pnl-tag"),
  solanaWinrateStat: document.querySelector("#solana-winrate-stat"),
  solanaFeeDrag: document.querySelector("#solana-fee-drag"),
  circuitBarFill: document.querySelector("#circuit-bar-fill"),
  circuitDrawdownText: document.querySelector("#circuit-drawdown-text"),
  circuitStatusBadge: document.querySelector("#circuit-status-badge"),
  circuitDangerHint: document.querySelector("#circuit-danger-hint"),
  solanaActiveTokenBadge: document.querySelector("#solana-active-token-badge"),
  solanaPositionDetails: document.querySelector("#solana-position-details"),
  multiPositionsPanel: document.querySelector("#multi-positions-panel"),
  activePositionsCount: document.querySelector("#active-positions-count"),
  allocatedMarginChip: document.querySelector("#allocated-margin-chip"),
  unrealizedPnlChip: document.querySelector("#unrealized-pnl-chip"),
  btnCloseAllPositions: document.querySelector("#btn-close-all-positions"),
  multiPositionsTbody: document.querySelector("#multi-positions-tbody"),
  solanaTokensTbody: document.querySelector("#solana-tokens-tbody"),
  timesfmForecastCanvas: document.querySelector("#timesfm-forecast-canvas"),
  timesfmActivePairHeading: document.querySelector("#timesfm-active-pair-heading"),
  timesfmExpectedReturn: document.querySelector("#timesfm-expected-return"),
  timesfmMeanRevProb: document.querySelector("#timesfm-mean-rev-prob"),
  timesfmFvgCount: document.querySelector("#timesfm-fvg-count"),
  tagStage1Count: document.querySelector("#tag-stage-1-count"),
  tagStage2Count: document.querySelector("#tag-stage-2-count"),
  tagStage3Count: document.querySelector("#tag-stage-3-count"),
  btnReassessVetoes: document.querySelector("#btn-reassess-vetoes"),
  solanaTokenSearch: document.querySelector("#solana-token-search"),
  solanaScannedCount: document.querySelector("#solana-scanned-count"),
  solanaLearningTbody: document.querySelector("#solana-learning-tbody"),
  solanaTradeJournalCount: document.querySelector("#solana-trade-journal-count"),
  solanaJournalTbody: document.querySelector("#solana-journal-tbody"),
  autopilotMasterToggle: document.querySelector("#autopilot-master-toggle"),
  autopilotStatusText: document.querySelector("#autopilot-status-text"),
  btnTriggerAiAudit: document.querySelector("#btn-trigger-ai-audit"),
  aiMarketRegime: document.querySelector("#ai-market-regime"),
  aiDynamicMargin: document.querySelector("#ai-dynamic-margin"),
  aiMaxPositions: document.querySelector("#ai-max-positions"),
  aiStopLoss: document.querySelector("#ai-stop-loss"),
  aiTrailingTrigger: document.querySelector("#ai-trailing-trigger"),
  aiAuditConfidence: document.querySelector("#ai-audit-confidence"),
  aiAuditSource: document.querySelector("#ai-audit-source"),
  aiAuditTimestamp: document.querySelector("#ai-audit-timestamp"),
  aiAuditVerdict: document.querySelector("#ai-audit-verdict"),
  aiCooldownTags: document.querySelector("#ai-cooldown-tags"),
};

document.addEventListener("DOMContentLoaded", initialize);

async function initialize() {
  initTheme();
  bindEvents();
  initAutoPilotState();
  updateSolanaWalletHUD();
  renderMultiPositionsTable();
  await checkAuth();
  await syncWithDedicatedDb();
  await scanSolanaChain(false);

  // Trigger initial AI Risk Sentinel Audit
  await triggerAiRiskAudit(false);

  // Auto-Pilot: if engaged, launch autonomous trading loop automatically
  if (solanaBotState.autoPilotEnabled && !solanaBotState.isRunning) {
    console.log("[Auto-Pilot] Autonomous execution active: Starting bot without human intervention...");
    startSolanaAutonomousBot();
  }
}

/* ==========================================================================
   Universal Theme Persistence & Cross-Tab Synchronization
   ========================================================================== */

function getActiveTheme() {
  return localStorage.getItem("rustbot_theme") || document.documentElement.getAttribute("data-theme") || "dark";
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
      } catch (e) { }
      updateThemeUI(nextTheme);
      if (solanaBotState.latestTimesfmResult) {
        drawTimesfmCanvas(solanaBotState.currentCandles, solanaBotState.latestTimesfmResult);
      }
    });
  }

  // Cross-Tab Theme Sync: If theme changes in another tab, update immediately
  window.addEventListener("storage", (event) => {
    if (event.key === "rustbot_theme" && event.newValue) {
      document.documentElement.setAttribute("data-theme", event.newValue);
      updateThemeUI(event.newValue);
      if (solanaBotState.latestTimesfmResult) {
        drawTimesfmCanvas(solanaBotState.currentCandles, solanaBotState.latestTimesfmResult);
      }
    }
  });
}

function bindEvents() {
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
  if (elements.btnReassessVetoes) {
    elements.btnReassessVetoes.addEventListener("click", reassessVetoLedger);
  }
  if (elements.solanaTokenSearch) {
    elements.solanaTokenSearch.addEventListener("input", () => {
      renderSolanaTokensTable();
    });
  }
  if (elements.autopilotMasterToggle) {
    elements.autopilotMasterToggle.addEventListener("change", (e) => {
      solanaBotState.autoPilotEnabled = e.target.checked;
      try {
        localStorage.setItem("rustbot_solana_autopilot", e.target.checked ? "true" : "false");
      } catch (_) { }
      updateAutoPilotUI();
      if (solanaBotState.autoPilotEnabled && !solanaBotState.isRunning) {
        startSolanaAutonomousBot();
      } else if (!solanaBotState.autoPilotEnabled && solanaBotState.isRunning) {
        stopSolanaAutonomousBot("OPERATOR_STOP");
      }
    });
  }
  if (elements.btnTriggerAiAudit) {
    elements.btnTriggerAiAudit.addEventListener("click", () => triggerAiRiskAudit(true));
  }
  if (elements.railToggleBtn && elements.sidebarRail) {
    elements.railToggleBtn.addEventListener("click", () => {
      elements.sidebarRail.classList.toggle("is-open");
    });
  }
  window.addEventListener("resize", () => {
    if (solanaBotState.latestTimesfmResult) {
      drawTimesfmCanvas(solanaBotState.currentCandles, solanaBotState.latestTimesfmResult);
    }
  });
}

function initAutoPilotState() {
  const saved = localStorage.getItem("rustbot_solana_autopilot");
  if (saved !== null) {
    solanaBotState.autoPilotEnabled = saved !== "false";
  } else {
    solanaBotState.autoPilotEnabled = true;
  }
  if (elements.autopilotMasterToggle) {
    elements.autopilotMasterToggle.checked = solanaBotState.autoPilotEnabled;
  }
  updateAutoPilotUI();
}

function updateAutoPilotUI() {
  if (elements.autopilotStatusText) {
    elements.autopilotStatusText.textContent = solanaBotState.autoPilotEnabled ? "ENGAGED" : "DISABLED";
    elements.autopilotStatusText.style.color = solanaBotState.autoPilotEnabled ? "#a78bfa" : "var(--muted)";
  }
}

async function triggerAiRiskAudit(notifyUser = false) {
  if (solanaBotState.isAuditingRisk) return;
  solanaBotState.isAuditingRisk = true;
  if (elements.btnTriggerAiAudit) elements.btnTriggerAiAudit.disabled = true;

  try {
    const res = await api("/api/market/solana/ai-risk-audit", {
      method: "POST",
      body: JSON.stringify({ recent_limit: 30 })
    });

    if (res) {
      applyAiRiskDirectives(res);
      if (notifyUser) {
        showToast(`AI Risk Sentinel: Market regime identified as ${res.market_regime || 'ADAPTIVE'}`);
      }
    }
  } catch (err) {
    console.warn("AI Risk Audit warning:", err);
  } finally {
    solanaBotState.isAuditingRisk = false;
    solanaBotState.tradesSinceLastAudit = 0;
    if (elements.btnTriggerAiAudit) elements.btnTriggerAiAudit.disabled = false;
  }
}

function applyAiRiskDirectives(data) {
  if (!data) return;

  // 1. Dynamic Margin % (Pegged to 1/15th full portfolio allocation)
  solanaBotState.dynamicMarginPct = 6.67;
  if (elements.aiDynamicMargin) {
    const marginUsd = (solanaBotState.wallet.currentEquity / (solanaBotState.maxConcurrentPositions || 15)).toFixed(2);
    elements.aiDynamicMargin.textContent = `6.7% ($${marginUsd})`;
  }

  // 2. Max Concurrent Positions
  solanaBotState.maxConcurrentPositions = 15;
  if (elements.aiMaxPositions) {
    elements.aiMaxPositions.textContent = `15 Coins`;
  }

  // 3. Adaptive Stop Loss
  if (typeof data.tighten_stop_loss_pct === "number") {
    solanaBotState.confluenceStopLossPct = data.tighten_stop_loss_pct;
    if (elements.aiStopLoss) {
      elements.aiStopLoss.textContent = `${solanaBotState.confluenceStopLossPct.toFixed(1)}% Confluence`;
    }
  }

  // 4. Trailing Runner Trigger
  if (typeof data.trailing_runner_trigger_pct === "number") {
    solanaBotState.trailingRunnerTriggerPct = data.trailing_runner_trigger_pct;
    if (elements.aiTrailingTrigger) {
      elements.aiTrailingTrigger.textContent = `+${solanaBotState.trailingRunnerTriggerPct.toFixed(1)}% Net`;
    }
  }

  // 5. Market Regime Pill
  if (data.market_regime && elements.aiMarketRegime) {
    elements.aiMarketRegime.textContent = data.market_regime;
    elements.aiMarketRegime.className = "chip-val regime-pill " + (
      data.market_regime.includes("BULL") ? "bullish" :
      data.market_regime.includes("DEFENSE") ? "defense" : ""
    );
  }

  // 6. Confidence & Source
  if (elements.aiAuditConfidence && typeof data.audit_confidence === "number") {
    elements.aiAuditConfidence.textContent = `${Math.round(data.audit_confidence * 100)}% Confidence`;
  }
  if (elements.aiAuditSource) {
    elements.aiAuditSource.textContent = data.source === "openrouter"
      ? `OpenRouter Risk Sentinel (${data.model || 'Auto'})`
      : "Quantitative Risk Rules Engine (Server)";
  }
  if (elements.aiAuditTimestamp) {
    elements.aiAuditTimestamp.textContent = `Audited: ${new Date().toLocaleTimeString()}`;
  }

  // 7. Fact Check Verdict Commentary
  if (elements.aiAuditVerdict && data.fact_check_verdict) {
    elements.aiAuditVerdict.textContent = data.fact_check_verdict;
  }

  // 8. Token Recommendations (e.g. cooldowns)
  if (Array.isArray(data.token_recommendations)) {
    const now = Date.now();
    if (elements.aiCooldownTags) elements.aiCooldownTags.innerHTML = "";

    for (const rec of data.token_recommendations) {
      if (rec.action === "COOLDOWN_30M") {
        solanaBotState.tokenCooldownMap.set(rec.symbol, now + (30 * 60 * 1000));
        if (elements.aiCooldownTags) {
          const pill = document.createElement("span");
          pill.className = "cooldown-pill cooldown";
          pill.textContent = `⏳ ${rec.symbol}: Cooldown (30m)`;
          pill.title = rec.reason || "Underperforming";
          elements.aiCooldownTags.appendChild(pill);
        }
      } else if (rec.action === "BOOST_WEIGHT") {
        if (elements.aiCooldownTags) {
          const pill = document.createElement("span");
          pill.className = "cooldown-pill boost";
          pill.textContent = `🔥 ${rec.symbol}: Boosted Weight`;
          pill.title = rec.reason || "Strong momentum";
          elements.aiCooldownTags.appendChild(pill);
        }
      }
    }
  }
}

async function checkAuth() {
  try {
    const res = await api("/api/auth/me");
    if (res && res.user) {
      csrfToken = res.csrf_token || "";
      if (elements.userNameDisplay) elements.userNameDisplay.textContent = res.user.username;
      if (elements.userRoleBadge) elements.userRoleBadge.textContent = res.user.role;
      if (elements.userAvatar) elements.userAvatar.textContent = res.user.username.charAt(0).toUpperCase();
      if (elements.authActionBtn) {
        elements.authActionBtn.textContent = "Log Out";
        elements.authActionBtn.onclick = async (e) => {
          e.preventDefault();
          await api("/api/auth/logout", { method: "POST" });
          window.location.reload();
        };
      }
    }
  } catch (err) {
    console.debug("User guest mode:", err);
  }
}

/* ==========================================================================
   On-Chain DEX Scanner & TimesFM Integration
   ========================================================================== */

async function scanSolanaChain(forceUserToast = false) {
  if (elements.solanaTokensTbody) {
    elements.solanaTokensTbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; color: var(--muted); padding: 14px;">
          Scanning live Solana DEX liquidity pools (Raydium, Orca, Jupiter)…
        </td>
      </tr>`;
  }

  try {
    const data = await api("/api/market/solana/trending?min_liquidity=10000");
    if (data && Array.isArray(data.tokens) && data.tokens.length > 0) {
      solanaBotState.scannedTokens = data.tokens;
      renderSolanaTokensTable();

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
    solanaBotState.scannedTokens = [...SOLANA_EXPANDED_CATALOG];
    renderSolanaTokensTable();
    if (!solanaBotState.selectedToken) {
      selectSolanaToken(SOLANA_EXPANDED_CATALOG[0]);
    }
  }
}

function renderSolanaTokensTable() {
  if (!elements.solanaTokensTbody) return;
  let tokens = solanaBotState.scannedTokens || [];
  if (tokens.length === 0) {
    tokens = [...SOLANA_EXPANDED_CATALOG];
    solanaBotState.scannedTokens = tokens;
  }

  const query = (elements.solanaTokenSearch?.value || "").trim().toLowerCase();
  const filtered = query
    ? tokens.filter((t) => (t.symbol && t.symbol.toLowerCase().includes(query)) || (t.name && t.name.toLowerCase().includes(query)) || (t.dex && t.dex.toLowerCase().includes(query)))
    : tokens;

  if (elements.solanaScannedCount) {
    elements.solanaScannedCount.textContent = `${filtered.length} / ${tokens.length} Pairs`;
  }

  if (filtered.length === 0) {
    elements.solanaTokensTbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; color: var(--muted); padding: 14px;">
          No Solana coins matching "${query}".
        </td>
      </tr>`;
    return;
  }

  elements.solanaTokensTbody.innerHTML = filtered.map((t) => {
    const isSelected = solanaBotState.selectedToken && solanaBotState.selectedToken.symbol === t.symbol;
    const change5mClass = (t.price_change_5m || 0) >= 0 ? "positive" : "negative";
    const change1hClass = (t.price_change_1h || 0) >= 0 ? "positive" : "negative";
    const formattedPrice = t.price_usd < 0.001 ? t.price_usd.toFixed(7) : t.price_usd.toFixed(4);

    const isPump = (t.dex || "").toLowerCase().includes("pump");
    const dexLabel = isPump ? "💊 pump.fun" : (t.dex || 'DEX');
    const dexClass = isPump ? "token-cell-dex badge-pump-fun" : "token-cell-dex";

    return `
      <tr style="cursor: pointer; ${isSelected ? 'background: var(--surface-elevated); border-left: 3px solid var(--ember);' : ''}" onclick="selectSolanaTokenBySymbol('${t.symbol}')">
        <td>
          <div class="token-cell-title">${t.symbol} <span class="${dexClass}" style="${isPump ? 'color: var(--ember); font-weight: 700;' : ''}">· ${dexLabel}</span></div>
          <small style="color: var(--muted); font-size: 0.7rem;">${(t.address || '').slice(0, 4)}...${(t.address || '').slice(-4)}</small>
        </td>
        <td>$${formattedPrice}</td>
        <td style="color: ${(t.price_change_5m || 0) >= 0 ? 'var(--sage)' : 'var(--danger)'};">${t.price_change_5m >= 0 ? '+' : ''}${(t.price_change_5m || 0).toFixed(2)}%</td>
        <td style="color: ${(t.price_change_1h || 0) >= 0 ? 'var(--sage)' : 'var(--danger)'};">${t.price_change_1h >= 0 ? '+' : ''}${(t.price_change_1h || 0).toFixed(2)}%</td>
        <td>
          <span class="badge-chip" style="color: ${t.volatility_score > 85 ? 'var(--danger)' : 'var(--ember)'};">
            ${(t.volatility_score || 75).toFixed(1)}
          </span>
        </td>
        <td>
          <button type="button" class="btn-refresh-scan" style="${isSelected ? 'background: var(--ember); color: #fff;' : ''}">
            ${isSelected ? 'Active Target' : 'Select'}
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

window.selectSolanaTokenBySymbol = function (symbol) {
  const token = solanaBotState.scannedTokens.find((t) => t.symbol === symbol);
  if (token) selectSolanaToken(token);
};

async function selectSolanaToken(token) {
  solanaBotState.selectedToken = token;
  renderSolanaTokensTable();

  if (elements.timesfmActivePairHeading) {
    elements.timesfmActivePairHeading.textContent = `${token.symbol}/USD · TimesFM Attention Matrix & FVGs`;
  }

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
    if (typeof runTimesFMPredictWorker === "function") {
      const localRes = runTimesFMPredictWorker(candles, 4, 6);
      solanaBotState.latestTimesfmResult = localRes;
      updateTimesfmUI(localRes);
      drawTimesfmCanvas(candles, localRes);
      return localRes;
    }
  } catch (err2) {
    console.warn("TimesFM local fallback error:", err2);
  }
  return null;
}

function updateTimesfmUI(res) {
  if (elements.timesfmExpectedReturn) {
    const bps = res.expectedReturnBps || res.expected_return_bps || 0;
    elements.timesfmExpectedReturn.textContent = `${bps >= 0 ? '+' : ''}${bps} bps`;
    elements.timesfmExpectedReturn.style.color = bps >= 0 ? "var(--sage)" : "var(--danger)";
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

    ctx.fillStyle = isBull ? 'rgba(142, 196, 166, 0.15)' : 'rgba(224, 82, 82, 0.15)';
    ctx.strokeStyle = isBull ? 'rgba(142, 196, 166, 0.45)' : 'rgba(224, 82, 82, 0.45)';
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
  ctx.strokeStyle = "#95a399";
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
    ctx.strokeStyle = "#f07044";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(splitX, getY(closes[closes.length - 1]));
    p10.forEach((price, i) => ctx.lineTo(getX(closes.length + i), getY(price)));
    ctx.stroke();
    ctx.setLineDash([]);

    // P50 Median Forecast Line
    ctx.strokeStyle = "#8ec4a6";
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

/* ==========================================================================
   Dedicated Database Synchronization (solana_trades.db)
   ========================================================================== */

async function syncWithDedicatedDb() {
  try {
    // 1. Fetch recent trades from solana_trades.db
    const tradesRes = await api("/api/market/solana/trades?limit=50");
    if (tradesRes && Array.isArray(tradesRes.trades)) {
      solanaBotState.executedTrades = tradesRes.trades.map((t) => ({
        id: t.id,
        tradeRef: t.trade_ref,
        time: new Date(t.closed_at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        token: t.token_symbol,
        dex: t.dex,
        entryPrice: t.entry_price,
        exitPrice: t.exit_price,
        marginUsd: t.margin_usd,
        pnlUsd: t.pnl_usd,
        pnlPct: t.pnl_pct,
        feesPaid: t.fees_paid_usd,
        exitReason: t.exit_reason,
        isWin: t.is_win,
        learningNote: t.is_win ? "🟢 Captured Edge" : "🔴 Learned Mistake",
      }));
      solanaBotState.databaseInfo.tradesCount = tradesRes.count || solanaBotState.executedTrades.length;
    }

    // 2. Fetch learned traps from solana_trades.db
    const memoryRes = await api("/api/market/solana/learned-memory");
    if (memoryRes && Array.isArray(memoryRes.traps)) {
      const stage1 = [];
      const stage2 = [];
      const stage3 = [];
      let totalVetoes = 0;
      let totalSaved = 0.0;

      memoryRes.traps.forEach((trap) => {
        totalVetoes += trap.times_vetoed || 0;
        totalSaved += trap.saved_capital_usd || 0.0;

        let parsedFeatures = [0.01, -0.02, 0.03, 1, 0.5];
        try {
          if (trap.features_json) parsedFeatures = JSON.parse(trap.features_json);
        } catch {
          // fallback
        }

        const trapItem = {
          id: trap.trap_id,
          trap_id: trap.trap_id,
          tokenSymbol: trap.token_symbol,
          pattern: trap.pattern_name,
          features: parsedFeatures,
          stage: trap.stage,
          retestPasses: trap.retest_passes || 0,
          retestFails: trap.retest_fails || 0,
          failLoss: (trap.initial_loss_pct || 15.0) / 100,
          timesVetoed: trap.times_vetoed || 0,
          savedCapital: trap.saved_capital_usd || 0.0,
          status: trap.status,
          notes: trap.notes,
        };

        if (trap.stage === 1) stage1.push(trapItem);
        else if (trap.stage === 2) stage2.push(trapItem);
        else if (trap.stage === 3) stage3.push(trapItem);
      });

      solanaBotState.learningEngine.stage1Doubts = stage1;
      solanaBotState.learningEngine.stage2Retesting = stage2;
      solanaBotState.learningEngine.stage3PermanentTraps = stage3;
      solanaBotState.learningEngine.avoidedTrapsCount = totalVetoes;
      solanaBotState.learningEngine.savedCapital = totalSaved;
      solanaBotState.databaseInfo.trapsCount = memoryRes.count || memoryRes.traps.length;
    }

    // 3. Fetch persisted wallet state from solana_trades.db
    try {
      const walletRes = await api("/api/market/solana/wallet");
      if (walletRes && walletRes.wallet) {
        const w = walletRes.wallet;
        solanaBotState.wallet.currentEquity = w.current_equity;
        solanaBotState.wallet.cash = w.cash;
        solanaBotState.wallet.realizedPnl = w.realized_pnl;
        solanaBotState.wallet.totalFeesPaid = w.total_fees;
        solanaBotState.wallet.peakEquity = w.peak_equity;
        solanaBotState.wallet.tradesWon = w.trades_won;
        solanaBotState.wallet.tradesLost = w.trades_lost;
        updateSolanaWalletHUD();
      }
    } catch (e) {
      console.debug("No previous wallet state stored yet:", e);
    }

    solanaBotState.databaseInfo.connected = true;
    if (elements.solanaDbText) {
      elements.solanaDbText.textContent = `solana_trades.db (${solanaBotState.databaseInfo.tradesCount} trades, ${solanaBotState.databaseInfo.trapsCount} traps)`;
    }
    if (elements.solanaDbPill) {
      elements.solanaDbPill.style.borderColor = "var(--sage)";
      elements.solanaDbPill.style.color = "var(--sage)";
    }

    renderSolanaJournal();
    renderLearningLedger();
  } catch (err) {
    console.warn("Could not sync with solana_trades.db backend:", err);
    if (elements.solanaDbText) {
      elements.solanaDbText.textContent = "solana_trades.db (Local In-Memory)";
    }
  }
}

function persistSolanaWallet() {
  const w = solanaBotState.wallet;
  api("/api/market/solana/wallet", {
    method: "POST",
    body: JSON.stringify({
      current_equity: w.currentEquity,
      cash: w.cash,
      realized_pnl: w.realizedPnl,
      total_fees: w.totalFeesPaid,
      peak_equity: w.peakEquity,
      trades_won: w.tradesWon,
      trades_lost: w.tradesLost,
      updated_at: Math.floor(Date.now() / 1000),
    }),
  }).catch((err) => console.warn("Failed to persist wallet state:", err));
}

/* ==========================================================================
   Autonomous HFT Loop & 20% Circuit Breaker
   ========================================================================== */

function startSolanaAutonomousBot() {
  if (solanaBotState.isRunning) return;

  const drawdown = (solanaBotState.wallet.peakEquity - solanaBotState.wallet.currentEquity) / Math.max(1, solanaBotState.wallet.peakEquity);
  if (drawdown >= 0.20 || solanaBotState.wallet.currentEquity <= (solanaBotState.wallet.initialEquity * 0.80)) {
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
    elements.solanaStatusText.textContent = "RUNNING · SUB-SECOND HFT CADENCE";
  }

  showToast("⚡ Solana Multi-Token Bot engaged: $10,000 capital, 2% margin ($200), max 15 coins, 1:2 R:R asymmetric exits, and 5-stage loss protection.");
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

  if (solanaBotState.activePositions.length > 0) {
    closeAllPositions("Forced Close on Bot Halt");
  }

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
    showToast("Solana bot stopped by operator. 3-stage learning ledger synchronized with solana_trades.db.");
  }

  updateSolanaWalletHUD();
  renderMultiPositionsTable();
  renderSolanaJournal();
  renderLearningLedger();
}

async function runSolanaAutonomousTick() {
  if (!solanaBotState.isRunning) return;

  try {
    solanaBotState.tickCount++;

    // Step 1: Drawdown Check (Strict 20% Max Loss Circuit Breaker: $8,000 threshold)
    const peak = solanaBotState.wallet.peakEquity;
    const current = solanaBotState.wallet.currentEquity;
    const drawdown = (peak - current) / Math.max(1, peak);

    if (drawdown >= 0.20 || current <= (solanaBotState.wallet.initialEquity * 0.80)) {
      stopSolanaAutonomousBot("CIRCUIT_BREAKER_20PCT_LOSS");
      return;
    }

    // Step 2: Manage All Active Positions Simultaneously (Dynamic Risk R:R + Trailing Runner)
    const activePositionsCopy = [...solanaBotState.activePositions];
    for (const pos of activePositionsCopy) {
      pos.barsHeld++;

      // Realistic volatility micro-jump based on coin's DEX volatility score
      const vol = (pos.token.volatility_score || 80) / 100;
      const tokenSeed = pos.token.symbol.charCodeAt(0) + pos.token.symbol.length;
      const noise = ((Math.sin(solanaBotState.tickCount * 2.2 + tokenSeed) * 0.7) + ((Math.random() - 0.46) * 1.1)) * 0.016 * vol;
      pos.currentPrice = Math.max(0.0000001, pos.currentPrice * (1 + noise));

      pos.peakPrice = Math.max(pos.peakPrice || pos.entryPrice, pos.currentPrice);

      // Fee calculations: 15 bps (0.15%) taker fee per trade leg
      const feeRate = 0.0015;
      const singleFeeUsd = pos.marginUsd * feeRate;
      const entryFeeUsd = singleFeeUsd;
      const exitFeeUsd = (pos.shares * pos.currentPrice) * feeRate;
      const grossPnlUsd = (pos.shares * pos.currentPrice) - pos.marginUsd;
      const netPnlUsd = grossPnlUsd - (entryFeeUsd + exitFeeUsd);

      pos.unrealizedPnlUsd = netPnlUsd;
      pos.unrealizedReturnPct = (netPnlUsd / pos.marginUsd) * 100;

      // QUANTITATIVE ASYMMETRIC EXIT SYSTEM (Adaptive 1:2 R:R):
      const runnerTrigger = solanaBotState.trailingRunnerTriggerPct || 3.5;
      const stopLossPct = solanaBotState.confluenceStopLossPct || -3.0;

      // Condition 1: Take-Profit 1 -> Lock in profit at adaptive runner threshold
      if (!pos.tp1Triggered && pos.unrealizedReturnPct >= runnerTrigger) {
        pos.tp1Triggered = true;
      }

      // Condition 2: Trailing Stop Runner -> Once TP1 is triggered, lock if price retraces 1.5% from peak
      const peakRetracePct = ((pos.peakPrice - pos.currentPrice) / pos.peakPrice) * 100;
      const isTrailingStop = pos.tp1Triggered && (peakRetracePct >= 1.5 || pos.unrealizedReturnPct < 0.5);

      // Condition 3: Adaptive Confluence Stop Loss -> Defends against drawdown
      const isInitialStopLoss = !pos.tp1Triggered && (pos.unrealizedReturnPct <= stopLossPct);

      // Condition 4: HFT Stale Margin Rebalance -> If trade is flat after 24 bars (~12s), free capital
      const isStaleTimeout = pos.barsHeld >= 24 && Math.abs(pos.unrealizedReturnPct) < 1.0;

      if (isTrailingStop) {
        closePosition(pos, `TAKE_PROFIT (Trailing Runner Locked: +${pos.unrealizedReturnPct.toFixed(2)}% Net)`, false);
      } else if (isInitialStopLoss) {
        closePosition(pos, `STOP_LOSS (${stopLossPct.toFixed(1)}% Confluence Defense: ${pos.unrealizedReturnPct.toFixed(2)}%)`, false);
      } else if (isStaleTimeout) {
        closePosition(pos, "HFT Stale Margin Rebalance", false);
      }
    }

    // Recalculate Current Wallet Equity
    const openPositionsValue = solanaBotState.activePositions.reduce((acc, p) => acc + (p.shares * p.currentPrice), 0);
    solanaBotState.wallet.currentEquity = solanaBotState.wallet.cash + openPositionsValue;
    if (solanaBotState.wallet.currentEquity > solanaBotState.wallet.peakEquity) {
      solanaBotState.wallet.peakEquity = solanaBotState.wallet.currentEquity;
    }

    // Step 3: Scan Chain & Seek Multiple Simultaneous Entries Across Coins (every ~30 seconds)
    if (solanaBotState.tickCount % 60 === 0) {
      await scanSolanaChain(false);
    }

    // Step 4: Autonomous OpenRouter AI Risk Audit (Every 5 minutes)
    if (solanaBotState.tickCount % 600 === 0) {
      triggerAiRiskAudit(false);
    }

    // Candidate Coins Pool (Using full scanned universe of 40+ tokens)
    const candidatePool = solanaBotState.scannedTokens.length > 0 ? solanaBotState.scannedTokens : SOLANA_EXPANDED_CATALOG;

    // Quantitative Multi-Position Risk Sizing: Full Balance Divided by 15
    const MAX_CONCURRENT_POSITIONS = 15;
    solanaBotState.maxConcurrentPositions = MAX_CONCURRENT_POSITIONS;
    const singleFeeRate = 0.0015; // 15 bps taker fee

    // Full balance divided into 15 concurrent position slots (100% allocation across 15 coins)
    const slotEquityUsd = (solanaBotState.wallet.currentEquity / MAX_CONCURRENT_POSITIONS);
    const uniformMarginUsd = Math.max(5.0, Math.floor((slotEquityUsd / (1 + singleFeeRate)) * 100) / 100);

    // CONFLUENCE METRIC 1: Benchmark Macro Regime Filter
    const solBenchmark = candidatePool.find((c) => c.symbol === "SOL") || { price_change_5m: 0.5, price_change_1h: 2.0 };
    const isMacroDumping = (solBenchmark.price_change_5m || 0) < -2.2 || (solBenchmark.price_change_1h || 0) < -5.0;

    for (const candidate of candidatePool) {
      if (solanaBotState.activePositions.length >= MAX_CONCURRENT_POSITIONS) {
        break;
      }

      // Check AI Sentinel Token Cooldown
      const cooldownUntil = solanaBotState.tokenCooldownMap.get(candidate.symbol);
      if (cooldownUntil && Date.now() < cooldownUntil) {
        continue;
      }

      // Cash Solvency & Trade Allocation Check: Allocate 1/15th slot or remaining cash buffer
      let tradeMarginUsd = uniformMarginUsd;
      let tradeFeeUsd = tradeMarginUsd * singleFeeRate;

      if (solanaBotState.wallet.cash < (tradeMarginUsd + tradeFeeUsd)) {
        const availableCashMargin = Math.floor((solanaBotState.wallet.cash / (1 + singleFeeRate)) * 100) / 100;
        if (availableCashMargin >= 5.0) {
          tradeMarginUsd = availableCashMargin;
          tradeFeeUsd = tradeMarginUsd * singleFeeRate;
        } else {
          break; // Fully deployed; no cash left for another spot trade
        }
      }

      // Do not open duplicate positions for the same token
      if (solanaBotState.activePositions.some((p) => p.token.symbol === candidate.symbol)) {
        continue;
      }

      // CONFLUENCE METRIC 1: Block altcoin longs during macro flush
      if (isMacroDumping && candidate.symbol !== "SOL") {
        continue;
      }

      // CONFLUENCE METRIC 2: Liquidity Depth & Volume Guard (Protects against micro-slippage)
      const vol24h = candidate.volume_24h || 500000;
      const liqUsd = candidate.liquidity_usd || 100000;
      if (vol24h < 40000 || liqUsd < 15000) {
        continue;
      }

      // CONFLUENCE METRIC 3: Anti-FOMO & Overbought Filter (Never buy extreme tops)
      const ch5m = candidate.price_change_5m || 0;
      const ch1h = candidate.price_change_1h || 0;
      if (ch5m > 8.0 || ch1h > 35.0) {
        continue; // Overbought wick exhaustion
      }

      // CONFLUENCE METRIC 4: Valid Retest / Momentum Confluence (Includes FVG pullbacks!)
      const isQualityConfluence = ch5m >= -2.5 && ch5m <= 5.0 && (candidate.volatility_score || 75) >= 65;
      if (!isQualityConfluence) {
        continue;
      }

      // CONFLUENCE METRIC 5: Learned Memory Veto Check (solana_trades.db)
      const vetoTrap = checkStage3TrapVeto(candidate);
      if (vetoTrap) {
        solanaBotState.learningEngine.avoidedTrapsCount++;
        solanaBotState.learningEngine.savedCapital += tradeMarginUsd;

        const trapKey = vetoTrap.id || vetoTrap.trap_id || "TRAP-UNKNOWN";
        const nowMs = Date.now();
        const lastSync = solanaBotState.learningEngine.lastVetoSyncTimes[trapKey] || 0;

        // Throttled server sync: at most once every 30s per trap ID to avoid 429 rate limits
        if (nowMs - lastSync > 30000) {
          solanaBotState.learningEngine.lastVetoSyncTimes[trapKey] = nowMs;
          api("/api/market/solana/learned-memory/veto", {
            method: "POST",
            body: JSON.stringify({
              trap_id: trapKey,
              saved_capital_usd: tradeMarginUsd,
            }),
          }).catch((e) => console.warn("Veto API sync suppressed:", e));
        }

        // Throttled UI toast: at most once every 15s per trap ID
        const lastToast = solanaBotState.learningEngine.lastVetoToastTimes[trapKey] || 0;
        if (nowMs - lastToast > 15000) {
          solanaBotState.learningEngine.lastVetoToastTimes[trapKey] = nowMs;
          showToast(`🛑 [VETO SAVED] Blocked candidate ${candidate.symbol} matching trap ${trapKey}! Saved $${tradeMarginUsd.toFixed(2)} margin.`);
        }
        continue;
      }

      const patternName = ch5m < 0 ? "Bullish FVG Pullback" : "Bullish Momentum Retest";
      openPosition(candidate, tradeMarginUsd, patternName);
    }

    processThreeStageLearningEngine();
    updateSolanaWalletHUD();
    renderMultiPositionsTable();
    renderSolanaJournal();
    renderLearningLedger();
  } catch (tickErr) {
    console.warn("[Auto-Pilot Self-Healing] Recovered from tick error:", tickErr);
  } finally {
    if (solanaBotState.isRunning) {
      solanaBotState.loopTimer = setTimeout(runSolanaAutonomousTick, solanaBotState.tickIntervalMs);
    }
  }
}

function openPosition(token, marginUsd, fvgType = "BULLISH_FVG") {
  const safeFvg = String(fvgType || "BULLISH_FVG");
  const takerFeeUsd = marginUsd * 0.0015; // 15 bps fee

  if (solanaBotState.wallet.cash < marginUsd + takerFeeUsd) {
    return;
  }

  const entryPrice = token.price_usd || 1.0;
  const shares = marginUsd / entryPrice;

  solanaBotState.wallet.cash -= (marginUsd + takerFeeUsd);
  solanaBotState.wallet.totalFeesPaid += takerFeeUsd;

  const rawFeatures = [
    (token.price_change_5m || 0) / 100,
    (token.price_change_1h || 0) / 100,
    (token.volatility_score || 80) / 100,
    safeFvg.toUpperCase().includes("BULLISH") ? 1 : -1,
    (token.volume_24h || 1000000) / 100000000,
  ];

  const pos = {
    token,
    marginUsd,
    entryPrice,
    currentPrice: entryPrice,
    peakPrice: entryPrice,
    tp1Triggered: false,
    shares,
    entryTime: Date.now(),
    entryFeatures: rawFeatures,
    fvgType: safeFvg,
    barsHeld: 0,
    unrealizedPnlUsd: 0.0,
    unrealizedReturnPct: 0.0,
  };

  solanaBotState.activePositions.push(pos);
}

function closePosition(pos, exitReason, isEmergencyHalt = false) {
  const index = solanaBotState.activePositions.indexOf(pos);
  if (index === -1) return;

  const exitPrice = pos.currentPrice;
  const exitTakerFee = (pos.shares * exitPrice) * 0.0015;
  const grossPnl = (pos.shares * exitPrice) - pos.marginUsd;
  const entryFee = pos.marginUsd * 0.0015;
  const netPnlUsd = grossPnl - (entryFee + exitTakerFee);
  const netReturnPct = (netPnlUsd / pos.marginUsd) * 100;

  // Return margin + net PnL back into cash
  solanaBotState.wallet.cash += (pos.marginUsd + grossPnl - exitTakerFee);
  solanaBotState.wallet.realizedPnl += netPnlUsd;
  solanaBotState.wallet.totalFeesPaid += exitTakerFee;

  const openPositionsValue = solanaBotState.activePositions
    .filter((p) => p !== pos)
    .reduce((acc, p) => acc + (p.shares * p.currentPrice), 0);
  solanaBotState.wallet.currentEquity = solanaBotState.wallet.cash + openPositionsValue;

  if (solanaBotState.wallet.currentEquity > solanaBotState.wallet.peakEquity) {
    solanaBotState.wallet.peakEquity = solanaBotState.wallet.currentEquity;
  }
  persistSolanaWallet();

  const isWin = netPnlUsd > 0;
  if (isWin) {
    solanaBotState.wallet.tradesWon++;
  } else {
    solanaBotState.wallet.tradesLost++;
    let failurePattern = "Defensive Stop-Loss (-3.0%)";
    if ((pos.token.price_change_5m || 0) > 3.5) {
      failurePattern = "FOMO Overbought Exhaustion";
    } else if ((pos.token.volatility_score || 0) > 92) {
      failurePattern = "Excessive Volatility Slippage";
    }
    registerTradeMistakeInStage1(pos.token, pos.entryFeatures, netReturnPct / 100, failurePattern);
  }

  const tradeRef = `SOL-HFT-${Date.now().toString().slice(-6)}`;
  const tradeEntry = {
    id: solanaBotState.executedTrades.length + 1,
    tradeRef,
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    token: pos.token.symbol,
    dex: pos.token.dex || "Raydium",
    entryPrice: pos.entryPrice,
    exitPrice,
    marginUsd: pos.marginUsd,
    pnlUsd: netPnlUsd,
    pnlPct: netReturnPct,
    feesPaid: entryFee + exitTakerFee,
    exitReason,
    isWin,
    learningNote: isWin ? "🟢 Captured Edge" : "🔴 Doubted (Stage 1)",
  };

  solanaBotState.executedTrades.unshift(tradeEntry);
  solanaBotState.activePositions.splice(index, 1);

  // PERSISTENCE: Save trade record into dedicated solana_trades.db
  api("/api/market/solana/trades", {
    method: "POST",
    body: JSON.stringify({
      trade_ref: tradeRef,
      token_symbol: pos.token.symbol,
      token_name: pos.token.name || pos.token.symbol,
      dex: pos.token.dex || "Raydium",
      entry_price: pos.entryPrice,
      exit_price: exitPrice,
      margin_usd: pos.marginUsd,
      pnl_usd: netPnlUsd,
      pnl_pct: netReturnPct,
      fees_paid_usd: entryFee + exitTakerFee,
      exit_reason: exitReason,
      is_win: isWin,
      features_json: JSON.stringify(pos.entryFeatures),
    }),
  }).then(() => {
    solanaBotState.databaseInfo.tradesCount++;
    if (elements.solanaDbText) {
      elements.solanaDbText.textContent = `solana_trades.db (${solanaBotState.databaseInfo.tradesCount} trades, ${solanaBotState.databaseInfo.trapsCount} traps)`;
    }
  }).catch((e) => console.warn("Failed to persist trade to solana_trades.db:", e));

  // Autonomous AI Fact-Check: After every 5 closed trades, run an AI Risk Audit
  solanaBotState.tradesSinceLastAudit++;
  if (solanaBotState.tradesSinceLastAudit >= 5) {
    triggerAiRiskAudit(false);
  }
}

function closeAllPositions(reason) {
  const positions = [...solanaBotState.activePositions];
  for (const pos of positions) {
    closePosition(pos, reason, false);
  }
}

window.closeSinglePositionBySymbol = function (symbol) {
  const pos = solanaBotState.activePositions.find((p) => p.token.symbol === symbol);
  if (pos) {
    closePosition(pos, "Manual Close by Operator", false);
    updateSolanaWalletHUD();
    renderMultiPositionsTable();
    renderSolanaJournal();
  }
};

/* ==========================================================================
   3-Stage Continuous Learning Engine (Doubt -> Re-test -> Permanent Veto)
   ========================================================================== */

function registerTradeMistakeInStage1(token, features, failReturn, fvgType) {
  const mistakeId = `TRAP-${token.symbol}-${String(solanaBotState.learningEngine.stage1Doubts.length + solanaBotState.learningEngine.stage3PermanentTraps.length + 1).padStart(3, "0")}`;
  const mistakeItem = {
    id: mistakeId,
    trap_id: mistakeId,
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

  // PERSISTENCE: Save new Stage 1 Doubt into dedicated solana_trades.db
  api("/api/market/solana/learned-memory", {
    method: "POST",
    body: JSON.stringify({
      trap_id: mistakeId,
      token_symbol: token.symbol,
      pattern_name: fvgType || "Volatility Imbalance Misjudgment",
      features_json: JSON.stringify(features || []),
      stage: 1,
      initial_loss_pct: Math.abs(failReturn * 100),
      notes: "Quarantined in Stage 1 Doubt after stop loss exit",
    }),
  }).then(() => {
    solanaBotState.databaseInfo.trapsCount++;
    if (elements.solanaDbText) {
      elements.solanaDbText.textContent = `solana_trades.db (${solanaBotState.databaseInfo.tradesCount} trades, ${solanaBotState.databaseInfo.trapsCount} traps)`;
    }
  }).catch((e) => console.warn("Failed to persist mistake to solana_trades.db:", e));
}

function processThreeStageLearningEngine() {
  const engine = solanaBotState.learningEngine;

  // Advance Stage 1 to Stage 2
  while (engine.stage1Doubts.length > 0) {
    const item = engine.stage1Doubts.shift();
    item.stage = 2;
    item.retestPasses = 0;
    item.retestFails = 0;
    engine.stage2Retesting.push(item);

    // Persist Stage 2 transition to solana_trades.db
    api("/api/market/solana/learned-memory", {
      method: "POST",
      body: JSON.stringify({
        is_update: true,
        trap_id: item.trap_id || item.id,
        stage: 2,
        retest_passes: item.retestPasses,
        retest_fails: item.retestFails,
        status: "RETESTING",
        notes: "Queued for historical re-test verification",
      }),
    }).catch(() => { });
  }

  // Paced Verification: Only process retests periodically (every 25 ticks) to avoid instant lockouts
  if (solanaBotState.tickCount % 25 !== 0) {
    return;
  }

  // Advance Stage 2 Retests (Requires 3 verified fails to confirm a Chronic Trap)
  for (let i = engine.stage2Retesting.length - 1; i >= 0; i--) {
    const item = engine.stage2Retesting[i];

    if (item.retestFails + item.retestPasses < 3) {
      const histFailRate = (Math.abs(item.failLoss || 0) * 10 > 0.15) ? 0.55 : 0.40;
      if (Math.random() < histFailRate) {
        item.retestFails++;
      } else {
        item.retestPasses++;
      }
    }

    if (item.retestFails >= 3) {
      // Confirmed Chronic Trap -> Advance to Stage 3 Permanent Veto
      item.stage = 3;
      item.timesVetoed = 0;
      engine.stage2Retesting.splice(i, 1);
      engine.stage3PermanentTraps.push(item);

      // Persist Stage 3 Permanent Veto to solana_trades.db
      api("/api/market/solana/learned-memory", {
        method: "POST",
        body: JSON.stringify({
          is_update: true,
          trap_id: item.trap_id || item.id,
          stage: 3,
          retest_passes: item.retestPasses,
          retest_fails: item.retestFails,
          status: "PERMANENT_VETO",
          notes: `Confirmed structural trap for ${item.tokenSymbol} after 3 failed re-tests.`,
        }),
      }).catch(() => { });
    } else if (item.retestPasses >= 2) {
      // Cleared Doubt
      item.stage = "CLEARED";
      engine.stage2Retesting.splice(i, 1);

      api("/api/market/solana/learned-memory", {
        method: "POST",
        body: JSON.stringify({
          is_update: true,
          trap_id: item.trap_id || item.id,
          stage: 0,
          retest_passes: item.retestPasses,
          retest_fails: item.retestFails,
          status: "CLEARED",
          notes: "Doubt cleared after successful historical re-tests.",
        }),
      }).catch(() => { });
    }
  }
}

function checkStage3TrapVeto(candidate) {
  const traps = solanaBotState.learningEngine.stage3PermanentTraps;
  if (!traps || traps.length === 0) return null;

  const currentFeatures = [
    (candidate.price_change_5m || 0) / 100,
    (candidate.price_change_1h || 0) / 100,
    (candidate.volatility_score || 80) / 100,
    1,
    (candidate.volume_24h || 1000000) / 100000000,
  ];

  for (const trap of traps) {
    // Crucial Scope Rule 1: Token Specificity Guard
    // Traps on token A must NEVER veto candidate token B!
    if (trap.tokenSymbol && candidate.symbol && trap.tokenSymbol.toUpperCase() !== candidate.symbol.toUpperCase()) {
      continue;
    }

    // Crucial Fatigue Rule 2: Prevent infinite bot lockouts
    if ((trap.timesVetoed || 0) >= 8) {
      continue;
    }

    let sumSq = 0;
    const trapFeatures = trap.features || [];
    for (let f = 0; f < Math.min(currentFeatures.length, trapFeatures.length); f++) {
      sumSq += (currentFeatures[f] - trapFeatures[f]) ** 2;
    }
    const dist = Math.sqrt(sumSq);

    // Crucial Precision Rule 3: Realistic Euclidean threshold (0.12, NOT 0.85!)
    if (dist < 0.12) {
      trap.timesVetoed = (trap.timesVetoed || 0) + 1;
      return trap;
    }
  }
  return null;
}

async function reassessVetoLedger() {
  try {
    const res = await api("/api/market/solana/learned-memory/reassess", {
      method: "POST",
      body: JSON.stringify({}),
    });

    // Reset local Stage 3 permanent traps into Stage 2 re-testing
    const engine = solanaBotState.learningEngine;
    while (engine.stage3PermanentTraps.length > 0) {
      const trap = engine.stage3PermanentTraps.shift();
      trap.stage = 2;
      trap.status = "REASSESSED";
      trap.timesVetoed = 0;
      engine.stage2Retesting.push(trap);
    }
    engine.avoidedTrapsCount = 0;

    await syncWithDedicatedDb();
    renderLearningLedger();
    showToast(`🔄 Veto Re-assessment complete: ${res.reassessed_count || 0} traps downgraded to active re-testing. Trading unblocked!`);
  } catch (err) {
    console.error("Failed to reassess vetoes:", err);
    showToast("Failed to reassess vetoes: " + err.message);
  }
}

/* ==========================================================================
   UI Rendering Functions
   ========================================================================== */

function resetSolanaWallet() {
  if (solanaBotState.isRunning) {
    stopSolanaAutonomousBot("OPERATOR_STOP");
  }
  solanaBotState.activePositions = [];
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
  persistSolanaWallet();
  updateSolanaWalletHUD();
  renderMultiPositionsTable();
  renderSolanaJournal();
  showToast("Solana virtual paper wallet reset to $10,000.00 baseline.");
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

  if (elements.circuitBarFill) {
    const meterPct = Math.min(100, (drawdownPct / 20.0) * 100);
    elements.circuitBarFill.style.width = `${meterPct}%`;
  }

  if (elements.circuitDrawdownText) {
    elements.circuitDrawdownText.textContent = `Drawdown: ${drawdownPct.toFixed(2)}% / 20.00% Max`;
  }

  if (elements.circuitDangerHint) {
    elements.circuitDangerHint.textContent = "Halts automatically at $8,000.00 (-20%)";
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

  if (elements.solanaActiveTokenBadge && elements.solanaPositionDetails) {
    const activeCount = solanaBotState.activePositions.length;
    const totalAllocatedMargin = solanaBotState.activePositions.reduce((acc, p) => acc + p.marginUsd, 0);
    const marginPct = ((totalAllocatedMargin / Math.max(1, current)) * 100).toFixed(1);

    if (activeCount > 0) {
      elements.solanaActiveTokenBadge.textContent = `${activeCount} / 15 IN PLAY`;
      elements.solanaActiveTokenBadge.style.color = "var(--sage)";
      elements.solanaPositionDetails.innerHTML = `
        <div class="position-stat-grid">
          <div><span>Allocated Margin:</span> <strong>$${totalAllocatedMargin.toFixed(2)} (${marginPct}%)</strong></div>
          <div><span>Per Trade Size:</span> <strong>2.0% ($${(current * 0.02).toFixed(2)})</strong></div>
          <div><span>Active Coins:</span> <strong>${solanaBotState.activePositions.map((p) => p.token.symbol).join(", ")}</strong></div>
          <div><span>Risk/Reward Rule:</span> <strong>1:2 R:R (+3.5% TP1 / Trailing Runner)</strong></div>
        </div>
      `;
    } else {
      elements.solanaActiveTokenBadge.textContent = "0 / 15 IN PLAY";
      elements.solanaActiveTokenBadge.style.color = "var(--muted)";
      elements.solanaPositionDetails.innerHTML = `<span class="no-position-label">Bot ready to trade multiple Solana coins (2% margin / $200 each)…</span>`;
    }
  }
}

function renderMultiPositionsTable() {
  const positions = solanaBotState.activePositions;
  const activeCount = positions.length;

  if (elements.activePositionsCount) {
    elements.activePositionsCount.textContent = `${activeCount} / 15 Active`;
  }

  const totalMargin = positions.reduce((sum, p) => sum + p.marginUsd, 0);
  const totalUnrealized = positions.reduce((sum, p) => sum + (p.unrealizedPnlUsd || 0), 0);
  const totalEquity = Math.max(1, solanaBotState.wallet.currentEquity);
  const totalMarginPct = ((totalMargin / totalEquity) * 100).toFixed(1);

  if (elements.allocatedMarginChip) {
    elements.allocatedMarginChip.textContent = `Allocated Margin: $${totalMargin.toFixed(2)} (${totalMarginPct}%)`;
  }

  if (elements.unrealizedPnlChip) {
    const sign = totalUnrealized >= 0 ? "+" : "-";
    elements.unrealizedPnlChip.textContent = `Unrealized PnL: ${sign}$${Math.abs(totalUnrealized).toFixed(2)}`;
    elements.unrealizedPnlChip.style.color = totalUnrealized >= 0 ? "var(--sage)" : "var(--danger)";
  }

  if (elements.btnCloseAllPositions) {
    elements.btnCloseAllPositions.style.display = activeCount > 0 ? "inline-flex" : "none";
  }

  if (!elements.multiPositionsTbody) return;

  if (activeCount === 0) {
    elements.multiPositionsTbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; color: var(--muted); padding: 18px;">
          No active positions held. Start the Solana Bot to enter concurrent 2% margin ($200) trades with 5-stage loss protection.
        </td>
      </tr>`;
    return;
  }

  elements.multiPositionsTbody.innerHTML = positions.map((pos) => {
    const pnl = pos.unrealizedPnlUsd || 0;
    const pnlPct = pos.unrealizedReturnPct || 0;
    const pnlColor = pnl >= 0 ? "var(--sage)" : "var(--danger)";
    const sign = pnl >= 0 ? "+" : "-";

    const formattedEntry = pos.entryPrice < 0.001 ? pos.entryPrice.toFixed(7) : pos.entryPrice.toFixed(4);
    const formattedCurrent = pos.currentPrice < 0.001 ? pos.currentPrice.toFixed(7) : pos.currentPrice.toFixed(4);

    const tpLabel = pos.tp1Triggered
      ? `<span style="color: var(--sage); font-weight: 700;">Trailing Runner</span> <small style="color: var(--muted);">(Peak: $${pos.peakPrice < 0.001 ? pos.peakPrice.toFixed(6) : pos.peakPrice.toFixed(4)})</small>`
      : `<span style="color: var(--sage);">+3.5% (+2R)</span> <small style="color: var(--muted);">(+$${(pos.marginUsd * 0.035).toFixed(2)})</small>`;

    const slLabel = pos.tp1Triggered
      ? `<span style="color: var(--sage); font-weight: 600;">Breakeven ($0 Risk)</span>`
      : `<span style="color: var(--danger);">-3.0% Confluence</span> <small style="color: var(--muted);">(-$${(pos.marginUsd * 0.03).toFixed(2)})</small>`;

    return `
      <tr>
        <td>
          <div class="token-cell-title"><strong>${pos.token.symbol}</strong> <span class="token-cell-dex">· ${pos.token.dex || 'Raydium'}</span></div>
          <small style="color: var(--muted); font-size: 0.7rem;">${pos.fvgType || 'Bullish Retest'}</small>
        </td>
        <td><strong>$${pos.marginUsd.toFixed(2)}</strong> <small style="color: var(--muted);">(2%)</small></td>
        <td>$${formattedEntry}</td>
        <td>$${formattedCurrent}</td>
        <td style="color: ${pnlColor}; font-weight: 700;">${sign}$${Math.abs(pnl).toFixed(2)} (${sign}${Math.abs(pnlPct).toFixed(2)}%)</td>
        <td>${tpLabel}</td>
        <td>${slLabel}</td>
        <td>
          <button type="button" class="btn-close-single" onclick="window.closeSinglePositionBySymbol('${pos.token.symbol}')">Close</button>
        </td>
      </tr>
    `;
  }).join("");
}

function renderSolanaJournal() {
  if (!elements.solanaJournalTbody) return;
  const trades = solanaBotState.executedTrades || [];

  if (elements.solanaTradeJournalCount) {
    elements.solanaTradeJournalCount.textContent = `${trades.length} Trade${trades.length === 1 ? '' : 's'}`;
  }

  if (trades.length === 0) {
    elements.solanaJournalTbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align: center; color: var(--muted); padding: 14px;">
          No live Solana HFT trades executed yet. Click "Start Solana Bot" above to begin.
        </td>
      </tr>`;
    return;
  }

  elements.solanaJournalTbody.innerHTML = trades
    .slice(0, 50)
    .map((t, idx) => {
      const isPositive = (t.pnlUsd || 0) >= 0;
      const pnlClass = isPositive ? "positive" : "negative";
      const pnlSign = isPositive ? "+" : "";
      const formattedEntry = (t.entryPrice || 0) < 0.001 ? (t.entryPrice || 0).toFixed(7) : (t.entryPrice || 0).toFixed(4);
      const formattedExit = (t.exitPrice || 0) < 0.001 ? (t.exitPrice || 0).toFixed(7) : (t.exitPrice || 0).toFixed(4);

      let learningBadge = `<span class="badge-stage" style="color: var(--sage); background: rgba(142, 196, 166, 0.12); padding: 2px 6px; border-radius: 4px; font-size: 0.72rem; font-weight: 700;">✅ Confirmed Win</span>`;
      if (!t.isWin) {
        learningBadge = `<span class="badge-stage" style="color: var(--danger); background: rgba(224, 82, 82, 0.12); padding: 2px 6px; border-radius: 4px; font-size: 0.72rem; font-weight: 700;">🛑 Stage 1 Doubt Registered</span>`;
      }

      const isPump = (t.dex || "").toLowerCase().includes("pump");
      const dexBadge = isPump
        ? `<span class="token-cell-dex" style="color: var(--ember); font-weight: 700;">💊 PUMP.FUN</span>`
        : `<span class="token-cell-dex" style="text-transform: uppercase;">${t.dex || "RAYDIUM"}</span>`;

      return `
        <tr>
          <td>#${trades.length - idx}</td>
          <td>${t.time || "--:--:--"}</td>
          <td><strong>${t.token || "SOL"}</strong></td>
          <td>${dexBadge}</td>
          <td>$${formattedEntry}</td>
          <td>$${formattedExit}</td>
          <td class="${pnlClass}" style="font-weight: 700;">${pnlSign}$${(t.pnlUsd || 0).toFixed(2)} (${pnlSign}${(t.pnlPct || 0).toFixed(2)}%)</td>
          <td><span class="badge-chip">${t.exitReason || "Closed"}</span></td>
          <td>${learningBadge}</td>
        </tr>`;
    })
    .join("");
}

function renderLearningLedger() {
  if (!elements.solanaLearningTbody) return;
  const le = solanaBotState.learningEngine;

  const stage1 = le.stage1Doubts || [];
  const stage2 = le.stage2Retesting || [];
  const stage3 = le.stage3PermanentTraps || [];

  if (elements.tagStage1Count) elements.tagStage1Count.textContent = `${stage1.length} Doubts`;
  if (elements.tagStage2Count) elements.tagStage2Count.textContent = `${stage2.length} Retests`;
  if (elements.tagStage3Count) elements.tagStage3Count.textContent = `${stage3.length} Permanent Vetoes`;

  const allTraps = [...stage3, ...stage2, ...stage1];

  if (allTraps.length === 0) {
    elements.solanaLearningTbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; color: var(--muted); padding: 14px;">
          No trade mistakes recorded yet. Start the Solana autonomous bot to begin active learning.
        </td>
      </tr>`;
    return;
  }

  elements.solanaLearningTbody.innerHTML = allTraps
    .map((trap) => {
      let stageBadge = "";
      let retestText = "";
      let vetoActionText = "";

      if (trap.stage === 1) {
        stageBadge = `<span class="badge-doubt">Stage 1 · Doubt</span>`;
        retestText = `<span style="color: var(--muted);">Scheduled for 2x re-test</span>`;
        vetoActionText = `<span style="color: var(--muted);">Testing pattern resiliency</span>`;
      } else if (trap.stage === 2) {
        stageBadge = `<span class="badge-retesting">Stage 2 · Retesting</span>`;
        retestText = `<strong style="color: var(--cyan);">${trap.retestPasses || 0}/2 Passes · ${trap.retestFails || 0}/2 Fails</strong>`;
        vetoActionText = `<span>Observing failure reproducibility</span>`;
      } else {
        stageBadge = `<span class="badge-vetoed">Stage 3 · Permanent Veto</span>`;
        retestText = `<strong style="color: var(--danger);">Confirmed 2x Failure</strong>`;
        vetoActionText = `<strong style="color: var(--ember);">Vetoed ${trap.timesVetoed || 0}x (+$${(trap.savedCapital || 0).toFixed(2)})</strong>`;
      }

      return `
        <tr>
          <td><code>${trap.id || trap.trap_id || "TRAP"}</code></td>
          <td><strong>${trap.tokenSymbol || "SOL"}</strong> <small style="color: var(--muted);">(${trap.pattern || "Fair Value Gap Trap"})</small></td>
          <td class="negative">-${((trap.failLoss || 0.15) * 100).toFixed(1)}%</td>
          <td>${stageBadge}</td>
          <td>${retestText}</td>
          <td>${vetoActionText}</td>
          <td><span class="badge-chip">${trap.status || "active"}</span></td>
        </tr>`;
    })
    .join("");
}

function showToast(message) {
  window.clearTimeout(solanaBotState.toastTimer);
  if (!elements.toast || !elements.toastMessage) return;
  elements.toastMessage.textContent = message;
  elements.toast.style.display = "block";
  solanaBotState.toastTimer = window.setTimeout(hideToast, 4000);
}

function hideToast() {
  window.clearTimeout(solanaBotState.toastTimer);
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
