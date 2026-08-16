// ── WELCOME SCREEN ────────────────────────────────────────────────────
function resetWelcomeScreen() {
  const main = document.querySelector('.main');
  if (main) main.classList.add('welcome-mode');
  // Back at the welcome screen (new chat, or the last conversation was
  // deleted) — reopen the sidebar on desktop; it auto-collapses again once
  // a message actually gets sent (see hideWelcome()).
  const sb = document.getElementById('sidebar');
  if (sb && window.innerWidth > 640) sb.classList.remove('collapsed');
  const chatArea = document.getElementById('chat-area');
  chatArea.innerHTML = '';
  const ws = document.createElement('div');
  ws.className = 'welcome-screen';
  ws.id = 'welcome-screen';
  const greetings = ['Good to see you!', 'Mabuhay!', 'Welcome back!', 'Hello, developer!'];
  const greeting = window._GREETING_ACTIVE || greetings[Math.floor(Math.random() * greetings.length)];
  const _activeName = window._AI_NAME_ACTIVE || AI_NAME;
  ws.innerHTML = `
    <img class="welcome-icon" src="assets/logos/17_logo.png" alt="DEVCON 17">
    <div class="welcome-hero">
      <div class="welcome-title">${_activeName}</div>
      <div class="welcome-greeting">${greeting} <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/><path d="M5 3v4"/><path d="M3 5h4"/><path d="M19 17v4"/><path d="M17 19h4"/></svg></div>
    </div>
    <div class="welcome-brief" id="welcome-brief">${welcomeBriefText()}</div>
    <div class="suggestion-chips" id="suggestion-grid-welcome">
      <button class="suggestion-chip" onclick="suggest('What is DEVCON Barangay AI Code Camps? What will I learn and build today?')">
        <span class="suggestion-chip-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg></span> About Barangay AI
      </button>
      <button class="suggestion-chip" onclick="suggest('I am a beginner. Give me a simple first coding exercise — write a Python function to call a local Ollama API endpoint and print the response.')">
        <span class="suggestion-chip-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg></span> Start Coding
      </button>
      <button class="suggestion-chip" onclick="suggest('Please check my grammar and suggest improvements. Here is my text: [paste your text here]')">
        <span class="suggestion-chip-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4Z"/></svg></span> Grammar Check
      </button>
      <button class="suggestion-chip" onclick="suggest('Please review my code, suggest improvements, and explain any issues you find. Here is my code: [paste your code here]')">
        <span class="suggestion-chip-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span> Code Review
      </button>
      <button class="suggestion-chip" onclick="suggest('How does a local AI model work? Explain what Ollama does and what Qwen is, using simple analogies a high school student would understand.')">
        <span class="suggestion-chip-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a5 5 0 0 0-5 5c0 1.5.5 2.5 1 3.5.5 1 1 2 1 3.5h6c0-1.5.5-2.5 1-3.5.5-1 1-2 1-3.5a5 5 0 0 0-5-5z"/><path d="M9 21h6"/><path d="M10 18h4"/></svg></span> How It Works
      </button>
      <button class="suggestion-chip" onclick="suggest('How do I contribute to an open source project on GitHub as a complete beginner? Walk me through forking a repo and opening a pull request step by step.')">
        <span class="suggestion-chip-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" y1="9" x2="6" y2="21"/></svg></span> Contribute
      </button>
    </div>`;
  chatArea.appendChild(ws);
  document.getElementById('chat-title').textContent = window._AI_NAME_ACTIVE || AI_NAME;

  // Apply custom suggestions if configured
  if (SUGGESTIONS) {
    const grid = ws.querySelector('#suggestion-grid-welcome');
    if (grid) {
      grid.innerHTML = SUGGESTIONS.map(s => `
        <button class="suggestion-chip" onclick="suggest(${JSON.stringify(s.prompt)})">
          <span class="suggestion-chip-icon">${s.icon}</span> ${s.label}
        </button>`).join('');
    }
  }
}

// ── CHAT ACTIONS ──────────────────────────────────────────────────────
function clearChat() {
  messages = [];
  const session = getCurrentSession();
  if (session) { session.displayMessages = []; session.title = 'New conversation'; }
  resetWelcomeScreen();
  renderHistory();
  saveSessionsToStorage();
}

function newChat() {
  messages = [];
  createSession();
  resetWelcomeScreen();
  if (window.innerWidth <= 640) {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('overlay').classList.remove('visible');
  }
}

// Rewrites every hardcoded Ollama command in the markup to the one this
// user's shell can actually run. The HTML ships the bash form as readable
// fallback text; on Windows these become PowerShell. Keeping the commands
// in config.js means the guide, the modals, and the error bubbles can
// never drift apart.
function applyOllamaCmdHints() {
  const byKind = {
    start:   OLLAMA_START_CMD,
    stop:    OLLAMA_STOP_CMD,
    restart: OLLAMA_RESTART_CMD,
    persist: OLLAMA_PERSIST_CMD,
    script:  OLLAMA_SCRIPT_CMD,
  };
  document.querySelectorAll('[data-ollama-cmd]').forEach(el => {
    const cmd = byKind[el.dataset.ollamaCmd];
    if (cmd) el.textContent = cmd;
  });
}

// ── OFFLINE SHELL ─────────────────────────────────────────────────────
// Registers sw.js, which precaches every file the app needs to boot. Without
// it the page is only as offline-capable as the browser's HTTP cache felt like
// being that day — which is how a camp laptop with no signal ends up staring at
// a blank screen. Registration is deliberately non-blocking and never fatal:
// service workers need a secure context, so file:// and plain http on a LAN IP
// simply don't get one, and the app must still work there.
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js')
    .then(() => console.log('[SW] offline shell ready'))
    .catch(err => console.warn('[SW] not registered:', err.message));
}

// ── INIT ──────────────────────────────────────────────────────────────
window.addEventListener('load', async () => {
  registerServiceWorker();
  // The inline head script already resolved data-theme before first paint;
  // sync the in-memory flag + icons to match (default is dark).
  isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  syncThemeIcon();
  sidebarTab('chats');

  if (window.BarangayDB) await window.BarangayDB.initDB();
  loadKBDisabled();

  // Is this a published copy of somebody's AI? Decided before anything
  // renders, because it changes what the UI is even allowed to show.
  // Absent my-ai.json (every fresh clone, and every student mid-camp) this
  // is null and the app behaves exactly as it always has.
  const published = await loadPublishedConfig();
  window.PUBLISHED_CONFIG = published;
  window.IS_VISITOR = isVisitorMode(published);
  if (window.IS_VISITOR) lockVisitorUI();
  hideOwnerPitchFooter();   // no-op on localhost; covers unpublished deploys too

  initModelRegistry();   // restore saved endpoints + discover live local models
  document.documentElement.style.setProperty('--dc-blue', BRAND_COLOR);
  document.documentElement.style.setProperty('--dc-accent', ACCENT_COLOR);

  applyOllamaCmdHints();

  const titleEl = document.getElementById('chat-title');
  if (titleEl) titleEl.textContent = AI_NAME;
  const welcomeTitleEl = document.querySelector('.welcome-title');
  if (welcomeTitleEl) welcomeTitleEl.textContent = AI_NAME;

  if (window.IS_VISITOR) {
    // The owner's published file IS the configuration — their sources are
    // the only ones, so the brand-kit seed is skipped (a visitor should
    // never see a document the owner didn't choose to ship).
    applySettings(hydratePublishedSettings(published));
  } else {
    let saved = loadSettings();
    // Carry the seeded list forward explicitly instead of re-reading settings —
    // applySettings() rebuilds _TRAINING_FILES_MASTER from whatever it is handed,
    // so a re-read that didn't persist would erase the seed before it renders.
    const seeded = await seedDefaultSourcesIfNeeded(saved);
    if (seeded) saved = Object.assign(loadSettings(), { training_files: seeded });
    if (Object.keys(saved).length) applySettings(saved);
    else renderSourcesPanel();
  }

  if (SUGGESTIONS) {
    const grid = document.querySelector('.suggestion-chips');
    if (grid) {
      grid.innerHTML = SUGGESTIONS.map(s => `
        <button class="suggestion-chip" onclick="suggest(${JSON.stringify(s.prompt)})">
          <span class="suggestion-chip-icon">${s.icon}</span> ${s.label}
        </button>`).join('');
    }
  }

  const greetings = ['Good to see you!', 'Mabuhay!', 'Welcome!', 'Hello, developer!'];
  const el = document.getElementById('welcome-greeting-text');
  if (el) el.textContent = window._GREETING_ACTIVE || greetings[Math.floor(Math.random() * greetings.length)];

  // Restore previous sessions if any, otherwise start fresh
  if (loadSessionsFromStorage()) {
    const session = getCurrentSession();
    if (session && session.displayMessages.length) {
      messages = rebuildApiMessages(session.displayMessages);
      renderHistory();
      renderSessionMessages(session);
    } else {
      renderHistory();
      resetWelcomeScreen();
    }
  } else {
    createSession();
  }

  // The welcome/onboarding flow is camp material — a visitor came to use
  // somebody's AI, not to be walked through building one.
  if (!window.IS_VISITOR) openModal();
  document.getElementById('message-input').focus();
});
