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

// ── COMPOSER LAYOUT ───────────────────────────────────────────────────
// The controls sit inline with the draft while it's short, then move below
// it once the text would wrap — so a long message gets the full width of
// the box instead of a squeezed column between the "+" and the model pill.
// The textarea can't detect the wrap itself (it always fills the width it's
// given), so a hidden mirror span measures the draft's natural width.
const _COMPOSER_MAX_H = 140;    // matches #message-input's max-height
const _COMPOSER_MIN_SLOT = 150; // narrower than this and the draft gets its own row

function syncComposer() {
  const input = document.getElementById('message-input');
  if (!input) return;
  const controls = document.getElementById('composer-controls');
  const measure = document.getElementById('composer-measure');

  // Below 640px the stacked layout is forced in CSS (see the mobile block in
  // styles.css), so there's nothing to measure.
  const stacked = window.matchMedia('(max-width: 640px)').matches;

  if (controls && measure && !stacked) {
    measure.textContent = input.value;
    // Width left for the textarea when it shares the row with the controls.
    const siblings = Array.from(controls.children)
      .filter(el => el !== input && el.offsetParent !== null);
    const taken = siblings.reduce((w, el) => w + el.offsetWidth, 0);
    const gap = parseFloat(getComputedStyle(controls).columnGap) || 0;
    const room = controls.clientWidth - taken - gap * siblings.length;
    const wraps =
      input.value.includes('\n') ||
      // A narrow window, an open sidebar, or a long model name can leave a
      // slot too thin to type in — take the whole line rather than a sliver.
      room < _COMPOSER_MIN_SLOT ||
      // +8px so the switch happens a hair before the text actually collides.
      measure.offsetWidth + 8 > room;
    controls.classList.toggle('expanded', wraps);
  }

  // Grow to fit, then scroll — measured after the layout switch above, since
  // the available width is what decides how many lines the draft takes.
  input.style.height = '0px';
  const content = input.scrollHeight;
  input.style.height = Math.min(content, _COMPOSER_MAX_H) + 'px';
  input.style.overflowY = content > _COMPOSER_MAX_H ? 'auto' : 'hidden';

  syncSendState();
}

// Send button reads "armed" only when there's something to send. Purely
// visual — sendMessage() is still the one guard on an empty draft.
function syncSendState() {
  const btn = document.getElementById('send-btn');
  const input = document.getElementById('message-input');
  if (!btn || !input) return;
  if (btn.classList.contains('stop')) return;   // generating — leave it red
  btn.classList.toggle('idle', input.value.trim().length === 0);
}

// The textarea's inline oninput handler.
function autoResize() { syncComposer(); }

// Re-measure when the box itself changes width (sidebar collapse, rotation,
// window resize) — the same draft can wrap at one width and not at another.
window.addEventListener('resize', syncComposer);
document.addEventListener('DOMContentLoaded', syncComposer);

function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

// ── SEND / STOP BUTTON ────────────────────────────────────────────────
let _streamAbort = null;     // AbortController for the in-flight generation
let _userCancelled = false;  // true when the user pressed Stop

// Both draw with currentColor so the button can mute the glyph in its idle
// state instead of leaving a white icon on a pale background.
const _ICON_SEND = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
const _ICON_STOP = '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>';

// Toggle the composer button between Send and Stop.
function setSendMode(streaming) {
  const btn = document.getElementById('send-btn');
  if (!btn) return;
  btn.disabled = false;
  btn.classList.toggle('stop', streaming);
  btn.title = streaming ? 'Stop generating' : 'Send message';
  btn.innerHTML = streaming ? _ICON_STOP : _ICON_SEND;
  syncSendState();
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

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
}

// Source tiles are generated locally rather than fetched from a favicon
// service: no third-party request per answer, and they still work offline —
// which is the whole point of an app that runs against a local model.
//
// Colour comes from the source's position in the list, not from a hash of the
// hostname: with a handful of colours, hashing collides often enough that two
// of three sources in one answer come out identical, which reads as a bug. By
// index they are always distinct, and a chip always matches its list entry
// because both are keyed on the same number the model cites.
const _SRC_TILE_COLORS = ['#4F46E5', '#5FBF6B', '#FF8A3D', '#B8860B', '#7C5CFF', '#E8547C'];
function sourceAvatar(host, index) {
  const h = host || '?';
  const bg = _SRC_TILE_COLORS[(index || 0) % _SRC_TILE_COLORS.length];
  const first = (h[0] || '?').toUpperCase();
  const letter = /[A-Z0-9]/.test(first) ? first : '?';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">`
    + `<rect width="64" height="64" rx="14" fill="${bg}"/>`
    + `<text x="32" y="44" font-family="sans-serif" font-size="34" font-weight="700" fill="#fff" text-anchor="middle">${letter}</text></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

const CHEVRON_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';

// Builds the sources control shown under answers that used web search: one
// collapsed line of stacked tiles that opens into the full list. Reused live
// (after streaming) and on session reload, so links persist.
function buildSourcesEl(sources) {
  const list = (Array.isArray(sources) ? sources : []).filter(s => s && s.url);
  if (!list.length) return null;

  const wrap = document.createElement('div');
  wrap.className = 'web-sources';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'src-toggle';
  btn.setAttribute('aria-expanded', 'false');
  const stack = list.map((s, i) => `<img src="${sourceAvatar(hostOf(s.url), i)}" alt="">`).join('');
  btn.innerHTML = `<span class="src-stack">${stack}</span>`
    + `<span class="src-toggle-label">${list.length} source${list.length !== 1 ? 's' : ''}</span>`
    + `<span class="src-toggle-chevron">${CHEVRON_SVG}</span>`;
  wrap.appendChild(btn);

  const panel = document.createElement('div');
  panel.className = 'src-list';
  const inner = document.createElement('div');
  inner.className = 'src-list-inner';
  list.forEach((s, i) => {
    const host = hostOf(s.url);
    const a = document.createElement('a');
    a.className = 'web-source-link';
    a.href = s.url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.innerHTML = `<span class="web-source-num"><img src="${sourceAvatar(host, i)}" alt=""></span>`
      + `<span class="web-source-title">${escHtml(s.title || host || s.url)}</span>`
      + (host ? `<span class="web-source-host">${escHtml(host)}</span>` : '');
    inner.appendChild(a);
  });
  panel.innerHTML = '<div class="src-list-clip"></div>';
  panel.firstChild.appendChild(inner);
  wrap.appendChild(panel);

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = panel.classList.toggle('open');
    btn.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  return wrap;
}

function citeChipEl(source, index) {
  const host = hostOf(source.url);
  const a = document.createElement('a');
  a.className = 'cite-chip';
  a.href = source.url;
  a.target = '_blank';
  a.rel = 'noopener';
  a.title = source.title || source.url;
  a.innerHTML = `<img src="${sourceAvatar(host, index)}" alt=""><span>${escHtml(host || 'source')}</span>`;
  return a;
}

// The model is told to cite inline as [1]. Once the answer has landed we swap
// those bare markers for the source they point at, so a claim carries its
// provenance where it's made instead of only in a list at the bottom.
function applyCitationChips(bubble, sources) {
  const list = (Array.isArray(sources) ? sources : []).filter(s => s && s.url);
  if (!bubble || !list.length) return;

  const targets = [];
  const walker = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT, null);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!/\[\d+\]/.test(node.nodeValue)) continue;
    if (node.parentElement && node.parentElement.closest('pre, code, a, .web-sources, .think-block, .process-trace')) continue;
    targets.push(node);
  }

  for (const node of targets) {
    const text = node.nodeValue;
    const frag = document.createDocumentFragment();
    const re = /\[(\d+)\]/g;
    let match, last = 0, replaced = 0;
    while ((match = re.exec(text)) !== null) {
      const idx = parseInt(match[1], 10) - 1;
      const src = list[idx];
      if (!src) continue;
      if (match.index > last) frag.appendChild(document.createTextNode(text.slice(last, match.index)));
      frag.appendChild(citeChipEl(src, idx));
      last = match.index + match[0].length;
      replaced++;
    }
    if (!replaced) continue;
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
  }
}

// ── KNOWLEDGE SOURCES (local retrieval) ───────────────────────────────
// Web results already get a source strip and inline chips. The student's own
// uploaded documents got nothing — the answer just quietly contained their file
// and they had to trust it. These render the same provenance for local
// retrieval, plus the one thing a web citation can't show: the similarity score
// that won the chunk its place in the prompt.
//
// That number is the teaching payload. "Retrieved 3 of 47 chunks, best match
// 0.41" makes RAG a mechanism a student can reason about and tune, instead of
// magic that either works or doesn't.

// Bars are scaled against the best match in this answer, not against 1.0.
// TF-IDF cosine scores are small in absolute terms — a genuinely good match
// often lands near 0.3 — so an absolute bar would render every source as a
// nearly empty sliver and teach the opposite of what's true. The raw number is
// always printed beside it, so nothing is hidden by the scaling.
function kbScoreBar(score, best) {
  const pct = best > 0 ? Math.max(6, Math.round((score / best) * 100)) : 0;
  return `<span class="kb-score" title="TF-IDF cosine similarity to your question">`
    + `<span class="kb-score-bar"><span style="width:${pct}%"></span></span>`
    + `<span class="kb-score-num">${score.toFixed(2)}</span></span>`;
}

function buildKnowledgeSourcesEl(kbSources) {
  const list = (Array.isArray(kbSources) ? kbSources : []).filter(s => s && s.file);
  if (!list.length) return null;
  const best = Math.max(...list.map(s => s.score || 0));

  const wrap = document.createElement('div');
  wrap.className = 'web-sources kb-sources';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'src-toggle';
  btn.setAttribute('aria-expanded', 'false');
  const files = [...new Set(list.map(s => s.file))];
  const single = files.length === 1;
  const stack = files.slice(0, 4).map((f, i) => `<img src="${sourceAvatar(f, i)}" alt="">`).join('');
  // Name the file in the header when there is only one, so the rows below can
  // stop repeating it. "5 chunks of resume.pdf" is one document; five rows each
  // headed "resume.pdf" looks like five.
  const label = single
    ? `${list.length} chunk${list.length !== 1 ? 's' : ''} of ${escHtml(files[0])}`
    : `${list.length} chunks from ${files.length} of your files`;
  btn.innerHTML = `<span class="src-stack">${stack}</span>`
    + `<span class="src-toggle-label">${label}</span>`
    + `<span class="src-toggle-chevron">${CHEVRON_SVG}</span>`;
  wrap.appendChild(btn);

  const panel = document.createElement('div');
  panel.className = 'src-list';
  const inner = document.createElement('div');
  inner.className = 'src-list-inner';
  list.forEach(s => {
    const fileIdx = files.indexOf(s.file);
    const row = document.createElement('div');
    row.className = 'kb-source-item';
    row.innerHTML = `
      <div class="kb-source-head">
        <span class="web-source-num"><img src="${sourceAvatar(s.file, fileIdx)}" alt=""></span>
        <span class="kb-source-marker">K${s.n}</span>
        <span class="web-source-title">${single ? `chunk ${s.index} of ${s.total}` : escHtml(s.file)}</span>
        ${single ? '' : `<span class="web-source-host">chunk ${s.index}/${s.total}</span>`}
        ${kbScoreBar(s.score || 0, best)}
      </div>
      <div class="kb-source-text"></div>`;
    // textContent, not innerHTML — this is raw document text and may contain
    // anything, including markup that would otherwise render into the page.
    row.querySelector('.kb-source-text').textContent = s.text || '';
    inner.appendChild(row);
  });
  panel.innerHTML = '<div class="src-list-clip"></div>';
  panel.firstChild.appendChild(inner);
  wrap.appendChild(panel);

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = panel.classList.toggle('open');
    btn.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  return wrap;
}

// Swap the model's [K1] markers for a chip naming the file it read. Mirrors
// applyCitationChips; the two patterns can't collide because [\d+] never
// matches a marker that starts with K.
function applyKnowledgeChips(bubble, kbSources) {
  const list = (Array.isArray(kbSources) ? kbSources : []).filter(s => s && s.file);
  if (!bubble || !list.length) return;

  const targets = [];
  const walker = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT, null);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!/\[K\d+\]/.test(node.nodeValue)) continue;
    if (node.parentElement && node.parentElement.closest('pre, code, a, .web-sources, .think-block, .process-trace')) continue;
    targets.push(node);
  }

  for (const node of targets) {
    const text = node.nodeValue;
    const frag = document.createDocumentFragment();
    const re = /\[K(\d+)\]/g;
    let match, last = 0, replaced = 0;
    while ((match = re.exec(text)) !== null) {
      const src = list.find(s => s.n === parseInt(match[1], 10));
      if (!src) continue;
      if (match.index > last) frag.appendChild(document.createTextNode(text.slice(last, match.index)));
      const chip = document.createElement('span');
      chip.className = 'cite-chip kb-chip';
      chip.title = `${src.file} — chunk ${src.index} of ${src.total} · match ${(src.score || 0).toFixed(2)}`;
      // Marker + the filename minus its extension. A web chip carries a short
      // hostname; a document name is long enough that the untrimmed version
      // pushed the chip onto its own line and broke the sentence it sits in.
      // The full name, chunk, and score all live in the tooltip and the strip.
      chip.innerHTML = `<img src="${sourceAvatar(src.file, list.indexOf(src))}" alt="">`
        + `<span class="kb-chip-n">K${src.n}</span>`
        + `<span>${escHtml(src.file.replace(/\.[^.]+$/, ''))}</span>`;
      frag.appendChild(chip);
      last = match.index + match[0].length;
      replaced++;
    }
    if (!replaced) continue;
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
  }
}

// ── PROMPT INSPECTOR ──────────────────────────────────────────────────
// The app assembles a system prompt from six or seven sources — persona, scope
// rule, language grammar, knowledge blurb, retrieved chunks, web results,
// prefix/suffix — and then never shows it to anyone. A student watching the
// trace can see that a prompt was built but not what it says, which leaves the
// most important artifact in the whole pipeline invisible.
//
// This shows the literal bytes that went to the model. Not a summary of them.
function promptCopyBtn(getText) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'prompt-copy-btn';
  b.innerHTML = '<span>Copy</span>';
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    const done = () => {
      b.classList.add('copied');
      b.querySelector('span').textContent = 'Copied';
      setTimeout(() => { b.classList.remove('copied'); b.querySelector('span').textContent = 'Copy'; }, 1500);
    };
    const text = getText();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else fallbackCopy(text, done);
  });
  return b;
}

// Colours for the composition bar. Cycled by position so neighbouring segments
// always differ; they carry no meaning beyond "this is a different part".
const _PART_COLORS = ['#4F46E5', '#A78BFA', '#5FBF6B', '#FF8A3D', '#7C5CFF', '#E8547C', '#B8A05A'];

function fmtChars(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

// The composition view: one stacked bar plus a labelled row per part.
//
// This is the half of the inspector that actually teaches. The raw text answers
// "what exactly was sent", which only helps someone who already knows what a
// system prompt is. The question a beginner has is "I typed one sentence, why
// does it say 1.9k tokens, and which of my settings did that?" — so every row
// names the switch that produced it.
function buildPromptBreakdownEl(prompt) {
  const parts = Array.isArray(prompt.parts) ? prompt.parts.filter(p => p && p.chars > 0) : [];
  if (!parts.length) return null;

  const total = parts.reduce((n, p) => n + p.chars, 0);
  const typed = prompt.typedChars || 0;
  const wrap = document.createElement('div');
  wrap.className = 'prompt-breakdown';

  // Lead with the comparison, in words, before any number or chart.
  const lede = document.createElement('p');
  lede.className = 'prompt-lede';
  lede.innerHTML = typed
    ? `You typed <b>${fmtChars(typed)} characters</b>. The model received <b>${fmtChars(total)}</b>.`
      + ` Everything else is what ${escHtml(window._AI_NAME_ACTIVE || AI_NAME)} added for you:`
    : `The model received <b>${fmtChars(total)} characters</b>, made up of:`;
  wrap.appendChild(lede);

  const bar = document.createElement('div');
  bar.className = 'prompt-bar';
  parts.forEach((p, i) => {
    const seg = document.createElement('span');
    seg.style.width = `${(p.chars / total) * 100}%`;
    seg.style.background = _PART_COLORS[i % _PART_COLORS.length];
    seg.title = `${p.label} — ${p.chars} characters`;
    bar.appendChild(seg);
  });
  wrap.appendChild(bar);

  const list = document.createElement('div');
  list.className = 'prompt-parts';
  parts.forEach((p, i) => {
    const pct = Math.round((p.chars / total) * 100);
    const row = document.createElement('div');
    row.className = 'prompt-part';
    row.innerHTML = `
      <span class="prompt-part-dot" style="background:${_PART_COLORS[i % _PART_COLORS.length]}"></span>
      <span class="prompt-part-label"></span>
      <span class="prompt-part-size">${fmtChars(p.chars)}<span class="prompt-part-pct">${pct < 1 ? '<1' : pct}%</span></span>
      <span class="prompt-part-src"></span>`;
    row.querySelector('.prompt-part-label').textContent = p.label;
    row.querySelector('.prompt-part-src').textContent = p.source || '';
    list.appendChild(row);
  });
  wrap.appendChild(list);

  const note = document.createElement('p');
  note.className = 'prompt-note';
  note.textContent = 'A model reads all of this every single time — it remembers nothing between messages. '
    + 'Longer instructions cost speed, and on a small model they compete with your actual question.';
  wrap.appendChild(note);

  return wrap;
}

// `prompt` is { messages, model, temperature, maxTokens, parts, typedChars }.
function buildPromptInspectorEl(prompt) {
  // Owner-only. The system prompt carries the student's persona and instructions
  // verbatim; my-ai.json already makes that public to anyone who opens the repo,
  // but a panel under every answer is a different thing from a file in a repo,
  // and it isn't the visitor's prompt to read. The teaching value is for whoever
  // is building the AI, and they are never in visitor mode.
  if (window.IS_VISITOR) return null;
  const msgs = prompt && Array.isArray(prompt.messages) ? prompt.messages : [];
  if (!msgs.length) return null;

  const asText = () => msgs.map(m => `### ${m.role}\n${m.content}`).join('\n\n');
  const chars = msgs.reduce((n, m) => n + (m.content || '').length, 0);

  const wrap = document.createElement('div');
  wrap.className = 'prompt-inspector';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'src-toggle prompt-toggle';
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = `<span class="prompt-toggle-icon">`
    + `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg></span>`
    + `<span class="src-toggle-label">What the model actually read</span>`
    + `<span class="prompt-toggle-meta">~${fmtCount(Math.round(chars / 4))} tok</span>`
    + `<span class="src-toggle-chevron">${CHEVRON_SVG}</span>`;
  wrap.appendChild(btn);

  const panel = document.createElement('div');
  panel.className = 'src-list';
  const inner = document.createElement('div');
  inner.className = 'prompt-inner';

  // Plain-language breakdown first. The raw text is one more click away, so the
  // panel opens on something a beginner can read rather than 7,000 characters
  // of instructions they have no context for yet.
  const breakdown = buildPromptBreakdownEl(prompt);
  if (breakdown) inner.appendChild(breakdown);

  const head = document.createElement('div');
  head.className = 'prompt-head';
  const bits = [prompt.model, `temp ${prompt.temperature}`,
    prompt.maxTokens == null ? 'no token limit' : `max ${prompt.maxTokens} tok`];
  head.innerHTML = `<span class="prompt-head-cfg">${bits.map(b => `<code>${escHtml(String(b))}</code>`).join('')}</span>`;
  head.appendChild(promptCopyBtn(asText));
  inner.appendChild(head);

  // ── Raw text, collapsed by default ──────────────────────────────────
  const rawWrap = document.createElement('div');
  rawWrap.className = 'prompt-raw';
  const rawBtn = document.createElement('button');
  rawBtn.type = 'button';
  rawBtn.className = 'prompt-raw-toggle';
  rawBtn.setAttribute('aria-expanded', 'false');
  rawBtn.innerHTML = `<span class="src-toggle-chevron">${CHEVRON_SVG}</span>`
    + `<span>Show the exact text (${msgs.length} message${msgs.length !== 1 ? 's' : ''})</span>`;
  rawWrap.appendChild(rawBtn);

  const rawBody = document.createElement('div');
  rawBody.className = 'prompt-raw-body hidden';
  msgs.forEach(m => {
    const block = document.createElement('div');
    block.className = `prompt-msg role-${escHtml(m.role)}`;
    block.innerHTML = `<div class="prompt-msg-role">${escHtml(m.role)}`
      + `<span class="prompt-msg-len">${(m.content || '').length} chars</span></div>`;
    const pre = document.createElement('pre');
    pre.className = 'prompt-msg-body';
    pre.textContent = m.content || '';   // never innerHTML — this is raw prompt text
    block.appendChild(pre);
    rawBody.appendChild(block);
  });
  rawWrap.appendChild(rawBody);
  rawBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = !rawBody.classList.toggle('hidden');
    rawBtn.classList.toggle('open', open);
    rawBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    rawBtn.querySelector('span:last-child').textContent = open
      ? 'Hide the exact text'
      : `Show the exact text (${msgs.length} message${msgs.length !== 1 ? 's' : ''})`;
  });
  inner.appendChild(rawWrap);

  panel.innerHTML = '<div class="src-list-clip"></div>';
  panel.firstChild.appendChild(inner);
  wrap.appendChild(panel);

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = panel.classList.toggle('open');
    btn.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  return wrap;
}

// The three provenance elements every answer can carry, attached in a fixed
// order so a reloaded conversation looks exactly like the live one. Called from
// sendMessage() after streaming and from renderSessionMessages() on reload.
function attachProvenance(bubble, msg) {
  if (!bubble || !msg) return;
  applyKnowledgeChips(bubble, msg.kbSources);
  applyCitationChips(bubble, msg.sources);
  const kbEl = buildKnowledgeSourcesEl(msg.kbSources);
  if (kbEl) bubble.appendChild(kbEl);
  const webEl = buildSourcesEl(msg.sources);
  if (webEl) bubble.appendChild(webEl);
  const promptEl = buildPromptInspectorEl(msg.prompt);
  if (promptEl) bubble.appendChild(promptEl);
}

// ── STREAMING RENDER ──────────────────────────────────────────────────
// Text simply appears as it arrives, with a caret at the end — no entry
// animation on the words. Anything that fades a word in has to be paced, and
// pacing is what made this feel slow and flickery.
//
// What keeps it smooth instead is not repainting the whole message. Repainting
// used to mean re-parsing everything and throwing the DOM away on every tick,
// and the parse is O(length), so long answers stuttered worse the longer they
// got. Now the reply is split at the last blank line: everything above it is
// finished markdown, parsed once and never touched again, and only the trailing
// block is rebuilt. A repaint stays cheap no matter how long the answer runs,
// which is what lets the tick rate sit low enough to track the tokens.

// Index just past the last blank line that isn't inside a code fence. Splitting
// inside an unclosed ``` would render a broken block above and strip the
// language hint below, so those candidates are skipped.
function stableSplit(text) {
  let i = text.lastIndexOf('\n\n');
  while (i > 0) {
    if (((text.slice(0, i).match(/```/g) || []).length % 2) === 0) return i + 2;
    i = text.lastIndexOf('\n\n', i - 1);
  }
  return 0;
}

function streamRender(host, text) {
  if (!host) return;
  let stable = host.querySelector('.stream-stable');
  let tail   = host.querySelector('.stream-tail');
  // Streamed text only ever grows. If it somehow doesn't, the commit pointer is
  // past the end of the string and the stable half is showing text that no
  // longer exists — start the host over rather than render a stale mix.
  if (stable && text.length < (+host.dataset.committed || 0)) stable = tail = null;
  if (!stable || !tail) {
    host.textContent = '';
    stable = document.createElement('div');
    stable.className = 'stream-stable';
    tail = document.createElement('div');
    tail.className = 'stream-tail';
    host.append(stable, tail);
    host.dataset.committed = '0';
  }

  const committed = +host.dataset.committed || 0;
  const splitAt = stableSplit(text);
  if (splitAt > committed) {
    // These blocks can't change any more — parse them once and leave them alone.
    const tpl = document.createElement('template');
    tpl.innerHTML = formatContent(text.slice(committed, splitAt));
    stable.appendChild(tpl.content);
    host.dataset.committed = String(splitAt);
  }

  const rest = text.slice(+host.dataset.committed || 0);
  tail.innerHTML = rest.trim() ? formatContent(rest) : '';
}

// ── FOLLOW-UPS ────────────────────────────────────────────────────────
function buildFollowUpsEl(items) {
  const list = (Array.isArray(items) ? items : []).filter(t => t && t.trim());
  if (!list.length) return null;
  const wrap = document.createElement('div');
  wrap.className = 'followups';
  wrap.innerHTML = '<div class="followups-label">Follow-ups</div>';
  list.slice(0, 3).forEach((text, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'followup-item';
    b.style.animationDelay = `${i * 90}ms`;
    b.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 10l-5 5 5 5"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/></svg><span></span>';
    b.querySelector('span').textContent = text;
    b.addEventListener('click', () => { wrap.remove(); suggest(text); });
    wrap.appendChild(b);
  });
  return wrap;
}

// Follow-ups belong to the turn that produced them — once the conversation
// moves on, they're stale. Cleared at the start of every send.
function clearFollowUps() {
  document.querySelectorAll('.followups').forEach(el => el.remove());
}

// Caret at the end of the text still being written. Re-placed after every
// render because the trailing block is rebuilt each tick — which is also why it
// doesn't blink: a blink restarted every 90ms would just sit at one phase.
function setStreamCaret(bubble, on) {
  if (!bubble) return;
  bubble.querySelectorAll('.stream-caret').forEach(c => c.remove());
  if (!on) return;
  let host = bubble.querySelector('.msg-body') || bubble;
  // Descend into the block the text is actually growing in, so the caret lands
  // after the last character instead of on a line of its own below everything.
  const tail = host.querySelector('.stream-tail');
  const stable = host.querySelector('.stream-stable');
  if (tail && tail.lastElementChild) host = tail;
  else if (stable && stable.lastElementChild) host = stable;
  let target = host.lastElementChild;
  // A caret inside a table or code block would land in the wrong place; a list
  // gets it on the final item, where the text actually ends.
  if (target && /^(TABLE|PRE)$/.test(target.tagName)) target = null;
  else if (target && /^(UL|OL)$/.test(target.tagName)) target = target.lastElementChild;
  const caret = document.createElement('span');
  caret.className = 'stream-caret';
  (target || host).appendChild(caret);
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

// ── PROCESS TRACE ─────────────────────────────────────────────────────
// One honest record of the work behind a single answer. Rows are appended in
// the order the work actually happens, so the same array both drives the live
// trace and is what gets stored with the message — reopening a conversation
// replays the trace the student watched, not a plausible reconstruction.
//
// Row kinds:
//   step    a unit of work — spinner while it runs, muted check once it lands
//   query   the search string that was actually sent
//   source  one result, linking out to the page the model was fed
//   more    the "+N more" tail for results we fetched but didn't use
let _trace = null;

const ICON_SPARKLE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"/></svg>';
const ICON_CHEVRON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
const ICON_SEARCH  = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>';
const ICON_GLOBE   = '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="9"/><path d="M3.5 12h17M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>';
// Retrieved chunks are pieces of a file on this machine, so they get a page
// glyph. They used to share the globe with web results, which said "these came
// from the internet" about the student's own uploaded document — and, repeated
// once per chunk, made three pieces of one PDF read as three separate sources.
const ICON_DOC     = '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';

// Step icons: a spinner while a step runs, then a quiet check once it lands.
// Completed steps deliberately don't go green — the trace is a record of work,
// not a scoreboard, and a column of green ticks pulls focus off the answer.
const STEP_ICONS = {
  active: '<span class="step-mini-spinner"></span>',
  done:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
  error:  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
};

// Each source gets its own dot colour so three rows of near-identical text stay
// scannable. Cycled, not hashed — the point is separation, not identity.
const SOURCE_TONES = ['var(--dc-accent)', 'var(--dc-orange)', 'var(--dc-green)'];

// Durations are printed as measured. Assembling the prompt really does take two
// milliseconds; saying so is more useful than padding it out to look busy.
function fmtDur(ms) {
  if (ms == null || !isFinite(ms)) return '';
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)}s`;
}

function fmtCount(n) {
  if (n == null) return '';
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function hostOf(url) {
  try { return new URL(url).host.replace(/^www\./, ''); } catch { return ''; }
}

// Two settled headers can end up stacked — the app's process and the model's
// own reasoning — so they use different verbs rather than both claiming to have
// "thought". A sub-second turn says so instead of rounding down to zero.
function fmtWorkedFor(verb, secs) {
  return secs < 1 ? `${verb} for under a second` : `${verb} for ${secs} second${secs !== 1 ? 's' : ''}`;
}

function startTrace() { _trace = { startMs: Date.now(), rows: [] }; }

function traceRow(id) {
  if (!_trace) return null;
  let row = _trace.rows.find(r => r.id === id);
  if (!row) { row = { id, kind: 'step' }; _trace.rows.push(row); }
  return row;
}

function buildTraceRowEl(row, toneIdx) {
  const isLink = row.kind === 'source' && row.href;
  const el = document.createElement(isLink ? 'a' : 'div');
  if (isLink) {
    el.href = row.href;
    el.target = '_blank';
    el.rel = 'noopener noreferrer';
  }
  el.className = `thinking-step kind-${row.kind}`
    + (row.kind === 'step' ? ` step-${row.status || 'done'}` : '');

  if (row.kind === 'more') {
    el.textContent = row.label;
    return el;
  }

  const icon = row.kind === 'query'
    ? ICON_SEARCH
    : row.kind === 'chunk'
      ? '<span class="chunk-tick"></span>'
      : (row.kind === 'source' || row.kind === 'srcfile')
        ? `<span class="src-dot" style="background:${SOURCE_TONES[toneIdx % SOURCE_TONES.length]}">`
          + `${row.kind === 'srcfile' ? ICON_DOC : ICON_GLOBE}</span>`
        : (STEP_ICONS[row.status] || '');
  el.innerHTML = `<span class="step-icon">${icon}</span><span class="step-text"></span>`;
  el.querySelector('.step-text').textContent = row.label || '';
  if (row.meta) {
    const m = document.createElement('span');
    m.className = 'step-meta';
    m.textContent = row.meta;
    el.appendChild(m);
  }
  return el;
}

function paintTraceRow(row) {
  const list = document.getElementById('thinking-steps-list');
  if (!list) return;
  const domId = `ts-${row.id}`;
  const existing = document.getElementById(domId);
  const toneIdx = _trace
    ? _trace.rows.filter(r => r.kind === 'source' || r.kind === 'srcfile').indexOf(row)
    : 0;
  const el = buildTraceRowEl(row, toneIdx < 0 ? 0 : toneIdx);
  el.id = domId;
  if (existing) {
    // Restyling a row on a status change shouldn't make it fly in a second time.
    el.style.animation = 'none';
    existing.replaceWith(el);
  } else {
    el.style.animationDelay = `${Math.min(list.children.length, 4) * 80}ms`;
    list.appendChild(el);
  }
  autoScroll();
}

function addTraceRow(id, kind, label, opts) {
  const row = traceRow(id);
  if (!row) return;
  row.kind = kind;
  row.label = label;
  row.meta = (opts && opts.meta) || '';
  if (opts && opts.href) row.href = opts.href;
  paintTraceRow(row);
}

function updateThinkingStep(stepId, status, label, meta) {
  const row = traceRow(stepId);
  if (!row) return;
  row.kind = 'step';
  row.status = status;
  row.label = label;
  row.meta = meta || '';
  paintTraceRow(row);
}

// null when the step never ran at all, which is how a caller tells "this stage
// failed" apart from "we never got that far".
function traceStatus(id) {
  const row = _trace && _trace.rows.find(r => r.id === id);
  return row ? (row.status || '') : null;
}

// Freeze the trace into a plain object that survives being stored with the
// message and re-rendered on reload.
function captureTrace() {
  if (!_trace || !_trace.rows.length) return null;
  return {
    startMs: _trace.startMs,
    secs: (Date.now() - _trace.startMs) / 1000,
    // Nothing is running any more, so a row left mid-spin is recorded as the
    // completed work it was — a spinner frozen in saved history reads as a hang.
    rows: _trace.rows.map(r => ({ ...r, status: r.status === 'active' ? 'done' : r.status })),
  };
}

// First token has landed. The trace stops being a placeholder and becomes part
// of the answer: the live nodes move into the bubble (so steps keep updating as
// the reply streams) and the typing row retires.
function promoteTrace(bubble) {
  const typing = document.getElementById('typing-row');
  if (!typing || !bubble) return;
  const source = typing.querySelector('.thinking-bubble');
  if (!source) { typing.remove(); return; }
  const wrap = document.createElement('div');
  wrap.className = 'process-trace live';
  while (source.firstChild) wrap.appendChild(source.firstChild);
  // The edu card is a "while you wait" panel — once there's an answer on screen
  // it has nothing left to fill.
  const edu = wrap.querySelector('#thinking-edu-card');
  if (edu) edu.remove();
  window._setEduCard = null;
  bubble.insertBefore(wrap, bubble.firstChild);
  typing.remove();
}

function settleTraceEl(wrap, secs) {
  if (!wrap) return;
  wrap.classList.remove('live');
  const label = wrap.querySelector('.thinking-label');
  if (label) {
    label.classList.add('settled');
    if (secs != null) label.textContent = fmtWorkedFor('Worked', secs);
  }
  // A spinner with nothing left to wait for would spin forever.
  wrap.querySelectorAll('.step-mini-spinner').forEach(s => {
    const step = s.closest('.thinking-step');
    s.outerHTML = STEP_ICONS.done;
    if (step) step.classList.replace('step-active', 'step-done');
  });
  const top = wrap.querySelector('.thinking-top-row');
  const body = wrap.querySelector('.thinking-collapsible');
  if (top && body) {
    body.classList.add('hidden');
    top.classList.add('collapsed');
    top.setAttribute('aria-expanded', 'false');
  }
  // Stale ids from a finished turn would hijack getElementById on the next one.
  wrap.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
}

// Streaming is done. The header stops shimmering, states how long the work
// took, and folds away — still there for anyone who wants to reopen it.
function settleTrace(bubble) {
  clearInterval(window._thinkingInterval);
  clearInterval(window._thinkTimerInterval);
  window._thinkingInterval = null;
  window._thinkTimerInterval = null;
  window._thinkingLabelOverride = null;
  window._revealThinkingSteps = null;
  window._setEduCard = null;
  const data = captureTrace();
  _trace = null;
  const wrap = bubble && bubble.querySelector('.process-trace.live');
  if (wrap) settleTraceEl(wrap, data ? Math.max(0, Math.round(data.secs)) : null);
  // Safety net: a reasoning block whose </think> never arrived would otherwise
  // shimmer "Thinking for 12s" forever under a finished answer.
  const stray = bubble && bubble.querySelector('.think-header-label:not(.settled)');
  if (stray) stray.classList.add('settled');
  return data;
}

// Rebuild a settled trace from stored data — used when a saved conversation is
// reopened, and for the non-streaming fallback, which has no live trace to move.
function buildSettledTraceEl(data) {
  if (!data || !Array.isArray(data.rows) || !data.rows.length) return null;
  const secs = Math.max(0, Math.round(data.secs || 0));
  const wrap = document.createElement('div');
  wrap.className = 'process-trace';
  wrap.innerHTML = `
    <div class="thinking-top-row collapsed" onclick="toggleThinkingCollapse(this)" role="button" tabindex="0" aria-expanded="false">
      <span class="thinking-sparkle">${ICON_SPARKLE}</span>
      <span class="thinking-label settled">${escHtml(fmtWorkedFor('Worked', secs))}</span>
      <span class="thinking-model-tag">${escHtml(data.model || '')}</span>
      <span class="thinking-top-chevron">${ICON_CHEVRON}</span>
    </div>
    <div class="thinking-collapsible hidden">
     <div class="thinking-clip">
      <div class="thinking-trace">
        <div class="thinking-steps-section">
          <div class="thinking-steps-label">Process</div>
          <div class="thinking-steps-list"></div>
        </div>
      </div>
     </div>
    </div>`;
  const list = wrap.querySelector('.thinking-steps-list');
  let tone = 0;
  for (const row of data.rows) {
    const el = buildTraceRowEl(row, (row.kind === 'source' || row.kind === 'srcfile') ? tone++ : 0);
    el.style.animation = 'none';
    list.appendChild(el);
  }
  return wrap;
}

// Prepend a stored trace above an answer that's already rendered.
function attachTrace(bubble, data) {
  const el = buildSettledTraceEl(data);
  if (bubble && el) bubble.insertBefore(el, bubble.firstChild);
}

const _thinkingPhrases = ['Thinking', 'Reading your message', 'Generating response', 'Putting it together'];

function appendTypingIndicator() {
  startTrace();
  const chatArea = document.getElementById('chat-area');
  const row = document.createElement('div');
  row.className = 'message-row';
  row.id = 'typing-row';
  row.innerHTML = `
    <div class="avatar ai">${getAIAvatar()}</div>
    <div class="bubble ai thinking-bubble">
      <div class="thinking-top-row" onclick="toggleThinkingCollapse(this)" role="button" tabindex="0" aria-expanded="true">
        <span class="thinking-sparkle"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"/></svg></span>
        <span class="thinking-label" id="thinking-label">Thinking</span>
        <span class="thinking-model-tag">${escHtml(window.ACTIVE_MODEL || '')}</span>
        <span class="thinking-top-chevron"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span>
      </div>
      <div class="thinking-collapsible" id="thinking-collapsible">
       <div class="thinking-clip">
        <div class="thinking-trace">
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
                <a href="https://github.com/Spod101/barangayAI" target="_blank" rel="noopener">GitHub repo</a>
                <a href="https://devcon.ph" target="_blank" rel="noopener">DEVCON</a>
              </div>
            </div>
          </div>
          <div class="thinking-steps-section${window._CONN_STATE === 'online' ? '' : ' hidden'}" id="thinking-steps-section">
            <div class="thinking-steps-label">Process</div>
            <div class="thinking-steps-list" id="thinking-steps-list"></div>
          </div>
        </div>
       </div>
      </div>
    </div>`;
  chatArea.appendChild(row);

  // The shimmer sweep carries the "still working" signal now, so the label only
  // has to rotate the phrase — no trailing dots jittering the header's width.
  let phraseIdx = 0;
  const labelEl = row.querySelector('#thinking-label');
  window._thinkingInterval = setInterval(() => {
    // While web search runs, pin the label instead of cycling the usual phrases.
    if (window._thinkingLabelOverride) {
      labelEl.textContent = window._thinkingLabelOverride;
      return;
    }
    phraseIdx = (phraseIdx + 1) % _thinkingPhrases.length;
    labelEl.textContent = _thinkingPhrases[phraseIdx];
  }, 1800);

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

  // The trace starts hidden unless the model is known-online: while the header
  // says Offline (or is still checking) the steps are claims we can't back up,
  // and the request is probably about to fail with a setup card instead. Steps
  // still record into the list, so the moment the endpoint actually answers the
  // section can be revealed with its history intact.
  const stepsSection = row.querySelector('#thinking-steps-section');
  window._revealThinkingSteps = () => stepsSection.classList.remove('hidden');

  autoScroll();
}

function removeTypingIndicator() {
  clearInterval(window._thinkingInterval);
  clearInterval(window._thinkTimerInterval);
  window._thinkingInterval = null;
  window._thinkingLabelOverride = null;
  window._setEduCard = null;
  window._revealThinkingSteps = null;
  window._thinkTimerInterval = null;
  const el = document.getElementById('typing-row');
  if (el) el.remove();
  // A turn that failed after its trace was promoted leaves a live trace stranded
  // in the bubble — settle it here so it can't spin forever or capture the next
  // turn's getElementById lookups.
  document.querySelectorAll('.process-trace.live').forEach(w => settleTraceEl(w, null));
}

function toggleThinkingCollapse(topRow) {
  const body = topRow.nextElementSibling;
  if (!body) return;
  const collapsed = body.classList.toggle('hidden');
  topRow.classList.toggle('collapsed', collapsed);
  topRow.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
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

// The model's own reasoning, rendered in the same language as the process
// trace above it: sparkle, shimmering label while it runs, settled "Thought
// for Ns" once it stops, and prose hanging off the same hairline rail.
function renderThinkInBubble(bubble, think, display, partial) {
  const main = bubble.querySelector('.msg-body');
  let thinkBlock = bubble.querySelector('.think-block');
  if (!thinkBlock) {
    thinkBlock = document.createElement('div');
    thinkBlock.className = 'think-block';
    thinkBlock.dataset.startMs = Date.now();
    thinkBlock.innerHTML = `
      <div class="think-block-header" onclick="toggleThinkBlock(this)" role="button" tabindex="0" aria-expanded="false">
        <span class="thinking-sparkle">${ICON_SPARKLE}</span>
        <span class="think-header-label">Thinking</span>
        <span class="think-block-chevron">${ICON_CHEVRON}</span>
      </div>
      <div class="think-block-body hidden"></div>`;
    // The reasoning belongs above the answer it produced.
    if (main) bubble.insertBefore(thinkBlock, main);
    else bubble.appendChild(thinkBlock);

    window._thinkTimerInterval = setInterval(() => {
      const label = thinkBlock.querySelector('.think-header-label');
      if (label) {
        const secs = Math.floor((Date.now() - +thinkBlock.dataset.startMs) / 1000);
        label.textContent = `Thinking for ${secs}s`;
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
    if (label) {
      label.classList.add('settled');
      label.textContent = fmtWorkedFor('Thought', secs);
    }
  }

  if (main) streamRender(main, display || '');
}

function toggleThinkBlock(headerEl) {
  const body = headerEl.nextElementSibling;
  if (!body) return;
  const open = !body.classList.toggle('hidden');
  headerEl.classList.toggle('open', open);
  headerEl.setAttribute('aria-expanded', open ? 'true' : 'false');
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

// Returns the bubble so callers can keep appending to this specific message —
// every AI bubble used to carry the same `ai-bubble-latest` id, which made
// getElementById hand back the *oldest* one in the conversation.
function appendAIMessage(text, trace) {
  const chatArea = document.getElementById('chat-area');
  const row = document.createElement('div');
  row.className = 'message-row';
  row.innerHTML = `
    <div class="avatar ai">${getAIAvatar()}</div>
    <div class="bubble ai"><div class="msg-body">${formatContent(text)}</div></div>`;
  if (trace) attachTrace(row.querySelector('.bubble'), trace);
  chatArea.appendChild(row);
  const time = document.createElement('div');
  time.className = 'message-time';
  time.textContent = getTime();
  chatArea.appendChild(time);
  autoScroll();
  return row.querySelector('.bubble');
}

function appendError(msg) {
  const chatArea = document.getElementById('chat-area');
  const err = document.createElement('div');
  err.className = 'error-bubble';
  err.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> ${escHtml(msg)}`;
  chatArea.appendChild(err);
  autoScroll();
}

// Auto-scroll follows the reply only while the reader is already at the bottom.
// The moment they scroll up mid-stream the view stays where they put it — every
// 90ms render used to yank it straight back down, which made reading anything
// above the caret impossible. The jump-to-bottom button is how they opt back in.
let _stickToBottom = true;

// Called for content the app produces on its own — respects the reader's place.
function autoScroll() {
  if (!_stickToBottom) return;
  const chatArea = document.getElementById('chat-area');
  if (chatArea) chatArea.scrollTop = chatArea.scrollHeight;
}

// Called when the reader explicitly asks to go back down — sending a message,
// switching sessions, or pressing the jump button — which re-arms following.
function scrollToBottom() {
  const chatArea = document.getElementById('chat-area');
  if (!chatArea) return;
  _stickToBottom = true;
  chatArea.scrollTop = chatArea.scrollHeight;
}

document.getElementById('chat-area').addEventListener('scroll', function() {
  const { scrollTop, scrollHeight, clientHeight } = this;
  const btn = document.getElementById('scroll-btn');
  const atBottom = scrollHeight - scrollTop - clientHeight < 120;
  _stickToBottom = atBottom;
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
  autoScroll();
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

function toggleFollowUpsSetting(el) {
  el.classList.toggle('on');
}

