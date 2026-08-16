// ── MODAL ─────────────────────────────────────────────────────────────
function openModal() {
  document.getElementById('modal-backdrop').style.display = 'flex';
  onboardGoStep(1);   // always start on the intro step
  // Pre-fill both name fields with whatever's already saved
  const s = loadSettings() || {};
  const nameInput = document.getElementById('onboarding-ai-name');
  if (nameInput) nameInput.value = (s.ai_name && s.ai_name !== AI_NAME) ? s.ai_name : '';
  const creatorInput = document.getElementById('onboarding-creator-name');
  if (creatorInput) creatorInput.value = s.creator_name || '';
  clearOnboardingNameError();
}

// Three-step onboarding wizard: 1) intro, 2) pick a model, 3) AI setup (name your AI).
const ONBOARD_STEP_COUNT = 3;
let _onboardStep = 1;
function onboardGoStep(step) {
  _onboardStep = Math.max(1, Math.min(ONBOARD_STEP_COUNT, step));
  for (let i = 1; i <= ONBOARD_STEP_COUNT; i++) {
    const s = document.getElementById(`onboard-step-${i}`);
    const f = document.getElementById(`onboard-footer-${i}`);
    if (s) s.style.display = i === _onboardStep ? '' : 'none';
    if (f) f.style.display = i === _onboardStep ? 'flex' : 'none';
  }
  if (_onboardStep === 2) renderOnboardRecs();
  if (_onboardStep === 3) {
    const input = document.getElementById('onboarding-ai-name');
    if (input) input.focus();
  }
  const card = document.getElementById('modal-card');
  if (card) card.scrollTop = 0;
}
function onboardNext() { onboardGoStep(_onboardStep + 1); }
function onboardBack() { onboardGoStep(_onboardStep - 1); }
function closeModal() {
  document.getElementById('modal-backdrop').style.display = 'none';
}

// ── STEP 3 NAMES ──────────────────────────────────────────────────────
// Both the AI's name and the builder's name are captured here. The creator
// name is not vanity: publish.js credits it on the published site, and the
// only way to guarantee a published AI carries a real byline is to collect
// it before the student ever reaches the chat.
function showOnboardingNameError(msg, focusEl) {
  const err = document.getElementById('onboarding-name-error');
  if (err) { err.textContent = msg; err.style.display = ''; }
  if (focusEl) focusEl.focus();
}

function clearOnboardingNameError() {
  const err = document.getElementById('onboarding-name-error');
  if (err) { err.textContent = ''; err.style.display = 'none'; }
}

// Reads both fields and reports what's missing. Returns null when either is
// blank, so callers can refuse to move on without repeating the checks.
function readOnboardingNames() {
  const nameInput = document.getElementById('onboarding-ai-name');
  const creatorInput = document.getElementById('onboarding-creator-name');
  const name = (nameInput?.value || '').trim();
  const creator = (creatorInput?.value || '').trim();
  if (!name) {
    showOnboardingNameError('Give your AI a name first.', nameInput);
    return null;
  }
  if (!creator) {
    showOnboardingNameError('Add your name — it gets credited as the builder.', creatorInput);
    return null;
  }
  clearOnboardingNameError();
  return { name, creator };
}

// Saves to the SAME store Settings uses, so both names stick and the
// Settings fields reflect them.
function saveOnboardingName() {
  const names = readOnboardingNames();
  if (!names) return false;
  const s = loadSettings() || {};
  s.ai_name = names.name;
  s.creator_name = names.creator;
  saveSettings(s);
  applySettings(s);
  // Keep the Settings panel draft + fields in sync for this session
  window._BASE_NAME_DRAFT = names.name;
  const settingsInput = document.getElementById('settings-ai-name');
  if (settingsInput && !getActivePersonaDraft()) settingsInput.value = names.name;
  const settingsCreator = document.getElementById('settings-creator-name');
  if (settingsCreator) settingsCreator.value = names.creator;
  showToast(`Your AI is now "${names.name}", built by ${names.creator}!`, '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/><path d="M5 3v4"/><path d="M3 5h4"/><path d="M19 17v4"/><path d="M17 19h4"/></svg>');
  return true;
}
function handleBackdropClick(e) {
  if (e.target === document.getElementById('modal-backdrop')) closeModal();
}

// ── CAMP GUIDEBOOK (floating + dockable book panel) ───────────────────
let _gpPage = 0;
let _gpInit = false;

function openGuide(page) {
  const p = document.getElementById('guide-panel');
  if (!p) return;
  p.hidden = false;
  if (typeof page === 'number') { gpGoto(page); _gpInit = true; }
  else if (!_gpInit) { gpGoto(0); _gpInit = true; }
}
function closeGuide() {
  const p = document.getElementById('guide-panel');
  if (!p) return;
  p.hidden = true;
  // leave dock state as-is so reopening keeps the user's last layout choice
}

// "Enter chat" is the gate. Both names are required, so a student can't slip
// past setup and end up publishing an AI credited to nobody — the field is
// far harder to go back and fill in once they're deep in the chat.
function finishOnboarding() {
  if (!saveOnboardingName()) return;
  closeModal();
}

// ── ONBOARDING MODEL RECOMMENDER (step 2 · Pick a model) ─────────────
// needGB ≈ Q4_K_M download size + ~1–1.5 GB for context/KV cache.
const ONBOARD_MODEL_CATALOG = [
  { tag: 'qwen2.5:0.5b', family: 'Qwen',  params: '0.5B', needGB: 1.5,  desc: 'Tiny and instant — runs on almost anything.' },
  { tag: 'gemma3:1b',    family: 'Gemma', params: '1B',   needGB: 2.0,  desc: 'Google’s lightweight model, very quick.' },
  { tag: 'qwen2.5:1.5b', family: 'Qwen',  params: '1.5B', needGB: 2.5,  desc: 'Fast and surprisingly capable for its size.' },
  { tag: 'llama3.2:1b',  family: 'Llama', params: '1B',   needGB: 2.5,  desc: 'Meta’s smallest — snappy on modest laptops.' },
  { tag: 'qwen2.5:3b',   family: 'Qwen',  params: '3B',   needGB: 3.5,  desc: 'The camp default — great balance of speed and smarts.' },
  { tag: 'llama3.2:3b',  family: 'Llama', params: '3B',   needGB: 3.5,  desc: 'Solid small model, good at following instructions.' },
  { tag: 'gemma3:4b',    family: 'Gemma', params: '4B',   needGB: 4.5,  desc: 'Strong quality for the size; handles images too.' },
  { tag: 'qwen2.5:7b',   family: 'Qwen',  params: '7B',   needGB: 6.0,  desc: 'Noticeably smarter answers; needs a beefier machine.' },
  { tag: 'llama3.1:8b',  family: 'Llama', params: '8B',   needGB: 6.5,  desc: 'A community favorite — strong general-purpose replies.' },
  { tag: 'gemma3:12b',   family: 'Gemma', params: '12B',  needGB: 9.5,  desc: 'Big and capable — for machines with lots of memory.' },
  { tag: 'qwen2.5:14b',  family: 'Qwen',  params: '14B',  needGB: 10.5, desc: 'Heavyweight — excellent answers if your PC can hold it.' },
  { tag: 'gemma3:27b',   family: 'Gemma', params: '27B',  needGB: 19,   desc: 'Google’s big model — workstation-grade quality.' },
  { tag: 'qwen2.5:32b',  family: 'Qwen',  params: '32B',  needGB: 22,   desc: 'Serious horsepower — near cloud-level answers, locally.' },
  { tag: 'llama3.3:70b', family: 'Llama', params: '70B',  needGB: 45,   desc: 'Meta’s flagship — needs a monster rig, rewards it.' },
  { tag: 'qwen2.5:72b',  family: 'Qwen',  params: '72B',  needGB: 49,   desc: 'The biggest Qwen — top-tier quality for extreme setups.' },
];

function recommendModels(ramGB, vramGB) {
  // Dedicated GPU: budget = VRAM (Ollama offloads there). CPU-only: the OS
  // and browser eat RAM, so ~60% of system RAM is a safe inference budget.
  // With a small GPU + lots of RAM, hybrid offload means RAM still helps —
  // take the larger of the two.
  const budget = Math.max(vramGB || 0, ramGB * 0.6);
  const best = [], runnable = [], notRecommended = [];
  for (const m of ONBOARD_MODEL_CATALOG) {
    if (m.needGB <= budget * 0.75) best.push(m);        // fits comfortably
    else if (m.needGB <= budget) runnable.push(m);      // fits, but tight
    else notRecommended.push(m);                        // exceeds budget
  }
  best.sort((a, b) => b.needGB - a.needGB);             // biggest comfortable first
  runnable.sort((a, b) => a.needGB - b.needGB);
  notRecommended.sort((a, b) => a.needGB - b.needGB);
  return { best, runnable, notRecommended, cpuOnly: !vramGB };
}

const FAMILY_LOGO = {
  Qwen: 'assets/logos/Qwen_logo.webp',
  Gemma: 'assets/logos/gemma_logo.png',
  Llama: 'assets/logos/Meta_logo.png',
};

function _recRowHtml(m, starred, dim) {
  const star = starred ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="var(--dc-gold)" stroke="var(--dc-gold)" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01L12 2z"/></svg>' : '';
  const tag = escapeHtml(m.tag);
  const logo = FAMILY_LOGO[m.family];
  const downloadBtn = dim ? '' :
    `<button class="rec-copy" data-pull-tag="${tag}" onclick="pullModelOneClick('${tag}')" title="Download and install this model via Ollama">Download</button>`;
  return `<div class="rec-row${dim ? ' dim' : ''}">
    ${logo ? `<img class="rec-logo" src="${logo}" alt="">` : ''}
    <div class="rec-info">
      <span class="rec-name">${star}${tag} <em>${escapeHtml(m.params)} · needs ~${m.needGB} GB</em></span>
      <span class="rec-desc">${escapeHtml(m.desc)}</span>
    </div>${downloadBtn}
  </div>`;
}

function renderOnboardRecs() {
  const out = document.getElementById('onboard-rec-results');
  const ramSel = document.getElementById('rec-ram');
  const gpuSel = document.getElementById('rec-gpu');
  if (!out || !ramSel || !gpuSel) return;
  if (!ramSel.value || !gpuSel.value) {
    out.innerHTML = `<div class="rec-cpu-note">Pick your RAM and GPU above to see which models fit your PC.</div>`;
    return;
  }
  const { best, runnable, notRecommended, cpuOnly } =
    recommendModels(parseFloat(ramSel.value), parseFloat(gpuSel.value));
  let html = '';
  if (cpuOnly) html += `<div class="rec-cpu-note">No dedicated GPU — models run on your CPU. Expect slower replies.</div>`;
  const group = (label, color, list, dim) => {
    if (!list.length) return '';
    return `<div class="rec-group">
      <div class="rec-group-head"><span class="rec-dot" style="background:${color}"></span>${label}</div>
      ${list.map((m, i) => _recRowHtml(m, !dim && color === '#22C55E' && i === 0, dim)).join('')}
    </div>`;
  };
  html += group('Best for your PC', '#22C55E', best, false);
  html += group('Will run, but slower', '#F59E0B', runnable, false);
  html += group('Not recommended', '#EF4444', notRecommended, true);
  if (!best.length && !runnable.length) {
    html = `<div class="rec-cpu-note">This machine is very limited — try the smallest model anyway, or use a cloud API in the next step.</div>` + html;
  }
  out.innerHTML = html;
}

// ── ONE-CLICK MODEL DOWNLOAD (Ollama's native /api/pull) ──────────────
// The OpenAI-compat endpoint (API_BASE) has no pull route, but Ollama's
// native API on the same host does — derive its root by dropping /v1.
function ollamaRoot() {
  return (API_BASE || '').replace(/\/v1\/?$/, '');
}

async function isOllamaReachable() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${ollamaRoot()}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

function pullBtns(tag) {
  return Array.from(document.querySelectorAll(`[data-pull-tag="${tag}"]`));
}

// Push every button for this model tag (hardcoded + spec-based rows can
// both show the same tag) into the same visual state at once.
function setPullState(tag, state, label) {
  const text = {
    idle: 'Download', checking: 'Checking…', downloading: label || 'Downloading…',
    done: 'Installed ✓', error: 'Retry',
  }[state];
  pullBtns(tag).forEach(btn => {
    btn.classList.remove('checking', 'downloading', 'done', 'error');
    if (state !== 'idle') btn.classList.add(state);
    btn.disabled = state === 'checking' || state === 'downloading';
    btn.textContent = text;
  });
}

// Entry point wired to every model row's Download button.
async function pullModelOneClick(tag) {
  const [btn] = pullBtns(tag);
  if (btn && btn.disabled) return;
  setPullState(tag, 'checking');
  const ok = await isOllamaReachable();
  if (!ok) {
    setPullState(tag, 'error');
    openOllamaCheckModal(tag);
    return;
  }
  await runModelPull(tag);
}

// Streams Ollama's /api/pull NDJSON progress into the button label AND a
// terminal-style log window, so the user can watch the pull happen live —
// same info a real `ollama pull` terminal shows, rendered inside the app.
async function runModelPull(tag) {
  setPullState(tag, 'downloading');
  openPullTerminal(tag);
  try {
    const res = await fetch(`${ollamaRoot()}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: tag, stream: true }),
    });
    if (!res.ok) throw new Error(`Ollama responded ${res.status}`);
    if (!res.body) throw new Error('Streaming not supported by this browser');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let evt;
        try { evt = JSON.parse(line); } catch { continue; }
        if (evt.error) throw new Error(evt.error);
        if (evt.digest) {
          const pct = evt.total ? Math.round((evt.completed || 0) / evt.total * 100) : 0;
          pullLog(`pulling ${shortDigest(evt.digest)}… ${pct}% ${pullBar(pct)} ${formatBytes(evt.completed)}${evt.total ? '/' + formatBytes(evt.total) : ''}`, evt.digest);
          setPullState(tag, 'downloading', `${pct}%`);
        } else {
          pullLog(evt.status || JSON.stringify(evt));
          setPullState(tag, 'downloading', evt.status || 'Downloading…');
        }
      }
    }
    pullLog('success', null, 'ok');
    setPullTerminalTitle(`Installed ✓ — ${tag}`);
    setPullState(tag, 'done');
    showToast(`${tag} installed ✓ — ready to use`);
    registerPulledModel(tag);
  } catch (err) {
    pullLog(`✗ ${err.message || 'connection lost'}`, null, 'err');
    setPullTerminalTitle(`Failed — ${tag}`);
    setPullState(tag, 'error');
    showToast(`Couldn't download ${tag}: ${err.message || 'connection lost'}`);
  }
}

// ── Terminal-style pull log ────────────────────────────────────────────
let _pullLogLines = new Map();   // digest -> its <div> line, so progress updates in place

function shortDigest(d) { return (d || '').replace(/^sha256:/, '').slice(0, 12); }

function formatBytes(n) {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function pullBar(pct, width = 16) {
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  return '▕' + '█'.repeat(filled) + '░'.repeat(width - filled) + '▏';
}

function openPullTerminal(tag) {
  _pullLogLines = new Map();
  const log = document.getElementById('pull-terminal-log');
  if (log) log.innerHTML = '';
  setPullTerminalTitle(`Downloading ${tag}`);
  const modal = document.getElementById('pull-terminal-modal');
  if (modal) modal.style.display = 'flex';
}
function setPullTerminalTitle(text) {
  const title = document.getElementById('pull-terminal-title');
  if (title) title.textContent = text;
}
function closePullTerminal() {
  const modal = document.getElementById('pull-terminal-modal');
  if (modal) modal.style.display = 'none';
}
function handlePullTerminalBackdrop(e) {
  if (e.target === document.getElementById('pull-terminal-modal')) closePullTerminal();
}

// digest-keyed lines update in place (mirrors how a real terminal overwrites
// a layer's progress bar); everything else appends as a new line.
function pullLog(text, digest, cls) {
  const log = document.getElementById('pull-terminal-log');
  if (!log) return;
  let line = digest ? _pullLogLines.get(digest) : null;
  if (!line) {
    line = document.createElement('div');
    line.className = 'pull-term-line';
    log.appendChild(line);
    if (digest) _pullLogLines.set(digest, line);
  }
  if (cls) line.classList.add(cls);
  line.textContent = text;
  log.scrollTop = log.scrollHeight;
}

// Make a freshly pulled model available in the picker right away, instead
// of waiting for the next full discovery pass on reload.
function registerPulledModel(tag) {
  if (typeof addModelEntry !== 'function') return;
  const entry = addModelEntry({ model: tag, base: API_BASE, key: API_KEY, kind: 'local', source: 'discovered' });
  if (entry && !window.ACTIVE_MODEL && typeof selectModel === 'function') selectModel(entry.id, { silent: true });
}

// ── "Ollama not detected" modal ────────────────────────────────────────
let _pendingPullTag = null;

function openOllamaCheckModal(tag) {
  _pendingPullTag = tag;
  const note = document.getElementById('ollama-check-note');
  if (note) note.hidden = true;
  const m = document.getElementById('ollama-check-modal');
  if (m) m.style.display = 'flex';
}
function closeOllamaCheckModal() {
  _pendingPullTag = null;
  const m = document.getElementById('ollama-check-modal');
  if (m) m.style.display = 'none';
}
function handleOllamaCheckBackdrop(e) {
  if (e.target === document.getElementById('ollama-check-modal')) closeOllamaCheckModal();
}
function openOllamaDownloadPage() {
  window.open('https://ollama.com/download', '_blank', 'noopener');
}

async function retryOllamaCheck() {
  const btn = document.getElementById('ollama-check-retry-btn');
  const note = document.getElementById('ollama-check-note');
  if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
  const ok = await isOllamaReachable();
  if (btn) { btn.disabled = false; btn.textContent = "I've installed it — Retry"; }
  if (ok) {
    const tag = _pendingPullTag;
    closeOllamaCheckModal();
    if (tag) runModelPull(tag);
  } else if (note) {
    note.textContent = `Still can't reach Ollama at ${ollamaRoot()}. Start it with: ${OLLAMA_START_CMD}`;
    note.hidden = false;
  }
}

// Paginated navigation
function _gpCount() { return document.querySelectorAll('#gp-pages .gp-page').length; }
function gpGoto(i) {
  const total = _gpCount();
  if (!total) return;
  _gpPage = Math.max(0, Math.min(i, total - 1));
  document.querySelectorAll('#gp-pages .gp-page').forEach((el, idx) =>
    el.classList.toggle('active', idx === _gpPage));
  document.querySelectorAll('#gp-tabs .gp-tab').forEach((el, idx) =>
    el.classList.toggle('active', idx === _gpPage));
  const prog = document.getElementById('gp-progress');
  if (prog) prog.textContent = `Page ${_gpPage + 1} of ${total}`;
  const prev = document.getElementById('gp-prev');
  const next = document.getElementById('gp-next');
  if (prev) prev.disabled = _gpPage === 0;
  if (next) { next.disabled = _gpPage === total - 1; next.textContent = _gpPage === total - 1 ? 'Done ✓' : 'Next ›'; }
  const pages = document.getElementById('gp-pages');
  if (pages) pages.scrollTop = 0;
  const activeTab = document.querySelectorAll('#gp-tabs .gp-tab')[_gpPage];
  if (activeTab) activeTab.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
}
function gpNext() {
  if (_gpPage >= _gpCount() - 1) { closeGuide(); return; }
  gpGoto(_gpPage + 1);
}
function gpPrev() { gpGoto(_gpPage - 1); }

// Pin / dock toggle — float ↔ right-side panel (VS Code style)
function toggleGuideDock() {
  const p = document.getElementById('guide-panel');
  if (!p) return;
  const docked = p.classList.toggle('docked');
  p.style.left = p.style.top = p.style.right = '';   // clear any drag coords
  const btn = document.getElementById('gp-dock-btn');
  if (btn) {
    btn.classList.toggle('active', docked);
    btn.title = docked ? 'Unpin (float)' : 'Pin to the side (dock)';
  }
}

// Drag the splitter to resize the docked panel (adjustable 2-panel layout)
let _gpResize = false;
function gpResizeStart(e) {
  const p = document.getElementById('guide-panel');
  if (!p || !p.classList.contains('docked')) return;
  _gpResize = true;
  document.body.classList.add('gp-resizing');
  window.addEventListener('pointermove', gpResizeMove);
  window.addEventListener('pointerup', gpResizeEnd);
  e.preventDefault();
}
function gpResizeMove(e) {
  if (!_gpResize) return;
  const p = document.getElementById('guide-panel');
  let w = window.innerWidth - e.clientX;          // panel hugs the right edge
  const max = Math.round(window.innerWidth * 0.8);
  w = Math.max(240, Math.min(w, max));
  p.style.setProperty('--guide-w', w + 'px');
}
function gpResizeEnd() {
  _gpResize = false;
  document.body.classList.remove('gp-resizing');
  window.removeEventListener('pointermove', gpResizeMove);
  window.removeEventListener('pointerup', gpResizeEnd);
}

// Drag the floating panel by its header (pointer events; disabled when docked)
let _gpDrag = null;
function gpDragStart(e) {
  const p = document.getElementById('guide-panel');
  if (!p || p.classList.contains('docked')) return;
  if (e.target.closest('.gp-btn')) return;          // don't drag when hitting a button
  const r = p.getBoundingClientRect();
  _gpDrag = { dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height };
  p.style.left = r.left + 'px';
  p.style.top = r.top + 'px';
  p.style.right = 'auto';
  window.addEventListener('pointermove', gpDragMove);
  window.addEventListener('pointerup', gpDragEnd);
  e.preventDefault();
}
function gpDragMove(e) {
  if (!_gpDrag) return;
  const p = document.getElementById('guide-panel');
  let x = e.clientX - _gpDrag.dx;
  let y = e.clientY - _gpDrag.dy;
  x = Math.max(4, Math.min(x, window.innerWidth - _gpDrag.w - 4));
  y = Math.max(4, Math.min(y, window.innerHeight - 44));
  p.style.left = x + 'px';
  p.style.top = y + 'px';
}
function gpDragEnd() {
  _gpDrag = null;
  window.removeEventListener('pointermove', gpDragMove);
  window.removeEventListener('pointerup', gpDragEnd);
}
// Wire up the drag handle + resize splitter (works whether or not the DOM is ready)
function _gpWireDrag() {
  const head = document.getElementById('gp-head');
  if (head && !head.dataset.dragWired) {
    head.addEventListener('pointerdown', gpDragStart);
    head.dataset.dragWired = '1';
  }
  const rez = document.getElementById('gp-resizer');
  if (rez && !rez.dataset.wired) {
    rez.addEventListener('pointerdown', gpResizeStart);
    rez.dataset.wired = '1';
  }
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _gpWireDrag);
} else {
  _gpWireDrag();
}

