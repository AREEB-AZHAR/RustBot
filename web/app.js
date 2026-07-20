"use strict";

const state = {
  patterns: [],
  messages: [],
  query: "",
  sending: false,
  pendingDelete: null,
  newPatternId: null,
  toastTimer: null,
  workspace: "chat",
  marketData: [],
  marketChartData: [],
};

const elements = {
  appShell: document.querySelector(".app-shell"),
  conversation: document.querySelector("#conversation"),
  welcome: document.querySelector("#welcome-state"),
  composerForm: document.querySelector("#composer-form"),
  composerInput: document.querySelector("#composer-input"),
  composerRegion: document.querySelector("#composer-region"),
  sendButton: document.querySelector("#send-button"),
  teachButton: document.querySelector("#teach-button"),
  newChatButton: document.querySelector("#new-chat-button"),
  knowledgePanel: document.querySelector("#knowledge-panel"),
  knowledgeToggle: document.querySelector("#knowledge-toggle"),
  knowledgeClose: document.querySelector("#knowledge-close"),
  panelOverlay: document.querySelector("#panel-overlay"),
  readyLabel: document.querySelector("#ready-label"),
  workspaceEyebrow: document.querySelector("#workspace-eyebrow"),
  conversationTitle: document.querySelector("#conversation-title"),
  workspaceToggle: document.querySelector("#workspace-toggle"),
  marketLab: document.querySelector("#market-lab"),
  marketForm: document.querySelector("#market-form"),
  marketProvider: document.querySelector("#market-provider"),
  marketSymbol: document.querySelector("#market-symbol"),
  marketTimeframe: document.querySelector("#market-timeframe"),
  marketLookback: document.querySelector("#market-lookback"),
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
  testAccuracy: document.querySelector("#test-accuracy"),
  strategyReturn: document.querySelector("#strategy-return"),
  maxDrawdown: document.querySelector("#max-drawdown"),
  testSamples: document.querySelector("#test-samples"),
  priceChart: document.querySelector("#price-chart"),
  tradingViewWidget: document.querySelector("#tradingview-widget"),
  tradingViewLink: document.querySelector("#tradingview-link"),
  memoryCount: document.querySelector("#memory-count"),
  railMemoryCount: document.querySelector("#rail-memory-count"),
  memoryList: document.querySelector("#memory-list"),
  memorySearch: document.querySelector("#memory-search-input"),
  addMemoryButton: document.querySelector("#add-memory-button"),
  addMemoryForm: document.querySelector("#add-memory-form"),
  cancelAddMemory: document.querySelector("#cancel-add-memory"),
  memoryPrompt: document.querySelector("#memory-prompt"),
  memoryResponse: document.querySelector("#memory-response"),
  memoryFormError: document.querySelector("#memory-form-error"),
  forgetDialog: document.querySelector("#forget-dialog"),
  forgetCopy: document.querySelector("#forget-copy"),
  toast: document.querySelector("#toast"),
  toastMessage: document.querySelector("#toast-message"),
  toastAction: document.querySelector("#toast-action"),
  toastClose: document.querySelector("#toast-close"),
  announcer: document.querySelector("#app-announcer"),
};

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const narrowWorkspace = window.matchMedia("(max-width: 1180px)");

document.addEventListener("DOMContentLoaded", initialize);

function initialize() {
  restorePanelPreference();
  bindEvents();
  restoreConversation();
  loadKnowledge();
  resizeComposer();
  updateMarketProvider();
}

function bindEvents() {
  elements.composerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    sendMessage(elements.composerInput.value);
  });

  elements.composerInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      elements.composerForm.requestSubmit();
    }
  });
  elements.composerInput.addEventListener("input", resizeComposer);

  document.querySelectorAll("[data-prompt]").forEach((button) => {
    button.addEventListener("click", () => sendMessage(button.dataset.prompt || ""));
  });

  document.querySelectorAll("[data-nav]").forEach((button) => {
    button.addEventListener("click", () => handleNavigation(button.dataset.nav));
  });

  elements.newChatButton.addEventListener("click", startNewConversation);
  elements.workspaceToggle.addEventListener("click", () => {
    handleNavigation(state.workspace === "market" ? "chat" : "market");
  });
  elements.teachButton.addEventListener("click", () => openTeachingForm());
  elements.knowledgeToggle.addEventListener("click", toggleKnowledgePanel);
  elements.knowledgeClose.addEventListener("click", closeKnowledgePanel);
  elements.panelOverlay.addEventListener("click", closeKnowledgePanel);
  elements.addMemoryButton.addEventListener("click", () => toggleAddMemoryForm());
  elements.cancelAddMemory.addEventListener("click", () => toggleAddMemoryForm(false));
  elements.addMemoryForm.addEventListener("submit", saveManualMemory);
  elements.marketForm.addEventListener("submit", trainMarketModel);
  elements.marketProvider.addEventListener("change", updateMarketProvider);
  elements.marketSymbol.addEventListener("change", renderTradingViewWidget);
  elements.marketTimeframe.addEventListener("change", renderTradingViewWidget);
  window.addEventListener("resize", () => {
    if (state.workspace === "market" && state.marketChartData.length) drawPriceChart();
  });

  elements.memorySearch.addEventListener("input", () => {
    state.query = elements.memorySearch.value.trim().toLowerCase();
    renderKnowledge();
  });

  elements.forgetDialog.addEventListener("close", () => {
    if (elements.forgetDialog.returnValue === "confirm" && state.pendingDelete) {
      forgetMemory(state.pendingDelete);
    }
    state.pendingDelete = null;
  });

  elements.toastClose.addEventListener("click", hideToast);

  document.addEventListener("keydown", (event) => {
    const activeTag = document.activeElement?.tagName;
    const isTyping = activeTag === "INPUT" || activeTag === "TEXTAREA";
    if (event.key === "/" && !isTyping) {
      event.preventDefault();
      openKnowledgePanel();
      elements.memorySearch.focus();
    }
    if (event.key === "Escape" && isKnowledgePanelOpen()) {
      closeKnowledgePanel();
    }
  });

  narrowWorkspace.addEventListener("change", () => {
    elements.knowledgePanel.classList.remove("is-open");
    elements.panelOverlay.classList.remove("is-visible");
    document.body.classList.remove("panel-open");
    restorePanelPreference();
  });
}

async function loadKnowledge() {
  try {
    const data = await api("/api/knowledge");
    state.patterns = Array.isArray(data.patterns) ? data.patterns : [];
    updateMemorySummary();
    renderKnowledge();
  } catch (error) {
    elements.readyLabel.textContent = "Forge unavailable";
    renderKnowledgeError(error.message);
  }
}

async function sendMessage(rawMessage) {
  const message = rawMessage.trim();
  if (!message || state.sending) return;

  if (state.workspace !== "chat") switchWorkspace("chat");

  elements.composerInput.value = "";
  resizeComposer();
  appendMessage("user", message);
  setSending(true);
  const loadingRow = appendLoadingMessage();
  const requestStartedAt = performance.now();

  try {
    const result = await api("/api/chat", {
      method: "POST",
      body: JSON.stringify({ message }),
    });
    const responseTimeMs = performance.now() - requestStartedAt;
    await wait(reducedMotion.matches ? 0 : Math.max(0, 280 - responseTimeMs));

    loadingRow.remove();
    const row = appendMessage("bot", result.response || "I found a memory, but it was empty.", {
      responseTimeMs,
    });
    if (result.status === "unknown") {
      row.querySelector(".message-body").append(createTeachCard(message));
      announce("RustBot does not know that answer yet. A teaching form is ready.");
    }
  } catch (error) {
    loadingRow.remove();
    appendErrorMessage(message, error.message);
  } finally {
    setSending(false);
    elements.composerInput.focus();
  }
}

function appendMessage(role, text, options = {}) {
  ensureMessageList();

  const row = document.createElement("article");
  row.className = `message-row ${role}`;
  row.setAttribute("aria-label", role === "bot" ? "RustBot message" : "Your message");

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = role === "bot" ? "R" : "Y";

  const body = document.createElement("div");
  body.className = "message-body";

  const meta = document.createElement("div");
  meta.className = "message-meta";
  const sender = document.createElement("span");
  sender.textContent = role === "bot" ? "RustBot" : "You";
  const time = document.createElement("time");
  time.dateTime = new Date().toISOString();
  time.textContent = formatTime(new Date());
  meta.append(sender, time);
  if (role === "bot" && Number.isFinite(options.responseTimeMs)) {
    const responseTime = document.createElement("span");
    responseTime.className = "response-time";
    responseTime.textContent = formatResponseTime(options.responseTimeMs);
    responseTime.setAttribute(
      "aria-label",
      `Response time ${Math.max(0, Math.round(options.responseTimeMs))} milliseconds`,
    );
    responseTime.title = "Engine response time";
    meta.append(responseTime);
  }

  const bubble = document.createElement("div");
  bubble.className = `message-bubble${options.error ? " is-error" : ""}`;
  bubble.textContent = text;
  body.append(meta, bubble);

  if (role === "user") row.append(body, avatar);
  else row.append(avatar, body);

  document.querySelector(".message-list").append(row);

  if (options.save !== false) {
    const savedMessage = { role, text };
    if (role === "bot" && Number.isFinite(options.responseTimeMs)) {
      savedMessage.responseTimeMs = options.responseTimeMs;
    }
    state.messages.push(savedMessage);
    state.messages = state.messages.slice(-40);
    saveConversation();
  }

  scrollConversation();
  return row;
}

function appendLoadingMessage() {
  ensureMessageList();
  const row = document.createElement("article");
  row.className = "message-row bot";
  row.setAttribute("aria-label", "RustBot is thinking");

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = "R";

  const body = document.createElement("div");
  body.className = "message-body";
  const meta = document.createElement("div");
  meta.className = "message-meta";
  meta.textContent = "RustBot · thinking";
  const bubble = document.createElement("div");
  bubble.className = "message-bubble typing-bubble";
  for (let dotIndex = 0; dotIndex < 3; dotIndex += 1) {
    bubble.append(document.createElement("span"));
  }
  body.append(meta, bubble);
  row.append(avatar, body);
  document.querySelector(".message-list").append(row);
  scrollConversation();
  return row;
}

function appendErrorMessage(originalMessage, detail) {
  const row = appendMessage(
    "bot",
    "The forge lost its connection. Your message is still here, so you can try again.",
    { error: true, save: false },
  );
  const retry = document.createElement("button");
  retry.className = "retry-button";
  retry.type = "button";
  retry.textContent = "Retry message";
  retry.addEventListener("click", () => {
    row.remove();
    sendMessage(originalMessage);
  });
  row.querySelector(".message-bubble").append(document.createElement("br"), retry);
  announce(`RustBot could not answer. ${detail}`);
}

function createTeachCard(prompt) {
  const card = document.createElement("form");
  card.className = "teach-card";

  const heading = document.createElement("div");
  heading.className = "teach-card-heading";
  const mark = document.createElement("div");
  mark.className = "teach-card-mark";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = "⌁";
  const headingText = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = "Teach this answer";
  const description = document.createElement("p");
  description.textContent = "Shape this missed question into a memory RustBot can use next time.";
  headingText.append(title, description);
  heading.append(mark, headingText);

  const promptDisplay = document.createElement("code");
  promptDisplay.className = "teach-prompt";
  promptDisplay.textContent = `“${prompt}”`;

  const label = document.createElement("label");
  const labelText = document.createElement("span");
  labelText.textContent = "RustBot should reply…";
  const response = document.createElement("textarea");
  response.name = "response";
  response.rows = 3;
  response.maxLength = 2000;
  response.placeholder = "Write the answer you want RustBot to remember";
  response.required = true;
  label.append(labelText, response);

  const error = document.createElement("p");
  error.className = "form-error";
  error.setAttribute("role", "alert");

  const actions = document.createElement("div");
  actions.className = "teach-actions";
  const skip = document.createElement("button");
  skip.type = "button";
  skip.className = "mini-secondary";
  skip.textContent = "Skip for now";
  const save = document.createElement("button");
  save.type = "submit";
  save.className = "mini-primary";
  save.textContent = "Forge memory";
  actions.append(skip, save);
  card.append(heading, promptDisplay, label, error, actions);

  skip.addEventListener("click", () => {
    card.remove();
    announce("Teaching skipped.");
  });

  card.addEventListener("submit", async (event) => {
    event.preventDefault();
    const answer = response.value.trim();
    if (!answer) {
      error.textContent = "Write a response before saving this memory.";
      response.focus();
      return;
    }

    save.disabled = true;
    skip.disabled = true;
    save.textContent = "Forging memory…";
    error.textContent = "";

    try {
      const result = await api("/api/knowledge", {
        method: "POST",
        body: JSON.stringify({ prompt, response: answer }),
      });
      state.patterns.push(result.pattern);
      state.newPatternId = result.pattern.id;
      updateMemorySummary();
      renderKnowledge();
      card.replaceChildren(createTeachSuccess());
      showToast("New memory forged successfully.");
      announce("RustBot learned the new response.");
    } catch (requestError) {
      error.textContent = requestError.message;
      save.disabled = false;
      skip.disabled = false;
      save.textContent = "Forge memory";
    }
  });

  window.setTimeout(() => response.focus(), 60);
  return card;
}

function createTeachSuccess() {
  const success = document.createElement("div");
  success.className = "teach-success";
  const icon = document.createElement("span");
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "✓";
  const copy = document.createElement("div");
  const strong = document.createElement("strong");
  strong.textContent = "Memory forged";
  const detail = document.createElement("p");
  detail.textContent = "Ask that question again and RustBot will remember.";
  copy.append(strong, detail);
  success.append(icon, copy);
  return success;
}

function ensureMessageList() {
  if (elements.welcome?.isConnected) elements.welcome.remove();
  if (!document.querySelector(".message-list")) {
    const list = document.createElement("div");
    list.className = "message-list";
    elements.conversation.append(list);
  }
}

function startNewConversation() {
  switchWorkspace("chat");
  state.messages = [];
  sessionStorage.removeItem("rustbot-conversation");
  elements.conversation.replaceChildren(createWelcomeState());
  elements.welcome = document.querySelector("#welcome-state");
  elements.composerInput.value = "";
  resizeComposer();
  elements.composerInput.focus();
  announce("Started a fresh conversation.");
}

function createWelcomeState() {
  const original = document.querySelector("#welcome-state");
  if (original) return original.cloneNode(true);

  const wrapper = document.createElement("div");
  wrapper.className = "welcome-state";
  wrapper.id = "welcome-state";
  const emblem = document.createElement("div");
  emblem.className = "forge-emblem";
  emblem.setAttribute("aria-hidden", "true");
  ["forge-ring", "forge-core", "forge-spark spark-one", "forge-spark spark-two"].forEach(
    (className, index) => {
      const element = document.createElement("span");
      element.className = className;
      if (index === 1) element.textContent = "R";
      emblem.append(element);
    },
  );
  const eyebrow = document.createElement("p");
  eyebrow.className = "welcome-eyebrow";
  eyebrow.append(document.createElement("span"), " Local · Self-learning");
  const title = document.createElement("h2");
  title.textContent = "Ask. Teach. Repeat.";
  const copy = document.createElement("p");
  copy.className = "welcome-copy";
  copy.textContent =
    "A small local bot that gets smarter one answer at a time. Try one of the prompts below or write your own.";
  const starters = document.createElement("div");
  starters.className = "starter-grid";
  starters.setAttribute("aria-label", "Suggested messages");
  [
    ["01", "Meet RustBot", "What can you do?"],
    ["02", "Talk shop", "Tell me about Rust"],
    ["03", "Shape a memory", "How do I teach you?"],
  ].forEach(([number, label, prompt]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "starter-card";
    const numberElement = document.createElement("span");
    numberElement.className = "starter-number";
    numberElement.textContent = number;
    const text = document.createElement("span");
    const strong = document.createElement("strong");
    strong.textContent = label;
    const small = document.createElement("small");
    small.textContent = prompt;
    text.append(strong, small);
    const arrow = document.createElement("span");
    arrow.className = "starter-arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "↗";
    button.append(numberElement, text, arrow);
    button.addEventListener("click", () => sendMessage(prompt));
    starters.append(button);
  });
  wrapper.append(emblem, eyebrow, title, copy, starters);
  return wrapper;
}

function restoreConversation() {
  try {
    const stored = JSON.parse(sessionStorage.getItem("rustbot-conversation") || "[]");
    if (!Array.isArray(stored) || stored.length === 0) return;
    state.messages = stored.filter(
      (message) =>
        (message.role === "bot" || message.role === "user") && typeof message.text === "string",
    );
    const messages = [...state.messages];
    state.messages = [];
    messages.forEach((message) =>
      appendMessage(message.role, message.text, { responseTimeMs: message.responseTimeMs }),
    );
  } catch {
    sessionStorage.removeItem("rustbot-conversation");
  }
}

function saveConversation() {
  sessionStorage.setItem("rustbot-conversation", JSON.stringify(state.messages));
}

function setSending(sending) {
  state.sending = sending;
  elements.sendButton.disabled = sending;
  elements.composerInput.setAttribute("aria-busy", String(sending));
}

function resizeComposer() {
  elements.composerInput.style.height = "auto";
  elements.composerInput.style.height = `${Math.min(elements.composerInput.scrollHeight, 118)}px`;
}

function scrollConversation() {
  window.requestAnimationFrame(() => {
    elements.conversation.scrollTo({
      top: elements.conversation.scrollHeight,
      behavior: reducedMotion.matches ? "auto" : "smooth",
    });
  });
}

function handleNavigation(destination) {
  document.querySelectorAll("[data-nav]").forEach((button) => {
    const active = button.dataset.nav === destination;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });

  if (destination === "chat") {
    switchWorkspace("chat");
    closeKnowledgePanel();
    elements.composerInput.focus();
  } else if (destination === "market") {
    switchWorkspace("market");
    closeKnowledgePanel();
  } else if (destination === "teach") {
    switchWorkspace("chat");
    openTeachingForm();
  } else {
    openKnowledgePanel();
    elements.memorySearch.focus();
  }
}

function switchWorkspace(workspace) {
  const marketOpen = workspace === "market";
  state.workspace = marketOpen ? "market" : "chat";
  elements.conversation.hidden = marketOpen;
  elements.composerRegion.hidden = marketOpen;
  elements.marketLab.hidden = !marketOpen;
  elements.workspaceEyebrow.textContent = marketOpen ? "Quant workspace" : "Active workspace";
  elements.conversationTitle.textContent = marketOpen ? "Market Research Lab" : "Fresh conversation";
  elements.readyLabel.textContent = marketOpen
    ? state.marketData.length
      ? `Dataset · ${state.marketData.length} candles`
      : "Research mode"
    : `Ready · ${state.patterns.length} ${state.patterns.length === 1 ? "memory" : "memories"}`;
  elements.workspaceToggle.setAttribute(
    "aria-label",
    marketOpen ? "Return to conversation" : "Open Market Lab",
  );
  elements.workspaceToggle.title = marketOpen ? "Return to conversation" : "Open Market Lab";
  elements.workspaceToggle.firstElementChild.textContent = marketOpen ? "◌" : "⌁";

  document.querySelectorAll('[data-nav="chat"], [data-nav="market"]').forEach((button) => {
    const active = button.dataset.nav === state.workspace;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });

  if (marketOpen && state.marketChartData.length) {
    window.requestAnimationFrame(drawPriceChart);
  }
}

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
  fifteenMinuteOption.disabled = provider === "coingecko";
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
    theme: "dark",
    style: "1",
    locale: "en",
    backgroundColor: "#202823",
    gridColor: "rgba(255, 255, 255, 0.05)",
    hide_side_toolbar: false,
    allow_symbol_change: true,
    save_image: false,
    calendar: false,
    support_host: "https://www.tradingview.com",
  });
  container.append(widget, script);
  elements.tradingViewWidget.append(container);

  const pathSymbol = chartSymbol.replace(":", "-").replace(/[^A-Z0-9-]/gi, "");
  elements.tradingViewLink.href = `https://www.tradingview.com/symbols/${pathSymbol}/`;
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
    elements.marketSymbol.focus();
    return;
  }

  const originalLabel = elements.marketTrainButton.firstElementChild.textContent;
  elements.marketTrainButton.disabled = true;
  elements.marketTrainButton.firstElementChild.textContent = "Fetching public candles…";
  elements.marketFormError.textContent = "";
  elements.datasetStatus.textContent = "Connecting…";

  try {
    const query = new URLSearchParams({ provider, symbol, interval: timeframe, limit: String(limit) });
    const response = await api(`/api/market/candles?${query}`);
    const candles = Array.isArray(response.candles)
      ? response.candles
          .map((candle) => ({
            timestamp: Number(candle.timestamp),
            close: Number(candle.close),
            volume: Number(candle.volume) || 0,
          }))
          .filter((candle) => Number.isFinite(candle.close) && candle.close > 0)
      : [];

    if (candles.length < 120) {
      throw new Error(`Only ${candles.length} usable candles were returned; at least 120 are required.`);
    }

    state.marketData = candles;
    elements.marketTrainButton.firstElementChild.textContent = "Training chronological baseline…";
    elements.datasetStatus.textContent = `${candles.length} candles`;
    elements.readyLabel.textContent = `Dataset · ${candles.length} candles`;
    await wait(reducedMotion.matches ? 0 : 40);
    const result = runMarketExperiment(candles);
    renderMarketReport(result, response.provider || provider, response.symbol || symbol, timeframe);
    renderTradingViewWidget();
    announce(`Market baseline trained on ${candles.length} candles. Out-of-sample accuracy ${Math.round(result.accuracy * 100)} percent.`);
  } catch (error) {
    elements.marketFormError.textContent = error.message;
    elements.datasetStatus.textContent = "Fetch failed";
    announce(`Market data experiment failed. ${error.message}`);
  } finally {
    elements.marketTrainButton.disabled = false;
    elements.marketTrainButton.firstElementChild.textContent = originalLabel;
  }
}

function runMarketExperiment(candles) {
  const samples = buildMarketSamples(candles);
  if (samples.length < 90) throw new Error("The dataset does not contain enough feature-ready candles.");

  const trainEnd = Math.floor(samples.length * 0.7);
  const validationEnd = Math.floor(samples.length * 0.85);
  const train = samples.slice(0, trainEnd);
  const validation = samples.slice(trainEnd, validationEnd);
  const test = samples.slice(validationEnd);
  const scaler = fitScaler(train.map((sample) => sample.features));
  const scaledTrain = train.map((sample) => ({ ...sample, features: scaleFeatures(sample.features, scaler) }));
  const weights = trainLogisticRegression(scaledTrain);
  const predict = (sample) => sigmoid(dot(weights, [1, ...scaleFeatures(sample.features, scaler)]));
  const validationProbabilities = validation.map(predict);
  const threshold = selectTradeThreshold(validation, validationProbabilities);
  const testProbabilities = test.map(predict);
  const correct = test.reduce(
    (total, sample, index) => total + ((testProbabilities[index] >= 0.5) === Boolean(sample.target) ? 1 : 0),
    0,
  );
  const strategy = backtestSignals(test, testProbabilities, threshold);
  const latestFeatures = marketFeaturesAt(candles, candles.length - 1);
  const probability = sigmoid(dot(weights, [1, ...scaleFeatures(latestFeatures, scaler)]));

  return {
    probability,
    threshold,
    accuracy: correct / test.length,
    testSamples: test.length,
    strategyReturn: strategy.netReturn,
    maxDrawdown: strategy.maxDrawdown,
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

function trainLogisticRegression(samples) {
  const weights = new Array(samples[0].features.length + 1).fill(0);
  const learningRate = 0.075;
  const regularization = 0.002;
  for (let epoch = 0; epoch < 650; epoch += 1) {
    const gradient = new Array(weights.length).fill(0);
    samples.forEach((sample) => {
      const row = [1, ...sample.features];
      const error = sigmoid(dot(weights, row)) - sample.target;
      row.forEach((value, index) => {
        gradient[index] += error * value;
      });
    });
    weights.forEach((weight, index) => {
      const penalty = index === 0 ? 0 : regularization * weight;
      weights[index] -= learningRate * (gradient[index] / samples.length + penalty);
    });
  }
  return weights;
}

function selectTradeThreshold(samples, probabilities) {
  const thresholds = [0.52, 0.55, 0.58, 0.6, 0.62, 0.65];
  return thresholds.reduce((best, threshold) => {
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
  samples.forEach((sample, index) => {
    const probability = probabilities[index];
    const position = probability >= threshold ? 1 : probability <= 1 - threshold ? -1 : 0;
    const cost = Math.abs(position - previousPosition) * feeRate;
    const periodReturn = Math.max(-0.99, position * sample.forwardReturn - cost);
    equity *= 1 + periodReturn;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak);
    previousPosition = position;
  });
  return { netReturn: equity - 1, maxDrawdown };
}

function renderMarketReport(result, provider, symbol, timeframe) {
  elements.marketEmpty.hidden = true;
  elements.marketReport.hidden = false;
  elements.reportSymbol.textContent = symbol.toUpperCase();
  elements.reportTimeframe.textContent = `${timeframe} · ${provider}`;
  elements.upProbability.textContent = `${(result.probability * 100).toFixed(1)}%`;
  elements.probabilityFill.style.width = `${Math.max(2, Math.min(98, result.probability * 100))}%`;
  elements.testAccuracy.textContent = `${(result.accuracy * 100).toFixed(1)}%`;
  elements.strategyReturn.textContent = formatSignedPercent(result.strategyReturn);
  elements.strategyReturn.style.color = result.strategyReturn >= 0 ? "#477259" : "#a14536";
  elements.maxDrawdown.textContent = `-${(result.maxDrawdown * 100).toFixed(1)}%`;
  elements.testSamples.textContent = String(result.testSamples);

  const signal = result.probability >= result.threshold
    ? "bullish"
    : result.probability <= 1 - result.threshold
      ? "bearish"
      : "neutral";
  elements.marketSignal.className = `signal-pill ${signal}`;
  elements.marketSignal.textContent = signal;
  elements.signalExplanation.textContent = signal === "neutral"
    ? `Probability is inside the model's ${(result.threshold * 100).toFixed(0)}% action threshold, so it abstains.`
    : `The latest feature window crosses the validation-selected ${(result.threshold * 100).toFixed(0)}% action threshold.`;
  state.marketChartData = state.marketData;
  window.requestAnimationFrame(drawPriceChart);
}

function drawPriceChart() {
  const canvas = elements.priceChart;
  const candles = state.marketChartData;
  if (!canvas || !candles.length || canvas.clientWidth === 0) return;
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

  context.strokeStyle = "rgba(255,255,255,0.07)";
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
    context.strokeStyle = index === 0 ? "rgba(228,98,50,0.46)" : "rgba(131,184,154,0.52)";
    context.setLineDash([4, 4]);
    context.beginPath();
    context.moveTo(x, padding.top);
    context.lineTo(x, height - padding.bottom);
    context.stroke();
  });
  context.setLineDash([]);

  const gradient = context.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, "#e46232");
  gradient.addColorStop(0.7, "#dfaa70");
  gradient.addColorStop(1, "#83b89a");
  context.strokeStyle = gradient;
  context.lineWidth = 1.8;
  context.beginPath();
  closes.forEach((value, index) => {
    const x = padding.left + ((width - padding.left - padding.right) * index) / Math.max(1, closes.length - 1);
    const y = padding.top + ((maximum - value) / range) * (height - padding.top - padding.bottom);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
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

function isKnowledgePanelOpen() {
  if (narrowWorkspace.matches) {
    return elements.knowledgePanel.classList.contains("is-open");
  }
  return !elements.appShell.classList.contains("knowledge-collapsed");
}

function syncPanelControls(isOpen) {
  elements.knowledgeToggle.setAttribute("aria-expanded", String(isOpen));
  elements.knowledgeToggle.setAttribute(
    "aria-label",
    `${isOpen ? "Close" : "Open"} knowledge panel`,
  );
  elements.knowledgeToggle.title = `${isOpen ? "Close" : "Open"} knowledge panel`;
}

function restorePanelPreference() {
  elements.appShell.classList.remove("knowledge-collapsed");
  if (narrowWorkspace.matches) {
    syncPanelControls(false);
    return;
  }

  const collapsed = localStorage.getItem("rustbot-knowledge-collapsed") === "true";
  elements.appShell.classList.toggle("knowledge-collapsed", collapsed);
  syncPanelControls(!collapsed);
}

function toggleKnowledgePanel() {
  if (isKnowledgePanelOpen()) closeKnowledgePanel();
  else openKnowledgePanel();
}

function openKnowledgePanel() {
  if (narrowWorkspace.matches) {
    elements.knowledgePanel.classList.add("is-open");
    elements.panelOverlay.classList.add("is-visible");
    document.body.classList.add("panel-open");
  } else {
    elements.appShell.classList.remove("knowledge-collapsed");
    localStorage.setItem("rustbot-knowledge-collapsed", "false");
  }
  syncPanelControls(true);
}

function closeKnowledgePanel() {
  elements.knowledgePanel.classList.remove("is-open");
  elements.panelOverlay.classList.remove("is-visible");
  document.body.classList.remove("panel-open");
  if (!narrowWorkspace.matches) {
    elements.appShell.classList.add("knowledge-collapsed");
    localStorage.setItem("rustbot-knowledge-collapsed", "true");
  }
  syncPanelControls(false);
}

function openTeachingForm(prompt = "") {
  openKnowledgePanel();
  toggleAddMemoryForm(true);
  elements.memoryPrompt.value = prompt;
  window.setTimeout(() => elements.memoryPrompt.focus(), 80);
}

function toggleAddMemoryForm(force) {
  const shouldOpen = typeof force === "boolean" ? force : elements.addMemoryForm.hidden;
  elements.addMemoryForm.hidden = !shouldOpen;
  elements.addMemoryButton.hidden = shouldOpen;
  elements.addMemoryButton.setAttribute("aria-expanded", String(shouldOpen));
  if (!shouldOpen) {
    elements.addMemoryForm.reset();
    elements.memoryFormError.textContent = "";
  }
}

async function saveManualMemory(event) {
  event.preventDefault();
  const prompt = elements.memoryPrompt.value.trim();
  const response = elements.memoryResponse.value.trim();
  const submit = elements.addMemoryForm.querySelector("button[type='submit']");
  submit.disabled = true;
  submit.textContent = "Saving memory…";
  elements.memoryFormError.textContent = "";

  try {
    const result = await api("/api/knowledge", {
      method: "POST",
      body: JSON.stringify({ prompt, response }),
    });
    state.patterns.push(result.pattern);
    state.newPatternId = result.pattern.id;
    updateMemorySummary();
    renderKnowledge();
    toggleAddMemoryForm(false);
    showToast("New memory added to RustBot.");
    announce("New memory saved.");
  } catch (error) {
    elements.memoryFormError.textContent = error.message;
  } finally {
    submit.disabled = false;
    submit.textContent = "Save to the forge";
  }
}

function updateMemorySummary() {
  const count = state.patterns.length;
  elements.memoryCount.textContent = String(count);
  elements.railMemoryCount.textContent = String(count);
  elements.readyLabel.textContent = `Ready · ${count} ${count === 1 ? "memory" : "memories"}`;
}

function renderKnowledge() {
  const query = state.query;
  const patterns = state.patterns.filter((pattern) => {
    const haystack = `${pattern.keywords.join(" ")} ${pattern.response}`.toLowerCase();
    return !query || haystack.includes(query);
  });

  elements.memoryList.replaceChildren();
  if (patterns.length === 0) {
    elements.memoryList.append(createEmptyMemories(query));
    return;
  }

  patterns
    .slice()
    .reverse()
    .forEach((pattern) => elements.memoryList.append(createMemoryCard(pattern)));
  state.newPatternId = null;
}

function createMemoryCard(pattern) {
  const card = document.createElement("article");
  card.className = `memory-card${state.newPatternId === pattern.id ? " is-new" : ""}`;
  card.dataset.id = String(pattern.id);

  const top = document.createElement("div");
  top.className = "memory-card-top";
  const index = document.createElement("span");
  index.className = "memory-index";
  index.textContent = `Memory ${String(pattern.id).padStart(2, "0")}`;
  const forget = document.createElement("button");
  forget.className = "forget-button";
  forget.type = "button";
  forget.textContent = "Forget";
  forget.setAttribute("aria-label", `Forget memory ${pattern.id}`);
  forget.addEventListener("click", () => openForgetDialog(pattern));
  top.append(index, forget);

  const trigger = document.createElement("h3");
  trigger.className = "memory-trigger";
  trigger.textContent =
    pattern.match_mode === "any" ? pattern.keywords.join(" · ") : pattern.keywords.join(" ");

  const keywords = document.createElement("div");
  keywords.className = "keyword-row";
  pattern.keywords.slice(0, 8).forEach((keyword) => {
    const chip = document.createElement("span");
    chip.className = "keyword-chip";
    chip.textContent = keyword;
    keywords.append(chip);
  });

  const response = document.createElement("p");
  response.className = "memory-response";
  response.textContent = pattern.response;

  const mode = document.createElement("span");
  mode.className = "memory-mode";
  mode.textContent = pattern.match_mode === "any" ? "Matches any keyword" : "Matches complete phrase";
  card.append(top, trigger, keywords, response, mode);
  return card;
}

function createEmptyMemories(query) {
  const empty = document.createElement("div");
  empty.className = "empty-memories";
  const mark = document.createElement("div");
  mark.className = "empty-memory-mark";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = query ? "⌕" : "＋";
  const title = document.createElement("strong");
  title.textContent = query ? "No memories found" : "The forge is empty";
  const copy = document.createElement("p");
  copy.textContent = query
    ? `Nothing matches “${elements.memorySearch.value.trim()}”.`
    : "Teach RustBot its first response to get started.";
  empty.append(mark, title, copy);

  const action = document.createElement("button");
  action.className = "clear-search";
  action.type = "button";
  if (query) {
    action.textContent = "Clear search";
    action.addEventListener("click", () => {
      elements.memorySearch.value = "";
      state.query = "";
      renderKnowledge();
      elements.memorySearch.focus();
    });
  } else {
    action.textContent = "Forge first memory";
    action.addEventListener("click", () => openTeachingForm());
  }
  empty.append(action);
  return empty;
}

function renderKnowledgeError(message) {
  elements.memoryList.replaceChildren();
  const empty = document.createElement("div");
  empty.className = "empty-memories";
  const title = document.createElement("strong");
  title.textContent = "Could not open the forge";
  const copy = document.createElement("p");
  copy.textContent = message;
  const retry = document.createElement("button");
  retry.className = "clear-search";
  retry.type = "button";
  retry.textContent = "Try again";
  retry.addEventListener("click", loadKnowledge);
  empty.append(title, copy, retry);
  elements.memoryList.append(empty);
}

function openForgetDialog(pattern) {
  state.pendingDelete = pattern;
  elements.forgetCopy.textContent = `“${pattern.keywords.join(" ")}” will stop returning its saved response. You can undo this immediately afterward.`;
  elements.forgetDialog.returnValue = "cancel";
  elements.forgetDialog.showModal();
}

async function forgetMemory(pattern) {
  try {
    const result = await api(`/api/knowledge/${pattern.id}`, { method: "DELETE" });
    const removed = result.pattern;
    state.patterns = state.patterns.filter((item) => item.id !== pattern.id);
    updateMemorySummary();
    renderKnowledge();
    showToast("Memory forgotten.", "Undo", () => restoreMemory(removed));
    announce("Memory removed. Undo is available.");
  } catch (error) {
    showToast(error.message);
  }
}

async function restoreMemory(pattern) {
  try {
    const result = await api("/api/knowledge/restore", {
      method: "POST",
      body: JSON.stringify(pattern),
    });
    state.patterns.push(result.pattern);
    state.newPatternId = result.pattern.id;
    updateMemorySummary();
    renderKnowledge();
    showToast("Memory restored.");
    announce("Memory restored.");
  } catch (error) {
    showToast(error.message);
  }
}

function showToast(message, actionLabel, action) {
  window.clearTimeout(state.toastTimer);
  elements.toastMessage.textContent = message;
  elements.toastAction.hidden = !actionLabel;
  elements.toastAction.textContent = actionLabel || "";
  elements.toastAction.onclick = action
    ? () => {
        hideToast();
        action();
      }
    : null;
  elements.toast.hidden = false;
  state.toastTimer = window.setTimeout(hideToast, action ? 7000 : 4200);
}

function hideToast() {
  window.clearTimeout(state.toastTimer);
  elements.toast.hidden = true;
}

function announce(message) {
  elements.announcer.textContent = "";
  window.setTimeout(() => {
    elements.announcer.textContent = message;
  }, 20);
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body) headers.set("Content-Type", "application/json");
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

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function formatTime(date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatResponseTime(milliseconds) {
  if (milliseconds < 1) return "<1 ms";
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  return `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 2 : 1)} s`;
}
