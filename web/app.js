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
  railToggleBtn: document.querySelector("#rail-toggle-btn"),
  railExpandBtn: document.querySelector("#rail-expand-btn"),
  knowledgePanel: document.querySelector("#knowledge-panel"),
  knowledgeToggle: document.querySelector("#knowledge-toggle"),
  knowledgeClose: document.querySelector("#knowledge-close"),
  panelOverlay: document.querySelector("#panel-overlay"),
  readyLabel: document.querySelector("#ready-label"),
  workspaceEyebrow: document.querySelector("#workspace-eyebrow"),
  conversationTitle: document.querySelector("#conversation-title"),
  workspaceToggle: document.querySelector("#workspace-toggle"),
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
  zoomCardReadonly: document.querySelector("#zoom-card-readonly"),
  zoomViewBody: document.querySelector("#zoom-view-body"),
  zoomEditBody: document.querySelector("#zoom-edit-body"),
  zoomEditKeywords: document.querySelector("#zoom-edit-keywords"),
  zoomEditCategory: document.querySelector("#zoom-edit-category"),
  zoomEditMode: document.querySelector("#zoom-edit-mode"),
  zoomEditResponse: document.querySelector("#zoom-edit-response"),
  zoomEditError: document.querySelector("#zoom-edit-error"),
  zoomViewFooter: document.querySelector("#zoom-view-footer"),
  zoomEditFooter: document.querySelector("#zoom-edit-footer"),
  zoomEditBtn: document.querySelector("#zoom-edit-btn"),
  zoomEditCancelBtn: document.querySelector("#zoom-edit-cancel-btn"),
  zoomEditSaveBtn: document.querySelector("#zoom-edit-save-btn"),
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
  themeToggleBtn: document.querySelector("#theme-toggle-btn"),
  heroTypingText: document.querySelector("#hero-typing-text"),
};

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const narrowWorkspace = window.matchMedia("(max-width: 1024px)");
const mobileWorkspace = window.matchMedia("(max-width: 860px)");
let csrfToken = document.querySelector('meta[name="rustbot-csrf-token"]')?.getAttribute("content") || "";

document.addEventListener("DOMContentLoaded", initialize);

async function initialize() {
  restoreRailPreference();
  initTheme();
  initHeroTypewriter();
  bindEvents();
  resizeComposer();
  await checkAuth();
}

function getActiveTheme() {
  return document.documentElement.getAttribute("data-theme") || "light";
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
    });
  }

  window.addEventListener("storage", (event) => {
    if (event.key === "rustbot_theme" && event.newValue) {
      document.documentElement.setAttribute("data-theme", event.newValue);
      updateThemeUI(event.newValue);
    }
  });
}

function initHeroTypewriter() {
  const target = elements.heroTypingText || document.getElementById("hero-typing-text");
  if (!target) return;

  if (reducedMotion.matches) {
    target.textContent = "Ask. Teach. Repeat.";
    return;
  }

  const phrases = [
    "Ask. Teach. Repeat.",
    "Local & Multi-User Isolated.",
    "Learn. Remember. Automate.",
    "Fast, Private & Deterministic.",
    "Adaptive Market Intelligence."
  ];

  let phraseIndex = 0;
  let charIndex = phrases[0].length;
  let isDeleting = false;
  let timer = null;

  function typeTick() {
    if (elements.welcome && elements.welcome.hidden) {
      timer = setTimeout(typeTick, 1000);
      return;
    }

    const currentTarget = document.getElementById("hero-typing-text") || target;
    if (!currentTarget) {
      timer = setTimeout(typeTick, 1000);
      return;
    }

    const currentPhrase = phrases[phraseIndex];
    if (isDeleting) {
      charIndex -= 1;
      currentTarget.textContent = currentPhrase.substring(0, charIndex);
      if (charIndex <= 0) {
        isDeleting = false;
        phraseIndex = (phraseIndex + 1) % phrases.length;
        timer = setTimeout(typeTick, 450);
        return;
      }
      timer = setTimeout(typeTick, 35);
    } else {
      charIndex += 1;
      currentTarget.textContent = currentPhrase.substring(0, charIndex);
      if (charIndex >= currentPhrase.length) {
        isDeleting = true;
        timer = setTimeout(typeTick, 2800);
        return;
      }
      const delay = 65 + Math.floor(Math.random() * 25);
      timer = setTimeout(typeTick, delay);
    }
  }

  timer = setTimeout(() => {
    isDeleting = true;
    typeTick();
  }, 2800);
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

  document.addEventListener("click", (e) => {
    const promptBtn = e.target.closest("[data-prompt]");
    if (promptBtn) {
      sendMessage(promptBtn.dataset.prompt || "");
    }
  });

  document.querySelectorAll("[data-nav]").forEach((button) => {
    button.addEventListener("click", () => handleNavigation(button.dataset.nav));
  });

  elements.newChatButton.addEventListener("click", () => {
    startNewConversation();
    closeRailMobile();
  });
  if (elements.workspaceToggle) {
    elements.workspaceToggle.addEventListener("click", (e) => {
      e.preventDefault();
      window.location.href = "/market";
    });
  }
  elements.teachButton.addEventListener("click", () => openTeachingForm());
  elements.knowledgeToggle.addEventListener("click", toggleKnowledgePanel);
  elements.knowledgeClose.addEventListener("click", closeKnowledgePanel);
  elements.panelOverlay.addEventListener("click", () => {
    closeKnowledgePanel();
    closeRailMobile();
  });
  elements.addMemoryButton.addEventListener("click", () => toggleAddMemoryForm());
  elements.cancelAddMemory.addEventListener("click", () => toggleAddMemoryForm(false));
  elements.addMemoryForm.addEventListener("submit", saveManualMemory);

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

  if (elements.railToggleBtn) {
    elements.railToggleBtn.addEventListener("click", toggleRail);
  }
  if (elements.railExpandBtn) {
    elements.railExpandBtn.addEventListener("click", toggleRail);
  }

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

  // Delegated safe copy handler for code blocks (zero-XSS: pure textContent extraction)
  document.addEventListener("click", async (event) => {
    const copyBtn = event.target.closest(".code-copy-btn");
    if (!copyBtn) return;

    const wrapper = copyBtn.closest(".code-block-wrapper");
    if (!wrapper) return;

    const codeEl = wrapper.querySelector("pre code");
    if (!codeEl) return;

    const rawCode = codeEl.textContent || "";
    if (!rawCode) return;

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(rawCode);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = rawCode;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }

      const iconEl = copyBtn.querySelector(".copy-icon");
      const labelEl = copyBtn.querySelector(".copy-label");
      if (iconEl) iconEl.textContent = "✓";
      if (labelEl) labelEl.textContent = "Copied!";
      copyBtn.classList.add("is-copied");

      setTimeout(() => {
        if (iconEl) iconEl.textContent = "📋";
        if (labelEl) labelEl.textContent = "Copy";
        copyBtn.classList.remove("is-copied");
      }, 2000);
    } catch {
      showToast("Failed to copy code to clipboard.");
    }
  });
  if (elements.zoomForgetBtn) {
    elements.zoomForgetBtn.addEventListener("click", () => {
      if (state.activeZoomPattern) {
        const pattern = state.activeZoomPattern;
        closeCardZoomModal();
        openForgetDialog(pattern);
      }
    });
  }

  if (elements.zoomEditBtn) {
    elements.zoomEditBtn.addEventListener("click", () => {
      if (!state.activeZoomPattern) return;
      const pattern = state.activeZoomPattern;
      if (pattern.id <= 258) {
        showToast("System seed memories are read-only.");
        return;
      }
      setZoomModalMode("edit");
      if (elements.zoomEditKeywords) elements.zoomEditKeywords.value = pattern.keywords.join(", ");
      if (elements.zoomEditCategory) elements.zoomEditCategory.value = pattern.category || "general";
      if (elements.zoomEditMode) elements.zoomEditMode.value = pattern.match_mode || "phrase";
      if (elements.zoomEditResponse) elements.zoomEditResponse.value = pattern.response;
      if (elements.zoomEditKeywords) elements.zoomEditKeywords.focus();
    });
  }

  if (elements.zoomEditCancelBtn) {
    elements.zoomEditCancelBtn.addEventListener("click", () => {
      setZoomModalMode("view");
    });
  }

  if (elements.zoomEditSaveBtn) {
    elements.zoomEditSaveBtn.addEventListener("click", saveZoomMemoryEdit);
  }

  document.addEventListener("keydown", (event) => {
    const activeTag = document.activeElement?.tagName;
    const isTyping = activeTag === "INPUT" || activeTag === "TEXTAREA";
    if (event.key === "/" && !isTyping && state.currentUser?.role === "admin") {
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
    if (state.currentUser?.role === "admin") {
      restorePanelPreference();
    }
  });

  mobileWorkspace.addEventListener("change", () => {
    restoreRailPreference();
  });
}

function toggleRail() {
  if (mobileWorkspace.matches) {
    const isOpen = elements.appShell.classList.toggle("rail-open");
    elements.panelOverlay.classList.toggle("is-visible", isOpen);
    document.body.classList.toggle("panel-open", isOpen);
  } else {
    const isCollapsed = elements.appShell.classList.toggle("rail-collapsed");
    if (elements.railExpandBtn) {
      elements.railExpandBtn.hidden = !isCollapsed;
    }
    localStorage.setItem("rustbot-rail-collapsed", isCollapsed ? "true" : "false");
  }
}

function closeRailMobile() {
  if (mobileWorkspace.matches && elements.appShell.classList.contains("rail-open")) {
    elements.appShell.classList.remove("rail-open");
    elements.panelOverlay.classList.remove("is-visible");
    document.body.classList.remove("panel-open");
  }
}

function restoreRailPreference() {
  if (mobileWorkspace.matches) {
    elements.appShell.classList.remove("rail-open");
    if (elements.railExpandBtn) {
      elements.railExpandBtn.hidden = false;
    }
    return;
  }
  const isCollapsed = localStorage.getItem("rustbot-rail-collapsed") === "true";
  elements.appShell.classList.toggle("rail-collapsed", isCollapsed);
  if (elements.railExpandBtn) {
    elements.railExpandBtn.hidden = !isCollapsed;
  }
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
  const isAdmin = Boolean(user && user.role === "admin");

  // Toggle admin-only features across the UI (knowledge tab, teach button, etc.)
  document.querySelectorAll(".admin-only-feature").forEach((el) => {
    el.hidden = !isAdmin;
  });

  if (user) {
    if (elements.userNameDisplay) elements.userNameDisplay.textContent = user.username;
    if (elements.userRoleBadge) {
      elements.userRoleBadge.textContent = user.role;
      elements.userRoleBadge.classList.toggle("admin", isAdmin);
    }
    if (elements.authActionBtn) elements.authActionBtn.textContent = "Log Out";
    if (elements.readyLabel) elements.readyLabel.textContent = `Connected as ${user.username}`;
    
    // Non-admin users cannot see or open the knowledge panel
    if (!isAdmin) {
      elements.appShell.classList.add("knowledge-collapsed");
      elements.knowledgePanel?.classList.remove("is-open");
    } else {
      restorePanelPreference();
    }
  } else {
    if (elements.userNameDisplay) elements.userNameDisplay.textContent = "Guest";
    if (elements.userRoleBadge) {
      elements.userRoleBadge.textContent = "Visitor";
      elements.userRoleBadge.classList.remove("admin");
    }
    if (elements.authActionBtn) elements.authActionBtn.textContent = "Log In";
    if (elements.railConversationsList) elements.railConversationsList.replaceChildren();
    if (elements.readyLabel) elements.readyLabel.textContent = "Please sign in";
    elements.appShell.classList.add("knowledge-collapsed");
    elements.knowledgePanel?.classList.remove("is-open");
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
  sessionStorage.removeItem("rustbot_active_conv");
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

function titleCaseWord(w) {
  if (!w) return "";
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

function titleCasePhrase(phrase) {
  const acronyms = {
    tps: "TPS", btc: "BTC", eth: "ETH", sol: "SOL", xrp: "XRP", ai: "AI", api: "API",
    sql: "SQL", sqlite: "SQLite", ui: "UI", usd: "USD", eur: "EUR", pkr: "PKR",
    inr: "INR", gbp: "GBP", html: "HTML", css: "CSS", js: "JS", rust: "Rust",
    python: "Python", solana: "Solana", bitcoin: "Bitcoin", ethereum: "Ethereum",
    us: "US", usa: "USA", america: "US"
  };
  const words = (phrase || "").split(/\s+/).filter(Boolean);
  return words.map((w, i) => {
    const low = w.toLowerCase().replace(/^[^\w]+|[^\w]+$/g, "");
    if (acronyms[low]) return acronyms[low];
    if (i > 0 && ["in", "on", "at", "of", "for", "to", "vs", "by", "with", "and"].includes(low)) {
      return low;
    }
    return titleCaseWord(low || w);
  }).join(" ");
}

function generateSpecificTitle(prompt) {
  const trimmed = (prompt || "").trim();
  if (!trimmed) return "New Chat";

  const lower = trimmed.toLowerCase();

  // 1. Math queries
  if (/^[\d\s+\-*/^().%]+$/.test(trimmed) && trimmed.length <= 30) {
    return `Math: ${trimmed}`;
  }
  for (const prefix of ["solve ", "calculate ", "compute ", "evaluate "]) {
    if (lower.startsWith(prefix)) {
      const expr = trimmed.slice(prefix.length).trim();
      if (expr.length <= 25 && /[+\-*/]/.test(expr)) {
        return `Math: ${expr}`;
      }
    }
  }

  // 2. Greetings
  const greetingTokens = [
    "hi", "hello", "hey", "greetings", "good morning", "good evening", "good afternoon",
    "howdy", "sup", "yo", "hello there", "hi there", "hey there"
  ];
  const strippedGreeting = lower.replace(/[^\w\s]/g, "").trim();
  if (greetingTokens.includes(strippedGreeting)) {
    return "Greetings";
  }

  // 3. Bot capabilities
  const capTokens = [
    "what can you do", "who are you", "help", "capabilities", "what are your features",
    "how do you work", "what is rustbot", "introduce yourself"
  ];
  if (capTokens.includes(strippedGreeting)) {
    return "Bot Capabilities";
  }

  // 4. Conversational prefixes
  const prefixes = [
    "can you please explain to me about ",
    "can you explain to me about ",
    "can you please explain to me ",
    "can you explain to me ",
    "can you please explain how ",
    "can you please explain what ",
    "can you please explain why ",
    "can you please explain ",
    "can you explain how ",
    "can you explain what ",
    "can you explain why ",
    "can you explain the ",
    "can you explain ",
    "could you please explain ",
    "could you explain ",
    "can you please tell me about ",
    "can you tell me about ",
    "can you please tell me ",
    "can you tell me ",
    "can you help me with ",
    "can you help me understand ",
    "can you help me ",
    "i want to know about ",
    "i want to know ",
    "what do you know about ",
    "what can you tell me about ",
    "let's discuss about ",
    "let's discuss ",
    "let s discuss about ",
    "let s discuss ",
    "lets discuss about ",
    "lets discuss ",
    "write an argumentative essay on whether ",
    "write an argumentative essay on ",
    "write an essay on whether ",
    "write an essay on ",
    "write a blog post about ",
    "write a story about ",
    "write a ",
    "create a ",
    "how do i calculate the ",
    "how do i calculate ",
    "how do we calculate ",
    "how do you calculate ",
    "how do i ",
    "how do we ",
    "how do you ",
    "how to ",
    "how does ",
    "how can i ",
    "how can we ",
    "how high can ",
    "give me an overview of ",
    "give me a summary of ",
    "give me an ",
    "give me a ",
    "give me ",
    "show me ",
    "what is the difference between ",
    "difference between ",
    "what is the name of the ",
    "what is the name of ",
    "what is the ",
    "what are the ",
    "what was the ",
    "what were the ",
    "what is ",
    "what are ",
    "what was ",
    "what were ",
    "why does ",
    "why is the ",
    "why is ",
    "why are ",
    "who is the ",
    "who was the ",
    "who is ",
    "who was ",
    "analyze ",
    "analysis of ",
    "predict ",
    "explain how ",
    "explain what ",
    "explain why ",
    "explain the ",
    "explain ",
    "please ",
  ];

  let cleaned = trimmed;
  let found = true;
  while (found) {
    found = false;
    const cLower = cleaned.toLowerCase();
    for (const p of prefixes) {
      if (cLower.startsWith(p)) {
        cleaned = cleaned.slice(p.length).trimStart();
        found = true;
        break;
      }
    }
  }

  // 5. Clean trailing phrases
  const trailing = [
    " about and how does it work",
    " and how does it work",
    " and how it works",
    " how it works",
    " works",
    " right now",
    " in detail",
    " step by step",
    " for me",
    " please",
    " thanks",
    " thank you",
    " or down according to market sentiment",
    " according to market sentiment",
    " should be allowed in school",
    " should be allowed",
    " should be",
  ];
  let trailingFound = true;
  while (trailingFound) {
    trailingFound = false;
    const strippedPunct = cleaned.toLowerCase().replace(/[^\w\s]+$/g, "").trimEnd();
    for (const t of trailing) {
      if (strippedPunct.endsWith(t)) {
        const cutoff = strippedPunct.length - t.length;
        cleaned = cleaned.slice(0, cutoff).trimEnd();
        trailingFound = true;
        break;
      }
    }
  }

  // Strip trailing punctuation
  cleaned = cleaned.replace(/[^\w\s]+$/g, "").trim();

  // 6. Comparison pattern: "X and Y"
  if (cleaned.toLowerCase().includes(" and ")) {
    const parts = cleaned.split(/\s+and\s+/i);
    if (parts.length === 2) {
      const leftWords = parts[0].split(/\s+/).filter(Boolean);
      const rightWords = parts[1].split(/\s+/).filter(Boolean);
      if (leftWords.length > 0 && leftWords.length <= 3 && rightWords.length > 0 && rightWords.length <= 3) {
        return `${titleCasePhrase(parts[0])} vs ${titleCasePhrase(parts[1])}`;
      }
    }
  }

  // 7. Weather queries: "weather in <Location>" -> "<Location> Weather"
  if (cleaned.toLowerCase().startsWith("weather in ")) {
    const loc = cleaned.slice(11).trim();
    if (loc) {
      return `${titleCasePhrase(loc)} Weather`;
    }
  }

  // 8. Tokenize into words and drop initial noise words
  let words = cleaned
    .split(/\s+/)
    .map((w) => w.replace(/^[^\w]+|[^\w]+$/g, ""))
    .filter(Boolean);

  let startIdx = 0;
  while (startIdx < words.length && ["the", "a", "an", "about", "of", "to", "in"].includes(words[startIdx].toLowerCase())) {
    startIdx++;
  }

  const meaningfulWords = startIdx < words.length ? words.slice(startIdx) : words;
  if (!meaningfulWords.length) {
    return "General Discussion";
  }

  // Target 2 to 4 concise words (max 28 characters)
  const selectedWords = [];
  let totalChars = 0;
  for (const w of meaningfulWords.slice(0, 5)) {
    if (totalChars + w.length > 28 && selectedWords.length >= 2) {
      break;
    }
    selectedWords.push(w);
    totalChars += w.length + 1;
  }

  // Remove dangling trailing prepositions/conjunctions/auxiliary verbs
  const dangling = [
    "in", "on", "at", "of", "for", "to", "vs", "by", "with", "and", "or", "the", "a",
    "an", "is", "be", "about", "should", "would", "could", "can", "will", "must",
    "might", "do", "does", "did", "have", "has", "had"
  ];
  while (selectedWords.length > 1 && dangling.includes(selectedWords[selectedWords.length - 1].toLowerCase())) {
    selectedWords.pop();
  }

  const title = titleCasePhrase(selectedWords.join(" "));
  return title || "New Chat";
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

  elements.composerInput.value = "";
  resizeComposer();
  appendMessage("user", message, { save: false });
  setSending(true);

  // Pre-emptively compute and display specific title if conversation is still default
  const convObj = state.conversations.find((c) => c.id === state.activeConversationId);
  const isDefaultTitle = !convObj || !convObj.title || convObj.title === "New Conversation" || convObj.title === "New Chat";
  if (convObj && isDefaultTitle) {
    convObj.title = generateSpecificTitle(message);
    renderConversationsList();
    if (elements.conversationTitle) elements.conversationTitle.textContent = convObj.title;
  }

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

    // Reconcile conversation title with persisted server response
    if (convObj) {
      if (result.conversation_title) {
        convObj.title = result.conversation_title;
      } else if (isDefaultTitle) {
        convObj.title = generateSpecificTitle(message);
      }
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
      const savedActiveId = sessionStorage.getItem("rustbot_active_conv");
      const targetConv = (savedActiveId && state.conversations.find((c) => c.id === savedActiveId)) || state.conversations[0];
      await selectConversation(targetConv.id);
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
    item.addEventListener("click", () => {
      selectConversation(conv.id);
      closeRailMobile();
    });
    elements.railConversationsList.append(item);
  });
}

async function selectConversation(convId) {
  state.activeConversationId = convId;
  sessionStorage.setItem("rustbot_active_conv", convId);
  renderConversationsList();

  const convObj = state.conversations.find((c) => c.id === convId);
  if (elements.conversationTitle) {
    elements.conversationTitle.textContent = convObj?.title || "New Chat";
  }

  try {
    const res = await api(`/api/conversations/${convId}/messages`);
    elements.conversation.replaceChildren();
    ensureMessageList();

    if (elements.conversationTitle) {
      elements.conversationTitle.textContent = convObj?.title || "New Chat";
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
  closeKnowledgePanel();
  closeRailMobile();
  try {
    const res = await api("/api/conversations", {
      method: "POST",
      body: JSON.stringify({ title: "New Conversation" }),
    });
    if (res.conversation) {
      state.conversations.unshift(res.conversation);
      sessionStorage.setItem("rustbot_active_conv", res.conversation.id);
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
  const wrapper = document.createElement("div");
  wrapper.className = "welcome-state";
  wrapper.id = "welcome-state";

  const emblem = document.createElement("div");
  emblem.className = "forge-emblem";
  emblem.setAttribute("aria-hidden", "true");

  const ring = document.createElement("span");
  ring.className = "forge-ring";
  const core = document.createElement("span");
  core.className = "forge-core";
  core.textContent = "R";
  const spark1 = document.createElement("span");
  spark1.className = "forge-spark spark-one";
  const spark2 = document.createElement("span");
  spark2.className = "forge-spark spark-two";
  const spark3 = document.createElement("span");
  spark3.className = "forge-spark spark-three";
  emblem.append(ring, core, spark1, spark2, spark3);

  const eyebrow = document.createElement("p");
  eyebrow.className = "welcome-eyebrow";
  eyebrow.append(document.createElement("span"), " Local · Self-learning");

  const title = document.createElement("h2");
  title.id = "hero-typing-title";
  title.setAttribute("aria-label", "Ask. Teach. Repeat.");
  const typingSpan = document.createElement("span");
  typingSpan.id = "hero-typing-text";
  typingSpan.textContent = "Ask. Teach. Repeat.";
  const cursorSpan = document.createElement("span");
  cursorSpan.className = "typing-cursor";
  cursorSpan.setAttribute("aria-hidden", "true");
  cursorSpan.textContent = "|";
  title.append(typingSpan, cursorSpan);

  const copy = document.createElement("p");
  copy.className = "welcome-copy";
  copy.textContent =
    "A small local bot that gets smarter one answer at a time. If RustBot draws a blank, turn the moment into a new memory.";

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
    button.dataset.prompt = prompt;
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
  closeRailMobile();
  document.querySelectorAll("[data-nav]").forEach((button) => {
    const active = button.dataset.nav === destination;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });

  if (destination === "chat") {
    closeKnowledgePanel();
    elements.composerInput.focus();
  } else if (destination === "market") {
    window.location.href = "/market";
    return;
  } else if (destination === "teach") {
    if (!state.currentUser || state.currentUser.role !== "admin") {
      showToast("Access Restricted: Only administrators have access to forge memories.");
      return;
    }
    openTeachingForm();
  } else if (destination === "history") {
    openHistoryModal();
  } else if (destination === "knowledge") {
    if (!state.currentUser || state.currentUser.role !== "admin") {
      showToast("Access Restricted: Only administrators have access to the Knowledge Forge.");
      return;
    }
    openKnowledgePanel();
    elements.memorySearch.focus();
  }
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
  if (!state.currentUser || state.currentUser.role !== "admin") {
    elements.appShell.classList.add("knowledge-collapsed");
    elements.knowledgePanel?.classList.remove("is-open");
    syncPanelControls(false);
    return;
  }

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
  if (!state.currentUser || state.currentUser.role !== "admin") {
    showToast("Access Restricted: Only administrators have access to the Knowledge Forge.");
    return;
  }
  if (isKnowledgePanelOpen()) closeKnowledgePanel();
  else openKnowledgePanel();
}

function openKnowledgePanel() {
  if (!state.currentUser || state.currentUser.role !== "admin") {
    showToast("Access Restricted: Only administrators have access to the Knowledge Forge.");
    return;
  }
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
  if (!state.currentUser || state.currentUser.role !== "admin") {
    showToast("Access Restricted: Only administrators have access to forge memories.");
    return;
  }
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

  const isSeed = pattern.id <= 258;
  const isOwnerOrAdmin =
    (pattern.owner_user_id && pattern.owner_user_id === state.currentUser?.id) ||
    state.currentUser?.role === "admin";
  if (isSeed || !isOwnerOrAdmin) {
    forget.hidden = true;
    forget.style.display = "none";
  }

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

function setZoomModalMode(mode) {
  const isEdit = mode === "edit";
  if (elements.zoomViewBody) elements.zoomViewBody.style.display = isEdit ? "none" : "flex";
  if (elements.zoomViewFooter) elements.zoomViewFooter.style.display = isEdit ? "none" : "flex";
  if (elements.zoomEditBody) elements.zoomEditBody.style.display = isEdit ? "flex" : "none";
  if (elements.zoomEditFooter) elements.zoomEditFooter.style.display = isEdit ? "flex" : "none";
  if (elements.zoomEditError) {
    elements.zoomEditError.textContent = "";
    elements.zoomEditError.style.display = "none";
  }
}

function openCardZoomModal(pattern) {
  if (!elements.cardZoomModal) return;
  state.activeZoomPattern = pattern;
  setZoomModalMode("view");

  const isSeed = pattern.id <= 258;
  const isOwnerOrAdmin =
    (pattern.owner_user_id && pattern.owner_user_id === state.currentUser?.id) ||
    state.currentUser?.role === "admin";
  const canEdit = !isSeed && isOwnerOrAdmin;
  const canForget = !isSeed && isOwnerOrAdmin;

  if (elements.zoomCardReadonly) {
    elements.zoomCardReadonly.style.display = isSeed ? "inline-block" : "none";
  }
  if (elements.zoomEditBtn) {
    elements.zoomEditBtn.style.display = canEdit ? "inline-flex" : "none";
  }
  if (elements.zoomForgetBtn) {
    elements.zoomForgetBtn.style.display = canForget ? "inline-flex" : "none";
  }

  elements.zoomCardId.textContent = `Memory #${String(pattern.id).padStart(2, "0")}`;
  elements.zoomCardCategory.textContent = pattern.category || "General";
  elements.zoomCardMode.textContent =
    pattern.match_mode === "any" ? "Matches any keyword" : "Matches complete phrase";

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
  setZoomModalMode("view");
  state.activeZoomPattern = null;
}

async function saveZoomMemoryEdit() {
  if (!state.activeZoomPattern) return;
  const pattern = state.activeZoomPattern;
  if (pattern.id <= 258) {
    showToast("System seed memories are immutable and cannot be modified.");
    return;
  }

  const rawKeywords = elements.zoomEditKeywords?.value || "";
  const keywords = rawKeywords
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length > 0);

  if (keywords.length === 0) {
    if (elements.zoomEditError) {
      elements.zoomEditError.textContent = "Please provide at least one valid keyword.";
      elements.zoomEditError.style.display = "block";
    }
    return;
  }

  const responseText = (elements.zoomEditResponse?.value || "").trim();
  if (!responseText) {
    if (elements.zoomEditError) {
      elements.zoomEditError.textContent = "Saved response cannot be empty.";
      elements.zoomEditError.style.display = "block";
    }
    return;
  }

  const category = (elements.zoomEditCategory?.value?.trim() || "general").toLowerCase();
  const matchMode = elements.zoomEditMode?.value || "phrase";

  elements.zoomEditSaveBtn.disabled = true;
  elements.zoomEditSaveBtn.textContent = "Saving...";

  try {
    const res = await api(`/api/memories/${pattern.id}`, {
      method: "PUT",
      body: JSON.stringify({
        keywords,
        response: responseText,
        category,
        match_mode: matchMode,
      }),
    });

    const updated = res.memory || res.pattern;
    Object.assign(pattern, updated);
    state.activeZoomPattern = pattern;

    // Update pattern in state.patterns
    const idx = state.patterns.findIndex((p) => p.id === pattern.id);
    if (idx !== -1) {
      state.patterns[idx] = pattern;
    }

    // Refresh view mode fields
    elements.zoomCardCategory.textContent = pattern.category || "General";
    elements.zoomCardMode.textContent =
      pattern.match_mode === "any" ? "Matches any keyword" : "Matches complete phrase";
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

    // Re-render Knowledge Forge cards
    renderKnowledge();

    setZoomModalMode("view");
    showToast(`Memory #${pattern.id} updated successfully.`);
    announce(`Memory #${pattern.id} updated.`);
  } catch (err) {
    if (elements.zoomEditError) {
      elements.zoomEditError.textContent = err.message || "Failed to update memory.";
      elements.zoomEditError.style.display = "block";
    }
  } finally {
    elements.zoomEditSaveBtn.disabled = false;
    elements.zoomEditSaveBtn.innerHTML = '<span aria-hidden="true">💾</span> Save Changes';
  }
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatMarkdownInline(str) {
  if (!str) return "";
  let s = escapeHtml(str);

  // Links: [text](url) - strictly allow http, https, relative, or anchor links
  s = s.replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/|#)[^\s)"]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="md-link">$1</a>');

  // Bold: **text** or __text__
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");

  // Italic: *text* or _text_
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  s = s.replace(/_([^_]+)_/g, "<em>$1</em>");

  return s;
}

function renderMarkdown(text) {
  if (!text) return "";

  // 1. Normalize line endings and collapse excessive blank lines (3+ newlines -> 2)
  let src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  src = src.replace(/\n{3,}/g, "\n\n").trim();

  // 2. Extract code blocks so their contents remain untouched (NO UNDERSCORES in placeholder)
  const codeBlocks = [];
  src = src.replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const placeholder = `@@CODEBLOCK${codeBlocks.length}@@`;
    const escapedCode = escapeHtml(code.trim());
    const cleanLang = (lang || "").trim();
    const displayLang = cleanLang ? cleanLang.toUpperCase() : "CODE";
    codeBlocks.push(
      `<div class="code-block-wrapper"><div class="code-block-header"><span class="code-lang">${escapeHtml(displayLang)}</span><button type="button" class="code-copy-btn" aria-label="Copy code to clipboard"><span class="copy-icon" aria-hidden="true">📋</span><span class="copy-label">Copy</span></button></div><pre class="code-block" data-lang="${escapeHtml(cleanLang)}"><code>${escapedCode}</code></pre></div>`
    );
    return placeholder;
  });

  // 3. Extract inline code (NO UNDERSCORES in placeholder)
  const inlineCodes = [];
  src = src.replace(/`([^`\n]+)`/g, (_, code) => {
    const placeholder = `@@INLINECODE${inlineCodes.length}@@`;
    inlineCodes.push(`<code class="inline-code">${escapeHtml(code)}</code>`);
    return placeholder;
  });

  // 4. Parse Tables
  const lines = src.split("\n");
  const processedLines = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.includes("|") && i + 1 < lines.length) {
      const nextLine = lines[i + 1].trim();
      // Delimiter row e.g. |---|---| or |:---|---:|
      const isDelimiter = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(nextLine);

      if (isDelimiter) {
        const tableLines = [trimmed, nextLine];
        i += 2;
        while (i < lines.length) {
          const rowLine = lines[i].trim();
          if (rowLine.includes("|")) {
            tableLines.push(rowLine);
            i++;
          } else {
            break;
          }
        }

        const splitRow = (rowStr) => {
          let s = rowStr;
          if (s.startsWith("|")) s = s.slice(1);
          if (s.endsWith("|")) s = s.slice(0, -1);
          return s.split("|").map(c => c.trim());
        };

        const headers = splitRow(tableLines[0]);
        const delimiters = splitRow(tableLines[1]);
        const alignments = delimiters.map(d => {
          if (d.startsWith(":") && d.endsWith(":")) return "center";
          if (d.endsWith(":")) return "right";
          return "left";
        });

        let html = '<div class="table-wrapper"><table class="markdown-table"><thead><tr>';
        headers.forEach((h, idx) => {
          html += `<th style="text-align:${alignments[idx] || 'left'}">${formatMarkdownInline(h)}</th>`;
        });
        html += '</tr></thead><tbody>';

        for (let r = 2; r < tableLines.length; r++) {
          const cells = splitRow(tableLines[r]);
          html += '<tr>';
          headers.forEach((_, idx) => {
            html += `<td style="text-align:${alignments[idx] || 'left'}">${formatMarkdownInline(cells[idx] || '')}</td>`;
          });
          html += '</tr>';
        }
        html += '</tbody></table></div>';
        processedLines.push("\n\n" + html + "\n\n");
        continue;
      }
    }
    processedLines.push(line);
    i++;
  }

  src = processedLines.join("\n");

  // Ensure headings have blank lines around them
  src = src.replace(/(^|\n)(#{1,6}\s+[^\n]+)/g, "$1\n$2\n");
  // Ensure horizontal rules have blank lines around them
  src = src.replace(/(^|\n)((?:---|\*\*\*|___)\s*)($|\n)/g, "$1\n$2\n$3");

  // 5. Split by double-newlines into blocks
  const rawBlocks = src.split(/\n\n+/);
  const renderedBlocks = [];

  for (let block of rawBlocks) {
    block = block.trim();
    if (!block) continue;

    if (block.startsWith("@@CODEBLOCK") && block.endsWith("@@") && !block.includes("\n")) {
      renderedBlocks.push(block);
      continue;
    }
    if (block.startsWith('<div class="table-wrapper">')) {
      renderedBlocks.push(block);
      continue;
    }

    if (/^(?:---|\*\*\*|___)\s*$/.test(block)) {
      renderedBlocks.push('<hr class="markdown-hr">');
      continue;
    }

    if (/^#{1,6}\s+/.test(block)) {
      const headingHtml = block.replace(/^(#{1,6})\s+(.+)$/gm, (_, hashes, title) => {
        const level = Math.min(6, hashes.length + 1);
        return `<h${level} class="md-heading md-h${hashes.length}">${formatMarkdownInline(title)}</h${level}>`;
      });
      renderedBlocks.push(headingHtml);
      continue;
    }

    if (block.startsWith(">")) {
      const quoteText = block
        .split("\n")
        .map(l => l.replace(/^>\s?/, ""))
        .join("<br>");
      renderedBlocks.push(`<blockquote class="md-blockquote">${formatMarkdownInline(quoteText)}</blockquote>`);
      continue;
    }

    // Handle lists even if mixed with preceding introductory text
    const bLines = block.split("\n");
    let intro = [];
    let listItems = [];
    let listType = null; // 'ul' or 'ol'
    let inList = false;

    for (const line of bLines) {
      const isUl = /^\s*[-*+]\s+/.test(line);
      const isOl = /^\s*\d+\.\s+/.test(line);

      if (isUl || isOl) {
        inList = true;
        listType = isUl ? "ul" : "ol";
        const content = line.replace(/^\s*(?:[-*+]|\d+\.)\s+/, "");
        listItems.push(`<li>${formatMarkdownInline(content)}</li>`);
      } else if (inList) {
        listItems.push(`<li>${formatMarkdownInline(line)}</li>`);
      } else {
        intro.push(line);
      }
    }

    if (listItems.length > 0) {
      if (intro.length > 0) {
        renderedBlocks.push(`<p>${intro.map(formatMarkdownInline).join("<br>")}</p>`);
      }
      renderedBlocks.push(`<${listType} class="md-list">${listItems.join("")}</${listType}>`);
      continue;
    }

    // Regular paragraph
    renderedBlocks.push(`<p>${bLines.map(formatMarkdownInline).join("<br>")}</p>`);
  }

  let finalHtml = renderedBlocks.join("");

  // Restore inline codes
  inlineCodes.forEach((codeHtml, idx) => {
    finalHtml = finalHtml.replace(`@@INLINECODE${idx}@@`, codeHtml);
  });

  // Restore code blocks
  codeBlocks.forEach((codeHtml, idx) => {
    finalHtml = finalHtml.replace(`@@CODEBLOCK${idx}@@`, codeHtml);
  });

  return finalHtml;
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
