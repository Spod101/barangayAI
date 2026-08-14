// ── UI HELPERS ────────────────────────────────────────────────────────
function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('overlay');
  if (window.matchMedia('(max-width: 640px)').matches) {
    // Mobile: slide-in drawer with backdrop
    sb.classList.remove('collapsed');
    sb.classList.toggle('open');
    ov.classList.toggle('visible');
  } else {
    // Desktop: collapse to zero width (no backdrop)
    sb.classList.remove('open');
    ov.classList.remove('visible');
    sb.classList.toggle('collapsed');
  }
}

document.getElementById('overlay').addEventListener('click', () => {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('overlay').classList.remove('visible');
});

function toggleTheme() {
  isDark = !isDark;
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : '');
  try { localStorage.setItem('barangayai_theme', isDark ? 'dark' : 'light'); } catch (e) {}
  syncThemeIcon();
}

function syncThemeIcon() {
  const html = isDark
    ? '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'
    : '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>';
  document.querySelectorAll('#theme-icon, #rail-theme-icon').forEach(icon => icon.innerHTML = html);
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

// ── SEND / STOP BUTTON ────────────────────────────────────────────────
let _streamAbort = null;     // AbortController for the in-flight generation
let _userCancelled = false;  // true when the user pressed Stop

const _ICON_SEND = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22,2 15,22 11,13 2,9 22,2"/></svg>';
const _ICON_STOP = '<svg width="15" height="15" viewBox="0 0 24 24" fill="white"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>';

// Toggle the composer button between Send and Stop.
function setSendMode(streaming) {
  const btn = document.getElementById('send-btn');
  if (!btn) return;
  btn.disabled = false;
  btn.classList.toggle('stop', streaming);
  btn.title = streaming ? 'Stop generating' : 'Send message';
  btn.innerHTML = streaming ? _ICON_STOP : _ICON_SEND;
}

function handleSendClick() {
  if (isStreaming) stopGeneration();
  else sendMessage();
}

// Abort the current generation; the stream handler shows the cancelled note.
function stopGeneration() {
  _userCancelled = true;
  if (_streamAbort) { try { _streamAbort.abort(); } catch {} }
}

// Builds the "cancelled by the user" note (reused live and on session reload).
function cancelledNoteEl() {
  const n = document.createElement('div');
  n.className = 'cancelled-note';
  n.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2.5"/></svg><span>The prompt was cancelled by the user.</span>';
  return n;
}

// Builds the "Web sources" card shown under answers that used web search.
// Reused live (after streaming) and on session reload, so links persist.
function buildSourcesEl(sources) {
  if (!Array.isArray(sources) || !sources.length) return null;
  const wrap = document.createElement('div');
  wrap.className = 'web-sources';
  const head = document.createElement('div');
  head.className = 'web-sources-head';
  head.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18"/></svg><span>Web sources</span>';
  wrap.appendChild(head);
  sources.forEach((s, i) => {
    if (!s || !s.url) return;
    let host = '';
    try { host = new URL(s.url).hostname.replace(/^www\./, ''); } catch (e) { host = ''; }
    const a = document.createElement('a');
    a.className = 'web-source-link';
    a.href = s.url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.innerHTML = `<span class="web-source-num">${i + 1}</span>`
      + `<span class="web-source-title">${escHtml(s.title || host || s.url)}</span>`
      + (host ? `<span class="web-source-host">${escHtml(host)}</span>` : '');
    wrap.appendChild(a);
  });
  return wrap;
}

// Cancelled assistant messages carry this marker in their stored content. It lets
// us (a) re-render the note after reload and (b) exclude the whole turn from the
// model's context — without needing a DB schema change.
const CANCEL_MARK = '␛__CANCELLED__';
function isCancelledContent(c) { return typeof c === 'string' && c.includes(CANCEL_MARK); }
function stripCancelMark(c) { return (c || '').split(CANCEL_MARK).join(''); }

// Rebuild the API message list from a session's display messages, dropping any
// cancelled turn (the cancelled assistant reply AND the question it answered) so
// the model never sees an unanswered/aborted prompt.
function rebuildApiMessages(displayMessages) {
  const out = [];
  for (const m of (displayMessages || [])) {
    if (m.role === 'assistant' && isCancelledContent(m.content)) {
      if (out.length && out[out.length - 1].role === 'user') out.pop();
      continue;
    }
    out.push({ role: m.role, content: m.content });
  }
  return out;
}

function suggest(text) {
  document.getElementById('message-input').value = text;
  sendMessage();
}

function getTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── COPY CODE BLOCK ───────────────────────────────────────────────────
function copyCodeBlock(btn) {
  const block = btn.closest('.code-block');
  if (!block) return;
  const pre = block.querySelector('pre');
  if (!pre) return;
  const text = pre.textContent;
  const label = btn.querySelector('.code-copy-label');
  const done = () => {
    btn.classList.add('copied');
    if (label) label.textContent = 'Copied';
    setTimeout(() => { btn.classList.remove('copied'); if (label) label.textContent = 'Copy'; }, 1500);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else {
    fallbackCopy(text, done);
  }
}
window.copyCodeBlock = copyCodeBlock;

function fallbackCopy(text, cb) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); cb && cb(); } catch {}
  document.body.removeChild(ta);
}

// ── MARKDOWN RENDERER ─────────────────────────────────────────────────
function inlineFmt(text) {
  const codes = [];
  text = text.replace(/`([^`\n]+)`/g, (_, c) => {
    codes.push(`<code>${escHtml(c)}</code>`);
    return `\x00i${codes.length - 1}\x00`;
  });
  text = escHtml(text);
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');
  text = text.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  text = text.replace(/_([^_\n]+)_/g, '<em>$1</em>');
  text = text.replace(/~~(.+?)~~/g, '<s>$1</s>');
  text = text.replace(/\x00i(\d+)\x00/g, (_, n) => codes[+n]);
  return text;
}

function renderTable(lines) {
  const parseRow = l => l.split('|').slice(1, -1).map(c => c.trim());
  const isSep = row => row.length > 0 && row.every(c => /^:?-{1,}:?$/.test(c.trim()));
  const rows = lines.map(parseRow).filter(r => r.length > 0);
  if (!rows.length) return '';
  let thead = '', startIdx = 0;
  if (rows.length >= 2 && isSep(rows[1])) {
    thead = '<thead><tr>' + rows[0].map(c => `<th>${inlineFmt(c)}</th>`).join('') + '</tr></thead>';
    startIdx = 2;
  }
  const bodyRows = rows.slice(startIdx);
  const tbody = bodyRows.length
    ? '<tbody>' + bodyRows.map(r => '<tr>' + r.map(c => `<td>${inlineFmt(c)}</td>`).join('') + '</tr>').join('') + '</tbody>'
    : '';
  return `<div class="table-wrap"><table>${thead}${tbody}</table></div>`;
}

function formatContent(rawText) {
  const codeBlocks = [];
  let text = rawText.replace(/```([\w]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const header = `<div class="code-block-header">
        <span class="code-lang-label">${lang ? escHtml(lang) : 'code'}</span>
        <button class="code-copy-btn" onclick="copyCodeBlock(this)" title="Copy code" aria-label="Copy code">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          <span class="code-copy-label">Copy</span>
        </button>
      </div>`;
    codeBlocks.push(`<div class="code-block">${header}<pre>${escHtml(code.replace(/\n+$/, ''))}</pre></div>`);
    return `\x00c${codeBlocks.length - 1}\x00`;
  });

  const lines = text.split('\n');
  const parts = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const t = raw.trim();

    if (/^\x00c\d+\x00$/.test(t)) { parts.push(t); i++; continue; }
    if (t === '') { parts.push('<div style="height:6px"></div>'); i++; continue; }

    const hm = t.match(/^(#{1,4}) (.+)/);
    if (hm) { parts.push(`<h${Math.min(hm[1].length + 1, 4)}>${inlineFmt(hm[2])}</h${Math.min(hm[1].length + 1, 4)}>`); i++; continue; }

    if (/^(---+|___+|\*\*\*+)$/.test(t)) { parts.push('<hr>'); i++; continue; }

    if (t.startsWith('> ')) {
      const bq = [];
      while (i < lines.length && lines[i].trim().startsWith('> ')) { bq.push(inlineFmt(lines[i].trim().slice(2))); i++; }
      parts.push(`<blockquote>${bq.join('<br>')}</blockquote>`);
      continue;
    }

    if (t.startsWith('|')) {
      const tblLines = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) { tblLines.push(lines[i]); i++; }
      parts.push(renderTable(tblLines));
      continue;
    }

    if (/^[-*•+] /.test(t)) {
      const items = [];
      while (i < lines.length && /^[-*•+] /.test(lines[i].trim())) {
        items.push(`<li>${inlineFmt(lines[i].trim().replace(/^[-*•+] /, ''))}</li>`);
        i++;
      }
      parts.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (/^\d+[.)]\s/.test(t)) {
      const items = [];
      while (i < lines.length && /^\d+[.)]\s/.test(lines[i].trim())) {
        items.push(`<li>${inlineFmt(lines[i].trim().replace(/^\d+[.)]\s/, ''))}</li>`);
        i++;
      }
      parts.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    parts.push(`<p>${inlineFmt(t)}</p>`);
    i++;
  }

  let html = parts.join('');
  html = html.replace(/\x00c(\d+)\x00/g, (_, n) => codeBlocks[+n]);
  return html;
}

// ── MESSAGE RENDERING ─────────────────────────────────────────────────
function hideWelcome() {
  const ws = document.getElementById('welcome-screen');
  if (ws) ws.remove();
  const main = document.querySelector('.main');
  if (main) main.classList.remove('welcome-mode');
  // A conversation just started — collapse the sidebar for full chat width.
  // It reopens automatically on the next "New Chat".
  const sb = document.getElementById('sidebar');
  if (sb && window.innerWidth > 640) sb.classList.add('collapsed');
}

function appendUserMessage(text) {
  const chatArea = document.getElementById('chat-area');
  hideWelcome();
  const row = document.createElement('div');
  row.className = 'message-row user';
  row.innerHTML = `<div class="avatar user">You</div><div class="bubble user">${escHtml(text)}</div>`;
  chatArea.appendChild(row);
  const time = document.createElement('div');
  time.className = 'message-time user';
  time.textContent = getTime();
  chatArea.appendChild(time);
  scrollToBottom();
}

const _thinkingPhrases = ['Thinking', 'Reading your message', 'Generating response', 'Putting it together'];

function appendTypingIndicator() {
  const chatArea = document.getElementById('chat-area');
  const row = document.createElement('div');
  row.className = 'message-row';
  row.id = 'typing-row';
  row.innerHTML = `
    <div class="avatar ai">${getAIAvatar()}</div>
    <div class="bubble ai thinking-bubble">
      <div class="thinking-top-row" onclick="toggleThinkingCollapse(this)" role="button" tabindex="0">
        <div class="thinking-spinner"></div>
        <span class="thinking-label" id="thinking-label">Thinking</span>
        <span class="thinking-model-tag">${window.ACTIVE_MODEL}</span>
        <span class="thinking-top-chevron">▲</span>
      </div>
      <div class="thinking-collapsible" id="thinking-collapsible">
        <div class="thinking-edu-card" id="thinking-edu-card">
          <div class="thinking-edu-body">
            <span class="thinking-edu-icon" id="thinking-edu-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></span>
            <span class="thinking-edu-text" id="thinking-edu-text">Preparing your message...</span>
          </div>
          <div class="thinking-edu-footer">
            <span class="thinking-edu-footer-label">While waiting, explore:</span>
            <div class="thinking-edu-links">
              <a href="https://ollama.com" target="_blank" rel="noopener">Ollama docs</a>
              <a href="https://ollama.com/library/qwen2.5" target="_blank" rel="noopener">Qwen 2.5</a>
              <a href="https://github.com/devcon-ph/barangay-ai" target="_blank" rel="noopener">GitHub repo</a>
              <a href="https://devcon.ph" target="_blank" rel="noopener">DEVCON</a>
            </div>
          </div>
        </div>
        <div class="thinking-steps-section">
          <div class="thinking-steps-label">Process</div>
          <div class="thinking-steps-list" id="thinking-steps-list"></div>
        </div>
      </div>
    </div>`;
  chatArea.appendChild(row);

  let phraseIdx = 0, dotCount = 0;
  const labelEl = row.querySelector('#thinking-label');
  window._thinkingInterval = setInterval(() => {
    dotCount = (dotCount + 1) % 4;
    // While web search runs, pin the label instead of cycling the usual phrases.
    if (window._thinkingLabelOverride) {
      labelEl.textContent = window._thinkingLabelOverride + '.'.repeat(dotCount || 1);
      return;
    }
    if (dotCount === 0) phraseIdx = (phraseIdx + 1) % _thinkingPhrases.length;
    labelEl.textContent = _thinkingPhrases[phraseIdx] + '.'.repeat(dotCount || 1);
  }, 450);

  const eduIconEl = row.querySelector('#thinking-edu-icon');
  const eduTextEl = row.querySelector('#thinking-edu-text');
  const eduCard = row.querySelector('#thinking-edu-card');
  window._setEduCard = (icon, text) => {
    eduCard.style.opacity = '0';
    setTimeout(() => {
      eduIconEl.innerHTML = icon;
      eduTextEl.textContent = text;
      eduCard.style.opacity = '1';
    }, 200);
  };

  scrollToBottom();
}

function removeTypingIndicator() {
  clearInterval(window._thinkingInterval);
  clearInterval(window._thinkTimerInterval);
  window._thinkingLabelOverride = null;
  window._setEduCard = null;
  window._thinkTimerInterval = null;
  const el = document.getElementById('typing-row');
  if (el) el.remove();
}

function toggleThinkingCollapse(topRow) {
  const body = topRow.nextElementSibling;
  const chevron = topRow.querySelector('.thinking-top-chevron');
  if (!body) return;
  const collapsed = body.classList.toggle('hidden');
  chevron.style.transform = collapsed ? 'rotate(180deg)' : '';
}

function updateThinkingStep(stepId, status, label) {
  const list = document.getElementById('thinking-steps-list');
  if (!list) return;
  let step = document.getElementById(`ts-${stepId}`);
  if (!step) {
    step = document.createElement('div');
    step.id = `ts-${stepId}`;
    list.appendChild(step);
  }
  step.className = `thinking-step step-${status}`;
  const iconHtml = status === 'active'
    ? '<div class="step-mini-spinner"></div>'
    : status === 'done'
      ? '<span style="color:#22c55e;font-size:11px">✓</span>'
      : status === 'error'
        ? '<span style="color:#ef4444;font-size:11px">✗</span>'
        : '<span style="opacity:0.35;font-size:10px">○</span>';
  step.innerHTML = `<span class="step-icon">${iconHtml}</span><span>${escHtml(label)}</span>`;
  scrollToBottom();
}

function parseThinkDisplay(text) {
  const start = text.indexOf('<think>');
  if (start === -1) return { think: '', display: text };
  const end = text.indexOf('</think>');
  if (end === -1) {
    return { think: text.slice(start + 7), display: text.slice(0, start), partial: true };
  }
  return {
    think: text.slice(start + 7, end),
    display: (text.slice(0, start) + text.slice(end + 8)).trim(),
    partial: false
  };
}

function renderThinkInBubble(bubble, think, display, partial) {
  let thinkBlock = bubble.querySelector('.think-block');
  if (!thinkBlock) {
    thinkBlock = document.createElement('div');
    thinkBlock.className = 'think-block';
    thinkBlock.dataset.startMs = Date.now();
    thinkBlock.innerHTML = `
      <div class="think-block-header" onclick="toggleThinkBlock(this)">
        <span class="think-icon">⊗</span>
        <span class="think-header-label">Thinking...</span>
        <span class="think-block-chevron">›</span>
      </div>
      <div class="think-block-body hidden"></div>`;
    bubble.appendChild(thinkBlock);
    const main = document.createElement('div');
    main.className = 'think-main-content';
    bubble.appendChild(main);

    window._thinkTimerInterval = setInterval(() => {
      const label = thinkBlock.querySelector('.think-header-label');
      if (label) {
        const secs = Math.floor((Date.now() - +thinkBlock.dataset.startMs) / 1000);
        label.textContent = `Thinking for ${secs}s...`;
      }
    }, 500);
  }

  const body = thinkBlock.querySelector('.think-block-body');
  body.textContent = think;
  body.scrollTop = body.scrollHeight;

  if (!partial && window._thinkTimerInterval) {
    clearInterval(window._thinkTimerInterval);
    window._thinkTimerInterval = null;
    const secs = Math.round((Date.now() - +thinkBlock.dataset.startMs) / 1000);
    const label = thinkBlock.querySelector('.think-header-label');
    if (label) label.textContent = `Thought for ${secs} second${secs !== 1 ? 's' : ''}`;
    const icon = thinkBlock.querySelector('.think-icon');
    if (icon) icon.classList.add('think-done');
  }

  const main = bubble.querySelector('.think-main-content');
  if (main) main.innerHTML = display ? formatContent(display) : '';
}

function toggleThinkBlock(headerEl) {
  const body = headerEl.nextElementSibling;
  const chevron = headerEl.querySelector('.think-block-chevron');
  body.classList.toggle('hidden');
  chevron.classList.toggle('open');
}

// Resolve raw timing/usage into a self-contained, serializable stats object
// so it can be re-rendered later (e.g. when a saved conversation is reopened).
function makeMsgStats(elapsedMs, completionTokens, fullText, promptTokens, prepMs) {
  const outputExact = completionTokens != null;
  const outputTokens = (fullText != null) ? (completionTokens ?? Math.round(fullText.length / 4)) : (completionTokens ?? null);
  const inputExact = promptTokens != null;
  return {
    model: window.ACTIVE_MODEL,
    secs: elapsedMs / 1000,
    prepSecs: (prepMs != null) ? prepMs / 1000 : null,   // time-to-first-token (model load + prompt eval)
    inputTokens: promptTokens ?? null,
    inputExact,
    outputTokens,
    outputExact
  };
}

function appendMsgMeta(chatArea, elapsedMs, completionTokens, fullText, promptTokens, prepMs) {
  const stats = makeMsgStats(elapsedMs, completionTokens, fullText, promptTokens, prepMs);
  renderMsgStats(chatArea, stats);
  return stats;
}

function renderMsgStats(chatArea, stats) {
  const secs = stats.secs;
  const { model, inputTokens, inputExact, outputTokens, outputExact } = stats;
  const totalTokens = (inputTokens ?? 0) + (outputTokens ?? 0);

  // Speed (tokens/sec) — only meaningful when we have a real output count
  const speed = (outputExact && secs > 0) ? (outputTokens / secs).toFixed(1) + ' tok/s' : 'n/a';
  const prepStr = (stats.prepSecs != null) ? stats.prepSecs.toFixed(2) + 's' : 'n/a';
  const contextPct = totalTokens ? ((totalTokens / CONTEXT_WINDOW) * 100) : 0;
  const contextStr = contextPct < 0.1 && contextPct > 0 ? '<0.1' : contextPct.toFixed(1);

  // ── Compact summary row (clickable) ──────────────────────────────────
  const wrap = document.createElement('div');
  wrap.className = 'msg-meta-wrap';

  const meta = document.createElement('div');
  meta.className = 'msg-meta msg-meta-clickable';
  meta.title = 'Click for message stats';
  const summaryParts = [];
  if (outputTokens != null) summaryParts.push(outputTokens + ' tok');
  summaryParts.push(secs.toFixed(2) + 's');
  meta.innerHTML = summaryParts.map((p, i) =>
    i < summaryParts.length - 1
      ? `<span>${p}</span><span class="msg-meta-dot">·</span>`
      : `<span>${p}</span>`
  ).join('') +
    `<svg class="msg-meta-chevron" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
  meta.onclick = (e) => { e.stopPropagation(); toggleMsgStats(meta); };

  // ── Stats popover ─────────────────────────────────────────────────────
  const tilde = (exact) => exact ? '' : '~';
  const fmtTok = (n, exact) => n == null ? 'n/a' : `<b>${n} token${n === 1 ? '' : 's'}${tilde(exact)}</b>`;
  const pop = document.createElement('div');
  pop.className = 'msg-stats-popover hidden';
  pop.innerHTML = `
    <div class="msg-stats-title">Message Stats</div>
    <div class="msg-stats-rows">
      <div class="msg-stats-row"><span class="msg-stats-k">Model</span><span class="msg-stats-v mono">${escHtml(model)}</span></div>
      <div class="msg-stats-row"><span class="msg-stats-k">Input</span><span class="msg-stats-v">${fmtTok(inputTokens, inputExact)}</span></div>
      <div class="msg-stats-row"><span class="msg-stats-k">Output</span><span class="msg-stats-v">${fmtTok(outputTokens, outputExact)}</span></div>
      <div class="msg-stats-row"><span class="msg-stats-k">Total</span><span class="msg-stats-v">${totalTokens ? `<b>${totalTokens} tokens</b>` : 'n/a'}</span></div>
      <div class="msg-stats-row"><span class="msg-stats-k">Speed</span><span class="msg-stats-v">${speed}</span></div>
      <div class="msg-stats-row" title="Prep time — how long before the first token arrived (loading the model into memory + reading your prompt). Large on the first message, small once the model is warm."><span class="msg-stats-k">Prep</span><span class="msg-stats-v">${prepStr}</span></div>
      <div class="msg-stats-row"><span class="msg-stats-k">Time</span><span class="msg-stats-v">${secs.toFixed(2)}s</span></div>
      <div class="msg-stats-row"><span class="msg-stats-k">Cost</span><span class="msg-stats-v">n/a</span></div>
    </div>
    <div class="msg-stats-divider"></div>
    <div class="msg-stats-row"><span class="msg-stats-k">Context</span><span class="msg-stats-v"><b>${contextStr}% used</b></span></div>
    <div class="msg-stats-note">~ estimated token count</div>`;

  wrap.appendChild(meta);
  wrap.appendChild(pop);
  chatArea.appendChild(wrap);
}

function toggleMsgStats(metaEl) {
  const pop = metaEl.parentElement.querySelector('.msg-stats-popover');
  const isOpen = !pop.classList.contains('hidden');
  // Close any other open popovers first
  document.querySelectorAll('.msg-stats-popover').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.msg-meta-clickable.open').forEach(m => m.classList.remove('open'));
  if (!isOpen) {
    pop.classList.remove('hidden', 'up');
    metaEl.classList.add('open');
    // Open upward if the popover would overflow the bottom of the viewport
    // (the stats row sits at a message's bottom, often near the composer).
    const rect = metaEl.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < pop.offsetHeight + 24) pop.classList.add('up');
  }
}

// Close stats popovers when clicking anywhere else
document.addEventListener('click', () => {
  document.querySelectorAll('.msg-stats-popover').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.msg-meta-clickable.open').forEach(m => m.classList.remove('open'));
});

function appendAIMessage(text) {
  const chatArea = document.getElementById('chat-area');
  const row = document.createElement('div');
  row.className = 'message-row';
  row.innerHTML = `
    <div class="avatar ai">${getAIAvatar()}</div>
    <div class="bubble ai" id="ai-bubble-latest">${formatContent(text)}</div>`;
  chatArea.appendChild(row);
  const time = document.createElement('div');
  time.className = 'message-time';
  time.textContent = getTime();
  chatArea.appendChild(time);
  scrollToBottom();
}

function appendError(msg) {
  const chatArea = document.getElementById('chat-area');
  const err = document.createElement('div');
  err.className = 'error-bubble';
  err.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> ${escHtml(msg)}`;
  chatArea.appendChild(err);
  scrollToBottom();
}

function scrollToBottom() {
  const chatArea = document.getElementById('chat-area');
  chatArea.scrollTop = chatArea.scrollHeight;
}

document.getElementById('chat-area').addEventListener('scroll', function() {
  const { scrollTop, scrollHeight, clientHeight } = this;
  const btn = document.getElementById('scroll-btn');
  const atBottom = scrollHeight - scrollTop - clientHeight < 80;
  btn.classList.toggle('visible', !atBottom && scrollHeight > clientHeight + 200);

  // Close any open stats popover on scroll so it doesn't float over the messages.
  document.querySelectorAll('.msg-stats-popover:not(.hidden)').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.msg-meta-clickable.open').forEach(m => m.classList.remove('open'));
});

// ── HISTORY ───────────────────────────────────────────────────────────
function updateHistory(firstMessage) {
  const session = getCurrentSession();
  if (session && session.title === 'New conversation') {
    session.title = firstMessage.length > 32 ? firstMessage.slice(0, 32) + '…' : firstMessage;
  }
  renderHistory();
  const titleEl = document.getElementById('chat-title');
  if (titleEl && session) titleEl.textContent = session.title;
  saveSessionsToStorage();
}

// Header title is contenteditable — commit the rename on blur.
function commitTitleRename(el) {
  const session = getCurrentSession();
  if (!session) return;
  let text = el.textContent.replace(/\s+/g, ' ').trim();
  if (!text) text = 'New conversation';
  el.textContent = text;
  session.title = text;
  renderHistory();
  saveSessionsToStorage();
}

function handleTitleKey(e, el) {
  if (e.key === 'Enter') {
    e.preventDefault();
    el.blur();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    const session = getCurrentSession();
    el.textContent = session ? session.title : el.textContent;
    el.blur();
  }
}

// ── XHR FALLBACK ──────────────────────────────────────────────────────
function xhrFallback(payload) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${window.ACTIVE_BASE}/chat/completions`, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Authorization', `Bearer ${window.ACTIVE_KEY}`);
    xhr.timeout = 30000;
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText).choices?.[0]?.message?.content || 'No response.'); }
        catch { reject(new Error('Parse error')); }
      } else { reject(new Error(`HTTP ${xhr.status}`)); }
    };
    xhr.onerror   = () => reject(new Error('XHR network error'));
    xhr.ontimeout = () => reject(new Error('XHR timeout'));
    xhr.send(JSON.stringify({ ...payload, stream: false }));
  });
}

// ── EDUCATIONAL ERROR BUBBLE ──────────────────────────────────────────
// Renders the same teaching-style error card used for connection failures.
function renderErrorBubble(errorData) {
  const chatArea = document.getElementById('chat-area');
  if (!chatArea) return;
  hideWelcome();
  const errId = 'err-' + Date.now();
  const err = document.createElement('div');
  err.className = 'error-bubble';
  err.id = errId;
  err.innerHTML = `
    <div class="error-bubble-top">
      <div class="error-bubble-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      </div>
      <div>
        <div class="error-bubble-title">${escHtml(errorData.title)}</div>
        <div class="error-bubble-desc">${escHtml(errorData.desc)}</div>
      </div>
    </div>
    <div class="error-bubble-steps">
      <div class="error-bubble-steps-title">What to do next</div>
      ${(errorData.steps || []).map((s, i) => `
      <div class="error-step">
        <div class="error-step-num">${i + 1}</div>
        <span>${escHtml(s.text)}${s.code ? ` <code>${escHtml(s.code)}</code>` : ''}</span>
      </div>`).join('')}
    </div>
    <div class="error-bubble-actions">
      ${errorData.cta ? `
      <button class="error-bubble-cta" onclick="document.getElementById('${errId}').remove(); openGuide(${Number.isInteger(errorData.guidePage) ? errorData.guidePage : 0});">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
        ${escHtml(errorData.ctaLabel || 'Set up the AI')}
      </button>` : ''}
      <button class="error-bubble-dismiss" onclick="document.getElementById('${errId}').remove()">Dismiss</button>
    </div>`;
  chatArea.appendChild(err);
  scrollToBottom();
}

// A failed request is thrown as `HTTP <status>: <body>`. Pull the status back
// out, plus whatever human-readable reason the provider put in the body, so a
// failure can be explained instead of guessed at. status is null when the
// request never got a response at all (network / CORS).
function parseHttpError(msg) {
  const m = /^HTTP (\d{3})(?::\s*([\s\S]*))?$/.exec((msg || '').trim());
  if (!m) return { status: null, detail: '' };
  let detail = (m[2] || '').trim();
  try {
    const body = JSON.parse(detail);
    detail = body?.error?.message || body?.message || detail;
  } catch (e) {}
  if (detail.length > 300) detail = detail.slice(0, 300) + '…';
  return { status: Number(m[1]), detail };
}

// Troubleshooting card for a failed request to an added cloud endpoint. The
// Ollama-flavoured cards below are the right advice for a student running a
// model on their own machine and the wrong advice for one calling an API — they
// send the reader to restart a server they aren't using, while hiding the
// provider's own explanation of what it refused. No setup-guide CTA here for
// the same reason: that guide is about installing Ollama.
function cloudErrorCard(status, detail) {
  const host = (() => {
    try { return new URL(window.ACTIVE_BASE).host; } catch (e) { return window.ACTIVE_BASE; }
  })();
  const model = window.ACTIVE_MODEL || 'the model';
  const said = detail ? [{ text: `${host} said:`, code: detail }] : [];
  let title, desc, steps;

  if (status === null) {
    title = `Couldn't reach ${host}`;
    desc = 'The request never came back. That is usually the network rather than the endpoint itself.';
    steps = [
      { text: 'Check this machine is online, then send again' },
      { text: 'Open "Add Models" and press Test on this endpoint to confirm it answers' },
      { text: 'A blocked connection on a school or office network is common — a local model in the picker needs no internet' },
    ];
  } else if (status === 401 || status === 403) {
    title = `${host} rejected the API key`;
    desc = 'The endpoint was reached, but the key it was given is missing, wrong, or has no access to this model.';
    steps = [
      { text: 'Copy a fresh key from your provider dashboard' },
      { text: 'Open "Add Models" and add the endpoint again with that key — check it pasted whole, with no stray spaces' },
      ...said,
    ];
  } else if (status === 404) {
    title = `${host} has no model called "${model}"`;
    desc = 'The endpoint is reachable, but it does not recognise this model name. Providers rename and retire models fairly often.';
    steps = [
      { text: 'Open the model picker and choose a different model from this endpoint' },
      { text: 'If the list looks out of date, delete the endpoint in "Add Models" and add it again to re-read what it serves' },
      ...said,
    ];
  } else if (status === 429) {
    title = `${host} is rate-limiting this key`;
    desc = 'The request was fine — there have just been too many of them, or too many tokens, for what this key is currently allowed.';
    steps = [
      { text: 'Wait a minute, then send again' },
      { text: 'Free tiers reset on a schedule — check the usage page on your provider dashboard' },
      { text: 'Or switch to a local model in the picker, which has no quota at all' },
      ...said,
    ];
  } else if (status >= 500) {
    title = `${host} had a server error`;
    desc = 'The problem is on the provider\'s side, not in your setup or your message.';
    steps = [
      { text: 'Wait a few seconds and send again — these usually clear on their own' },
      { text: 'If it keeps failing, check the provider\'s status page' },
      ...said,
    ];
  } else {
    title = `${host} rejected the request`;
    desc = 'The endpoint was reached and the key worked, but it refused something in the request itself — usually an option this model does not accept.';
    steps = [
      { text: 'Turn Deep thinking and Web search off, then send again — that narrows it to one option' },
      { text: 'Lower "Max tokens" in Settings → Model if it is above what this model allows' },
      { text: 'Confirm the model name is one this endpoint actually serves' },
      ...said,
    ];
  }
  return { title, desc, steps, cta: false };
}

// Two distinct, educational states when there is no model to send to.
const NO_MODEL_ERROR = {
  title: "No AI model is installed on this computer",
  desc: "An AI model is the “brain” that writes the replies — it lives as a file on your machine and has to be downloaded once before you can chat. Right now Ollama has none to load, so there is nothing to talk to yet.",
  steps: [
    { text: 'Make sure Ollama (the program that runs models locally) is installed and running:', code: OLLAMA_START_CMD },
    { text: 'Download a small, fast starter model — about 2 GB, one time only:', code: 'ollama pull qwen2.5:3b' },
    { text: 'Check what is installed any time with:', code: 'ollama list' },
    { text: 'Refresh this page — the model will appear in the picker at the bottom of the chat, then select it' },
  ],
  cta: true,
  guidePage: 2,   // Pre-install — install Ollama + pull a starter model
};
const SELECT_MODEL_ERROR = {
  title: "Choose a model before you start chatting",
  desc: "Good news — your computer already has AI model(s) ready. But none is selected yet, so the app does not know which “brain” to send your message to. Each model has its own size, speed, and strengths, so the choice is yours.",
  steps: [
    { text: 'Click the model selector at the bottom of the chat, beside the message box' },
    { text: 'Pick a model from the list — smaller models reply faster, larger ones tend to be more capable' },
    { text: 'Send your message again once a model is highlighted' },
  ],
  cta: true,
  guidePage: 1,   // Models 101 — how to read model names and pick a fit
  ctaLabel: 'How to choose a model',
};

// Returns true if a model is selected. Otherwise shows the right educational
// error (none installed vs. installed-but-not-selected) and returns false.
function ensureModelSelected() {
  if (window.ACTIVE_MODEL) return true;
  const hasModels = MODEL_LIST.some(m => m.model);
  renderErrorBubble(hasModels ? SELECT_MODEL_ERROR : NO_MODEL_ERROR);
  return false;
}

// ── SEND MESSAGE ──────────────────────────────────────────────────────
// ── WEB SEARCH (Tavily) ───────────────────────────────────────────────
// Reflect the current on/off state onto the globe button next to Send.
function syncWebSearchUI() {
  const on = !!window._WEB_SEARCH_ENABLED;
  const btn = document.getElementById('web-search-btn');
  if (!btn) return;
  btn.classList.toggle('active', on);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.title = on ? 'Web search is ON — click to disable' : 'Web search is OFF — click to enable';
  syncToolsIndicator();
}

// Quick per-conversation toggle (the globe button). Persists immediately so it survives reload.
function toggleWebSearchQuick() {
  const next = !window._WEB_SEARCH_ENABLED;
  if (next && !(window._TAVILY_KEY || '').trim()) {
    showToast('Add your Tavily API key in Settings → Model to use web search.');
    openSettings();
    switchSettingsTab('model');
    return;
  }
  window._WEB_SEARCH_ENABLED = next;
  const s = loadSettings();
  s.web_search_enabled = next;
  saveSettings(s);
  syncWebSearchUI();
  showToast(
    next ? 'Web search enabled' : 'Web search disabled',
    next ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18"/></svg>' : null
  );
}

// Settings-modal toggle (draft only — committed on Save).
function toggleWebSearchSetting(el) {
  el.classList.toggle('on');
}

