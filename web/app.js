"use strict";

const state = {
  currentUser: null,
  activeConversationId: null,
  conversations: [],
  patterns: [],
  messages: [],
  query: "",
  sending: false,
  pendingDelete: null,
  pendingChatDeleteId: null,
  pendingChatDeletions: new Map(),
  newPatternId: null,
  toastTimer: null,
  workspace: "chat",
  marketData: [],
  marketChartData: [],
  activeZoomPattern: null,
  authMode: "login",
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
  botFinalCapital: document.querySelector("#bot-final-capital"),
  botTotalTrades: document.querySelector("#bot-total-trades"),
  botWinRate: document.querySelector("#bot-win-rate"),
  botAvgGain: document.querySelector("#bot-avg-gain"),
  botAvgLoss: document.querySelector("#bot-avg-loss"),
  buyHoldReturn: document.querySelector("#buy-hold-return"),
  executedTradesList: document.querySelector("#executed-trades-list"),
  tradesCountBadge: document.querySelector("#trades-count-badge"),
  tradingViewWidget: document.querySelector("#tradingview-widget"),
  tradingViewLink: document.querySelector("#tradingview-link"),
  memoryCount: document.querySelector("#memory-count"),
  railMemoryCount: document.querySelector("#rail-memory-count"),
  memoryList: document.querySelector("#memory-list"),
  memorySearch: document.querySelector("#memory-search-input"),
  categoryFilter: document.querySelector("#category-filter"),
  exportButton: document.querySelector("#export-knowledge-button"),
  importInput: document.querySelector("#import-knowledge-input"),
  memoryCategory: document.querySelector("#memory-category"),
  addMemoryButton: document.querySelector("#add-memory-button"),
  addMemoryForm: document.querySelector("#add-memory-form"),
  cancelAddMemory: document.querySelector("#cancel-add-memory"),
  memoryPrompt: document.querySelector("#memory-prompt"),
  memoryResponse: document.querySelector("#memory-response"),
  memoryFormError: document.querySelector("#memory-form-error"),
  forgetDialog: document.querySelector("#forget-dialog"),
  forgetCopy: document.querySelector("#forget-copy"),
  deleteChatDialog: document.querySelector("#delete-chat-dialog"),
  deleteChatCopy: document.querySelector("#delete-chat-copy"),
  toast: document.querySelector("#toast"),
  toastMessage: document.querySelector("#toast-message"),
  toastAction: document.querySelector("#toast-action"),
  toastClose: document.querySelector("#toast-close"),
  announcer: document.querySelector("#app-announcer"),
  cardZoomModal: document.querySelector("#card-zoom-modal"),
  zoomCardId: document.querySelector("#zoom-card-id"),
  zoomCardCategory: document.querySelector("#zoom-card-category"),
  zoomCardMode: document.querySelector("#zoom-card-mode"),
  zoomCloseBtn: document.querySelector("#zoom-close-btn"),
  zoomCardTrigger: document.querySelector("#zoom-card-trigger"),
  zoomKeywordRow: document.querySelector("#zoom-keyword-row"),
  zoomCardResponse: document.querySelector("#zoom-card-response"),
  zoomCopyBtn: document.querySelector("#zoom-copy-btn"),
  zoomTestBtn: document.querySelector("#zoom-test-btn"),
  zoomForgetBtn: document.querySelector("#zoom-forget-btn"),
  historyNavBtn: document.querySelector("#history-nav-btn"),
  railHistoryCount: document.querySelector("#rail-history-count"),
  chatHistoryModal: document.querySelector("#chat-history-modal"),
  historyCloseBtn: document.querySelector("#history-close-btn"),
  historySessionCount: document.querySelector("#history-session-count"),
  historyListContainer: document.querySelector("#history-list-container"),
  exportHistoryBtn: document.querySelector("#export-history-btn"),
  clearHistoryBtn: document.querySelector("#clear-history-btn"),

  // Multi-user Profile & Conversations
  userNameDisplay: document.querySelector("#user-name-display"),
  userRoleBadge: document.querySelector("#user-role-badge"),
  authActionBtn: document.querySelector("#auth-action-btn"),
  railConversationsList: document.querySelector("#rail-conversations-list"),
  navTeachBtn: document.querySelector("#nav-teach-btn"),
  navKnowledgeBtn: document.querySelector("#nav-knowledge-btn"),

  // Auth Modal
  authModal: document.querySelector("#auth-modal"),
  authModalTitle: document.querySelector("#auth-modal-title"),
  authSubtitle: document.querySelector("#auth-subtitle"),
  authTabLogin: document.querySelector("#auth-tab-login"),
  authTabRegister: document.querySelector("#auth-tab-register"),
  authCloseBtn: document.querySelector("#auth-close-btn"),
  authForm: document.querySelector("#auth-form"),
  authUsername: document.querySelector("#auth-username"),
  authUsernameLabel: document.querySelector("#auth-username-label"),
  authEmailGroup: document.querySelector("#auth-email-group"),
  authEmail: document.querySelector("#auth-email"),
  authPassword: document.querySelector("#auth-password"),
  authFormError: document.querySelector("#auth-form-error"),
  authSubmitBtn: document.querySelector("#auth-submit-btn"),
};

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const narrowWorkspace = window.matchMedia("(max-width: 1180px)");
let csrfToken = document.querySelector('meta[name="rustbot-csrf-token"]')?.getAttribute("content") || "";

document.addEventListener("DOMContentLoaded", initialize);

async function initialize() {
  restorePanelPreference();
  bindEvents();
  resizeComposer();
  updateMarketProvider();
  await checkAuth();
}

function bindEvents() {
  if (elements.authActionBtn) {
    elements.authActionBtn.addEventListener("click", () => {
      if (state.currentUser) {
        handleLogout();
      } else {
        openAuthModal("login");
      }
    });
  }

  if (elements.authTabLogin) {
    elements.authTabLogin.addEventListener("click", () => switchAuthTab("login"));
  }

  if (elements.authTabRegister) {
    elements.authTabRegister.addEventListener("click", () => switchAuthTab("register"));
  }

  if (elements.authCloseBtn) {
    elements.authCloseBtn.addEventListener("click", closeAuthModal);
  }

  if (elements.authForm) {
    elements.authForm.addEventListener("submit", handleAuthSubmit);
  }

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

  document.querySelectorAll(".category-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".category-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      const cat = tab.dataset.category || "all";
      state.category = cat;
      if (elements.categoryFilter) {
        elements.categoryFilter.value = cat;
      }
      loadKnowledge();
    });
  });

  if (elements.categoryFilter) {
    elements.categoryFilter.addEventListener("change", () => {
      const cat = elements.categoryFilter.value;
      state.category = cat;
      document.querySelectorAll(".category-tab").forEach((t) => {
        t.classList.toggle("active", (t.dataset.category || "all") === cat);
      });
      loadKnowledge();
    });
  }
  if (elements.exportButton) {
    elements.exportButton.addEventListener("click", exportKnowledge);
  }
  if (elements.importInput) {
    elements.importInput.addEventListener("change", importKnowledge);
  }

  elements.forgetDialog.addEventListener("close", () => {
    if (elements.forgetDialog.returnValue === "confirm" && state.pendingDelete) {
      forgetMemory(state.pendingDelete);
    }
    state.pendingDelete = null;
  });

  if (elements.deleteChatDialog) {
    elements.deleteChatDialog.addEventListener("close", () => {
      if (elements.deleteChatDialog.returnValue === "confirm" && state.pendingChatDeleteId) {
        executeDeleteConversationWithUndo(state.pendingChatDeleteId);
      }
      state.pendingChatDeleteId = null;
    });
  }

  elements.toastClose.addEventListener("click", hideToast);

  if (elements.historyCloseBtn) {
    elements.historyCloseBtn.addEventListener("click", closeHistoryModal);
  }
  if (elements.chatHistoryModal) {
    elements.chatHistoryModal.addEventListener("click", (event) => {
      if (event.target === elements.chatHistoryModal) closeHistoryModal();
    });
  }
  if (elements.exportHistoryBtn) {
    elements.exportHistoryBtn.addEventListener("click", exportHistoryLogs);
  }
  if (elements.clearHistoryBtn) {
    elements.clearHistoryBtn.addEventListener("click", clearHistoryLogs);
  }

  if (elements.zoomCloseBtn) {
    elements.zoomCloseBtn.addEventListener("click", closeCardZoomModal);
  }
  if (elements.cardZoomModal) {
    elements.cardZoomModal.addEventListener("click", (event) => {
      if (event.target === elements.cardZoomModal) closeCardZoomModal();
    });
  }
  if (elements.zoomCopyBtn) {
    elements.zoomCopyBtn.addEventListener("click", async () => {
      if (state.activeZoomPattern) {
        try {
          await navigator.clipboard.writeText(state.activeZoomPattern.response);
          showToast("Memory response copied to clipboard.");
        } catch {
          showToast("Failed to copy response.");
        }
      }
    });
  }
  if (elements.zoomTestBtn) {
    elements.zoomTestBtn.addEventListener("click", () => {
      if (state.activeZoomPattern) {
        const promptText = state.activeZoomPattern.keywords.join(" ");
        closeCardZoomModal();
        sendMessage(promptText);
      }
    });
  }
  if (elements.zoomForgetBtn) {
    elements.zoomForgetBtn.addEventListener("click", () => {
      if (state.activeZoomPattern) {
        const pattern = state.activeZoomPattern;
        closeCardZoomModal();
        openForgetDialog(pattern);
      }
    });
  }

  document.addEventListener("keydown", (event) => {
    const activeTag = document.activeElement?.tagName;
    const isTyping = activeTag === "INPUT" || activeTag === "TEXTAREA";
    if (event.key === "/" && !isTyping) {
      event.preventDefault();
      openKnowledgePanel();
      elements.memorySearch.focus();
    }
    if (event.key === "Escape") {
      if (elements.cardZoomModal?.open) {
        closeCardZoomModal();
      } else if (isKnowledgePanelOpen()) {
        closeKnowledgePanel();
      }
    }
  });

  narrowWorkspace.addEventListener("change", () => {
    elements.knowledgePanel.classList.remove("is-open");
    elements.panelOverlay.classList.remove("is-visible");
    document.body.classList.remove("panel-open");
    restorePanelPreference();
  });
}

/* ==========================================
   AUTHENTICATION & USER STATE
   ========================================== */
async function checkAuth() {
  try {
    const res = await api("/api/auth/me");
    if (res.user) {
      if (res.csrf_token) {
        csrfToken = res.csrf_token;
      }
      setUserState(res.user);
      await loadConversations();
      if (res.user.role === "admin") {
        await loadKnowledge();
      }
    } else {
      setUserState(null);
      openAuthModal("login");
    }
  } catch {
    setUserState(null);
    openAuthModal("login");
  }
}

function setUserState(user) {
  state.currentUser = user;
  if (user) {
    if (elements.userNameDisplay) elements.userNameDisplay.textContent = user.username;
    if (elements.userRoleBadge) {
      elements.userRoleBadge.textContent = user.role;
      elements.userRoleBadge.classList.toggle("admin", user.role === "admin");
    }
    if (elements.authActionBtn) elements.authActionBtn.textContent = "Log Out";
    if (elements.navTeachBtn) elements.navTeachBtn.hidden = user.role !== "admin";
    if (elements.navKnowledgeBtn) elements.navKnowledgeBtn.hidden = user.role !== "admin";
    if (elements.readyLabel) elements.readyLabel.textContent = `Connected as ${user.username}`;
  } else {
    if (elements.userNameDisplay) elements.userNameDisplay.textContent = "Guest";
    if (elements.userRoleBadge) {
      elements.userRoleBadge.textContent = "Visitor";
      elements.userRoleBadge.classList.remove("admin");
    }
    if (elements.authActionBtn) elements.authActionBtn.textContent = "Log In";
    if (elements.navTeachBtn) elements.navTeachBtn.hidden = true;
    if (elements.navKnowledgeBtn) elements.navKnowledgeBtn.hidden = true;
    if (elements.railConversationsList) elements.railConversationsList.replaceChildren();
    if (elements.readyLabel) elements.readyLabel.textContent = "Please sign in";
  }
}

function openAuthModal(mode = "login") {
  switchAuthTab(mode);
  if (elements.authFormError) {
    elements.authFormError.style.display = "none";
    elements.authFormError.textContent = "";
  }
  elements.authModal?.showModal();
}

function closeAuthModal() {
  elements.authModal?.close();
}

function switchAuthTab(mode) {
  state.authMode = mode;
  if (elements.authTabLogin) elements.authTabLogin.classList.toggle("active", mode === "login");
  if (elements.authTabRegister) elements.authTabRegister.classList.toggle("active", mode === "register");
  if (elements.authModalTitle) elements.authModalTitle.textContent = mode === "login" ? "Welcome back" : "Create an account";
  if (elements.authSubtitle) elements.authSubtitle.textContent = mode === "login" ? "Sign in to access your private conversations." : "Register to start chatting with RustBot.";
  if (elements.authUsernameLabel) elements.authUsernameLabel.textContent = mode === "login" ? "Username or Email" : "Username (min 3 chars)";
  if (elements.authEmailGroup) elements.authEmailGroup.style.display = mode === "register" ? "flex" : "none";
  if (elements.authSubmitBtn) elements.authSubmitBtn.textContent = mode === "login" ? "Log In" : "Create Account";
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const username = elements.authUsername?.value.trim();
  const password = elements.authPassword?.value;
  const email = elements.authEmail?.value.trim() || undefined;

  if (!username || !password) return;
  if (elements.authFormError) {
    elements.authFormError.style.display = "none";
    elements.authFormError.textContent = "";
  }

  elements.authSubmitBtn.disabled = true;
  elements.authSubmitBtn.textContent = state.authMode === "login" ? "Logging in…" : "Registering…";

  try {
    const endpoint = state.authMode === "login" ? "/api/auth/login" : "/api/auth/register";
    const body = state.authMode === "login" ? { username, password } : { username, email, password };
    const res = await api(endpoint, {
      method: "POST",
      body: JSON.stringify(body),
    });

    if (res.csrf_token) {
      csrfToken = res.csrf_token;
    }
    setUserState(res.user);
    closeAuthModal();
    showToast(state.authMode === "login" ? `Welcome back, ${res.user.username}!` : `Account created! Welcome, ${res.user.username}!`);
    await loadConversations();
    if (res.user.role === "admin") {
      await loadKnowledge();
    }
  } catch (error) {
    if (elements.authFormError) {
      elements.authFormError.textContent = error.message;
      elements.authFormError.style.display = "block";
    }
  } finally {
    elements.authSubmitBtn.disabled = false;
    elements.authSubmitBtn.textContent = state.authMode === "login" ? "Log In" : "Create Account";
  }
}

async function handleLogout() {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {
    // Ignore error on logout
  }
  setUserState(null);
  state.messages = [];
  state.conversations = [];
  state.activeConversationId = null;
  elements.conversation.replaceChildren(createWelcomeState());
  elements.welcome = document.querySelector("#welcome-state");
  showToast("Logged out successfully.");
  openAuthModal("login");
}


async function loadKnowledge() {
  try {
    const url = state.category && state.category !== "all"
      ? `/api/memories?category=${encodeURIComponent(state.category)}`
      : "/api/memories";
    const data = await api(url);
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

  if (!state.currentUser) {
    openAuthModal("login");
    return;
  }

  if (!state.activeConversationId) {
    await startNewConversation();
  }

  if (state.workspace !== "chat") switchWorkspace("chat");

  elements.composerInput.value = "";
  resizeComposer();
  appendMessage("user", message, { save: false });
  setSending(true);
  const loadingRow = appendLoadingMessage();
  const requestStartedAt = performance.now();

  try {
    const result = await api(`/api/conversations/${state.activeConversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({ message }),
    });
    const responseTimeMs = performance.now() - requestStartedAt;
    await wait(reducedMotion.matches ? 0 : Math.max(0, 280 - responseTimeMs));

    loadingRow.remove();
    const botText = result.assistant_message?.content || "Message received.";
    const row = appendMessage("bot", botText, {
      responseTimeMs,
      status: result.status,
      save: false,
    });

    if (result.status === "unknown") {
      row.querySelector(".message-body").append(createTeachCard(message));
      announce("RustBot does not know that answer yet. A teaching form is ready.");
    }

    // Update conversation title if needed
    const convObj = state.conversations.find((c) => c.id === state.activeConversationId);
    if (convObj && (!convObj.title || convObj.title === "New Conversation" || convObj.title === "New Chat")) {
      convObj.title = message.substring(0, 30);
      renderConversationsList();
      if (elements.conversationTitle) elements.conversationTitle.textContent = convObj.title;
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

  if (role === "bot" && options.status) {
    const badge = document.createElement("span");
    badge.className = `engine-badge badge-${options.status}`;
    if (options.status === "openrouter_ai" || options.status === "ai_learned_and_cached") {
      badge.innerHTML = `🌐 Web AI · Learned to memory`;
      badge.title = "Answer retrieved from Web AI models and auto-cached into local Knowledge Forge for instant future answers.";
    } else if (options.status === "memory_matched") {
      badge.innerHTML = `⚡ Knowledge Forge (<1ms)`;
      badge.title = "Direct instant match from local memory forge.";
    } else if (options.status === "math_matched") {
      badge.innerHTML = `🧮 Math Engine`;
    } else if (options.status === "market_matched") {
      badge.innerHTML = `📈 Market Engine`;
    }
    meta.append(badge);
  }

  const bubble = document.createElement("div");
  bubble.className = `message-bubble${options.error ? " is-error" : ""}`;
  if (role === "bot" && !options.error) {
    bubble.innerHTML = renderMarkdown(text);
  } else {
    bubble.textContent = text;
  }
  body.append(meta, bubble);

  if (role === "user") row.append(body, avatar);
  else row.append(avatar, body);

  document.querySelector(".message-list").append(row);

  scrollConversation();
  return row;
}

function appendLoadingMessage() {
  ensureMessageList();
  const row = document.createElement("article");
  row.className = "message-row bot is-loading";
  row.setAttribute("aria-label", "RustBot is searching the web and knowledge base");

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = "R";

  const body = document.createElement("div");
  body.className = "message-body";
  const meta = document.createElement("div");
  meta.className = "message-meta";

  const searchStatus = document.createElement("span");
  searchStatus.className = "searching-indicator";
  searchStatus.innerHTML = `<span class="search-globe">🌐</span> Searching the web & AI knowledge base…`;
  meta.append(searchStatus);

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
    "The server lost its connection or returned an error. Your message was not lost.",
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
      const result = await api("/api/memories", {
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

/* ==========================================
   MULTI-USER CONVERSATION MANAGEMENT
   ========================================== */
async function loadConversations() {
  if (!state.currentUser) return;
  try {
    const res = await api("/api/conversations");
    state.conversations = Array.isArray(res.conversations) ? res.conversations : [];
    renderConversationsList();
    if (state.conversations.length > 0) {
      if (!state.activeConversationId || !state.conversations.some((c) => c.id === state.activeConversationId)) {
        await selectConversation(state.conversations[0].id);
      }
    } else {
      await startNewConversation();
    }
  } catch (err) {
    console.error("Failed to load conversations:", err);
  }
}

function renderConversationsList() {
  if (!elements.railConversationsList) return;
  elements.railConversationsList.replaceChildren();

  state.conversations.forEach((conv) => {
    const item = document.createElement("div");
    item.className = `conversation-rail-item${conv.id === state.activeConversationId ? " active" : ""}`;
    item.setAttribute("role", "button");
    item.tabIndex = 0;

    const title = document.createElement("span");
    title.className = "conv-item-title";
    title.textContent = conv.title || "New Chat";

    const delBtn = document.createElement("button");
    delBtn.className = "conv-item-del-btn";
    delBtn.type = "button";
    delBtn.title = "Delete chat";
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      promptDeleteConversation(conv.id);
    });

    item.append(title, delBtn);
    item.addEventListener("click", () => selectConversation(conv.id));
    elements.railConversationsList.append(item);
  });
}

async function selectConversation(convId) {
  state.activeConversationId = convId;
  renderConversationsList();

  try {
    const res = await api(`/api/conversations/${convId}/messages`);
    elements.conversation.replaceChildren();
    ensureMessageList();

    const convObj = state.conversations.find((c) => c.id === convId);
    if (elements.conversationTitle) {
      elements.conversationTitle.textContent = convObj?.title || "Active Chat";
    }

    state.messages = [];
    if (Array.isArray(res.messages) && res.messages.length > 0) {
      res.messages.forEach((m) => {
        appendMessage(m.role === "assistant" ? "bot" : "user", m.content, { save: false });
      });
    } else {
      elements.conversation.replaceChildren(createWelcomeState());
      elements.welcome = document.querySelector("#welcome-state");
    }
  } catch (err) {
    showToast("Could not load conversation messages.");
  }
}

async function startNewConversation() {
  if (!state.currentUser) {
    openAuthModal("login");
    return;
  }
  switchWorkspace("chat");
  try {
    const res = await api("/api/conversations", {
      method: "POST",
      body: JSON.stringify({ title: "New Conversation" }),
    });
    if (res.conversation) {
      state.conversations.unshift(res.conversation);
      await selectConversation(res.conversation.id);
    }
  } catch (err) {
    showToast("Failed to create conversation.");
  }
  elements.composerInput.value = "";
  resizeComposer();
  elements.composerInput.focus();
}

function promptDeleteConversation(convId) {
  const conv = state.conversations.find((c) => c.id === convId);
  state.pendingChatDeleteId = convId;
  if (elements.deleteChatCopy) {
    elements.deleteChatCopy.textContent = conv
      ? `Are you sure you want to delete "${conv.title || "New Chat"}"? Learned knowledge in the Knowledge Forge will be preserved.`
      : "Are you sure you want to delete this conversation?";
  }
  if (elements.deleteChatDialog) {
    elements.deleteChatDialog.showModal();
  } else {
    executeDeleteConversationWithUndo(convId);
  }
}

function executeDeleteConversationWithUndo(convId) {
  const convIndex = state.conversations.findIndex((c) => c.id === convId);
  if (convIndex === -1) return;
  const deletedConvObj = state.conversations[convIndex];

  // 1. Remove from local list immediately
  state.conversations.splice(convIndex, 1);
  if (state.activeConversationId === convId) {
    state.activeConversationId = null;
    if (state.conversations.length > 0) {
      selectConversation(state.conversations[0].id);
    } else {
      startNewConversation();
    }
  } else {
    renderConversationsList();
  }

  // 2. Schedule backend deletion in 5 seconds
  const timerId = window.setTimeout(async () => {
    try {
      await api(`/api/conversations/${convId}`, { method: "DELETE" });
    } catch (err) {
      console.error("Backend delete conversation error:", err);
    }
    state.pendingChatDeletions.delete(convId);
  }, 5000);

  state.pendingChatDeletions.set(convId, { timerId, convObj: deletedConvObj });

  // 3. Show Undo Toast for 5 seconds
  showToast(
    "Conversation deleted.",
    () => {
      const pending = state.pendingChatDeletions.get(convId);
      if (pending) {
        window.clearTimeout(pending.timerId);
        state.pendingChatDeletions.delete(convId);
        if (!state.conversations.some((c) => c.id === convId)) {
          state.conversations.unshift(pending.convObj);
          selectConversation(convId);
          showToast("Conversation restored.");
        }
      }
    },
    null,
    5000
  );
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
  eyebrow.append(document.createElement("span"), " Local · Multi-user isolated");
  const title = document.createElement("h2");
  title.textContent = "Ask. Teach. Repeat.";
  const copy = document.createElement("p");
  copy.className = "welcome-copy";
  copy.textContent =
    "A secured local assistant with multi-user session isolation. Try one of the prompts below or write your own.";
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

function updateHistoryCount() {
  const count = state.conversations.length;
  if (elements.railHistoryCount) elements.railHistoryCount.textContent = String(count);
  if (elements.historySessionCount) elements.historySessionCount.textContent = `${count} active conversations`;
}

async function openHistoryModal() {
  if (!elements.chatHistoryModal) return;
  await renderHistoryModal();
  elements.chatHistoryModal.showModal();
}

function closeHistoryModal() {
  if (elements.chatHistoryModal?.open) {
    elements.chatHistoryModal.close();
  }
}

async function renderHistoryModal() {
  if (!elements.historyListContainer) return;
  elements.historyListContainer.replaceChildren();

  if (!state.conversations.length) {
    const emptyState = document.createElement("div");
    emptyState.style.padding = "20px";
    emptyState.style.textAlign = "center";
    emptyState.style.color = "#838a84";
    emptyState.textContent = "No conversations recorded yet. Start talking to RustBot!";
    elements.historyListContainer.append(emptyState);
    return;
  }

  const sectionTitle = document.createElement("p");
  sectionTitle.style.fontSize = "11px";
  sectionTitle.style.fontWeight = "700";
  sectionTitle.style.color = "#34d399";
  sectionTitle.style.textTransform = "uppercase";
  sectionTitle.textContent = "Your Server Conversations";
  elements.historyListContainer.append(sectionTitle);

  state.conversations.forEach((conv) => {
    const card = document.createElement("div");
    card.style.background = "rgba(255, 255, 255, 0.05)";
    card.style.border = "1px solid rgba(255, 255, 255, 0.1)";
    card.style.borderRadius = "12px";
    card.style.padding = "12px 14px";
    card.style.display = "flex";
    card.style.justifyContent = "space-between";
    card.style.alignItems = "center";
    card.style.marginBottom = "8px";

    const info = document.createElement("div");
    const title = document.createElement("strong");
    title.style.display = "block";
    title.style.color = "#fff";
    title.style.fontSize = "13px";
    title.textContent = `“${conv.title || "New Chat"}”`;

    const meta = document.createElement("span");
    meta.style.fontSize = "10px";
    meta.style.color = "#94a3b8";
    meta.textContent = `${new Date(conv.created_at || Date.now()).toLocaleString()}`;
    info.append(title, meta);

    const loadBtn = document.createElement("button");
    loadBtn.className = "toolbar-action-btn";
    loadBtn.type = "button";
    loadBtn.textContent = "Open";
    loadBtn.addEventListener("click", async () => {
      await selectConversation(conv.id);
      closeHistoryModal();
    });

    card.append(info, loadBtn);
    elements.historyListContainer.append(card);
  });
}

async function exportHistoryLogs() {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({ conversations: state.conversations }, null, 2));
  const downloadAnchor = document.createElement("a");
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", `rustbot-conversations-${new Date().toISOString().slice(0,10)}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
  showToast("Exported conversations metadata.");
}

async function clearHistoryLogs() {
  if (state.activeConversationId) {
    closeHistoryModal();
    promptDeleteConversation(state.activeConversationId);
  }
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
  } else if (destination === "history") {
    openHistoryModal();
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
    elements.marketTrainButton.firstElementChild.textContent = apiKey ? "Training AI-Enhanced Model…" : "Training chronological baseline…";
    elements.datasetStatus.textContent = `${candles.length} live candles ${apiKey ? "(OpenRouter AI Connected 🤖)" : `(Recorded: ${response.recorded_count || candles.length})`}`;
    elements.readyLabel.textContent = `Dataset · ${candles.length} candles`;
    await wait(reducedMotion.matches ? 0 : 40);
    const result = runMarketExperiment(candles);

    let openRouterAnalysis = null;
    elements.marketTrainButton.firstElementChild.textContent = "Querying OpenRouter AI Model…";
    openRouterAnalysis = await callOpenRouterMarketAnalysis(apiKey, symbol, candles, result);

    renderMarketReport(result, response.provider || provider, response.symbol || symbol, timeframe, openRouterAnalysis);
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
  elements.marketEmpty.hidden = true;
  elements.marketReport.hidden = false;
  elements.reportSymbol.textContent = symbol.toUpperCase();
  elements.reportTimeframe.textContent = `${timeframe} · ${provider}`;
  elements.upProbability.textContent = `${(result.probability * 100).toFixed(1)}%`;
  elements.probabilityFill.style.width = `${Math.max(2, Math.min(98, result.probability * 100))}%`;
  elements.testAccuracy.textContent = `${(result.accuracy * 100).toFixed(1)}%`;
  elements.strategyReturn.textContent = formatSignedPercent(result.strategyReturn);
  elements.strategyReturn.style.color = result.strategyReturn >= 0 ? "#477259" : "#a14536";
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

  if (testSamples.length > 1) {
    const assetShares = initialCapital / testSamples[0].close;
    let currentPosition = 0; // 0 = Cash, 1 = Long
    let entryPrice = 0;
    let adaptiveThreshold = 0.0012; // Base signal threshold
    let consecutiveLosses = 0;

    for (let i = 0; i < testSamples.length; i++) {
      const price = testSamples[i].close;
      const candle = testSamples[i];
      const benchmarkVal = assetShares * price;
      benchmarkCurve.push(benchmarkVal);

      const prevPrice = i > 0 ? testSamples[i - 1].close : price;
      const pctChange = (price - prevPrice) / prevPrice;

      // Online Signal Generation with Adaptive Threshold
      if (pctChange > adaptiveThreshold && currentPosition === 0) {
        currentPosition = 1;
        entryPrice = price;
        botEquity *= 0.999; // 0.1% transaction fee
      } else if (pctChange < -adaptiveThreshold && currentPosition === 1) {
        // Exit Long Trade & Learn Online
        const rawReturn = (price - entryPrice) / entryPrice;
        const netReturn = rawReturn - 0.001; // deduct exit fee
        const tradeWin = netReturn > 0;

        botEquity *= (1 + netReturn);

        if (tradeWin) {
          winCount++;
          totalWinPct += netReturn;
          consecutiveLosses = 0;
          adaptiveThreshold = Math.max(0.0008, adaptiveThreshold * 0.98); // Gain confidence, slightly lower threshold
        } else {
          lossCount++;
          totalLossPct += Math.abs(netReturn);
          consecutiveLosses++;
          adaptiveThreshold = Math.min(0.0035, adaptiveThreshold * 1.12); // Adapt to choppy market: require stronger conviction
        }

        // Online Experience Memory Note Generation
        let lessonNote = "";
        if (tradeWin) {
          lessonNote = netReturn > 0.02
            ? "🟢 Strong trend capture: high momentum signal validated."
            : "🟢 Scalp profit realized: positive feature alignment.";
        } else {
          if (consecutiveLosses > 1) {
            lessonNote = `🔴 Consecutive loss #${consecutiveLosses}: Raised threshold to ${(adaptiveThreshold * 100).toFixed(2)}% to filter false breakouts.`;
          } else {
            lessonNote = "🔴 Choppy market whipsaw: adaptively increased entry filter.";
          }
        }

        const dateStr = new Date(candle.timestamp > 1e11 ? candle.timestamp : candle.timestamp * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

        executedTrades.push({
          id: executedTrades.length + 1,
          time: dateStr,
          direction: "LONG",
          entryPrice: entryPrice,
          exitPrice: price,
          pnlPct: netReturn,
          capital: botEquity,
          lesson: lessonNote,
          isWin: tradeWin
        });

        currentPosition = 0;
      } else if (currentPosition === 1) {
        botEquity *= (1 + pctChange);
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

  renderExecutedTradesTable(executedTrades);

  // Render Equity Chart Canvas
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

  // Draw Bot Equity (Glowing Green Line)
  context.strokeStyle = "#34d399";
  context.lineWidth = 2.5;
  context.shadowColor = "rgba(52, 211, 153, 0.5)";
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
    emptyRow.innerHTML = `<td colspan="8" style="text-align: center; color: #838a84; padding: 16px;">No executed trades in this out-of-sample window.</td>`;
    container.append(emptyRow);
    return;
  }

  trades.slice().reverse().forEach((trade) => {
    const tr = document.createElement("tr");

    const pnlSign = trade.pnlPct >= 0 ? "+" : "";
    const pnlClass = trade.isWin ? "win" : "loss";
    const pnlFormatted = `${pnlSign}${(trade.pnlPct * 100).toFixed(2)}%`;

    tr.innerHTML = `
      <td>#${trade.id}</td>
      <td>${trade.time}</td>
      <td><span class="trade-direction-pill ${trade.direction.toLowerCase()}">${trade.direction}</span></td>
      <td>$${trade.entryPrice.toFixed(2)}</td>
      <td>$${trade.exitPrice.toFixed(2)}</td>
      <td><span class="trade-pnl-pill ${pnlClass}">${pnlFormatted}</span></td>
      <td>$${Math.round(trade.capital).toLocaleString()}</td>
      <td><span class="trade-adaptive-note">${trade.lesson}</span></td>
    `;
    container.append(tr);
  });
}

async function callOpenRouterChat(apiKey, promptMessage) {
  const key = (apiKey || elements.marketApiKey?.value || "").trim();

  const models = [
    "google/gemma-4-26b-a4b-it:free",
    "google/gemma-4-31b-it:free"
  ];

  for (const model of models) {
    try {
      const payload = {
        model: model,
        messages: [
          { role: "system", content: "You are RustBot, an intelligent self-learning AI coding and trading assistant." },
          { role: "user", content: promptMessage }
        ],
        max_tokens: 400,
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
        const text = data.choices?.[0]?.message?.content;
        if (text && text.trim()) return text.trim();
      }
    } catch (err) {
      console.warn(`OpenRouter model ${model} chat error:`, err);
    }
  }
  return null;
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
  const category = elements.memoryCategory ? elements.memoryCategory.value : "general";
  const submit = elements.addMemoryForm.querySelector("button[type='submit']");
  submit.disabled = true;
  submit.textContent = "Saving memory…";
  elements.memoryFormError.textContent = "";

  try {
    const result = await api("/api/knowledge", {
      method: "POST",
      body: JSON.stringify({ prompt, response, category }),
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
  forget.addEventListener("click", (event) => {
    event.stopPropagation();
    openForgetDialog(pattern);
  });
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
  mode.textContent = `${pattern.match_mode === "any" ? "Matches any keyword" : "Matches complete phrase"}${pattern.category ? ` · ${pattern.category}` : ""}`;
  card.append(top, trigger, keywords, response, mode);

  card.addEventListener("click", () => {
    openCardZoomModal(pattern);
  });

  return card;
}

function openCardZoomModal(pattern) {
  if (!elements.cardZoomModal) return;
  state.activeZoomPattern = pattern;
  elements.zoomCardId.textContent = `Memory #${String(pattern.id).padStart(2, "0")}`;
  elements.zoomCardCategory.textContent = pattern.category || "General";
  elements.zoomCardMode.textContent = pattern.match_mode === "any" ? "Matches any keyword" : "Matches complete phrase";

  const triggerText = pattern.keywords.join(pattern.match_mode === "any" ? " · " : " ");
  elements.zoomCardTrigger.textContent = triggerText;

  elements.zoomKeywordRow.replaceChildren();
  pattern.keywords.forEach((keyword) => {
    const chip = document.createElement("span");
    chip.className = "keyword-chip";
    chip.textContent = keyword;
    elements.zoomKeywordRow.append(chip);
  });

  elements.zoomCardResponse.innerHTML = renderMarkdown(pattern.response);
  elements.cardZoomModal.showModal();
  announce(`Opened Memory #${pattern.id} detail modal.`);
}

function closeCardZoomModal() {
  if (elements.cardZoomModal?.open) {
    elements.cardZoomModal.close();
  }
  state.activeZoomPattern = null;
}

function renderMarkdown(text) {
  if (!text) return "";
  let escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  escaped = escaped.replace(/```([\s\S]*?)```/g, (_, code) => {
    return `<pre class="code-block" style="background:rgba(0,0,0,0.3);padding:10px;border-radius:6px;overflow-x:auto;position:relative;margin:8px 0;"><code>${code.trim()}</code></pre>`;
  });

  escaped = escaped.replace(/`([^`]+)`/g, "<code style='background:rgba(255,255,255,0.1);padding:2px 6px;border-radius:4px;'>$1</code>");

  // Clean # at start of line/sentence only, rendering as clean bold heading
  escaped = escaped.replace(/^#{1,6}\s*(.+)$/gm, "<strong style='display:block;margin:6px 0 2px;color:var(--text-bright,#ffffff);font-size:1.05em;'>$1</strong>");

  escaped = escaped.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  escaped = escaped.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return escaped.replace(/\n/g, "<br>");
}

async function exportKnowledge() {
  try {
    const res = await fetch("/api/memories/export");
    const jsonText = await res.text();
    const blob = new Blob([jsonText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `knowledge-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Knowledge exported successfully.");
  } catch {
    showToast("Failed to export knowledge.");
  }
}

async function importKnowledge(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const res = await fetch("/api/memories/import", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-RustBot-CSRF": csrfToken },
      body: text,
    });
    const result = await res.json();
    if (result.status === "imported") {
      showToast(`Imported ${result.count} memories into the forge!`);
      loadKnowledge();
    } else {
      showToast(`Import failed: ${result.error || "Invalid file"}`);
    }
  } catch {
    showToast("Failed to import knowledge file.");
  } finally {
    e.target.value = "";
  }
}

function createEmptyMemories(query) {
  const empty = document.createElement("div");
  empty.className = "empty-knowledge-state";
  const mark = document.createElement("div");
  mark.className = "empty-icon";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = query ? "🔍" : "🧠";
  const title = document.createElement("h4");
  title.textContent = query ? "No memories match query" : "No memory learned yet";
  const copy = document.createElement("p");
  copy.textContent = query
    ? `Nothing matches “${elements.memorySearch.value.trim()}”.`
    : "Ask RustBot questions to auto-learn from Web AI, or teach it your own custom facts.";
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
    action.textContent = "+ Add First Memory";
    action.addEventListener("click", () => openTeachingForm());
  }
  empty.append(action);
  return empty;
}

function renderKnowledgeError(message) {
  elements.memoryList.replaceChildren();
  const empty = document.createElement("div");
  empty.className = "empty-knowledge-state";
  const title = document.createElement("h4");
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
  elements.forgetCopy.textContent = `“${pattern.keywords.join(" ")}” will stop returning its saved response.`;
  elements.forgetDialog.returnValue = "cancel";
  elements.forgetDialog.showModal();
}

async function forgetMemory(pattern) {
  try {
    await api(`/api/memories/${pattern.id}`, { method: "DELETE" });
    state.patterns = state.patterns.filter((item) => item.id !== pattern.id);
    updateMemorySummary();
    renderKnowledge();
    showToast("Memory removed from the forge.");
    announce("Memory removed.");
  } catch (error) {
    showToast(error.message);
  }
}

async function restoreMemory(pattern) {
  try {
    const result = await api("/api/memories", {
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

function showToast(message, actionOrLabel, maybeAction, customTimeout) {
  window.clearTimeout(state.toastTimer);
  elements.toastMessage.textContent = message;

  let label = "Undo";
  let actionFn = null;
  let duration = 4000;

  if (typeof actionOrLabel === "function") {
    actionFn = actionOrLabel;
    label = "Undo";
    duration = customTimeout || 5000;
  } else if (typeof actionOrLabel === "string" && typeof maybeAction === "function") {
    label = actionOrLabel;
    actionFn = maybeAction;
    duration = customTimeout || 5000;
  }

  if (actionFn) {
    elements.toastAction.hidden = false;
    elements.toastAction.textContent = label;
    elements.toastAction.onclick = () => {
      hideToast();
      actionFn();
    };
  } else {
    elements.toastAction.hidden = true;
    elements.toastAction.textContent = "";
    elements.toastAction.onclick = null;
  }

  elements.toast.hidden = false;
  state.toastTimer = window.setTimeout(hideToast, actionFn ? duration : 4000);
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
  const method = (options.method || "GET").toUpperCase();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    if (csrfToken) {
      headers.set("X-RustBot-CSRF", csrfToken);
    }
  }
  const response = await fetch(path, { ...options, headers });
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (response.status === 401 && !path.startsWith("/api/auth/login") && !path.startsWith("/api/auth/register")) {
    setUserState(null);
    openAuthModal("login");
    throw new Error(data.error || "Session expired. Please log in.");
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
