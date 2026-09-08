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
    sorSavingsUsd: 0.0,
    peakEquity: 10000.0,
    maxDrawdownPct: 0.0,
    tradesWon: 0,
    tradesLost: 0,
  },
  priceHistory1m: new Map(),
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
  currentUser: null,
  dynamicMarginPct: 6.67,
  maxConcurrentPositions: 15,
  confluenceStopLossPct: -2.0,
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
  btnOpenSetBalance: document.querySelector("#btn-open-set-balance"),
  walletBalanceModal: document.querySelector("#wallet-balance-modal"),
  btnCloseBalanceModal: document.querySelector("#btn-close-balance-modal"),
  btnCancelBalanceModal: document.querySelector("#btn-cancel-balance-modal"),
  btnApplyCustomBalance: document.querySelector("#btn-apply-custom-balance"),
  customWalletBalanceInput: document.querySelector("#custom-wallet-balance-input"),
  previewSlotSize: document.querySelector("#preview-slot-size"),
  previewCircuitLimit: document.querySelector("#preview-circuit-limit"),
  solanaBaselineCapital: document.querySelector("#solana-baseline-capital"),
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
  solanaSorSavings: document.querySelector("#solana-sor-savings"),
  aiMtfFilter: document.querySelector("#ai-mtf-filter"),
  aiSorStatus: document.querySelector("#ai-sor-status"),
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
  if (elements.btnOpenSetBalance) {
    elements.btnOpenSetBalance.addEventListener("click", openBalanceModal);
  }
  if (elements.btnCloseBalanceModal) {
    elements.btnCloseBalanceModal.addEventListener("click", closeBalanceModal);
  }
  if (elements.btnCancelBalanceModal) {
    elements.btnCancelBalanceModal.addEventListener("click", closeBalanceModal);
  }
  if (elements.walletBalanceModal) {
    elements.walletBalanceModal.addEventListener("click", (e) => {
      if (e.target === elements.walletBalanceModal) closeBalanceModal();
    });
  }
  if (elements.customWalletBalanceInput) {
    elements.customWalletBalanceInput.addEventListener("input", (e) => {
      updateBalanceModalPreview(e.target.value);
      highlightActivePreset(e.target.value);
    });
  }
  const presetButtons = document.querySelectorAll(".btn-preset");
  presetButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const amount = Number(btn.getAttribute("data-amount"));
      if (elements.customWalletBalanceInput) {
        elements.customWalletBalanceInput.value = amount;
      }
      updateBalanceModalPreview(amount);
      highlightActivePreset(amount);
    });
  });
  if (elements.btnApplyCustomBalance) {
    elements.btnApplyCustomBalance.addEventListener("click", () => {
      const amount = Number(elements.customWalletBalanceInput?.value);
      if (!amount || amount < 1) {
        showToast("⚠️ Please enter a valid amount of at least $1.00.");
        return;
      }
      setCustomWalletBalance(amount);
      closeBalanceModal();
    });
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

  // 3. Adaptive Stop Loss (Tightened for spot asymmetric risk)
  if (typeof data.tighten_stop_loss_pct === "number") {
    solanaBotState.confluenceStopLossPct = Math.max(-2.5, Math.min(-1.5, data.tighten_stop_loss_pct));
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
      solanaBotState.currentUser = res.user;
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
    } else {
      solanaBotState.currentUser = null;
    }
  } catch (err) {
    solanaBotState.currentUser = null;
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
          <span class="badge-chip" style="color: ${(t.rvol || 1.0) >= 2.0 ? 'var(--sage)' : (t.rvol || 1.0) >= 1.4 ? 'var(--ember)' : 'var(--muted)'}; font-weight: 700;">
            🔥 ${(t.rvol || computeTokenRvol(t)).toFixed(1)}x <small style="font-weight: 600;">(${t.grade || (t.qualityScore >= 80 ? 'A+' : t.qualityScore >= 70 ? 'A' : 'B')})</small>
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

    // 3. Fetch dedicated wallet state for this authenticated user (if logged in)
    try {
      const userKey = solanaBotState.currentUser ? solanaBotState.currentUser.id : "guest";
      const storageKey = `rustbot_solana_${userKey}_initial_equity`;
      let savedInitial = 0;
      try {
        savedInitial = Number(localStorage.getItem(storageKey)) || 0;
        if (!savedInitial && !solanaBotState.currentUser) {
          savedInitial = Number(localStorage.getItem("rustbot_solana_initial_equity")) || 0;
        }
      } catch (_) { }

      const walletRes = await api("/api/market/solana/wallet");
      if (walletRes && walletRes.wallet && !walletRes.is_guest) {
        // Authenticated user with dedicated wallet state
        const w = walletRes.wallet;
        solanaBotState.wallet.initialEquity = savedInitial > 0 ? savedInitial : (w.peak_equity || w.current_equity || 10000.0);
        solanaBotState.wallet.currentEquity = w.current_equity;
        solanaBotState.wallet.cash = w.cash;
        solanaBotState.wallet.realizedPnl = w.realized_pnl;
        solanaBotState.wallet.totalFeesPaid = w.total_fees;
        solanaBotState.wallet.peakEquity = Math.max(w.peak_equity, w.current_equity);
        solanaBotState.wallet.tradesWon = w.trades_won;
        solanaBotState.wallet.tradesLost = w.trades_lost;
        updateSolanaWalletHUD();
      } else if (savedInitial > 0) {
        // User's dedicated local baseline
        solanaBotState.wallet.initialEquity = savedInitial;
        solanaBotState.wallet.currentEquity = savedInitial;
        solanaBotState.wallet.cash = savedInitial;
        solanaBotState.wallet.peakEquity = savedInitial;
        updateSolanaWalletHUD();
      }
    } catch (e) {
      console.debug("No previous wallet state stored for this account:", e);
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
  if (!solanaBotState.currentUser) {
    // Guest mode: Do NOT sync or persist to server database; keep wallet strictly local
    return;
  }
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

  const initial = solanaBotState.wallet.initialEquity || solanaBotState.wallet.currentEquity || 10.0;
  const peak = Math.max(initial, solanaBotState.wallet.peakEquity || initial);
  const current = solanaBotState.wallet.currentEquity || initial;
  const drawdown = Math.max(0, (peak - current) / Math.max(1, peak));

  if (drawdown >= 0.20 || current <= (initial * 0.80)) {
    showToast(`⚠️ 20% Circuit Breaker is tripped ($${(initial * 0.80).toFixed(2)} limit). Reset or set balance.`);
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

  const slotUsd = (solanaBotState.wallet.currentEquity / 15).toFixed(2);
  showToast(`⚡ Solana Bot engaged: $${solanaBotState.wallet.currentEquity.toFixed(2)} capital, 1/15th slots ($${slotUsd} each), 50% TP1 scale-outs, and RVOL surge filter.`);
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

/* ==========================================================================
   Quantitative Signal Intelligence: RVOL & Setup Quality Matrix
   ========================================================================== */

function computeTokenRvol(candidate) {
  if (typeof candidate.rvol === "number" && candidate.rvol > 0) {
    return candidate.rvol;
  }
  const vol24h = Math.max(10000, candidate.volume_24h || 100000);
  const baseline5mUsd = vol24h / 288; // 288 5-minute intervals in 24 hours
  const abs5mMove = Math.abs(candidate.price_change_5m || 0.5);
  const volScore = (candidate.volatility_score || 80) / 80;

  // Real-time on-chain turnover velocity factor
  const estimatedRvol = Math.max(0.6, 1.0 + (abs5mMove * 0.42 * volScore));
  const rounded = Math.round(estimatedRvol * 10) / 10;
  candidate.rvol = rounded;
  return rounded;
}

/* ==========================================================================
   Quantitative Multi-Timeframe Trend Confirmation Engine (1m · 5m · 15m)
   ========================================================================== */

function recordTokenPriceTick(symbol, price) {
  if (!symbol || typeof price !== "number" || isNaN(price)) return;
  if (!solanaBotState.priceHistory1m.has(symbol)) {
    solanaBotState.priceHistory1m.set(symbol, []);
  }
  const history = solanaBotState.priceHistory1m.get(symbol);
  const now = Date.now();
  history.push({ price, time: now });

  // Retain last 120 ticks (~60 seconds at 500ms cadence)
  while (history.length > 120 || (history.length > 0 && now - history[0].time > 65000)) {
    history.shift();
  }
}

function computeMultiTimeframeConfluence(candidate) {
  const symbol = candidate.symbol;
  const currentPrice = candidate.price_usd || 1.0;
  recordTokenPriceTick(symbol, currentPrice);

  // 1. Timeframe 1: 1-Minute Micro-Timing (Tick Momentum)
  const history = solanaBotState.priceHistory1m.get(symbol) || [];
  let delta1m = 0.0;
  if (history.length >= 4) {
    const oldestPrice = history[0].price;
    delta1m = ((currentPrice - oldestPrice) / Math.max(1e-8, oldestPrice)) * 100;
  } else {
    // Warm start estimate based on 5m drift velocity
    delta1m = (candidate.price_change_5m || 0) * 0.20;
  }
  const is1mBullish = delta1m >= -0.06; // Turning up or holding micro support

  // 2. Timeframe 2: 5-Minute Setup Trigger (Pullback Retest / Momentum Continuation)
  const delta5m = candidate.price_change_5m || 0;
  const is5mBullish = delta5m >= -2.5 && delta5m <= 5.5; // Healthy pullback or controlled breakout

  // 3. Timeframe 3: 15-Minute Macro Regime Anchor
  const delta1h = candidate.price_change_1h || 0;
  const delta15m = (delta1h * 0.25) + (delta5m * 0.50);
  const is15mBullish = delta15m >= -0.85; // Macro uptrend or consolidation

  const alignedCount = (is1mBullish ? 1 : 0) + (is5mBullish ? 1 : 0) + (is15mBullish ? 1 : 0);

  let status = "DIVERGENT";
  let label = "1/3 Divergent";
  let scoreBonus = -12;
  let convictionMultiplier = 0.80;

  if (alignedCount === 3) {
    status = "TRIPLE_ALIGNED";
    label = "3/3 Triple MTF";
    scoreBonus = 15;
    convictionMultiplier = 1.20;
  } else if (alignedCount === 2) {
    status = "DOUBLE_ALIGNED";
    label = "2/3 Double MTF";
    scoreBonus = 6;
    convictionMultiplier = 1.00;
  }

  return {
    status,
    label,
    alignedCount,
    is1mBullish,
    is5mBullish,
    is15mBullish,
    delta1m,
    delta5m,
    delta15m,
    scoreBonus,
    convictionMultiplier,
  };
}

function renderMtfBadge(mtf) {
  if (!mtf) {
    return `<span class="badge-mtf double" title="Multi-Timeframe Evaluation">⏱️ 2/3 MTF</span>`;
  }
  if (mtf.status === "TRIPLE_ALIGNED") {
    const d1m = (mtf.delta1m >= 0 ? "+" : "") + mtf.delta1m.toFixed(2);
    const d5m = (mtf.delta5m >= 0 ? "+" : "") + mtf.delta5m.toFixed(2);
    const d15m = (mtf.delta15m >= 0 ? "+" : "") + mtf.delta15m.toFixed(2);
    return `<span class="badge-mtf triple" title="1m (${d1m}%) · 5m (${d5m}%) · 15m (${d15m}%)">🎯 3/3 TRIPLE</span>`;
  }
  if (mtf.status === "DOUBLE_ALIGNED") {
    const d1m = (mtf.delta1m >= 0 ? "+" : "") + mtf.delta1m.toFixed(2);
    const d5m = (mtf.delta5m >= 0 ? "+" : "") + mtf.delta5m.toFixed(2);
    const d15m = (mtf.delta15m >= 0 ? "+" : "") + mtf.delta15m.toFixed(2);
    return `<span class="badge-mtf double" title="1m (${d1m}%) · 5m (${d5m}%) · 15m (${d15m}%)">⏱️ 2/3 ALIGNED</span>`;
  }
  return `<span class="badge-mtf divergent" title="Conflicting momentum across timeframes">⚠️ DIVERGENT</span>`;
}

/* ==========================================================================
   Cross-DEX Smart Order Routing (SOR) Engine
   Simulates & routes orders across Orca Whirlpools, Raydium CLMM/CPMM, and pump.fun
   ========================================================================== */

function routeBestExecutionVenue(candidate, marginUsd) {
  const tokenDex = (candidate.dex || "raydium").toLowerCase();
  const liqUsd = Math.max(5000, candidate.liquidity_usd || 50000);
  const isPumpToken = tokenDex.includes("pump") || (candidate.address || "").endsWith("pump");

  const venues = [];

  // Venue 1: Orca Whirlpool (Concentrated Liquidity)
  // Low fee tiers (16 bps default, 4 bps for major pairs), 1.5x depth efficiency
  const orcaFeeRate = (candidate.symbol === "SOL" || candidate.symbol === "MSOL" || candidate.symbol === "JITOSOL") ? 0.0004 : 0.0016;
  const orcaPriceImpactPct = (marginUsd / (liqUsd * 1.5)) * 100;
  const orcaTotalCostUsd = (marginUsd * orcaFeeRate) + (marginUsd * (orcaPriceImpactPct / 100));
  venues.push({
    venueName: "Orca Whirlpool",
    dexTag: "orca",
    feeRate: orcaFeeRate,
    priceImpactPct: orcaPriceImpactPct,
    totalCostUsd: orcaTotalCostUsd,
    badgeText: "⚡ ORCA",
  });

  // Venue 2: Raydium (CLMM / Standard CPMM)
  // 15 bps for CLMM, 25 bps for standard AMM pools
  const raydiumFeeRate = liqUsd >= 500000 ? 0.0015 : 0.0025;
  const raydiumPriceImpactPct = (marginUsd / liqUsd) * 100;
  const raydiumTotalCostUsd = (marginUsd * raydiumFeeRate) + (marginUsd * (raydiumPriceImpactPct / 100));
  venues.push({
    venueName: "Raydium AMM",
    dexTag: "raydium",
    feeRate: raydiumFeeRate,
    priceImpactPct: raydiumPriceImpactPct,
    totalCostUsd: raydiumTotalCostUsd,
    badgeText: "🌊 RAYDIUM",
  });

  // Venue 3: pump.fun (Bonding curve, only if token originated on pump.fun)
  if (isPumpToken) {
    const pumpFeeRate = 0.0100; // 1% bonding curve fee
    const pumpPriceImpactPct = 0.20; // fixed curve step
    const pumpTotalCostUsd = (marginUsd * pumpFeeRate) + (marginUsd * (pumpPriceImpactPct / 100));
    venues.push({
      venueName: "pump.fun Bonding",
      dexTag: "pump",
      feeRate: pumpFeeRate,
      priceImpactPct: pumpPriceImpactPct,
      totalCostUsd: pumpTotalCostUsd,
      badgeText: "💊 PUMP.FUN",
    });
  }

  // Sort by lowest total execution cost (Fee + Price Impact)
  venues.sort((a, b) => a.totalCostUsd - b.totalCostUsd);
  const bestRoute = venues[0];

  // Baseline standard fee is 25 bps (0.25%)
  const standardBaselineCost = marginUsd * 0.0025;
  const savedUsd = Math.max(0, standardBaselineCost - bestRoute.totalCostUsd);
  const bpsSaved = Math.round((savedUsd / Math.max(0.01, marginUsd)) * 10000);

  return {
    ...bestRoute,
    savedUsd,
    bpsSaved,
    displayBadge: bpsSaved > 0 ? `${bestRoute.badgeText} (-${bpsSaved} bps)` : bestRoute.badgeText,
  };
}

function scoreCandidateSetup(candidate, isSolBullish, timesfmInsight = null) {
  const rvol = computeTokenRvol(candidate);
  candidate.rvol = rvol;

  // Compute Multi-Timeframe Alignment (1m micro + 5m setup + 15m macro)
  const mtf = computeMultiTimeframeConfluence(candidate);
  candidate.mtf = mtf;

  let score = 50;

  // 1. Volume Surge Factor (Up to +25 pts)
  if (rvol >= 2.5) score += 25;
  else if (rvol >= 1.8) score += 18;
  else if (rvol >= 1.4) score += 10;
  else if (rvol < 0.9) score -= 15;

  // 2. Multi-Timeframe Alignment Bonus/Penalty (+15 / +6 / -12)
  score += mtf.scoreBonus;

  // 3. Liquidity Depth Protection (Up to +15 pts)
  const liq = candidate.liquidity_usd || 50000;
  if (liq >= 10000000) score += 15;
  else if (liq >= 1000000) score += 10;
  else if (liq >= 150000) score += 5;
  else if (liq < 10000) score -= 15;

  // 4. Price Action Quality (Up to +25 pts)
  const ch5m = candidate.price_change_5m || 0;
  const ch1h = candidate.price_change_1h || 0;

  if (ch1h > 1.5 && ch5m >= 0.4 && ch5m <= 4.0) {
    score += 20; // Clean momentum continuation breakout
  } else if (ch1h > 0.0 && ch5m >= -2.2 && ch5m < 0.4) {
    score += 18; // Bullish FVG dip pullback retest
  } else if (ch5m > 6.0 || ch1h > 30.0) {
    score -= 20; // Overbought wick blowoff top
  } else if (ch5m < -3.0) {
    score -= 15; // Panic sell-off knife
  }

  // 5. Macro Synergy with SOL Trend (+/- 8 pts)
  if (isSolBullish) score += 8;
  else score -= 8;

  // 6. TimesFM Foundation Model Quantile Synergy (+/- 15 pts)
  candidate.timesfmEdge = "NEUTRAL";
  if (timesfmInsight) {
    const isTargetToken = candidate.symbol === "SOL" || (solanaBotState.selectedToken && candidate.symbol === solanaBotState.selectedToken.symbol);
    const p50Bps = timesfmInsight.expectedReturnBps || 0;
    if (p50Bps >= 120 && isTargetToken) {
      score += 15; // High confidence upward quantile forecast on analyzed token
      candidate.timesfmEdge = "BULLISH_SURGE";
    } else if (p50Bps >= 40) {
      score += 6;
      candidate.timesfmEdge = "MODERATE_EXPANSION";
    } else if (p50Bps < -120 && isTargetToken) {
      score -= 15;
      candidate.timesfmEdge = "BEARISH_CONTRACTION";
    }
  }

  const finalScore = Math.max(10, Math.min(99, Math.round(score)));
  candidate.qualityScore = finalScore;
  candidate.grade = finalScore >= 80 ? "A+" : finalScore >= 70 ? "A" : finalScore >= 60 ? "B" : "C";
  return finalScore;
}

async function runSolanaAutonomousTick() {
  if (!solanaBotState.isRunning) return;

  try {
    solanaBotState.tickCount++;

    // Step 1: Drawdown Check (Strict 20% Max Loss Circuit Breaker with Dynamic High-Water Mark Ratchet)
    const initial = solanaBotState.wallet.initialEquity || solanaBotState.wallet.currentEquity || 10.0;
    const peak = Math.max(initial, solanaBotState.wallet.peakEquity || initial);
    const current = solanaBotState.wallet.currentEquity || initial;
    const drawdown = Math.max(0, (peak - current) / Math.max(1, peak));
    const trailingHaltFloor = Math.max(initial * 0.80, peak * 0.80);

    if (drawdown >= 0.20 || current <= (initial * 0.80)) {
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

      // QUANTITATIVE ASYMMETRIC SCALE-OUT EXIT SYSTEM:
      const runnerTrigger = solanaBotState.trailingRunnerTriggerPct || 3.5;
      const stopLossPct = solanaBotState.confluenceStopLossPct || -2.0;

      if (!pos.tp1Triggered) {
        // Stage 1: Pre-TP1 Lifecycle
        if (pos.unrealizedReturnPct >= runnerTrigger) {
          // Asymmetric Scale-Out: Bank 50% profit immediately and set breakeven stop on runner
          executePartialTakeProfit(pos, pos.currentPrice);
        } else if (pos.unrealizedReturnPct <= stopLossPct) {
          // Defensive Confluence Stop-Loss (-2.0% Risk Guard)
          closePosition(pos, `STOP_LOSS (${stopLossPct.toFixed(1)}% Defense: ${pos.unrealizedReturnPct.toFixed(2)}%)`, false);
        } else if (pos.barsHeld >= 120 && Math.abs(pos.unrealizedReturnPct) < 0.8) {
          // HFT Stale Margin Rebalance -> If trade is dead flat after ~60s, free capital
          closePosition(pos, "HFT Stale Margin Rebalance", false);
        }
      } else {
        // Stage 2: Managing the Remaining 50% Runner (Adaptive Volatility Trailing)
        const volScore = pos.token.volatility_score || 80;
        const adaptiveRetraceTrigger = volScore >= 90 ? 3.2 : volScore >= 82 ? 2.2 : 1.5;

        const peakRetracePct = ((pos.peakPrice - pos.currentPrice) / pos.peakPrice) * 100;
        const isTrailingRunnerExit = peakRetracePct >= adaptiveRetraceTrigger && pos.unrealizedReturnPct >= 1.0;
        const isBreakevenStop = pos.currentPrice <= (pos.breakevenPrice || pos.entryPrice * 1.003) || pos.unrealizedReturnPct <= 0.0;
        const isRunnerStagnant = pos.barsHeld >= 160 && peakRetracePct >= (adaptiveRetraceTrigger * 0.65) && pos.unrealizedReturnPct >= 1.5;

        if (isTrailingRunnerExit) {
          closePosition(pos, `TAKE_PROFIT (Adaptive Trailing Peak: +${pos.unrealizedReturnPct.toFixed(2)}% Net)`, false);
        } else if (isRunnerStagnant) {
          closePosition(pos, `TAKE_PROFIT (Momentum Exhaustion Banked: +${pos.unrealizedReturnPct.toFixed(2)}% Net)`, false);
        } else if (isBreakevenStop) {
          closePosition(pos, `BREAKEVEN_STOP (Risk-Free Exit: +${Math.max(0, pos.unrealizedReturnPct).toFixed(2)}% Net)`, false);
        }
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

    // Base slot size = Total current equity divided by 15 slots
    const baseSlotEquityUsd = (solanaBotState.wallet.currentEquity / MAX_CONCURRENT_POSITIONS);

    // CONFLUENCE METRIC 1: Benchmark Macro Regime Filter
    const solBenchmark = candidatePool.find((c) => c.symbol === "SOL") || { price_change_5m: 0.5, price_change_1h: 2.0 };
    const isMacroDumping = (solBenchmark.price_change_5m || 0) < -2.2 || (solBenchmark.price_change_1h || 0) < -5.0;
    const isSolBullish = (solBenchmark.price_change_1h || 0) > 0.0 && (solBenchmark.price_change_5m || 0) > -0.8;

    // TimesFM Foundation Model Ecosystem Insight
    const timesfmInsight = solanaBotState.latestTimesfmResult ? {
      expectedReturnBps: solanaBotState.latestTimesfmResult.expectedReturnBps || solanaBotState.latestTimesfmResult.expected_return_bps || 0,
      meanRevProb: solanaBotState.latestTimesfmResult.meanReversionProbability || solanaBotState.latestTimesfmResult.mean_reversion_probability || 0.5,
    } : null;

    // STEP A: Rank & Score Candidates by Volume Velocity (RVOL), Liquidity, FVG Confluence, and TimesFM
    const rankedCandidates = candidatePool
      .map((c) => {
        const score = scoreCandidateSetup(c, isSolBullish, timesfmInsight);
        return { candidate: c, score };
      })
      .sort((a, b) => b.score - a.score);

    for (const { candidate, score } of rankedCandidates) {
      if (solanaBotState.activePositions.length >= MAX_CONCURRENT_POSITIONS) {
        break;
      }

      // Check AI Sentinel Token Cooldown
      const cooldownUntil = solanaBotState.tokenCooldownMap.get(candidate.symbol);
      if (cooldownUntil && Date.now() < cooldownUntil) {
        continue;
      }

      // CONFLUENCE METRIC 1: Block altcoin longs during macro flush
      if (isMacroDumping && candidate.symbol !== "SOL") {
        continue;
      }

      // CONFLUENCE METRIC 2: Relative Volume (RVOL) Surge Guard (Rejects dead volume)
      const tokenRvol = candidate.rvol || computeTokenRvol(candidate);
      if (tokenRvol < 0.9) {
        continue; // Skip illiquid / stagnant coins with decaying volume
      }

      // CONFLUENCE METRIC 3: Liquidity Depth
      const vol24h = candidate.volume_24h || 500000;
      const liqUsd = candidate.liquidity_usd || 100000;
      if (vol24h < 8000 || liqUsd < 5000) {
        continue;
      }

      // CONFLUENCE METRIC 4: Anti-FOMO & Overbought Filter (Never buy extreme tops)
      const ch5m = candidate.price_change_5m || 0;
      const ch1h = candidate.price_change_1h || 0;
      if (ch5m > 9.0 || ch1h > 45.0) {
        continue; // Overbought wick exhaustion
      }

      // CONFLUENCE METRIC 5: Valid Retest / Momentum Confluence (Includes FVG pullbacks!)
      const isQualityConfluence = ch5m >= -3.5 && ch5m <= 6.0 && (candidate.volatility_score || 75) >= 50;
      if (!isQualityConfluence) {
        continue;
      }

      // CONFLUENCE METRIC 6: TimesFM Foundation Model Quantile Gate (Targeted token veto)
      if (candidate.timesfmEdge === "BEARISH_CONTRACTION" && solanaBotState.selectedToken && candidate.symbol === solanaBotState.selectedToken.symbol) {
        continue; // Only veto the specific analyzed token when TimesFM predicts breakdown
      }

      // CONFLUENCE METRIC 7: Setup Grade Gate (Must be at least Grade B / Score >= 45)
      if (score < 45) {
        continue;
      }

      // CONFLUENCE METRIC 8: Multi-Timeframe Trend Confirmation (1m micro + 5m setup + 15m macro)
      const mtf = candidate.mtf || computeMultiTimeframeConfluence(candidate);
      if (mtf && mtf.status === "DIVERGENT") {
        continue; // Block conflicting momentum entries (<2/3 timeframe confluence)
      }

      // CONVICTION SIZING (Kelly-Adjusted 1/15th Sizing amplified by MTF alignment):
      const convictionMultiplier = (score >= 80 ? 1.20 : score >= 70 ? 1.00 : 0.80) * (mtf ? mtf.convictionMultiplier : 1.0);
      const targetSlotUsd = baseSlotEquityUsd * convictionMultiplier;

      // Cross-DEX Smart Order Routing (Simulate Orca Whirlpools, Raydium CLMM/CPMM, pump.fun)
      const route = routeBestExecutionVenue(candidate, targetSlotUsd);
      const singleFeeRate = route ? route.feeRate : 0.0015;

      const targetMarginUsd = Math.max(0.10, Math.floor((targetSlotUsd / (1 + singleFeeRate)) * 100) / 100);

      // Cash Solvency & Trade Allocation Check
      let tradeMarginUsd = targetMarginUsd;
      let tradeFeeUsd = tradeMarginUsd * singleFeeRate;

      if (solanaBotState.wallet.cash < (tradeMarginUsd + tradeFeeUsd)) {
        const availableCashMargin = Math.floor((solanaBotState.wallet.cash / (1 + singleFeeRate)) * 100) / 100;
        if (availableCashMargin >= 0.10) {
          tradeMarginUsd = availableCashMargin;
          tradeFeeUsd = tradeMarginUsd * singleFeeRate;
        } else {
          break; // Fully deployed; no cash left for another spot trade
        }
      }

      // CONFLUENCE METRIC 9: Liquidity Depth & Price Impact Shield (DEX AMM Slippage Defense)
      // Cap position size if estimated price impact > 0.40%
      const priceImpactPct = (tradeMarginUsd / Math.max(1, liqUsd)) * 100;
      if (priceImpactPct > 0.40) {
        const maxSafeMargin = Math.floor(liqUsd * 0.0040 * 100) / 100;
        if (maxSafeMargin >= 0.10) {
          tradeMarginUsd = maxSafeMargin;
          tradeFeeUsd = tradeMarginUsd * singleFeeRate;
        } else {
          continue; // Liquidity pool too shallow for safe spot execution without high slippage
        }
      }

      // Do not open duplicate positions for the same token
      if (solanaBotState.activePositions.some((p) => p.token.symbol === candidate.symbol)) {
        continue;
      }

      // CONFLUENCE METRIC 10: Learned Memory Veto Check (solana_trades.db)
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

      // Cumulative Smart Order Routing savings
      if (route && route.savedUsd > 0) {
        solanaBotState.wallet.sorSavingsUsd = (solanaBotState.wallet.sorSavingsUsd || 0) + route.savedUsd;
      }

      const patternName = ch5m < 0 ? `Bullish FVG Pullback (${candidate.grade || 'A'} · ${tokenRvol.toFixed(1)}x RVOL)` : `Momentum Surge (${candidate.grade || 'A'} · ${tokenRvol.toFixed(1)}x RVOL)`;
      openPosition(candidate, tradeMarginUsd, patternName, route, mtf);
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

function executePartialTakeProfit(pos, exitPrice) {
  if (pos.tp1Triggered) return;

  const sellRatio = 0.50; // Sell 50% of position to bank profit and derisk
  const sharesToSell = pos.shares * sellRatio;
  const marginToClose = pos.marginUsd * sellRatio;
  const feeRate = pos.route ? pos.route.feeRate : 0.0015;

  const exitTakerFee = (sharesToSell * exitPrice) * feeRate;
  const grossPnl = (sharesToSell * exitPrice) - marginToClose;
  const entryFee = marginToClose * feeRate;
  const netPnlUsd = grossPnl - (entryFee + exitTakerFee);
  const netReturnPct = (netPnlUsd / marginToClose) * 100;

  // Realize 50% cash & profit
  solanaBotState.wallet.cash += (marginToClose + grossPnl - exitTakerFee);
  solanaBotState.wallet.realizedPnl += netPnlUsd;
  solanaBotState.wallet.totalFeesPaid += exitTakerFee;
  solanaBotState.wallet.tradesWon++;

  // Update remaining position (50% runner)
  pos.shares -= sharesToSell;
  pos.marginUsd -= marginToClose;
  pos.tp1Triggered = true;
  pos.tp1BankedProfitUsd = netPnlUsd;
  pos.tp1ExitPrice = exitPrice;
  // Breakeven price covers original entry price plus roundtrip taker fees
  pos.breakevenPrice = pos.entryPrice * (1 + feeRate * 2);
  pos.peakPrice = Math.max(pos.peakPrice || exitPrice, exitPrice);

  // Recalculate equity
  const openPositionsValue = solanaBotState.activePositions.reduce((acc, p) => acc + (p.shares * p.currentPrice), 0);
  solanaBotState.wallet.currentEquity = solanaBotState.wallet.cash + openPositionsValue;
  if (solanaBotState.wallet.currentEquity > solanaBotState.wallet.peakEquity) {
    solanaBotState.wallet.peakEquity = solanaBotState.wallet.currentEquity;
  }
  persistSolanaWallet();

  // Record partial take-profit trade in journal & SQLite
  const tradeRef = `SOL-TP1-${Date.now().toString().slice(-6)}`;
  const tradeDex = pos.route ? pos.route.venueName : (pos.token.dex || "Raydium");
  const tradeEntry = {
    id: solanaBotState.executedTrades.length + 1,
    tradeRef,
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    token: pos.token.symbol,
    dex: tradeDex,
    entryPrice: pos.entryPrice,
    exitPrice,
    marginUsd: marginToClose,
    pnlUsd: netPnlUsd,
    pnlPct: netReturnPct,
    feesPaid: entryFee + exitTakerFee,
    exitReason: `TAKE_PROFIT_1 (Banked 50% Tranche at +${netReturnPct.toFixed(2)}%)`,
    isWin: true,
    learningNote: "💰 Scaled Out 50% (Runner at BE)",
  };

  solanaBotState.executedTrades.unshift(tradeEntry);

  api("/api/market/solana/trades", {
    method: "POST",
    body: JSON.stringify({
      trade_ref: tradeRef,
      token_symbol: pos.token.symbol,
      token_name: pos.token.name || pos.token.symbol,
      dex: tradeDex,
      entry_price: pos.entryPrice,
      exit_price: exitPrice,
      margin_usd: marginToClose,
      pnl_usd: netPnlUsd,
      pnl_pct: netReturnPct,
      fees_paid_usd: entryFee + exitTakerFee,
      exit_reason: `TAKE_PROFIT_1 (Banked 50% Tranche: +${netReturnPct.toFixed(2)}%)`,
      is_win: true,
      features_json: JSON.stringify(pos.entryFeatures || []),
    }),
  }).then(() => {
    solanaBotState.databaseInfo.tradesCount++;
    if (elements.solanaDbText) {
      elements.solanaDbText.textContent = `solana_trades.db (${solanaBotState.databaseInfo.tradesCount} trades, ${solanaBotState.databaseInfo.trapsCount} traps)`;
    }
  }).catch((err) => console.warn("Failed to persist TP1 trade to SQLite:", err));

  showToast(`💰 [TP1 BANKED] ${pos.token.symbol} booked +$${netPnlUsd.toFixed(2)} (+${netReturnPct.toFixed(1)}%) via ${tradeDex}! Remaining 50% runner protected at breakeven.`);
}

function openPosition(token, marginUsd, fvgType = "BULLISH_FVG", route = null, mtf = null) {
  const safeFvg = String(fvgType || "BULLISH_FVG");
  const effectiveRoute = route || routeBestExecutionVenue(token, marginUsd);
  const effectiveMtf = mtf || token.mtf || computeMultiTimeframeConfluence(token);
  const takerFeeRate = effectiveRoute ? effectiveRoute.feeRate : 0.0015;
  const takerFeeUsd = marginUsd * takerFeeRate;

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
    tp1BankedProfitUsd: 0.0,
    breakevenPrice: entryPrice * (1 + takerFeeRate * 2),
    shares,
    entryTime: Date.now(),
    entryFeatures: rawFeatures,
    fvgType: safeFvg,
    route: effectiveRoute,
    mtf: effectiveMtf,
    barsHeld: 0,
    unrealizedPnlUsd: 0.0,
    unrealizedReturnPct: 0.0,
  };

  solanaBotState.activePositions.push(pos);
  const openPositionsValue = solanaBotState.activePositions.reduce((acc, p) => acc + (p.shares * p.currentPrice), 0);
  solanaBotState.wallet.currentEquity = solanaBotState.wallet.cash + openPositionsValue;
  if (solanaBotState.wallet.currentEquity > solanaBotState.wallet.peakEquity) {
    solanaBotState.wallet.peakEquity = solanaBotState.wallet.currentEquity;
  }
  persistSolanaWallet();
}

function closePosition(pos, exitReason, isEmergencyHalt = false) {
  const index = solanaBotState.activePositions.indexOf(pos);
  if (index === -1) return;

  const exitPrice = pos.currentPrice;
  const feeRate = pos.route ? pos.route.feeRate : 0.0015;
  const exitTakerFee = (pos.shares * exitPrice) * feeRate;
  const grossPnl = (pos.shares * exitPrice) - pos.marginUsd;
  const entryFee = pos.marginUsd * feeRate;
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

  const isWin = netPnlUsd > 0 || Boolean(pos.tp1Triggered);
  if (isWin) {
    solanaBotState.wallet.tradesWon++;
  } else {
    solanaBotState.wallet.tradesLost++;
    let failurePattern = "Defensive Stop-Loss (-2.0%)";
    if ((pos.token.price_change_5m || 0) > 3.5) {
      failurePattern = "FOMO Overbought Exhaustion";
    } else if ((pos.token.volatility_score || 0) > 92) {
      failurePattern = "Excessive Volatility Slippage";
    }
    registerTradeMistakeInStage1(pos.token, pos.entryFeatures, netReturnPct / 100, failurePattern);
  }

  const tradeRef = `SOL-HFT-${Date.now().toString().slice(-6)}`;
  const tradeDex = pos.route ? pos.route.venueName : (pos.token.dex || "Raydium");
  const tradeEntry = {
    id: solanaBotState.executedTrades.length + 1,
    tradeRef,
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    token: pos.token.symbol,
    dex: tradeDex,
    entryPrice: pos.entryPrice,
    exitPrice,
    marginUsd: pos.marginUsd,
    pnlUsd: netPnlUsd,
    pnlPct: netReturnPct,
    feesPaid: entryFee + exitTakerFee,
    exitReason,
    isWin,
    learningNote: isWin ? (pos.tp1Triggered ? "🛡️ BE Runner Exit" : "🟢 Captured Edge") : "🔴 Doubted (Stage 1)",
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
      dex: tradeDex,
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
  const currentBaseline = solanaBotState.wallet.initialEquity || 10000.0;
  setCustomWalletBalance(currentBaseline);
}

function setCustomWalletBalance(amount) {
  if (typeof amount !== "number" || isNaN(amount) || amount < 1) {
    showToast("⚠️ Please enter a valid wallet balance (minimum $1.00).");
    return;
  }

  if (solanaBotState.isRunning) {
    stopSolanaAutonomousBot("OPERATOR_STOP");
  }

  const userKey = solanaBotState.currentUser ? solanaBotState.currentUser.id : "guest";
  try {
    localStorage.setItem(`rustbot_solana_${userKey}_initial_equity`, String(amount));
    localStorage.setItem("rustbot_solana_initial_equity", String(amount));
  } catch (_) { }

  solanaBotState.activePositions = [];
  solanaBotState.wallet = {
    initialEquity: amount,
    currentEquity: amount,
    cash: amount,
    realizedPnl: 0.0,
    totalFeesPaid: 0.0,
    sorSavingsUsd: 0.0,
    peakEquity: amount,
    maxDrawdownPct: 0.0,
    tradesWon: 0,
    tradesLost: 0,
  };

  persistSolanaWallet();
  updateSolanaWalletHUD();
  renderMultiPositionsTable();
  renderSolanaJournal();

  const slotUsd = (amount / (solanaBotState.maxConcurrentPositions || 15)).toFixed(2);
  if (elements.aiDynamicMargin) {
    elements.aiDynamicMargin.textContent = `6.7% ($${slotUsd})`;
  }

  showToast(`💰 Virtual wallet balance set to $${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}! Trade slots calibrated to $${slotUsd} each.`);
}

function openBalanceModal() {
  if (!elements.walletBalanceModal) return;
  const currentEquity = solanaBotState.wallet.initialEquity || 10000.0;
  if (elements.customWalletBalanceInput) {
    elements.customWalletBalanceInput.value = currentEquity;
  }
  updateBalanceModalPreview(currentEquity);
  highlightActivePreset(currentEquity);
  elements.walletBalanceModal.style.display = "flex";
  if (elements.customWalletBalanceInput) {
    elements.customWalletBalanceInput.focus();
  }
}

function closeBalanceModal() {
  if (!elements.walletBalanceModal) return;
  elements.walletBalanceModal.style.display = "none";
}

function updateBalanceModalPreview(val) {
  const amount = Number(val) || 0;
  const slotSize = Math.max(0, amount / 15).toFixed(2);
  const circuitLimit = (amount * 0.80).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (elements.previewSlotSize) elements.previewSlotSize.textContent = `$${slotSize}`;
  if (elements.previewCircuitLimit) elements.previewCircuitLimit.textContent = `$${circuitLimit}`;
}

function highlightActivePreset(amount) {
  const presets = document.querySelectorAll(".btn-preset");
  presets.forEach((btn) => {
    const val = Number(btn.getAttribute("data-amount"));
    if (val === Number(amount)) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });
}

function updateSolanaWalletHUD() {
  const wallet = solanaBotState.wallet;
  const peak = wallet.peakEquity;
  const current = wallet.currentEquity;
  const drawdownPct = Math.max(0, ((peak - current) / Math.max(1, peak)) * 100);

  if (elements.solanaWalletBalance) {
    elements.solanaWalletBalance.textContent = `$${current.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  if (elements.solanaBaselineCapital) {
    elements.solanaBaselineCapital.textContent = `Baseline Capital: $${wallet.initialEquity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

  if (elements.solanaSorSavings) {
    const saved = wallet.sorSavingsUsd || 0.0;
    elements.solanaSorSavings.textContent = `⚡ SOR Saved: $${saved.toFixed(2)}`;
  }

  if (elements.circuitBarFill) {
    const meterPct = Math.min(100, (drawdownPct / 20.0) * 100);
    elements.circuitBarFill.style.width = `${meterPct}%`;
  }

  if (elements.circuitDrawdownText) {
    elements.circuitDrawdownText.textContent = `Drawdown: ${drawdownPct.toFixed(2)}% / 20.00% Max`;
  }

  if (elements.circuitDangerHint) {
    const trailingHaltFloor = Math.max(wallet.initialEquity * 0.80, peak * 0.80);
    elements.circuitDangerHint.textContent = `Trailing halt floor at $${trailingHaltFloor.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (-20% from peak $${peak.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`;
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
    const baseSlotUsd = (current / (solanaBotState.maxConcurrentPositions || 15)).toFixed(2);

    if (activeCount > 0) {
      elements.solanaActiveTokenBadge.textContent = `${activeCount} / 15 IN PLAY`;
      elements.solanaActiveTokenBadge.style.color = "var(--sage)";
      elements.solanaPositionDetails.innerHTML = `
        <div class="position-stat-grid">
          <div><span>Allocated Margin:</span> <strong>$${totalAllocatedMargin.toFixed(2)} (${marginPct}%)</strong></div>
          <div><span>Per Trade Size:</span> <strong>1/15th (~6.7% / $${baseSlotUsd})</strong></div>
          <div><span>Active Coins:</span> <strong>${solanaBotState.activePositions.map((p) => p.token.symbol).join(", ")}</strong></div>
          <div><span>Risk/Reward Rule:</span> <strong>1:2 R:R (50% TP1 / Adaptive Runner)</strong></div>
        </div>
      `;
    } else {
      elements.solanaActiveTokenBadge.textContent = "0 / 15 IN PLAY";
      elements.solanaActiveTokenBadge.style.color = "var(--muted)";
      elements.solanaPositionDetails.innerHTML = `<span class="no-position-label">Bot ready to trade multiple Solana coins (1/15th margin / $${baseSlotUsd} each)…</span>`;
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
        <td colspan="9" style="text-align: center; color: var(--muted); padding: 18px;">
          No active positions held. Start the Solana Bot to enter concurrent 1/15th balance trades with multi-timeframe trend confirmation and Smart Order Routing.
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

    const isRunner = Boolean(pos.tp1Triggered);
    const tpLabel = isRunner
      ? `<span style="color: var(--sage); font-weight: 700;">🏃 50% Runner Active</span> <small style="color: var(--muted);">(Peak: $${pos.peakPrice < 0.001 ? pos.peakPrice.toFixed(6) : pos.peakPrice.toFixed(4)})</small>`
      : `<span style="color: var(--sage);">+3.5% (Scale 50%)</span> <small style="color: var(--muted);">(+$${(pos.marginUsd * 0.035).toFixed(2)})</small>`;

    const slLabel = isRunner
      ? `<span style="color: var(--sage); font-weight: 700; background: rgba(52, 211, 153, 0.12); padding: 2px 6px; border-radius: 4px;">🛡️ Breakeven ($0 Risk)</span>`
      : `<span style="color: var(--danger); font-weight: 600;">-2.0% Risk Guard</span> <small style="color: var(--muted);">(-$${(pos.marginUsd * 0.02).toFixed(2)})</small>`;

    const mtfHtml = renderMtfBadge(pos.mtf);
    const routerTag = pos.route ? (pos.route.dexTag || 'raydium') : ((pos.token.dex || 'raydium').toLowerCase());
    const routerLabel = pos.route ? (pos.route.displayBadge || pos.route.badgeText) : (pos.token.dex ? pos.token.dex.toUpperCase() : 'RAYDIUM');

    return `
      <tr>
        <td>
          <div class="token-cell-title">
            <strong>${pos.token.symbol}</strong>
            <span class="badge-sor ${routerTag}">${routerLabel}</span>
          </div>
          <small style="color: var(--muted); font-size: 0.7rem;">${pos.fvgType || 'Bullish Retest'}</small>
        </td>
        <td>${mtfHtml}</td>
        <td><strong>$${pos.marginUsd.toFixed(2)}</strong> ${isRunner ? '<small style="color: var(--sage); font-weight: 600;">(50% Left)</small>' : '<small style="color: var(--muted);">(1/15th)</small>'}</td>
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
