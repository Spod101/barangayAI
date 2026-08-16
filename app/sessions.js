// ── SESSION MANAGEMENT ────────────────────────────────────────────────

function saveSessionsToStorage() {
  if (window.BarangayDB) window.BarangayDB.dbSaveSessions(sessions, currentSessionId);
}

function loadSessionsFromStorage() {
  if (!window.BarangayDB) return false;
  const { sessions: loaded, currentId } = window.BarangayDB.dbLoadSessions();
  if (!loaded.length) return false;
  sessions = loaded;
  currentSessionId = (currentId && loaded.some(s => s.id === currentId))
    ? currentId
    : loaded[0].id;
  return true;
}

function createSession(title) {
  const id = 'sess_' + Date.now();
  const session = { id, title: title || 'New conversation', displayMessages: [], created: new Date() };
  sessions.unshift(session);
  currentSessionId = id;
  renderHistory();
  saveSessionsToStorage();
  const main = document.querySelector('.main');
  if (main) main.classList.add('welcome-mode');
  return session;
}

function getCurrentSession() {
  return sessions.find(s => s.id === currentSessionId) || null;
}

function loadSession(id) {
  const session = sessions.find(s => s.id === id);
  if (!session) return;
  currentSessionId = id;
  messages = rebuildApiMessages(session.displayMessages);
  renderHistory();
  renderSessionMessages(session);
  if (window.BarangayDB) window.BarangayDB.dbSetCurrentSession(currentSessionId);
  if (window.innerWidth <= 640) {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('overlay').classList.remove('visible');
  } else if (session.displayMessages.length) {
    document.getElementById('sidebar').classList.add('collapsed');
  }
}

function renderHistory() {
  const list = document.getElementById('history-list');
  if (!sessions.length) {
    list.innerHTML = `<div class="history-item active">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      <span class="history-item-title">New conversation</span>
    </div>`;
    return;
  }
  list.innerHTML = sessions.map(s => {
    const userCount = s.displayMessages.filter(m => m.role === 'user').length;
    const isActive = s.id === currentSessionId;
    return `<div class="history-item${isActive ? ' active' : ''}" onclick="loadSession('${s.id}')">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      <span class="history-item-title">${escHtml(s.title)}</span>
      ${userCount > 0 ? `<span class="history-item-badge">${userCount}</span>` : ''}
      <button class="history-item-delete" onclick="event.stopPropagation(); deleteSession('${s.id}')" title="Delete conversation">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
      </button>
    </div>`;
  }).join('');
}

function deleteSession(id) {
  const idx = sessions.findIndex(s => s.id === id);
  if (idx === -1) return;
  sessions.splice(idx, 1);
  if (currentSessionId === id) {
    if (sessions.length) {
      loadSession(sessions[Math.min(idx, sessions.length - 1)].id);
    } else {
      currentSessionId = null;
      messages = [];
      resetWelcomeScreen();
      renderHistory();
    }
  } else {
    renderHistory();
  }
  saveSessionsToStorage();
}

function renderSessionMessages(session) {
  const chatArea = document.getElementById('chat-area');
  chatArea.innerHTML = '';

  if (!session.displayMessages.length) {
    resetWelcomeScreen();
    return;
  }

  const main = document.querySelector('.main');
  if (main) main.classList.remove('welcome-mode');

  const avatarLabel = window._AI_NAME_ACTIVE
    ? window._AI_NAME_ACTIVE.slice(0, 2).toUpperCase()
    : AI_AVATAR;

  // Follow-ups only belong under the newest answer — re-showing them mid-thread
  // would offer to ask questions the conversation has already moved past.
  let lastAssistantIdx = -1;
  session.displayMessages.forEach((m, i) => { if (m.role === 'assistant') lastAssistantIdx = i; });

  session.displayMessages.forEach((msg, idx) => {
    if (msg.role === 'user') {
      const row = document.createElement('div');
      row.className = 'message-row user';
      row.innerHTML = `<div class="avatar user">You</div><div class="bubble user">${escHtml(msg.content)}</div>`;
      chatArea.appendChild(row);
      const t = document.createElement('div');
      t.className = 'message-time user';
      t.textContent = msg.time || '';
      chatArea.appendChild(t);
    } else if (msg.role === 'assistant') {
      const row = document.createElement('div');
      row.className = 'message-row';
      const wasCancelled = isCancelledContent(msg.content);
      const bodyText = wasCancelled ? stripCancelMark(msg.content) : msg.content;
      row.innerHTML = `<div class="avatar ai">${avatarLabel}</div><div class="bubble ai"><div class="msg-body">${formatContent(bodyText)}</div></div>`;
      const bubble = row.querySelector('.bubble');
      // The trace is part of the answer, not decoration around it — reopening a
      // conversation shows the same record of work the student watched live.
      attachTrace(bubble, msg.trace);
      if (wasCancelled) bubble.appendChild(cancelledNoteEl());
      // Knowledge chips + source strips + the prompt inspector, in the same order
      // the live turn built them, so a reopened conversation is indistinguishable
      // from the one the student watched.
      attachProvenance(bubble, msg);
      if (idx === lastAssistantIdx) {
        const fuEl = buildFollowUpsEl(msg.followUps);
        if (fuEl) bubble.appendChild(fuEl);
      }
      chatArea.appendChild(row);
      const t = document.createElement('div');
      t.className = 'message-time';
      t.textContent = msg.time || '';
      chatArea.appendChild(t);
      if (msg.stats) renderMsgStats(chatArea, msg.stats);
    }
  });

  document.getElementById('chat-title').textContent = session.title;
  scrollToBottom();
}

