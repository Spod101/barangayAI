// ── REVIEW STUDY BUDDY ────────────────────────────────────────────────
// A second way to use the same AI: instead of asking it questions, it asks
// you. Sources the student already uploaded become flashcards, each one
// tagged with the Bloom's Taxonomy level it exercises, and the deck is then
// drilled with active recall and Leitner spacing.
//
// Bloom levels are not decoration. A deck that is all "define X" trains one
// skill — recall — and that is not the skill an exam question like "which
// approach would you choose here, and why" tests. Tagging every card makes
// the imbalance visible, and the Progress tab scores each level on its own so
// a weak level can be drilled rather than guessed at.
//
// Generation is deliberately NOT sendMessage(): that function owns the
// composer, the trace UI, `isStreaming` and the session thread. This is a
// one-shot non-streaming call in the shape of generateFollowUps() instead, so
// nothing here can leave the chat in a half-streamed state.
// ─────────────────────────────────────────────────────────────────────

// ── Bloom's Taxonomy (2001 Anderson/Krathwohl revision) ───────────────
// Ordered low to high. `n` is the level number students see; `verbs` seeds the
// generation prompt so the model writes a card that actually sits at the level
// it claims, rather than labelling six recall questions as six levels.
const BLOOM_LEVELS = [
  { id: 'remember',   n: 1, label: 'Remember',   verbs: 'define, list, name, identify, recall, state',
    blurb: 'Retrieve a fact or term from memory.' },
  { id: 'understand', n: 2, label: 'Understand', verbs: 'explain, describe, summarise, paraphrase, classify',
    blurb: 'Restate an idea in your own words.' },
  { id: 'apply',      n: 3, label: 'Apply',      verbs: 'use, solve, demonstrate, calculate, implement',
    blurb: 'Use it in a new but similar situation.' },
  { id: 'analyze',    n: 4, label: 'Analyze',    verbs: 'compare, contrast, differentiate, examine, deconstruct',
    blurb: 'Break it apart and relate the parts.' },
  { id: 'evaluate',   n: 5, label: 'Evaluate',   verbs: 'judge, critique, justify, defend, prioritise',
    blurb: 'Judge it against criteria and defend that.' },
  { id: 'create',     n: 6, label: 'Create',     verbs: 'design, construct, compose, plan, devise',
    blurb: 'Build something new out of the parts.' },
];

const BLOOM_BY_ID = new Map(BLOOM_LEVELS.map(l => [l.id, l]));

// Models answer with whatever spelling they like, and a mislabelled card is
// worse than an unlabelled one — it lands in the wrong Progress bar and hides
// the very weakness the level split exists to expose. So the level comes back
// through this map rather than being trusted as-is.
const BLOOM_ALIASES = new Map([
  ['remembering', 'remember'], ['knowledge', 'remember'], ['recall', 'remember'], ['1', 'remember'],
  ['understanding', 'understand'], ['comprehension', 'understand'], ['2', 'understand'],
  ['applying', 'apply'], ['application', 'apply'], ['3', 'apply'],
  ['analysing', 'analyze'], ['analyzing', 'analyze'], ['analyse', 'analyze'], ['analysis', 'analyze'], ['4', 'analyze'],
  ['evaluating', 'evaluate'], ['evaluation', 'evaluate'], ['synthesis', 'evaluate'], ['5', 'evaluate'],
  ['creating', 'create'], ['creation', 'create'], ['6', 'create'],
]);

function bloomMeta(id) {
  return BLOOM_BY_ID.get(normaliseBloom(id)) || BLOOM_LEVELS[0];
}

function normaliseBloom(raw) {
  const k = String(raw || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (BLOOM_BY_ID.has(k)) return k;
  return BLOOM_ALIASES.get(k) || 'remember';
}

// ── Leitner spacing ───────────────────────────────────────────────────
// Box 1 is always due; every promotion roughly quadruples the wait. The short
// rungs (5 min, 1 hour) matter because most of this app's studying happens in
// one sitting at a camp — a schedule whose first interval is "tomorrow" would
// leave nothing due for the entire session and quietly do nothing.
const BOX_WAIT_MS = {
  1: 0,
  2: 5 * 60 * 1000,
  3: 60 * 60 * 1000,
  4: 24 * 60 * 60 * 1000,
  5: 3 * 24 * 60 * 60 * 1000,
  6: 7 * 24 * 60 * 60 * 1000,
};
const BOX_MAX = 6;
const BOX_MASTERED = 5;   // box 5+ counts as mastered in Progress

// ── Generation limits ─────────────────────────────────────────────────
// Five cards per request, not twenty. api/proxy.js caps max_tokens at 512 on a
// published site, and a truncated reply is invalid JSON — which loses the whole
// batch, not the last card. Five compact cards fit inside that ceiling with
// room to spare, and a batch that fails costs five cards instead of all of them.
const REVIEW_BATCH = 5;
const REVIEW_MAX_TOKENS = 900;        // clamped to 512 by the proxy; honoured in full locally
const REVIEW_CONTEXT_CHARS = 5200;    // grounding budget per request
const REVIEW_RETRIEVE_K = 10;
const REVIEW_FRONT_MAX = 200;
const REVIEW_BACK_MAX = 420;
const REVIEW_HINT_MAX = 110;
const REVIEW_QUIZ_LEN = 10;
const REVIEW_QUIZ_OPTIONS = 4;

const REVIEW_DECKS_KEY = 'review_decks';
const REVIEW_ACTIVE_KEY = 'review_active_deck';
const REVIEW_MODEL_KEY = 'review_groq_model';

// ── Groq ──────────────────────────────────────────────────────────────
const GROQ_BASE = 'https://api.groq.com/openai/v1';
// Same value api/proxy.js falls back to, and for the same reason: a pinned
// model name is a dead feature the day the provider retires it, so this is only
// ever the last resort when the live list cannot be read at all.
const GROQ_FALLBACK_MODEL = 'openai/gpt-oss-20b';
// /models lists speech, embedding and safety models beside the chat ones, and
// every one of them either 400s or answers nonsense when handed a conversation.
const GROQ_NON_CHAT = /whisper|tts|embedding|embed|rerank|guard|moderation|vision/i;
// Preference order for auto-picking, cheapest-and-good-enough first. Flashcard
// generation is short, structured and repeated — it does not need the big model.
const GROQ_PREFERRED = [/gpt-oss-20b/i, /8b|instant|mini|small/i, /70b|versatile/i];

// ── State ─────────────────────────────────────────────────────────────
let _REVIEW_DECKS = [];
let _REVIEW_ACTIVE = null;       // deck id
let _reviewTab = 'build';
let _reviewQueue = [];           // card ids queued for this study run
let _reviewPos = 0;
let _reviewFlipped = false;
let _reviewBusy = false;
let _reviewQuiz = null;          // { items, pos, score, answered }
let _reviewGroqModels = null;    // cached /models result
let _reviewGroqModelsKey = '';   // which key produced that cache — see reviewGroqModels()
let _reviewGroqModel = '';       // the chosen Groq model

// ── Persistence ───────────────────────────────────────────────────────

function loadReviewDecks() {
  let raw = null;
  try { if (window.BarangayDB) raw = window.BarangayDB.dbGetItem(REVIEW_DECKS_KEY, null); } catch (e) { /* storage unavailable */ }
  _REVIEW_DECKS = Array.isArray(raw) ? raw.map(hydrateDeck).filter(Boolean) : [];

  let active = null;
  try { if (window.BarangayDB) active = window.BarangayDB.dbGetItem(REVIEW_ACTIVE_KEY, null); } catch (e) { /* ignore */ }
  _REVIEW_ACTIVE = _REVIEW_DECKS.some(d => d.id === active) ? active : (_REVIEW_DECKS[0]?.id || null);

  try { if (window.BarangayDB) _reviewGroqModel = window.BarangayDB.dbGetItem(REVIEW_MODEL_KEY, '') || ''; } catch (e) { /* ignore */ }
}

// A deck read back from storage is a file from outside this run — an older
// version of the app wrote it, or a hand-edited export did. Every field is
// rebuilt to a known shape here so no later code has to defend itself.
function hydrateDeck(d) {
  if (!d || typeof d !== 'object' || !d.id) return null;
  return {
    id: String(d.id),
    name: String(d.name || 'Untitled deck').slice(0, 80),
    topic: String(d.topic || '').slice(0, 400),
    grounded: d.grounded === true,
    createdAt: Number(d.createdAt) || Date.now(),
    updatedAt: Number(d.updatedAt) || Number(d.createdAt) || Date.now(),
    cards: Array.isArray(d.cards) ? d.cards.map(hydrateCard).filter(Boolean) : [],
  };
}

function hydrateCard(c) {
  if (!c || typeof c !== 'object') return null;
  const front = String(c.front || '').trim();
  const back = String(c.back || '').trim();
  if (!front || !back) return null;
  const srs = c.srs && typeof c.srs === 'object' ? c.srs : {};
  const box = Math.min(BOX_MAX, Math.max(1, Number(srs.box) || 1));
  return {
    id: String(c.id || reviewId('c')),
    front: front.slice(0, REVIEW_FRONT_MAX),
    back: back.slice(0, REVIEW_BACK_MAX),
    hint: String(c.hint || '').trim().slice(0, REVIEW_HINT_MAX),
    bloom: normaliseBloom(c.bloom || c.level),
    cite: String(c.cite || '').slice(0, 120),
    srs: {
      box,
      seen: Math.max(0, Number(srs.seen) || 0),
      right: Math.max(0, Number(srs.right) || 0),
      streak: Math.max(0, Number(srs.streak) || 0),
      lastAt: Number(srs.lastAt) || 0,
    },
  };
}

function saveReviewDecks() {
  try {
    if (!window.BarangayDB) return;
    window.BarangayDB.dbSetItem(REVIEW_DECKS_KEY, _REVIEW_DECKS);
    window.BarangayDB.dbSetItem(REVIEW_ACTIVE_KEY, _REVIEW_ACTIVE);
  } catch (e) {
    console.warn('[Review] decks not saved:', e && e.message || e);
  }
}

function reviewId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function activeDeck() {
  return _REVIEW_DECKS.find(d => d.id === _REVIEW_ACTIVE) || null;
}

// ── Engine resolution ─────────────────────────────────────────────────
// Two branches only, on purpose. A Groq key the student pasted in is an
// explicit "use this", so it wins everywhere — including on a deployed copy,
// where it saves a round trip through our own proxy. With no key we borrow
// whatever the app already selected, which is Ollama locally and the hosted
// model through /api on a published site. No third path means no case where
// Review reaches a provider the rest of the app is not already reaching.
function reviewEngine() {
  const key = (window._GROQ_KEY || '').trim();
  if (key) {
    return {
      base: GROQ_BASE,
      key,
      model: _reviewGroqModel || GROQ_FALLBACK_MODEL,
      label: 'Groq',
      via: 'groq',
      ready: true,
    };
  }
  const base = window.ACTIVE_BASE || '';
  const model = window.ACTIVE_MODEL || '';
  const hosted = base === '/api' || base.endsWith('/api');
  return {
    base,
    key: window.ACTIVE_KEY || '',
    model,
    label: hosted ? 'Hosted model' : (model || 'no model selected'),
    via: hosted ? 'proxy' : 'app',
    // The proxy picks the model server-side, so a published copy is ready
    // without one chosen here; a local endpoint is not.
    ready: !!base && (hosted || !!model),
  };
}

function reviewEngineNote(eng) {
  if (eng.via === 'groq') return `Groq · ${eng.model}`;
  if (eng.via === 'proxy') return 'Hosted model via /api — the key stays on the server';
  if (!eng.ready) return 'No model selected yet — pick one in the composer, or add a Groq key in Settings → Model';
  return `${eng.model} · the model this app is already using`;
}

// Ask Groq what this key can actually reach, rather than pinning a name that
// may already be retired. Cached for the page's lifetime — the list changes on
// the order of weeks and the Build tab would otherwise re-ask on every open.
//
// The cache is keyed by the key itself, not just "have we asked yet". Two keys
// on the same account can reach different models, and a key that has been
// replaced because the old one was revoked is exactly the moment a stale list is
// most misleading: the picker would keep offering models the new key may not
// serve, and every Generate would 404 against a name the app itself supplied.
async function reviewGroqModels(key) {
  if (_reviewGroqModels && _reviewGroqModelsKey === key) return _reviewGroqModels;
  const res = await fetch(`${GROQ_BASE}/models`, { headers: { 'Authorization': `Bearer ${key}` } });
  if (!res.ok) {
    const err = new Error(res.status === 401 ? 'That Groq key was rejected.' : `Groq model list unavailable (HTTP ${res.status})`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const ids = (data.data || data.models || [])
    .map(m => m && (m.id || m.name))
    .filter(id => typeof id === 'string' && id && !GROQ_NON_CHAT.test(id));
  if (!ids.length) throw new Error('That Groq key reaches no chat models.');
  _reviewGroqModels = rankGroqModels(ids);
  _reviewGroqModelsKey = key;
  return _reviewGroqModels;
}

function rankGroqModels(ids) {
  const seen = new Set();
  const out = [];
  for (const rx of GROQ_PREFERRED) {
    for (const id of ids) {
      if (!seen.has(id) && rx.test(id)) { seen.add(id); out.push(id); }
    }
  }
  for (const id of ids.slice().sort()) if (!seen.has(id)) { seen.add(id); out.push(id); }
  return out;
}

// ── Grounding ─────────────────────────────────────────────────────────
// Same retrieval the chat uses, pointed at the same active sources. With a
// topic we rank chunks against it; without one we take the leading chunks so a
// deck can still be built from a document the student has not read yet.
function reviewGroundingText(topic) {
  const files = window._TRAINING_FILES_ACTIVE || [];
  const rag = window.BarangayRAG;
  if (!files.length || !rag) return { text: '', cites: [] };

  const items = rag.buildChunkIndex(files);
  if (!items.length) return { text: '', cites: [] };

  const picked = (topic && topic.trim())
    ? rag.retrieveTopChunks(topic, items, REVIEW_RETRIEVE_K)
    : [];
  const pool = picked.length ? picked : items.slice(0, REVIEW_RETRIEVE_K);

  const parts = [];
  const cites = [];
  let used = 0;
  for (const c of pool) {
    if (used + c.text.length > REVIEW_CONTEXT_CHARS) break;
    parts.push(`[${c.file} · chunk ${c.index}/${c.total}]\n${c.text}`);
    cites.push(`${c.file} · chunk ${c.index}/${c.total}`);
    used += c.text.length;
  }
  // Nothing fit because the very first chunk is larger than the budget — take a
  // slice of it rather than reporting "no sources" for a library that has them.
  if (!parts.length && pool.length) {
    parts.push(`[${pool[0].file} · chunk ${pool[0].index}/${pool[0].total}]\n${pool[0].text.slice(0, REVIEW_CONTEXT_CHARS)}`);
    cites.push(`${pool[0].file} · chunk ${pool[0].index}/${pool[0].total}`);
  }
  return { text: parts.join('\n\n---\n\n'), cites };
}

// ── Prompt ────────────────────────────────────────────────────────────

const REVIEW_SYSTEM = [
  "You write exam-quality study flashcards and tag each one with its Bloom's Taxonomy level.",
  'Reply with a JSON array and nothing else: no prose, no explanation, no markdown code fences.',
  'Every element is an object with exactly these four keys:',
  '  "level" - one of: remember, understand, apply, analyze, evaluate, create',
  '  "front" - the prompt the student sees. One single question, under 140 characters.',
  '  "back"  - the answer, under 240 characters. For evaluate and create cards, give a model answer that names the points a good response must hit.',
  '  "hint"  - a short nudge that does not give the answer away, under 60 characters. Use an empty string if none fits.',
  'Rules you must follow:',
  '- One idea per card. Never ask two things in one front.',
  '- The front must determine its own answer. Never write a front that could mean several different questions.',
  '- Never copy a sentence from the source material as the answer. Rephrase it.',
  '- Never write a card whose answer can be guessed from the wording of the front.',
  '- Write the card at the level you tagged it with, using that level\'s kind of thinking.',
].join('\n');

function reviewBatchPrompt(opts) {
  const { levels, count, topic, grounding, avoid } = opts;
  const lines = [];

  lines.push(`Write exactly ${count} flashcards.`);
  lines.push('');
  lines.push('Spread them across these Bloom levels, using each at least once where the count allows:');
  for (const id of levels) {
    const m = bloomMeta(id);
    lines.push(`- ${m.id} (level ${m.n}, ${m.label}): ${m.blurb} Use verbs like ${m.verbs}.`);
  }

  if (topic) {
    lines.push('');
    lines.push(`Topic or focus: ${topic}`);
  }

  if (grounding) {
    lines.push('');
    lines.push('Base every card strictly on the source material below. If the material does not support a card at some level, write one that reasons about the material rather than inventing new facts.');
    lines.push('');
    lines.push('--- SOURCE MATERIAL ---');
    lines.push(grounding);
    lines.push('--- END SOURCE MATERIAL ---');
  } else {
    lines.push('');
    lines.push('There is no source document. Use your own general knowledge of the topic, and stay with widely agreed material rather than niche specifics.');
  }

  if (avoid && avoid.length) {
    lines.push('');
    lines.push('These questions already exist. Do not repeat them or ask a reworded version of them:');
    for (const q of avoid) lines.push(`- ${q}`);
  }

  lines.push('');
  lines.push(`Reply with the JSON array of ${count} objects now.`);
  return lines.join('\n');
}

// ── Parsing ───────────────────────────────────────────────────────────
// Models wrap JSON in prose, in code fences, and in reasoning tags however
// firmly they were told not to. Every one of those is recoverable, and losing
// five good cards to a stray "Here you go:" would be a bad trade.
function parseCardJSON(raw) {
  let text = String(raw || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:json)?/gi, '')
    .trim();

  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start >= 0 && end > start) {
    const slice = text.slice(start, end + 1);
    try {
      const arr = JSON.parse(slice);
      if (Array.isArray(arr)) return arr;
    } catch (e) { /* fall through to the per-object scan */ }
  }

  // The array as a whole did not parse — usually one malformed element, or a
  // reply cut off mid-array by the token cap. Recover the objects that ARE
  // intact rather than discarding the batch.
  const out = [];
  const objRx = /\{[^{}]*\}/g;
  let m;
  while ((m = objRx.exec(text)) !== null) {
    try {
      const o = JSON.parse(m[0]);
      if (o && typeof o === 'object') out.push(o);
    } catch (e) { /* skip this one */ }
  }
  return out;
}

// A card is only worth keeping if it has both sides and asks something. The
// length caps are the same ones the prompt asked for — a model that ignored
// them gets truncated here rather than breaking the card layout.
function cardsFromRaw(arr, cite) {
  const out = [];
  for (const o of (arr || [])) {
    if (!o || typeof o !== 'object') continue;
    const front = String(o.front || o.question || o.q || '').trim();
    const back = String(o.back || o.answer || o.a || '').trim();
    // A front under six characters is not a question, but a back of one
    // character can be a perfectly good answer — "7", "π", a letter grade. Only
    // emptiness disqualifies the answer side, and this deliberately matches
    // hydrateCard(), which validates the same card coming back from storage.
    if (front.length < 6 || !back) continue;
    out.push({
      id: reviewId('c'),
      front: front.slice(0, REVIEW_FRONT_MAX),
      back: back.slice(0, REVIEW_BACK_MAX),
      hint: String(o.hint || '').trim().slice(0, REVIEW_HINT_MAX),
      bloom: normaliseBloom(o.level || o.bloom),
      cite: cite || '',
      srs: { box: 1, seen: 0, right: 0, streak: 0, lastAt: 0 },
    });
  }
  return out;
}

// Same question twice is the one failure mode batching introduces, so fronts are
// compared with punctuation and case removed rather than literally.
function frontKey(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// What the card says it came from. The whole value of a citation is being able
// to go and check it, so this always names a file when it can: one chunk cites
// itself, several from one document name that document, and only a genuine spread
// across files falls back to a count. "4 chunks from your Sources" is true and
// useless — it points at nothing the student can open.
function reviewCiteLabel(cites) {
  if (!cites || !cites.length) return '';
  if (cites.length === 1) return cites[0];
  const files = [...new Set(cites.map(c => String(c).split(' · ')[0]))];
  if (files.length === 1) return `${files[0]} · ${cites.length} chunks`;
  return `${files.length} sources · ${cites.length} chunks`;
}

// ── Generation ────────────────────────────────────────────────────────

async function reviewChat(eng, messages, maxTokens) {
  const payload = {
    model: eng.model,
    messages,
    temperature: 0.5,
    max_tokens: maxTokens,
    stream: false,
  };
  const isLocalOllama = typeof isOllamaEndpoint === 'function'
    && eng.via === 'app'
    && isOllamaEndpoint(eng.base, window.ACTIVE_KIND);

  if (isLocalOllama) {
    // Ollama-only knobs. Cloud providers answer 400 for fields they do not know,
    // and api/proxy.js drops them anyway, so they are only ever sent to a local
    // endpoint — where a reasoning model would otherwise spend the whole token
    // budget thinking and return no JSON at all.
    payload.chat_template_kwargs = { enable_thinking: false };
    payload.messages = payload.messages.concat([{ role: 'user', content: '/no_think' }]);
  } else {
    // The same failure, on the cloud path, needs the standard field rather than
    // Ollama's. Without it this request measured 510 of its 512 tokens spent
    // reasoning and returned an empty string — a deck of zero cards, from a
    // request that reported HTTP 200.
    //
    // Writing a flashcard is not a task that needs deliberation: the answer is
    // short, its shape is dictated, and the material is supplied. Extended
    // reasoning here buys nothing and costs the entire budget.
    payload.reasoning_effort = 'low';
  }

  const headers = { 'Content-Type': 'application/json' };
  if (eng.key) headers['Authorization'] = `Bearer ${eng.key}`;

  const res = await fetch(`${eng.base}/chat/completions`, {
    method: 'POST',
    mode: 'cors',
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.error?.message || '';
    } catch (e) { /* not JSON */ }
    const err = new Error(detail || reviewHttpHint(res.status));
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  return data?.choices?.[0]?.message?.content || '';
}

function reviewHttpHint(status) {
  if (status === 401 || status === 403) return 'The API key was rejected. Check it in Settings → Model.';
  if (status === 404) return 'That model no longer exists on the provider. Pick another one.';
  if (status === 429) return 'Rate limit reached. Wait a moment and try again.';
  if (status === 503) return 'No model is connected. Add a key on the server, or a Groq key in Settings → Model.';
  return `The model provider answered HTTP ${status}.`;
}

async function reviewGenerate() {
  if (_reviewBusy) return;

  const nameEl = document.getElementById('review-deck-name');
  const topicEl = document.getElementById('review-topic');
  const countEl = document.getElementById('review-count');
  const useSrc = document.getElementById('review-use-sources');

  const levels = [...document.querySelectorAll('#review-levels .bloom-chip.on')].map(el => el.dataset.bloom);
  if (!levels.length) { reviewStatus('Pick at least one Bloom level.', 'warn'); return; }

  const topic = (topicEl?.value || '').trim();
  const total = Math.max(1, Math.min(48, parseInt(countEl?.value || '12', 10) || 12));
  const wantSources = !!useSrc?.classList.contains('on');

  const eng = reviewEngine();
  if (!eng.ready) {
    reviewStatus(reviewEngineNote(eng), 'warn');
    return;
  }

  const ground = wantSources ? reviewGroundingText(topic) : { text: '', cites: [] };
  if (!topic && !ground.text) {
    reviewStatus('Give it a topic, or add a Source to build from.', 'warn');
    return;
  }
    const cite = reviewCiteLabel(ground.cites);

  _reviewBusy = true;
  reviewSetGenerating(true);

  const cards = [];
  const seenFronts = new Set();
  const batches = Math.ceil(total / REVIEW_BATCH);
  let lastError = null;

  try {
    for (let b = 0; b < batches; b++) {
      const want = Math.min(REVIEW_BATCH, total - cards.length);
      if (want <= 0) break;

      reviewStatus(`Writing cards… ${cards.length}/${total}`, 'busy');

      // Levels are rotated across batches so a five-card request does not
      // spend all of itself on "remember" and leave the higher levels to a
      // batch that may never run.
      const slice = [];
      for (let i = 0; i < want; i++) slice.push(levels[(b * want + i) % levels.length]);
      const wanted = [...new Set(slice)];

      const prompt = reviewBatchPrompt({
        levels: wanted,
        count: want,
        topic,
        grounding: ground.text,
        avoid: cards.slice(-12).map(c => c.front),
      });

      let raw;
      try {
        raw = await reviewChat(eng, [
          { role: 'system', content: REVIEW_SYSTEM },
          { role: 'user', content: prompt },
        ], REVIEW_MAX_TOKENS);
      } catch (err) {
        lastError = err;
        // A rejected key or a dead model will fail identically on every
        // remaining batch, so stop rather than spending four more requests
        // learning the same thing. A rate limit is the same story.
        if (err.status === 401 || err.status === 403 || err.status === 404 || err.status === 429 || err.status === 503) break;
        continue;
      }

      for (const c of cardsFromRaw(parseCardJSON(raw), cite)) {
        const k = frontKey(c.front);
        if (!k || seenFronts.has(k)) continue;
        seenFronts.add(k);
        cards.push(c);
        if (cards.length >= total) break;
      }
    }
  } finally {
    _reviewBusy = false;
    reviewSetGenerating(false);
  }

  if (!cards.length) {
    reviewStatus(lastError ? `Could not build the deck. ${lastError.message}` : 'The model returned nothing usable. Try again, or reword the topic.', 'error');
    return;
  }

  const name = (nameEl?.value || '').trim() || topic.slice(0, 60) || 'Review deck';
  const deck = hydrateDeck({
    id: reviewId('d'),
    name,
    topic,
    grounded: !!ground.text,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    cards,
  });

  _REVIEW_DECKS.unshift(deck);
  _REVIEW_ACTIVE = deck.id;
  saveReviewDecks();

  if (nameEl) nameEl.value = '';
  renderReviewPanel();
  renderReviewDeckList();
  renderReviewDeckPicker();

  const short = cards.length < total;
  reviewStatus(
    short
      ? `Built ${cards.length} of ${total} cards — the rest did not come back clean. Generate again to top the deck up.`
      : `Built ${cards.length} cards across ${new Set(cards.map(c => c.bloom)).size} Bloom levels.`,
    short ? 'warn' : 'ok'
  );
  if (typeof showToast === 'function') showToast(`Deck "${deck.name}" ready — ${cards.length} cards`);
  switchReviewTab('study');
}

// ── Study ─────────────────────────────────────────────────────────────

function cardDue(card, now) {
  const wait = BOX_WAIT_MS[card.srs.box] ?? 0;
  return !card.srs.lastAt || (now - card.srs.lastAt) >= wait;
}

function buildStudyQueue() {
  const deck = activeDeck();
  _reviewQueue = [];
  _reviewPos = 0;
  _reviewFlipped = false;
  if (!deck) return;

  const level = document.getElementById('review-study-level')?.value || 'all';
  const mode = document.getElementById('review-study-mode')?.value || 'due';
  const now = Date.now();

  let pool = deck.cards.filter(c => level === 'all' || c.bloom === level);
  if (mode === 'due') {
    const due = pool.filter(c => cardDue(c, now));
    // Everything is scheduled into the future. Falling back to the whole set
    // beats an empty screen: a student who opened Study wants to study.
    pool = due.length ? due : pool;
  }
  // Interleaving, as the guide itself recommends — shuffled rather than served
  // in Bloom order, so each card requires working out what kind of question it
  // is before answering it.
  _reviewQueue = shuffle(pool.map(c => c.id));
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function currentCard() {
  const deck = activeDeck();
  if (!deck || _reviewPos >= _reviewQueue.length) return null;
  return deck.cards.find(c => c.id === _reviewQueue[_reviewPos]) || null;
}

// Toggles classes on the live nodes rather than repainting the pane. Rebuilding
// it would replace the card with a brand new element that already carries
// .flipped, and a freshly-inserted element has no previous state to transition
// FROM — the turn would simply not animate. Both control rows are therefore
// rendered up front and swapped with CSS, and this only ever flips two classes.
function reviewFlip() {
  if (!currentCard()) return;
  _reviewFlipped = !_reviewFlipped;

  const wrap = document.getElementById('rv-study');
  const fc = document.getElementById('fc');
  if (!wrap || !fc) { renderStudy(); return; }

  fc.classList.toggle('flipped', _reviewFlipped);
  wrap.classList.toggle('revealed', _reviewFlipped);
}

// Again / Good / Easy. Failure drops straight to box 1 rather than down one
// step: the Leitner rule is "back to the start", and a card you could not
// answer has not earned a longer wait than a brand new one.
function reviewGrade(grade) {
  const deck = activeDeck();
  const card = currentCard();
  if (!deck || !card) return;

  card.srs.seen += 1;
  card.srs.lastAt = Date.now();

  if (grade === 'again') {
    card.srs.box = 1;
    card.srs.streak = 0;
    // Requeued at the back of this run, not dropped — the point of getting it
    // wrong is seeing it again while the correction is still fresh.
    _reviewQueue.push(card.id);
  } else {
    card.srs.right += 1;
    card.srs.streak += 1;
    card.srs.box = Math.min(BOX_MAX, card.srs.box + (grade === 'easy' ? 2 : 1));
  }

  deck.updatedAt = Date.now();
  saveReviewDecks();

  _reviewPos += 1;
  _reviewFlipped = false;
  renderStudy();
  renderReviewPanel();
  renderProgress();
}

function reviewSkip() {
  if (!currentCard()) return;
  _reviewPos += 1;
  _reviewFlipped = false;
  renderStudy();
}

function reviewRestartStudy() {
  buildStudyQueue();
  renderStudy();
}

// ── Quiz ──────────────────────────────────────────────────────────────
// Multiple choice, and labelled honestly as the weaker exercise: picking the
// right answer out of four is recognition, which the guide's own material
// points out is much easier than recall. It earns its place as a fast
// confidence check and as something that works when nobody wants to
// self-grade — not as a replacement for the flip cards.

function reviewStartQuiz() {
  const deck = activeDeck();
  const host = document.getElementById('review-quiz-body');
  if (!host) return;

  if (!deck || deck.cards.length < REVIEW_QUIZ_OPTIONS) {
    _reviewQuiz = null;
    renderQuiz();
    return;
  }

  const items = [];
  for (const card of shuffle(deck.cards).slice(0, REVIEW_QUIZ_LEN)) {
    // Distractors from the same Bloom level read as plausible; a "define X"
    // answer sitting among three design proposals gives itself away.
    const sameLevel = deck.cards.filter(c => c.id !== card.id && c.bloom === card.bloom);
    const others = deck.cards.filter(c => c.id !== card.id && c.bloom !== card.bloom);
    const pool = shuffle(sameLevel).concat(shuffle(others));

    const options = [card.back];
    const used = new Set([frontKey(card.back)]);
    for (const o of pool) {
      if (options.length >= REVIEW_QUIZ_OPTIONS) break;
      const k = frontKey(o.back);
      if (used.has(k)) continue;
      used.add(k);
      options.push(o.back);
    }
    if (options.length < 2) continue;

    const shuffled = shuffle(options);
    items.push({
      cardId: card.id,
      front: card.front,
      bloom: card.bloom,
      options: shuffled,
      answer: shuffled.indexOf(card.back),
    });
  }

  _reviewQuiz = items.length ? { items, pos: 0, score: 0, answered: null } : null;
  renderQuiz();
}

function reviewAnswerQuiz(i) {
  const q = _reviewQuiz;
  if (!q || q.answered !== null) return;
  const item = q.items[q.pos];
  if (!item) return;

  q.answered = i;
  const right = i === item.answer;
  if (right) q.score += 1;

  // A quiz answer is still a retrieval attempt, so it moves the card — but only
  // half a step: a correct guess out of four is weaker evidence than a correct
  // recall, and promoting on it would schedule a card the student cannot
  // actually produce from memory.
  const deck = activeDeck();
  const card = deck?.cards.find(c => c.id === item.cardId);
  if (card) {
    card.srs.seen += 1;
    card.srs.lastAt = Date.now();
    if (right) {
      card.srs.right += 1;
      card.srs.streak += 1;
      if (card.srs.streak >= 2) card.srs.box = Math.min(BOX_MAX, card.srs.box + 1);
    } else {
      card.srs.box = 1;
      card.srs.streak = 0;
    }
    deck.updatedAt = Date.now();
    saveReviewDecks();
  }

  renderQuiz();
  renderReviewPanel();
  renderProgress();
}

function reviewNextQuiz() {
  const q = _reviewQuiz;
  if (!q) return;
  q.pos += 1;
  q.answered = null;
  renderQuiz();
}

// ── Deck management ───────────────────────────────────────────────────

function reviewSelectDeck(id) {
  if (!_REVIEW_DECKS.some(d => d.id === id)) return;
  _REVIEW_ACTIVE = id;
  saveReviewDecks();
  _reviewQuiz = null;
  buildStudyQueue();
  renderReviewPanel();
  renderReviewDeckList();
  renderReviewDeckPicker();
  renderStudy();
  renderQuiz();
  renderProgress();
}

function reviewRenameDeck(id) {
  const deck = _REVIEW_DECKS.find(d => d.id === id);
  if (!deck) return;
  const next = prompt('Rename this deck', deck.name);
  if (next === null) return;
  const name = next.trim().slice(0, 80);
  if (!name) return;
  deck.name = name;
  deck.updatedAt = Date.now();
  saveReviewDecks();
  renderReviewPanel();
  renderReviewDeckList();
  renderReviewDeckPicker();
  renderProgress();
}

function reviewDeleteDeck(id) {
  const deck = _REVIEW_DECKS.find(d => d.id === id);
  if (!deck) return;
  if (!confirm(`Delete "${deck.name}" and its ${deck.cards.length} cards? This cannot be undone.`)) return;

  _REVIEW_DECKS = _REVIEW_DECKS.filter(d => d.id !== id);
  if (_REVIEW_ACTIVE === id) _REVIEW_ACTIVE = _REVIEW_DECKS[0]?.id || null;
  _reviewQuiz = null;
  saveReviewDecks();
  buildStudyQueue();
  renderReviewPanel();
  renderReviewDeckList();
  renderReviewDeckPicker();
  renderStudy();
  renderQuiz();
  renderProgress();
  if (typeof showToast === 'function') showToast('Deck deleted');
}

function reviewExportDeck(id) {
  const deck = _REVIEW_DECKS.find(d => d.id === id);
  if (!deck) return;
  const blob = new Blob([JSON.stringify(deck, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${deck.name.replace(/[^\w.-]+/g, '-').toLowerCase() || 'deck'}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function reviewResetProgress() {
  const deck = activeDeck();
  if (!deck) return;
  if (!confirm(`Reset progress on all ${deck.cards.length} cards in "${deck.name}"? The cards stay; only the scores go.`)) return;
  for (const c of deck.cards) c.srs = { box: 1, seen: 0, right: 0, streak: 0, lastAt: 0 };
  deck.updatedAt = Date.now();
  saveReviewDecks();
  buildStudyQueue();
  renderStudy();
  renderProgress();
  renderReviewPanel();
  if (typeof showToast === 'function') showToast('Progress reset');
}

// ── Stats ─────────────────────────────────────────────────────────────

function deckStats(deck) {
  const now = Date.now();
  const out = {
    total: 0, mastered: 0, due: 0, seen: 0, right: 0,
    byLevel: new Map(BLOOM_LEVELS.map(l => [l.id, { total: 0, mastered: 0, seen: 0, right: 0 }])),
  };
  if (!deck) return out;
  for (const c of deck.cards) {
    out.total += 1;
    out.seen += c.srs.seen;
    out.right += c.srs.right;
    if (c.srs.box >= BOX_MASTERED) out.mastered += 1;
    if (cardDue(c, now)) out.due += 1;
    const l = out.byLevel.get(c.bloom);
    if (l) {
      l.total += 1;
      l.seen += c.srs.seen;
      l.right += c.srs.right;
      if (c.srs.box >= BOX_MASTERED) l.mastered += 1;
    }
  }
  return out;
}

// ── Rendering: sidebar panel ──────────────────────────────────────────

function renderReviewPanel() {
  const list = document.getElementById('review-list');
  const total = document.getElementById('review-total');
  if (total) total.textContent = _REVIEW_DECKS.length ? String(_REVIEW_DECKS.length) : '';

  const seg = document.querySelector('.seg-tabs [data-segtab="review"]');
  if (seg) {
    const due = _REVIEW_DECKS.reduce((n, d) => n + deckStats(d).due, 0);
    seg.textContent = due ? `Review · ${due}` : 'Review';
  }

  if (!list) return;
  list.innerHTML = '';

  if (!_REVIEW_DECKS.length) {
    const empty = document.createElement('div');
    empty.className = 'kb-empty';
    empty.textContent = 'No decks yet. Build one from your Sources or from any topic — the AI writes the cards and tags each with its Bloom level.';
    list.appendChild(empty);
    return;
  }

  for (const deck of _REVIEW_DECKS) {
    const st = deckStats(deck);
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'rv-item' + (deck.id === _REVIEW_ACTIVE ? ' active' : '');
    row.title = `${deck.name} — ${st.total} cards`;
    row.onclick = () => { reviewSelectDeck(deck.id); openReview('study'); };

    const meta = document.createElement('span');
    meta.className = 'rv-meta';
    const nm = document.createElement('b');
    nm.textContent = deck.name;
    const sub = document.createElement('i');
    sub.textContent = `${st.total} card${st.total === 1 ? '' : 's'} · ${st.mastered} mastered`;
    meta.appendChild(nm);
    meta.appendChild(sub);

    row.appendChild(meta);

    if (st.due) {
      const badge = document.createElement('span');
      badge.className = 'rv-due';
      badge.textContent = String(st.due);
      badge.title = `${st.due} card${st.due === 1 ? '' : 's'} due`;
      row.appendChild(badge);
    }
    list.appendChild(row);
  }
}

// ── Rendering: modal chrome ───────────────────────────────────────────

function openReview(tab) {
  const modal = document.getElementById('review-modal');
  if (!modal) return;
  renderReviewDeckPicker();
  renderReviewDeckList();
  reviewRefreshEngine();
  switchReviewTab(tab || (_REVIEW_DECKS.length ? 'study' : 'build'));
  modal.style.display = 'flex';
}

function closeReview() {
  const modal = document.getElementById('review-modal');
  if (modal) modal.style.display = 'none';
}

function handleReviewBackdrop(e) {
  if (e.target === document.getElementById('review-modal')) closeReview();
}

function reviewIsOpen() {
  const modal = document.getElementById('review-modal');
  return !!modal && modal.style.display === 'flex';
}

function switchReviewTab(tab) {
  _reviewTab = tab;
  document.querySelectorAll('[data-review-tab]').forEach(el => {
    el.classList.toggle('active', el.dataset.reviewTab === tab);
  });
  document.querySelectorAll('[data-review-pane]').forEach(el => {
    el.style.display = el.dataset.reviewPane === tab ? '' : 'none';
  });
  if (tab === 'study') { buildStudyQueue(); renderStudy(); }
  if (tab === 'quiz') renderQuiz();
  if (tab === 'progress') renderProgress();
}

function reviewToggleLevel(el) {
  el.classList.toggle('on');
}

function reviewToggleSources(el) {
  el.classList.toggle('on');
  reviewSyncSourcesHint();
}

function reviewStatus(msg, kind) {
  const el = document.getElementById('review-status');
  if (!el) return;
  el.textContent = msg || '';
  el.className = 'rv-status' + (kind ? ` ${kind}` : '');
  el.style.display = msg ? '' : 'none';
}

function reviewSetGenerating(on) {
  const btn = document.getElementById('review-generate-btn');
  if (btn) {
    btn.disabled = on;
    btn.textContent = on ? 'Writing cards…' : 'Generate deck';
  }
  const card = document.getElementById('review-card');
  if (card) card.classList.toggle('generating', on);
}

async function reviewRefreshEngine() {
  const line = document.getElementById('review-engine');
  const sel = document.getElementById('review-model');
  const eng = reviewEngine();

  if (line) {
    line.textContent = reviewEngineNote(eng);
    line.classList.toggle('warn', !eng.ready);
  }
  if (!sel) return;

  if (eng.via !== 'groq') {
    sel.style.display = 'none';
    return;
  }

  sel.style.display = '';
  if (_reviewGroqModels && _reviewGroqModelsKey === eng.key) { fillModelSelect(sel, _reviewGroqModels); return; }

  sel.innerHTML = '<option>Loading Groq models…</option>';
  sel.disabled = true;
  try {
    const ids = await reviewGroqModels(eng.key);
    fillModelSelect(sel, ids);
  } catch (err) {
    // A bad key is worth saying out loud here — the alternative is a Generate
    // click that fails five times over and never explains why.
    sel.innerHTML = `<option value="${escHtml(GROQ_FALLBACK_MODEL)}">${escHtml(GROQ_FALLBACK_MODEL)}</option>`;
    if (line) { line.textContent = err.message; line.classList.add('warn'); }
  } finally {
    sel.disabled = false;
  }
}

function fillModelSelect(sel, ids) {
  sel.innerHTML = '';
  for (const id of ids) {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = id;
    sel.appendChild(o);
  }
  if (!_reviewGroqModel || !ids.includes(_reviewGroqModel)) _reviewGroqModel = ids[0] || GROQ_FALLBACK_MODEL;
  sel.value = _reviewGroqModel;
  const line = document.getElementById('review-engine');
  if (line) { line.textContent = `Groq · ${_reviewGroqModel}`; line.classList.remove('warn'); }
}

function reviewSetModel(v) {
  _reviewGroqModel = v || '';
  try { if (window.BarangayDB) window.BarangayDB.dbSetItem(REVIEW_MODEL_KEY, _reviewGroqModel); } catch (e) { /* ignore */ }
  const line = document.getElementById('review-engine');
  if (line) line.textContent = `Groq · ${_reviewGroqModel}`;
}

function renderReviewDeckPicker() {
  for (const id of ['review-study-deck', 'review-quiz-deck', 'review-progress-deck']) {
    const sel = document.getElementById(id);
    if (!sel) continue;
    sel.innerHTML = '';
    if (!_REVIEW_DECKS.length) {
      const o = document.createElement('option');
      o.value = '';
      o.textContent = 'No decks yet';
      sel.appendChild(o);
      sel.disabled = true;
      continue;
    }
    sel.disabled = false;
    for (const d of _REVIEW_DECKS) {
      const o = document.createElement('option');
      o.value = d.id;
      o.textContent = `${d.name} (${d.cards.length})`;
      sel.appendChild(o);
    }
    sel.value = _REVIEW_ACTIVE || '';
  }

  const levelSel = document.getElementById('review-study-level');
  if (levelSel) {
    const keep = levelSel.value || 'all';
    const deck = activeDeck();
    levelSel.innerHTML = '<option value="all">All levels</option>';
    for (const l of BLOOM_LEVELS) {
      const n = deck ? deck.cards.filter(c => c.bloom === l.id).length : 0;
      const o = document.createElement('option');
      o.value = l.id;
      o.textContent = `${l.n}. ${l.label}${n ? ` (${n})` : ''}`;
      if (!n) o.disabled = true;
      levelSel.appendChild(o);
    }
    levelSel.value = [...levelSel.options].some(o => o.value === keep && !o.disabled) ? keep : 'all';
  }
}

function renderReviewDeckList() {
  const host = document.getElementById('review-deck-manager');
  if (!host) return;
  host.innerHTML = '';

  if (!_REVIEW_DECKS.length) {
    const p = document.createElement('span');
    p.className = 'settings-hint';
    p.textContent = 'Decks you build show up here, with the Bloom spread of each.';
    host.appendChild(p);
    return;
  }

  for (const deck of _REVIEW_DECKS) {
    const st = deckStats(deck);
    const row = document.createElement('div');
    row.className = 'rv-deck-row' + (deck.id === _REVIEW_ACTIVE ? ' active' : '');

    const main = document.createElement('div');
    main.className = 'rv-deck-main';
    const nm = document.createElement('b');
    nm.textContent = deck.name;
    const sub = document.createElement('span');
    sub.textContent = `${st.total} cards · ${st.mastered} mastered · ${st.due} due${deck.grounded ? ' · from Sources' : ''}`;
    main.appendChild(nm);
    main.appendChild(sub);

    const spread = document.createElement('div');
    spread.className = 'rv-spread';
    for (const l of BLOOM_LEVELS) {
      const n = deck.cards.filter(c => c.bloom === l.id).length;
      const pip = document.createElement('span');
      pip.className = 'rv-pip' + (n ? '' : ' empty');
      pip.dataset.bloom = l.id;
      pip.textContent = n ? String(n) : '·';
      pip.title = `${l.label}: ${n} card${n === 1 ? '' : 's'}`;
      spread.appendChild(pip);
    }
    main.appendChild(spread);

    const acts = document.createElement('div');
    acts.className = 'rv-deck-acts';
    acts.appendChild(reviewMiniBtn('Study', () => { reviewSelectDeck(deck.id); switchReviewTab('study'); }));
    acts.appendChild(reviewMiniBtn('Rename', () => reviewRenameDeck(deck.id)));
    acts.appendChild(reviewMiniBtn('Export', () => reviewExportDeck(deck.id)));
    acts.appendChild(reviewMiniBtn('Delete', () => reviewDeleteDeck(deck.id), 'danger'));

    row.appendChild(main);
    row.appendChild(acts);
    host.appendChild(row);
  }
}

function reviewMiniBtn(label, fn, kind) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'rv-mini' + (kind ? ` ${kind}` : '');
  b.textContent = label;
  b.onclick = fn;
  return b;
}

// ── Rendering: study ──────────────────────────────────────────────────

function renderStudy() {
  const host = document.getElementById('review-study-body');
  if (!host) return;

  const deck = activeDeck();
  if (!deck) {
    host.innerHTML = '<div class="rv-empty">No deck yet. Head to <b>Build</b> and make one — it takes one click once you have a topic or a Source.</div>';
    return;
  }
  if (!deck.cards.length) {
    host.innerHTML = '<div class="rv-empty">This deck has no cards.</div>';
    return;
  }

  const card = currentCard();
  if (!card) {
    const st = deckStats(deck);
    host.innerHTML = `
      <div class="rv-done">
        <div class="rv-done-title">Run complete</div>
        <div class="rv-done-sub">${st.mastered} of ${st.total} cards mastered · ${st.due} due now</div>
        <button type="button" class="settings-btn-primary" onclick="reviewRestartStudy()">Go again</button>
      </div>`;
    return;
  }

  const meta = bloomMeta(card.bloom);
  const seen = _reviewPos + 1;
  const pct = Math.round((_reviewPos / Math.max(1, _reviewQueue.length)) * 100);

  // Both control rows ship in the markup and CSS decides which is visible. See
  // reviewFlip() for why the reveal must not be a re-render.
  host.innerHTML = `
    <div class="rv-study${_reviewFlipped ? ' revealed' : ''}" id="rv-study">
      <div class="rv-progress-row">
        <div class="rv-bar"><span style="width:${pct}%"></span></div>
        <span class="rv-count">${seen} / ${_reviewQueue.length}</span>
      </div>

      <div class="fc-stage">
        <div class="fc${_reviewFlipped ? ' flipped' : ''}" id="fc" onclick="reviewFlip()" role="button" tabindex="0"
             aria-label="Flashcard — click or press Space to reveal the answer">
          <div class="fc-face fc-front">
            <span class="bloom-badge" data-bloom="${escHtml(meta.id)}">${meta.n}. ${escHtml(meta.label)}</span>
            <div class="fc-text">${escHtml(card.front)}</div>
            ${card.hint ? `<div class="fc-hint">Hint: ${escHtml(card.hint)}</div>` : ''}
            <div class="fc-flip-note">Click to reveal</div>
          </div>
          <div class="fc-face fc-back">
            <span class="bloom-badge" data-bloom="${escHtml(meta.id)}">${escHtml(meta.label)}</span>
            <div class="fc-text">${escHtml(card.back)}</div>
            ${card.cite ? `<div class="fc-cite">${escHtml(card.cite)}</div>` : ''}
          </div>
        </div>
      </div>

      <div class="rv-grade rv-front-only">
        <button type="button" class="rv-grade-btn wide" onclick="reviewFlip()">Show answer<small>Space</small></button>
        <button type="button" class="rv-mini" onclick="reviewSkip()">Skip</button>
      </div>
      <div class="rv-shortcut rv-front-only">Answer it in your head first. Retrieving is what builds the memory; reading the answer does not.</div>

      <div class="rv-grade rv-back-only">
        <button type="button" class="rv-grade-btn again" onclick="reviewGrade('again')">Again<small>1</small></button>
        <button type="button" class="rv-grade-btn good" onclick="reviewGrade('good')">Good<small>2</small></button>
        <button type="button" class="rv-grade-btn easy" onclick="reviewGrade('easy')">Easy<small>3</small></button>
      </div>
      <div class="rv-shortcut rv-back-only">Grade honestly — a card you half-knew is a card you do not know yet. Box ${card.srs.box} of ${BOX_MAX}.</div>
    </div>`;
}

// ── Rendering: quiz ───────────────────────────────────────────────────

function renderQuiz() {
  const host = document.getElementById('review-quiz-body');
  if (!host) return;

  const deck = activeDeck();
  if (!deck) {
    host.innerHTML = '<div class="rv-empty">No deck yet. Build one first.</div>';
    return;
  }
  if (deck.cards.length < REVIEW_QUIZ_OPTIONS) {
    host.innerHTML = `<div class="rv-empty">A multiple-choice round needs at least ${REVIEW_QUIZ_OPTIONS} cards to draw wrong answers from. This deck has ${deck.cards.length}.</div>`;
    return;
  }

  const q = _reviewQuiz;
  if (!q) {
    host.innerHTML = `
      <div class="rv-empty">
        Pick the right answer out of four. It is a quick confidence check, not a substitute for the flip cards —
        recognising an answer is much easier than recalling it, so a strong quiz score with a weak Study score means
        the material is familiar rather than known.
      </div>
      <button type="button" class="settings-btn-primary" onclick="reviewStartQuiz()">Start a round of ${Math.min(REVIEW_QUIZ_LEN, deck.cards.length)}</button>`;
    return;
  }

  if (q.pos >= q.items.length) {
    const pct = Math.round((q.score / q.items.length) * 100);
    host.innerHTML = `
      <div class="rv-done">
        <div class="rv-done-title">${q.score} / ${q.items.length} · ${pct}%</div>
        <div class="rv-done-sub">${pct >= 80 ? 'Solid recognition. Now prove it on the flip cards.' : 'Worth a Study run before the next round.'}</div>
        <button type="button" class="settings-btn-primary" onclick="reviewStartQuiz()">Another round</button>
      </div>`;
    return;
  }

  const item = q.items[q.pos];
  const meta = bloomMeta(item.bloom);
  const answered = q.answered !== null;

  const opts = item.options.map((text, i) => {
    let cls = 'rv-opt';
    if (answered) {
      if (i === item.answer) cls += ' right';
      else if (i === q.answered) cls += ' wrong';
      else cls += ' dim';
    }
    return `<button type="button" class="${cls}" onclick="reviewAnswerQuiz(${i})"${answered ? ' disabled' : ''}>
      <span class="rv-opt-key">${String.fromCharCode(65 + i)}</span><span>${escHtml(text)}</span>
    </button>`;
  }).join('');

  const pct = Math.round((q.pos / q.items.length) * 100);
  host.innerHTML = `
    <div class="rv-progress-row">
      <div class="rv-bar"><span style="width:${pct}%"></span></div>
      <span class="rv-count">${q.pos + 1} / ${q.items.length} · ${q.score} right</span>
    </div>
    <div class="rv-qcard">
      <span class="bloom-badge" data-bloom="${escHtml(meta.id)}">${meta.n}. ${escHtml(meta.label)}</span>
      <div class="rv-qtext">${escHtml(item.front)}</div>
    </div>
    <div class="rv-opts">${opts}</div>
    ${answered ? `<button type="button" class="settings-btn-primary" onclick="reviewNextQuiz()">${q.pos + 1 >= q.items.length ? 'See score' : 'Next question'}</button>` : ''}`;
}

// ── Rendering: progress ───────────────────────────────────────────────

function renderProgress() {
  const host = document.getElementById('review-progress-body');
  if (!host) return;

  const deck = activeDeck();
  if (!deck || !deck.cards.length) {
    host.innerHTML = '<div class="rv-empty">Build a deck and answer a few cards — the per-level breakdown appears here.</div>';
    return;
  }

  const st = deckStats(deck);
  const masteredPct = Math.round((st.mastered / st.total) * 100);
  const accuracy = st.seen ? Math.round((st.right / st.seen) * 100) : null;

  const rows = BLOOM_LEVELS.map(l => {
    const s = st.byLevel.get(l.id);
    if (!s.total) {
      return `<div class="rv-lvl empty">
        <span class="rv-lvl-name"><i data-bloom="${l.id}"></i>${l.n}. ${escHtml(l.label)}</span>
        <span class="rv-lvl-note">no cards at this level</span>
      </div>`;
    }
    const pct = Math.round((s.mastered / s.total) * 100);
    const acc = s.seen ? `${Math.round((s.right / s.seen) * 100)}% correct` : 'not attempted';
    return `<div class="rv-lvl">
      <span class="rv-lvl-name"><i data-bloom="${l.id}"></i>${l.n}. ${escHtml(l.label)}</span>
      <div class="rv-lvl-bar"><span data-bloom="${l.id}" style="width:${pct}%"></span></div>
      <span class="rv-lvl-note">${s.mastered}/${s.total} mastered · ${acc}</span>
    </div>`;
  }).join('');

  // The weakest attempted level is the actionable number on this screen, so it
  // gets said in words rather than left for the reader to spot in six bars.
  const attempted = BLOOM_LEVELS
    .map(l => ({ l, s: st.byLevel.get(l.id) }))
    .filter(x => x.s.total && x.s.seen);
  let advice = 'Answer a few cards and a per-level read appears here.';
  if (attempted.length) {
    attempted.sort((a, b) => (a.s.right / a.s.seen) - (b.s.right / b.s.seen));
    const worst = attempted[0];
    const rate = Math.round((worst.s.right / worst.s.seen) * 100);
    advice = rate >= 85
      ? `Evenly strong — weakest level is ${worst.l.label} at ${rate}%. Add higher-level cards to keep it useful.`
      : `Weakest level is <b>${escHtml(worst.l.label)}</b> at ${rate}%. ${escHtml(bloomAdvice(worst.l.id))}`;
  }

  host.innerHTML = `
    <div class="rv-stat-row">
      <div class="rv-stat"><b>${masteredPct}%</b><span>mastered</span></div>
      <div class="rv-stat"><b>${st.due}</b><span>due now</span></div>
      <div class="rv-stat"><b>${accuracy === null ? '—' : accuracy + '%'}</b><span>accuracy</span></div>
      <div class="rv-stat"><b>${st.total}</b><span>cards</span></div>
    </div>
    <div class="rv-advice">${advice}</div>
    <div class="rv-levels">${rows}</div>
    <button type="button" class="settings-btn-secondary" onclick="reviewResetProgress()">Reset progress on this deck</button>`;
}

// Each level fails for a different reason, so the fix is different too. This is
// the diagnosis half of Bloom tagging — without it the six bars are just six
// numbers.
function bloomAdvice(id) {
  switch (id) {
    case 'remember':   return 'Drill the terms directly — this is vocabulary, and rereading will not fix it.';
    case 'understand': return 'Try explaining each answer aloud without the card in front of you.';
    case 'apply':      return 'Work through examples rather than definitions; this level needs practice, not review.';
    case 'analyze':    return 'Persistent trouble here is usually a Remember or Understand gap in disguise — check those first.';
    case 'evaluate':   return 'Argue the opposite case for each card. A judgement you cannot attack you cannot defend either.';
    case 'create':     return 'Sketch a whole answer on paper before flipping. There is no stored answer to retrieve at this level.';
    default:           return 'Drill this level directly.';
  }
}

// ── Keyboard ──────────────────────────────────────────────────────────
// Space to flip, 1/2/3 to grade. Scoped hard: the review modal has to be open
// AND on the Study tab AND the keypress must not belong to a text field, or
// this would eat spaces out of the composer.
function reviewKeydown(e) {
  if (!reviewIsOpen()) return;

  if (e.key === 'Escape') { closeReview(); return; }
  if (_reviewTab !== 'study') return;

  const t = e.target;
  const tag = (t && t.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || (t && t.isContentEditable)) return;
  if (!currentCard()) return;

  if (e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); reviewFlip(); return; }
  if (!_reviewFlipped) return;
  if (e.key === '1') { e.preventDefault(); reviewGrade('again'); }
  else if (e.key === '2') { e.preventDefault(); reviewGrade('good'); }
  else if (e.key === '3') { e.preventDefault(); reviewGrade('easy'); }
}

// ── Boot ──────────────────────────────────────────────────────────────
// Called from app/init.js once the DB is open and settings are applied — the
// decks live in the DB and the engine reads _GROQ_KEY out of settings, so
// neither is knowable before that.
function initReview() {
  loadReviewDecks();
  buildStudyQueue();
  renderReviewPanel();
  document.addEventListener('keydown', reviewKeydown);

  // Default every Bloom level on: a first-time deck should be balanced without
  // the student having to know what the six chips mean yet.
  document.querySelectorAll('#review-levels .bloom-chip').forEach(el => el.classList.add('on'));
  // Grounding defaults on when there is something to ground on, and off when
  // there is not — a toggle promising Sources to a library with none is a
  // promise the Generate button then has to break.
  const useSrc = document.getElementById('review-use-sources');
  if (useSrc) {
    useSrc.classList.toggle('on', (window._TRAINING_FILES_ACTIVE || []).length > 0);
    reviewSyncSourcesHint();
  }
}

// Sets the hint from the toggle's CURRENT state, without flipping it.
function reviewSyncSourcesHint() {
  const el = document.getElementById('review-use-sources');
  const hint = document.getElementById('review-sources-hint');
  if (!el || !hint) return;
  const files = window._TRAINING_FILES_ACTIVE || [];
  hint.textContent = el.classList.contains('on')
    ? (files.length
        ? `Grounded on ${files.length} active Source${files.length === 1 ? '' : 's'} — the topic picks which parts get used.`
        : 'No active Sources yet. Add files in the Sources tab, or leave this off and build from a topic.')
    : 'Off — cards come from the model\'s own knowledge of the topic.';
}

// ── Exports (inline handlers in index.html reach these) ────────────────
window.openReview          = openReview;
window.closeReview         = closeReview;
window.handleReviewBackdrop = handleReviewBackdrop;
window.switchReviewTab     = switchReviewTab;
window.reviewToggleLevel   = reviewToggleLevel;
window.reviewToggleSources = reviewToggleSources;
window.reviewGenerate      = reviewGenerate;
window.reviewSelectDeck    = reviewSelectDeck;
window.reviewSetModel      = reviewSetModel;
window.reviewFlip          = reviewFlip;
window.reviewGrade         = reviewGrade;
window.reviewSkip          = reviewSkip;
window.reviewRestartStudy  = reviewRestartStudy;
window.reviewStartQuiz     = reviewStartQuiz;
window.reviewAnswerQuiz    = reviewAnswerQuiz;
window.reviewNextQuiz      = reviewNextQuiz;
window.reviewResetProgress = reviewResetProgress;
window.reviewRenameDeck    = reviewRenameDeck;
window.reviewDeleteDeck    = reviewDeleteDeck;
window.reviewExportDeck    = reviewExportDeck;
window.reviewRefreshEngine = reviewRefreshEngine;
window.initReview          = initReview;
window.renderReviewPanel   = renderReviewPanel;
window.reviewSyncSourcesHint = reviewSyncSourcesHint;
