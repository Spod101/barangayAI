// ── PERSONALIZATION ───────────────────────────────────────────────────

function loadSettings() {
  if (window.BarangayDB) return window.BarangayDB.dbLoadSettings();
  return {};
}

function saveSettings(s) {
  if (window.BarangayDB) window.BarangayDB.dbSaveSettings(s);
}

function applySettings(s) {
  // Resolve active persona (overrides name + system prompt when set)
  const _personas = Array.isArray(s.personas) ? s.personas : [];
  const _activePersona = _personas.find(p => p.id === s.active_persona) || null;

  if (s.brand_color) {
    const c = s.brand_color;
    document.documentElement.style.setProperty('--dc-blue', c);
    document.documentElement.style.setProperty('--dc-blue-dark',   shadeColor(c, -20));
    document.documentElement.style.setProperty('--dc-blue-mid',    shadeColor(c,  10));
    document.documentElement.style.setProperty('--dc-blue-deeper', scaleColor(c, 0.22));
    window._BRAND_COLOR_ACTIVE = c;
  }
  const name = (_activePersona && _activePersona.name) ? _activePersona.name : (s.ai_name || AI_NAME);
  window._AI_NAME_ACTIVE = name;
  document.getElementById('chat-title').textContent = name;
  const wt = document.querySelector('.welcome-title');
  if (wt) wt.textContent = name;
  if (_activePersona) {
    window._AI_TONE_ACTIVE = _activePersona.systemPrompt || '';
  } else if (s.ai_tone !== undefined) {
    window._AI_TONE_ACTIVE = s.ai_tone;
  }
  if (s.ai_knowledge !== undefined) window._AI_KNOWLEDGE_ACTIVE = s.ai_knowledge;
  window._PROMPT_PREFIX_ACTIVE = s.prompt_prefix || '';
  window._PROMPT_SUFFIX_ACTIVE = s.prompt_suffix || '';
  window._TEMPERATURE_ACTIVE   = (typeof s.temperature === 'number') ? s.temperature : 0.3;
  // max_tokens: null means "No limit"
  window._MAX_TOKENS_ACTIVE    = (s.max_tokens === null || typeof s.max_tokens === 'number') ? s.max_tokens : 1024;
  window._TRAINING_FILES_MASTER = Array.isArray(s.training_files) ? s.training_files : [];
  window._TRAINING_FILES_ACTIVE = window._TRAINING_FILES_MASTER.filter(f => !_KB_DISABLED.has(f.name));
  window._TRAINING_NOTES_ACTIVE = s.training_notes || '';
  let _lang = s.reply_language || 'english';
  if (_lang === 'tagalog') _lang = 'filipino';
  window._REPLY_LANG_ACTIVE = _lang;
  window._GREETING_ACTIVE = s.welcome_greeting || null;
  // Web search (Tavily) — a key is required for it to actually run
  window._TAVILY_KEY = s.tavily_api_key || '';
  window._WEB_SEARCH_ENABLED = (s.web_search_enabled === true);
  window._THINKING_ENABLED = (s.thinking_enabled === true);
  // Off unless explicitly switched on. Every answer would otherwise cost a
  // second model call, and on a published AI that call is spent against the
  // owner's free quota by visitors who never agreed to it. Opting in is the
  // owner's call to make, so the default can't be the expensive one.
  window._FOLLOWUPS_ENABLED = (s.followups_enabled === true);
  syncWebSearchUI();
  syncThinkingUI();
  const initials = name.slice(0, 2).toUpperCase();
  document.querySelectorAll('.avatar.ai').forEach(a => a.textContent = initials);
  if (document.getElementById('welcome-screen')) resetWelcomeScreen();
  renderSourcesPanel();
}

function shadeColor(hex, pct) {
  const n = parseInt(hex.replace('#',''), 16);
  const r = Math.min(255, Math.max(0, (n >> 16) + Math.round(2.55 * pct)));
  const g = Math.min(255, Math.max(0, ((n >> 8) & 0xff) + Math.round(2.55 * pct)));
  const b = Math.min(255, Math.max(0, (n & 0xff) + Math.round(2.55 * pct)));
  return '#' + [r,g,b].map(x => x.toString(16).padStart(2,'0')).join('');
}

function scaleColor(hex, factor) {
  const n = parseInt(hex.replace('#',''), 16);
  const r = Math.round(((n >> 16) & 0xff) * factor);
  const g = Math.round(((n >> 8)  & 0xff) * factor);
  const b = Math.round((n & 0xff)         * factor);
  return '#' + [r,g,b].map(x => x.toString(16).padStart(2,'0')).join('');
}

function getAIAvatar() {
  const name = window._AI_NAME_ACTIVE || AI_NAME;
  return name.slice(0, 2).toUpperCase();
}

function setTonePreset(key, el) {
  const aiName = document.getElementById('settings-ai-name').value.trim() || AI_NAME;
  const prompt = (TONE_PRESETS[key] || '').replace(/\{name\}/g, aiName);
  document.getElementById('settings-ai-tone').value = prompt;
  document.querySelectorAll('.tone-preset-chip').forEach(c => c.classList.remove('active'));
  if (el) el.classList.add('active');
}

function detectActivePreset(currentTone) {
  const aiName = document.getElementById('settings-ai-name').value.trim() || AI_NAME;
  document.querySelectorAll('.tone-preset-chip').forEach(c => {
    const key = c.dataset.preset;
    const expected = (TONE_PRESETS[key] || '').replace(/\{name\}/g, aiName);
    c.classList.toggle('active', currentTone.trim() === expected.trim());
  });
}

function updateSettingsPreview() {
  const name    = document.getElementById('settings-ai-name').value.trim() || AI_NAME;
  const brand   = document.getElementById('settings-brand-color').value;
  const greeting = document.getElementById('settings-greeting').value.trim() || 'Good to see you!';
  const prevAvatar  = document.getElementById('preview-avatar');
  const prevName    = document.getElementById('preview-name');
  const prevGreeting = document.getElementById('preview-greeting');
  if (prevAvatar) {
    prevAvatar.textContent = name.slice(0, 2).toUpperCase();
    prevAvatar.style.background = `linear-gradient(135deg, ${brand} 0%, ${brand}bb 100%)`;
  }
  if (prevName)    prevName.textContent    = name;
  if (prevGreeting) prevGreeting.textContent = greeting;
}

// Far-right position of the Max Tokens slider means "No limit"
const MAX_TOKENS_SLIDER_MAX = 4224;

function updateTemperatureLabel(val) {
  const el = document.getElementById('settings-temperature-value');
  if (el) el.textContent = Number(val).toFixed(1);
}
window.updateTemperatureLabel = updateTemperatureLabel;

function updateMaxTokensLabel(val) {
  const el = document.getElementById('settings-max-tokens-value');
  if (el) el.textContent = (Number(val) >= MAX_TOKENS_SLIDER_MAX) ? 'No limit' : val;
}
window.updateMaxTokensLabel = updateMaxTokensLabel;

function openSettings() {
  const s = loadSettings();
  const nameInput   = document.getElementById('settings-ai-name');
  const brandInput  = document.getElementById('settings-brand-color');
  const toneInput   = document.getElementById('settings-ai-tone');
  const greetInput  = document.getElementById('settings-greeting');

  const knowledgeInput = document.getElementById('settings-ai-knowledge');
  // Name + Personality fields are persona-aware — populated by loadPersonaFields() below.
  // The "Default (no persona)" entry edits these base values:
  window._BASE_NAME_DRAFT = s.ai_name || AI_NAME;
  window._BASE_TONE_DRAFT = s.ai_tone || AI_TONE || '';
  brandInput.value     = s.brand_color      || BRAND_COLOR;
  greetInput.value     = s.welcome_greeting || '';
  if (knowledgeInput) knowledgeInput.value = s.ai_knowledge || '';
  const creatorInput = document.getElementById('settings-creator-name');
  if (creatorInput) creatorInput.value = s.creator_name || '';

  // Model controls (prefix / suffix / temperature / max tokens)
  const prefixInput = document.getElementById('settings-prompt-prefix');
  const suffixInput = document.getElementById('settings-prompt-suffix');
  const tempInput   = document.getElementById('settings-temperature');
  const maxTokInput = document.getElementById('settings-max-tokens');
  if (prefixInput) prefixInput.value = s.prompt_prefix || '';
  if (suffixInput) suffixInput.value = s.prompt_suffix || '';
  if (tempInput) {
    const t = (typeof s.temperature === 'number') ? s.temperature : 0.3;
    tempInput.value = t;
    updateTemperatureLabel(t);
  }
  if (maxTokInput) {
    // null = no limit → park the slider at its far-right position
    const mt = (s.max_tokens === null) ? MAX_TOKENS_SLIDER_MAX
             : (typeof s.max_tokens === 'number' ? s.max_tokens : 1024);
    maxTokInput.value = mt;
    updateMaxTokensLabel(maxTokInput.value);
  }

  // Language picker
  const langChoice = s.reply_language || 'english';
  document.querySelectorAll('#lang-picker .lang-chip').forEach(el => {
    if (el.disabled) return;
    el.classList.toggle('active', el.dataset.lang === langChoice);
  });

  // Web search (Tavily) controls live on the Model tab
  const wsToggle = document.getElementById('settings-web-search');
  if (wsToggle) wsToggle.classList.toggle('on', s.web_search_enabled === true);
  const wsKey = document.getElementById('settings-tavily-key');
  if (wsKey) wsKey.value = s.tavily_api_key || '';
  const fuToggle = document.getElementById('settings-followups');
  if (fuToggle) fuToggle.classList.toggle('on', s.followups_enabled === true);

  // Training tab
  window._TRAINING_FILES_DRAFT = Array.isArray(s.training_files) ? s.training_files.slice() : [];
  const notesInput = document.getElementById('settings-training-notes');
  if (notesInput) notesInput.value = s.training_notes || '';
  renderTrainingFilesList();

  // Persona tab
  window._PERSONAS_DRAFT = Array.isArray(s.personas)
    ? s.personas.map(p => ({ id: p.id, name: p.name || '', systemPrompt: p.systemPrompt || '' }))
    : [];
  window._ACTIVE_PERSONA_DRAFT = s.active_persona || '';
  renderPersonaDropdown();
  loadPersonaFields();

  switchSettingsTab('personalize');

  document.getElementById('settings-brand-color-label').textContent = brandInput.value;

  document.querySelectorAll('#brand-swatches .color-swatch').forEach(el =>
    el.classList.toggle('active', el.dataset.color === brandInput.value));

  document.getElementById('settings-modal').style.display = 'flex';
  updateSettingsPreview();
  detectActivePreset(toneInput.value);
}

function closeSettings() {
  document.getElementById('settings-modal').style.display = 'none';
}

function handleSettingsBackdrop(e) {
  if (e.target === document.getElementById('settings-modal')) closeSettings();
}

function previewColor(type, val) {
  document.getElementById('settings-brand-color-label').textContent = val;
  document.querySelectorAll('#brand-swatches .color-swatch').forEach(el =>
    el.classList.toggle('active', el.dataset.color === val));
  updateSettingsPreview();
}

function setSwatchColor(type, val, el) {
  document.getElementById('settings-brand-color').value = val;
  document.getElementById('settings-brand-color-label').textContent = val;
  document.querySelectorAll('#brand-swatches .color-swatch').forEach(s => s.classList.remove('active'));
  el.classList.add('active');
  updateSettingsPreview();
}

function resetSettingsForm() {
  window._BASE_NAME_DRAFT = AI_NAME;
  window._BASE_TONE_DRAFT = AI_TONE || '';
  document.getElementById('settings-brand-color').value = BRAND_COLOR;
  document.getElementById('settings-greeting').value = '';
  const ki = document.getElementById('settings-ai-knowledge');
  if (ki) ki.value = '';
  const ci = document.getElementById('settings-creator-name');
  if (ci) ci.value = '';
  const tn = document.getElementById('settings-training-notes');
  if (tn) tn.value = '';
  const pf = document.getElementById('settings-prompt-prefix');
  if (pf) pf.value = '';
  const sf = document.getElementById('settings-prompt-suffix');
  if (sf) sf.value = '';
  const tp = document.getElementById('settings-temperature');
  if (tp) { tp.value = 0.3; updateTemperatureLabel(0.3); }
  const mt = document.getElementById('settings-max-tokens');
  if (mt) { mt.value = 1024; updateMaxTokensLabel(1024); }
  const wsToggle = document.getElementById('settings-web-search');
  if (wsToggle) wsToggle.classList.remove('on');
  const wsKey = document.getElementById('settings-tavily-key');
  if (wsKey) wsKey.value = '';
  const fuToggle = document.getElementById('settings-followups');
  if (fuToggle) fuToggle.classList.remove('on');
  window._TRAINING_FILES_DRAFT = [];
  renderTrainingFilesList();
  window._PERSONAS_DRAFT = [];
  window._ACTIVE_PERSONA_DRAFT = '';
  renderPersonaDropdown();
  loadPersonaFields();
  document.querySelectorAll('#lang-picker .lang-chip').forEach(el => {
    if (el.disabled) return;
    el.classList.toggle('active', el.dataset.lang === 'english');
  });
  document.getElementById('settings-brand-color-label').textContent = BRAND_COLOR;
  document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
  document.querySelector(`#brand-swatches [data-color="${BRAND_COLOR}"]`)?.classList.add('active');
  document.querySelectorAll('.tone-preset-chip').forEach(c => c.classList.toggle('active', c.dataset.preset === 'default'));
  updateSettingsPreview();
}

function applyAndSaveSettings() {
  commitPersonaDraft();   // flush current Name/Personality edits into base draft or active persona
  const s = {
    // Base name/tone come from the drafts (the fields may currently be showing a persona)
    ai_name:          ((window._BASE_NAME_DRAFT || '').trim() || AI_NAME),
    brand_color:      document.getElementById('settings-brand-color').value,
    ai_tone:          (window._BASE_TONE_DRAFT || '').trim(),
    welcome_greeting: document.getElementById('settings-greeting').value.trim(),
    ai_knowledge:     (document.getElementById('settings-ai-knowledge')?.value.trim() || ''),
    creator_name:     (document.getElementById('settings-creator-name')?.value.trim() || ''),
    training_files:   (window._TRAINING_FILES_DRAFT || []),
    training_notes:   (document.getElementById('settings-training-notes')?.value.trim() || ''),
    reply_language:   (document.querySelector('#lang-picker .lang-chip.active')?.dataset.lang || 'english'),
    prompt_prefix:    (document.getElementById('settings-prompt-prefix')?.value.trim() || ''),
    prompt_suffix:    (document.getElementById('settings-prompt-suffix')?.value.trim() || ''),
    temperature:      parseFloat(document.getElementById('settings-temperature')?.value ?? '0.3'),
    max_tokens:       (() => {
      const v = parseInt(document.getElementById('settings-max-tokens')?.value ?? '1024', 10);
      return v >= MAX_TOKENS_SLIDER_MAX ? null : v;   // null = no limit
    })(),
    personas:         (window._PERSONAS_DRAFT || []),
    active_persona:   (window._ACTIVE_PERSONA_DRAFT || ''),
    web_search_enabled: !!document.getElementById('settings-web-search')?.classList.contains('on'),
    followups_enabled: !!document.getElementById('settings-followups')?.classList.contains('on'),
    thinking_enabled:   !!window._THINKING_ENABLED,
    tavily_api_key:   (document.getElementById('settings-tavily-key')?.value.trim() || ''),
  };
  saveSettings(s);
  applySettings(s);
  closeSettings();
  showToast('Settings saved!');
}

// ── PERSONAS ──────────────────────────────────────────────────────────
function getActivePersonaDraft() {
  const list = window._PERSONAS_DRAFT || [];
  return list.find(p => p.id === window._ACTIVE_PERSONA_DRAFT) || null;
}

function renderPersonaDropdown() {
  const sel = document.getElementById('settings-persona-select');
  if (!sel) return;
  sel.innerHTML = '';
  const def = document.createElement('option');
  def.value = '';
  def.textContent = 'Default (no persona)';
  sel.appendChild(def);
  for (const p of (window._PERSONAS_DRAFT || [])) {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.name || 'Untitled persona';
    sel.appendChild(o);
  }
  sel.value = window._ACTIVE_PERSONA_DRAFT || '';
}

// The Name + Personality fields are shared: "Default (no persona)" edits the base
// config (_BASE_NAME_DRAFT / _BASE_TONE_DRAFT); a selected persona edits that persona.
function loadPersonaFields() {
  const nameEl = document.getElementById('settings-ai-name');
  const toneEl = document.getElementById('settings-ai-tone');
  const delBtn = document.getElementById('persona-delete-btn');
  if (!nameEl || !toneEl) return;
  const p = getActivePersonaDraft();
  if (p) {
    nameEl.value = p.name || '';
    toneEl.value = p.systemPrompt || '';
  } else {
    nameEl.value = window._BASE_NAME_DRAFT || '';
    toneEl.value = window._BASE_TONE_DRAFT || '';
  }
  if (delBtn) delBtn.style.display = p ? '' : 'none';
  updateSettingsPreview();
  detectActivePreset(toneEl.value);
}

function commitPersonaDraft() {
  const nameEl = document.getElementById('settings-ai-name');
  const toneEl = document.getElementById('settings-ai-tone');
  if (!nameEl || !toneEl) return;
  const p = getActivePersonaDraft();
  if (p) {
    p.name = nameEl.value.trim();
    p.systemPrompt = toneEl.value;
    const sel = document.getElementById('settings-persona-select');
    if (sel) {
      const opt = Array.from(sel.options).find(o => o.value === p.id);
      if (opt) opt.textContent = p.name || 'Untitled persona';
    }
  } else {
    window._BASE_NAME_DRAFT = nameEl.value.trim();
    window._BASE_TONE_DRAFT = toneEl.value;
  }
}

function selectPersona(id) {
  commitPersonaDraft();   // save edits to the persona we're leaving
  window._ACTIVE_PERSONA_DRAFT = id || '';
  loadPersonaFields();
}

function newPersona() {
  commitPersonaDraft();
  const id = 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  (window._PERSONAS_DRAFT = window._PERSONAS_DRAFT || []).push({ id, name: '', systemPrompt: '' });
  window._ACTIVE_PERSONA_DRAFT = id;
  renderPersonaDropdown();
  loadPersonaFields();
  document.getElementById('settings-ai-name')?.focus();
}

function deletePersona() {
  const p = getActivePersonaDraft();
  if (!p) return;
  if (!confirm(`Delete persona "${p.name || 'Untitled persona'}"?`)) return;
  window._PERSONAS_DRAFT = (window._PERSONAS_DRAFT || []).filter(x => x.id !== p.id);
  window._ACTIVE_PERSONA_DRAFT = '';
  renderPersonaDropdown();
  loadPersonaFields();
}

async function expandPersonaPrompt() {
  const ta  = document.getElementById('settings-ai-tone');
  const btn = document.getElementById('persona-expand-btn');
  if (!ta || !btn) return;
  const notes = ta.value.trim();
  if (!notes) { showToast('Write a few rough notes first.'); return; }
  if (!window.ACTIVE_MODEL) {
    showToast(MODEL_LIST.some(m => m.model)
      ? 'Select a model first — use the picker at the bottom of the chat.'
      : 'No AI model installed yet. Pull one in a terminal: ollama pull qwen2.5:3b');
    return;
  }

  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Expanding…';
  try {
    const sys = 'You are a prompt engineer. Expand the user\'s rough notes into a clear, well-structured system prompt for an AI assistant persona. Write in the second person ("You are…"). Be concrete about the persona\'s role, tone, behavior, and any constraints. Output ONLY the finished system prompt text — no preamble, no markdown headings, no surrounding quotes.';
    const res = await fetch(`${window.ACTIVE_BASE}/chat/completions`, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${window.ACTIVE_KEY}` },
      body: JSON.stringify({
        model: window.ACTIVE_MODEL,
        messages: [{ role: 'system', content: sys }, { role: 'user', content: notes }],
        temperature: 0.7,
        max_tokens: 600,
        stream: false
      })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const out = data?.choices?.[0]?.message?.content?.trim();
    if (!out) throw new Error('empty response');
    ta.value = out;
    commitPersonaDraft();
    detectActivePreset(out);
    showToast('Expanded!');
  } catch (e) {
    showToast('Expand failed — check your model connection.');
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

window.selectPersona = selectPersona;
window.newPersona = newPersona;
window.deletePersona = deletePersona;
window.commitPersonaDraft = commitPersonaDraft;
window.expandPersonaPrompt = expandPersonaPrompt;

// ── LANGUAGE PICKER ───────────────────────────────────────────────────
function setLanguageChoice(lang, btn) {
  document.querySelectorAll('#lang-picker .lang-chip').forEach(el => {
    if (el.disabled) return;
    el.classList.toggle('active', el === btn);
  });
}
window.setLanguageChoice = setLanguageChoice;

function buildLanguageRule(lang) {
  // Indonesian/Malay words that often bleed into model output — strictly banned in all Philippine language modes
  const banned = `\n\n### BANNED — Indonesian/Malay Contamination\nYou are speaking a Philippine language, NOT Indonesian or Malay. These words are FORBIDDEN — replace every single one:\n"dengan" → sa/kasama | "yang" → na/yung/nga | "ini" → ito/ni | "itu" → iyon/ana/adto | "untuk" → para/alang sa | "dari" → mula sa/gikan sa | "tidak/tak" → hindi/dili/haan/indi | "bisa" → pwede/kaya/makabuhat | "juga" → din/rin/pud/met | "sudah" → na | "kegiatan" → gawain/buluhaton/aramid | "pengguna" → user/gumagamit/mogamit | "lingkungan" → kapaligiran/palibot | "berbagai" → iba't ibang/nagkalainlain | "mungkin" → siguro/basin/ngata | "buatan" → gawa/hinimo | "namun" → pero/ngunit/apan/ngem | "saja" → lang/ra/la | "kalau" → kung/kon/no | "karena" → kasi/dahil/kay/ta | "mereka" → sila/isuda | "kami" → only valid in Filipino/Bisaya/Hiligaynon (not Indonesian sense) | "belum" → hindi pa/wala pa | "sudah" → na/nankaman | "sangat" → napaka/kaayo/unay/ado | "sebelum" → bago/sa wala pa | "setelah" → pagkatapos/human | "banyak" → marami/daghan/madamo/adu | "atau" → o/kon/wenno | "tetapi" → pero/ngunit/apan/ngem\nIf ANY word feels Indonesian or Malay — stop, delete it, and use the correct Philippine language word.`;

  if (lang === 'filipino') {
    return `\n\n## Language Rule (STRICT — Filipino/Tagalog only)\nRespond ONLY in Filipino (Tagalog-based). Non-negotiable regardless of what language the user writes in. Before you output anything, mentally verify every sentence against the grammar rules below.

### Register & Tone
- Casual, warm, conversational — like a classmate, kuya, or ate. NOT formal, NOT news-anchor Tagalog, NOT deep/archaic.
- Use real everyday words: "pwede" not "maaari", "gusto" not "nais", "kasi" not "sapagkat", "tapos" not "pagkatapos nito", "yung/yun" not "ang/iyon" in casual speech.
- WRONG: "Ang iyong kahilingan ay aking ipoproseso." → CORRECT: "Sige, gagawin ko yun."
- WRONG: "Bilang isang AI, nais kong ipaalam sa inyo..." → CORRECT: "So, ganito yun..."
- WRONG: "Nais kong ipaliwanag ang..." → CORRECT: "Ipapaliwanag ko yung..."

### Case Markers (CRITICAL — most common error source)
- "Ang" = subject/topic marker (nominative): "Kumain **ang** bata." | "Maganda **ang** bahay."
- "Ng" [nang] = object marker / genitive (possessive): "Kinain niya **ng** mansanas." | "Bahay **ng** nanay."
- "Sa" = location / direction / indirect object / dative: "Pumunta siya **sa** palengke." | "Ibinigay ko **sa** kanya."
- NEVER confuse ng and sa: "Pumunta sa tindahan" ✓ | "Pumunta ng tindahan" ✗

### Verb Focus System (CRITICAL)
Filipino verbs MUST agree with their topic/focus. Choose the right focus:
- **Actor Focus** (-um-, mag-): actor is the topic. "**Kumain** siya ng kanin." (She ate rice — she is the topic.) "**Magluto** tayo." (Let's cook.)
  - -um- for punctual/single actions: kumain, bumili, lumabas, dumating, sumali
  - mag- for sustained/habitual or when there's an explicit object: magluto, maglaro, magbasa, magtrabaho
- **Object Focus** (-in, i-in-): object/patient is the topic. "**Kinain** niya ang kanin." (The rice was eaten by her — rice is the topic.) "**Bilhin** mo ang tinapay."
- **Locative Focus** (-an): location is the topic. "**Lutuan** niya ang kaldero." (The pot is what she'll cook in.) "**Puntahan** natin." (Let's go there — there is the topic.)
- **Benefactive Focus** (i-): beneficiary or thing conveyed is the topic. "**Ibigay** mo sa kanya." "**Iluto** ko ito para sa iyo."
- WRONG FOCUS: "Bumili siya ang tinapay." ✗ (ang marks topic but bumili is actor focus — object must be ng) → "Bumili siya ng tinapay." ✓ OR "Binili niya ang tinapay." ✓

### Verb Aspect (Tense)
- **Completed** (nag-, -in-, ni-): action is done. "Kumain na siya." "Nagluto na ako." "Binili ko na."
- **Contemplated** (mag-, -in future form): action not yet done. "Magluluto ako." "Bilhin ko bukas."
- **Progressive** (nag- + partial reduplication, naka-): action ongoing. "Nagluluto siya ngayon." "Kumakain pa siya."
- Reduplication rule: first consonant + first vowel is reduplicated for progressive: kain → ka-kain → **kakain** (will eat) | luto → lu-luto → **luluto** | basa → ba-basa → **babasa**
- WRONG: "Nagluto siya ngayon" (completed form for ongoing action) ✗ → "Nagluluto siya ngayon" ✓

### Linkers — "na" / "-ng" / "nang" (CRITICAL)
- **"-ng"** (suffix) = when preceding word ends in a vowel: "maganda**ng** babae", "mabilis**ng** kotse" ✗ (mabilis ends in s → use "na") → "mabilis **na** kotse" ✓
- **"na"** (separate word) = when preceding word ends in a consonant: "mabilis **na** kotse", "malaki **na** bahay"
- **"nang"** = adverbial linker (how/when/manner/time): "Tumakbo siya **nang** mabilis." "**Nang** dumating siya..." NEVER use "ng" here.
- WRONG: "Tumakbo ng mabilis" ✗ | CORRECT: "Tumakbo nang mabilis" ✓
- WRONG: "magandang kotse" when maganda ends in 'a' → "maganda**ng** kotse" ✓ (vowel ending → -ng suffix)

### Enclitics — Second-Position Particles (attach after first word/phrase)
- **na** (already/now): "Kumain **na** siya." "Tapos **na**."
- **pa** (still/yet/more): "Kumakain **pa** siya." "Hindi **pa** tapos."
- **rin/din** (also/too): after vowel sound → **rin**: "Gusto ko **rin**." | after consonant sound → **din**: "Gusto niya **din**."
- **raw/daw** (hearsay/reportedly): after vowel → **raw**: "Magaling **raw** siya." | after consonant → **daw**: "Matalino **daw** siya."
- **ba** (yes/no question marker): "Kumain **ka ba**?" "Okay **ba** iyon?"
- **yata** (seems like/I think): "Nalimutan **niya yata**." "Wala **yata** siya."
- **nga** (emphasis/confirmation): "Oo **nga**." "Ganun **nga**."
- **kaya** (I wonder): "Saan **kaya** siya?" (not to be confused with "kaya" = so/therefore as connector)

### Pronouns — Full Paradigm
- Subject (ang-form): ako, ikaw/ka, siya, tayo (incl.), kami (excl.), kayo, sila
- Object/Genitive (ng-form): ko, mo, niya, natin (incl.), namin (excl.), ninyo, nila
- Oblique (sa-form): sa akin, sa iyo, sa kanya, sa atin (incl.), sa amin (excl.), sa inyo, sa kanila
- WRONG: "Ibinigay niya sa ko." ✗ → "Ibinigay niya sa akin." ✓
- WRONG: "Ginawa ko niya." ✗ → "Ginawa niya." or "Ginawa niya para sa akin." ✓

### Common Errors to NEVER Make
1. "Pumunta ako ng tindahan." ✗ → "Pumunta ako sa tindahan." ✓ (location = sa)
2. "Ang bahay ng maganda." ✗ → "Ang magandang bahay." ✓
3. "Gusto ko ikaw." ✗ → "Gusto kita." ✓ (special form for I→you)
4. "Mahal kita ikaw." ✗ → "Mahal kita." ✓
5. "Ito ay isang..." (overly formal) ✗ → "Ito yung..." ✓

### Technical Terms — Keep in English
AI, code, function, API, file, app, server, database, terminal, bug, error, install, update, deploy, click, run, download, upload, settings, folder, output, input, script, model, token, prompt.
Wrap naturally: "I-run mo yung script." | "May error sa code mo." | "I-check mo yung settings."

### ESCAPE HATCH
Unknown Filipino word → use English. A correct mixed sentence beats broken Filipino.
${banned}`;
  }

  if (lang === 'taglish') {
    return `\n\n## Language Rule (STRICT — Taglish)\nRespond in Taglish — natural Filipino-English code-switching as actually spoken by Filipinos daily. The Filipino parts must follow correct Filipino grammar (same rules as Filipino mode). The English parts must be grammatically correct English. Mixing is the point — but both halves must be correct.

### What Natural Taglish Sounds Like
- Filipino grammatical frame + English for technical/borrowed words.
- "Pwede mong **i-run** yung **code** sa **terminal**, tapos tingnan mo yung **output**." ✓
- "May **error** ka sa **line 5** — baka mali yung **variable name**." ✓
- "**Install** mo muna yung **dependencies**, tapos **i-run** mo na." ✓
- WRONG (too formal Filipino): "Maaari mong patakbuhin ang programa sa terminal." ✗
- WRONG (Indonesian bleed): "Dengan menggunakan ang code..." ✗
- WRONG (broken grammar): "I-check mo ng file" ✗ → "I-check mo **yung** file" ✓

### When to Switch to English
- Technical terms: function, loop, variable, array, error, deploy, install, run, click, check, update, debug, import, export, build, test, push, pull, merge, branch, commit
- Already-naturalized loanwords: okay, sure, wait, anyway, actually, basically, literally, exactly, right, yeah
- Whenever the Filipino word sounds unnatural or overly formal in context

### When to Stay in Filipino
- Sentence connectors: "tapos" (then), "kasi" (because), "pero" (but), "saka" (and after), "kaya" (so), "pag/kapag" (when/if), "kung" (if), "kahit" (even if), "hanggang" (until), "bago" (before)
- Reactions and fillers: "ay grabe", "sige", "oo nga", "ganun ba", "talaga", "edi", "eh"
- Pronouns and particles: always use Filipino — "mo", "ko", "niya", "yung", "yun", "ba", "na", "pa", "nga"

### Grammar Rules — Filipino Parts (STRICTLY ENFORCE)
- Case markers: "ang" = subject, "ng" = object/possessive, "sa" = location/direction.
  - "I-save mo **ang** file." ✓ | "I-save mo **ng** file." ✗
  - "I-upload mo **sa** server." ✓ | "I-upload mo **ng** server." ✗
- Verb focus with English verbs (i- prefix for object focus borrowed verbs):
  - "**I-install** mo." ✓ | "**I-check** mo yung settings." ✓ | "**I-run** natin." ✓
  - "Mag-install ka." ✓ (actor focus) | "I-install mo ang app." ✓ (object focus)
- Linker ng vs nang: "Gawin mo **nang** maayos." ✓ | "Gawin mo **ng** maayos." ✗
- rin/din: after vowel sound → rin | after consonant → din. "Gusto ko **rin**." "Gusto niya **din**."
- Pronoun "kita" = I→you (special): "Gusto **kita**." ✓ | "Gusto ko **ikaw**." ✗
- Progressive needs reduplication: "Nag-i-**install** na siya." ✓ | "Nag-install na siya ngayon." ✗ (use progressive if action is ongoing)

### Common Taglish Grammar Errors to NEVER Make
1. "I-check mo ng file" ✗ → "I-check mo yung file" / "I-check mo ang file" ✓
2. "Para i-run ang code niya" ✗ → "Para ma-run ang code" / "Para i-run mo yung code" ✓
3. "Subukan mo mag-install" ✗ → "Subukan mong i-install" ✓
4. "Pumunta ng settings" ✗ → "Pumunta sa settings" ✓
${banned}`;
  }

  if (lang === 'bisaya') {
    return `\n\n## Language Rule (STRICT — Cebuano/Bisaya only)\nRespond ONLY in Cebuano (Bisaya). This is the Cebuano of Cebu, Davao, and Mindanao — NOT Tagalog, NOT Filipino, NOT Indonesian. Mentally verify every sentence against the grammar rules below before outputting.

### Register & Tone
- Casual, warm, everyday Bisaya — talk like a Cebuano friend, not a textbook.
- Natural particles to use: "bai" (friend/buddy), "uy" (hey), "ay" (oh), "lagi" (yes/of course), "bitaw" (right/exactly/indeed), "man" (softener/emphasis — "unsa man?"), "ba" (question marker), "gud" (intensifier — "sige gud"), "jud/gyud" (really/definitely), "lang/ra" (just/only), "diay" (so/apparently/I see), "pud/pod" (also/too), "na" (already), "pa" (still/yet).
- Natural examples: "Unsa man to, bai?" (What was that?) | "Okay ra ba?" (Is it okay?) | "Sige gud, buhaton nako." (Alright, I'll do it.) | "Tinuod jud, bitaw!" (That's really true!) | "Salamat kaayo!" (Thanks a lot!)

### Case Markers (CRITICAL)
- "Ang" = subject/topic marker: "**Ang** bata nagkaon." | "Maganda **ang** balay."
- "Sa" = location / direction / oblique: "Moadto siya **sa** merkado." | "Ihatag mo **sa** iya."
- "Ni" = genitive singular (of a person): "Balay **ni** Juan." | "Libro **ni** Maria."
- "Og/ug" = object marker (non-topic object) AND conjunction "and": "Gikaon niya **og** tinapay." (as object marker) | "Ako **ug** ikaw." (as "and")
- "Kang" = genitive of pronouns / sa-form of "ka" in some uses.
- NEVER use "ng" as Tagalog uses it — in Bisaya the object marker is "og/ug": "Mokaon ko **og** isda." ✓ | "Mokaon ko **ng** isda." ✗

### Verb Focus System (CRITICAL — different from Tagalog)
- **Actor Focus — future** (mo-/mu-): simple future action, actor is topic.
  - "**Mokaon** ko." (I will eat.) "**Moadto** siya." (He/she will go.) "**Mokuha** ka." (You will get it.)
  - mo- before consonants, mu- before some consonants (dialectal variation — both acceptable)
- **Actor Focus — habitual/extended** (mag-): habitual or extended action, or when action has a direct stated object.
  - "**Magkaon** ta." (Let's eat — habitual/general.) "**Magdula** siya matag adlaw." (He plays every day.)
- **Object Focus — future** (-on suffix): object/patient is the topic.
  - "**Kuhaon** nako." (I will get it — it is the topic.) "**Buhaton** niya." (He will do it.) "**Kaonon** nato." (We'll eat it.)
- **Object Focus — completed** (gi- prefix): completed action, object is topic.
  - "**Gikuha** nako." (I got it.) "**Gibuhat** niya." (He did it.) "**Gikaon** niya ang tinapay." (He ate the bread.)
  - NOTE: gi- NOT "ni-" — "nikaon" is actor focus completed: "Nikaon siya." (He ate.) vs "Gikaon niya ang tinapay." (He ate the bread.)
- **Actor Focus — completed** (ni-/nag-): actor is topic, action completed.
  - "**Nikaon** siya." (He ate.) "**Nagdula** sila kagahapon." (They played yesterday.) "**Miadto** siya sa merkado." (She went to the market.)
- **Locative Focus** (-an suffix): location is topic.
  - "**Adtoan** nako." (I'll go there.) "**Lutoan** niya." (She'll cook in/on it.)
- **Progressive** (nag- + partial reduplication): ongoing action.
  - "**Nagkaon** pa siya." (He is still eating.) "**Nagdula-dula** siya." (He's playing around.)
  - OR: "Naay nagkaon pa." — context carries it in Bisaya (less strict reduplication than Tagalog)

### Negation Rules
- "**Dili**" = not/no for FUTURE actions and commands: "**Dili** ko moadto." (I won't go.) "**Dili** mo buhata." (Don't do it.)
- "**Wala**" = not/no for COMPLETED actions and states: "**Wala** ko moadto." (I didn't go.) "**Wala** koy kwarta." (I have no money.)
- "**Ayaw**" = don't (imperative prohibition): "**Ayaw** panghadlok." (Don't be scared.) "**Ayaw** ug kaon ana." (Don't eat that.)
- WRONG: "Hindi ko moadto." ✗ (that's Tagalog) → "Dili ko moadto." ✓

### Pronouns — Full Paradigm
- Subject (ang-pronouns): ako, ikaw/ka, siya, kita (incl.), kami (excl.), kamo/mo (you pl.), sila
- Genitive/Possessive (ng-pronouns): nako/ko, nimo/mo, niya, nato/ta (incl.), namo (excl.), ninyo/nyo, nila
- Oblique (sa-pronouns): kanako/nako, kanimo/nimo, kaniya/niya, kanato (incl.), kanamo (excl.), kaninyo, kanila
- WRONG: "Ibayad mo sa ko." ✗ → "Ibayad mo kanako." / "Ibayad mo nako." ✓

### Ligature
- "**Nga**" connects modifier to head noun (equivalent of Tagalog na/-ng):
  - "dako**ng** balay" (big house — vowel ending → nga shortened to -ng suffix) | "gamay **nga** balay" ✓ | "daghan **nga** problema" ✓
  - After vowel: word + -ng: "dako**ng**", "gwapa**ng**" | After consonant: word + nga: "gamay **nga**", "dako **nga**" (when full form needed)

### Common Errors to NEVER Make
1. Using Tagalog "ng" as object marker ✗ → use "og/ug" in Bisaya ✓
2. "Hindi" for negation ✗ → "Dili" (future) or "Wala" (past) ✓
3. "Pumunta siya sa" ✗ (Tagalog verb) → "Miadto siya sa" ✓
4. "Nagkaon siya ng kanon" ✗ → "Nagkaon siya og kanon" ✓
5. "Gusto ko" alone is fine in casual Bisaya but prefer "Ganahan ko" or "Gusto nako" for full clarity

### Technical Terms — Keep in English
AI, code, function, API, file, app, server, database, terminal, bug, error, install, update, deploy, settings, folder, output, input, script, model, token, prompt.
Natural Bisaya wrapping: "I-run ang code." | "Naa bay error?" | "I-check ang settings." | "I-install lang na."

### ESCAPE HATCH
Unknown Bisaya word → use English. Correct mixed sentence beats broken Bisaya.
${banned}`;
  }

  if (lang === 'hiligaynon') {
    return `\n\n## Language Rule (STRICT — Hiligaynon/Ilonggo only)\nRespond ONLY in Hiligaynon (Ilonggo), the language of Iloilo, Bacolod, Antique, Capiz, and Western Visayas. NOT Tagalog, NOT Cebuano, NOT Indonesian. Verify every sentence against the grammar rules below.

### Register & Tone
- Warm, gentle, polite, conversational — Ilonggos are known for melodic, soft speech. Reflect that quality.
- Natural particles: "man" (softener/emphasis — "ano man?"), "gid" (really/definitely/intensifier — "maayo gid"), "na" (already/now), "pa" (still/yet), "lang" (just/only), "bala" (rhetorical tag — "maayo ka bala?"), "abi" (I thought/apparently), "kuno" (supposedly), "daw" (reportedly/they say), "no" (right? — tag question, soft), "guid" (variant of gid — dialectal).
- Natural examples: "Ano man ina?" (What's that?) | "Maayo ka bala?" (Are you okay?) | "Salamat gid, ha." (Thank you very much.) | "Maayo gid na!" (That's really good!) | "Sige, himuon ko." (Okay, I'll do it.)

### Case Markers (CRITICAL — different from Tagalog AND Cebuano)
- "**Ang**" = subject/topic marker: "**Ang** bata nagkaon."
- "**Sang**" = definite object marker / genitive of common nouns (NOT Tagalog "ng"): "Ginkaon niya **sang** tinapay." | "Balay **sang** manugdaro."
- "**Sing**" = indefinite object marker: "Nagkaon siya **sing** tinapay." (ate some bread)
- "**Sa**" = location, direction, oblique: "Nagkadto siya **sa** merkado." | "Ihatag mo **sa** iya."
- "**Kay**" = genitive of personal names / subject-focus pronoun case for names: "Balay **kay** Juan." | "Para **kay** Maria."
- WRONG: "Ginkaon niya ng tinapay." ✗ (Tagalog case marker) → "Ginkaon niya **sang** tinapay." ✓

### Verb Focus System (CRITICAL)
- **Actor Focus — future** (mag-): actor is topic, action not yet done.
  - "**Magkaon** ako." (I will eat.) "**Magluto** siya." (She will cook.) "**Magkadto** kita." (We'll go — incl.)
- **Actor Focus — completed** (nag-): actor is topic, action done.
  - "**Nagkaon** ako." (I ate.) "**Nagluto** siya." (She cooked.) "**Nagkadto** sila." (They went.)
- **Actor Focus — progressive** (naga-): actor is topic, action ongoing.
  - "**Nagakaon** siya subong." (She is eating now.) "**Nagaluto** pa ako." (I'm still cooking.)
- **Object Focus — future** (-on suffix): object is topic, action not yet done.
  - "**Kaonon** ko." (I will eat it.) "**Himoon** niya." (She will do it.) "**Batonon** ta." (We'll take/get it.)
- **Object Focus — completed** (gin-): object is topic, action done.
  - "**Ginkaon** niya ang tinapay." (She ate the bread.) "**Ginhimo** na niya." (She already did it.)
- **Object Focus — progressive** (gina-): object is topic, action ongoing.
  - "**Ginakaon** pa niya." (She is still eating it.) "**Ginahimo** niya subong." (She is doing it now.)
- **Locative Focus** (-an suffix): location is topic.
  - "**Lutuan** niya ang kaldero." (She'll use the pot to cook.) "**Suldan** ko." (I'll enter it.)
- **Benefactive Focus** (i-): thing conveyed or beneficiary is topic.
  - "**Ihatag** mo sa iya." (Give it to her.) "**Iluto** ko para sa imo." (I'll cook it for you.)

### Negation Rules
- "**Indi**" = not/no for FUTURE actions, intentions, commands (most common negator): "**Indi** ko makadto." (I won't go.) "**Indi** mo gid buhata." (Don't ever do that.)
- "**Wala**" = not/no for COMPLETED actions and states/existence: "**Wala** ko nagkadto." (I didn't go.) "**Wala** kwarta." (No money.)
- "**Indi**" is characteristic of Hiligaynon — do NOT use "hindi" (Tagalog) or "dili" (Bisaya).
- WRONG: "Hindi ko makadto." ✗ → "Indi ko makadto." ✓
- WRONG: "Dili ko makadto." ✗ (Bisaya) → "Indi ko makadto." ✓

### Pronouns — Full Paradigm
- Subject (ang-form): ako, ikaw/ka, siya, kita (incl.), kami (excl.), kamo (you pl.), sila
- Genitive/Possessive (sang-form): ko, mo, niya, naton/ta (incl.), namon (excl.), ninyo, nila
- Oblique (sa-form): sa akon, sa imo, sa iya, sa aton (incl.), sa amon (excl.), sa inyo, sa ila
- WRONG: "Ihatag mo sa ko." ✗ → "Ihatag mo sa akon." ✓

### Key Connector: "kag" (AND)
- "**Kag**" is the characteristic Hiligaynon word for "and" when joining nouns or clauses. NOT "at" (Tagalog), NOT "ug" (Bisaya).
- "Ako **kag** ikaw." ✓ | "Nagkaon siya **kag** nagtiner." ✓
- Other connectors: "ukon" (or), "pero" (but), "tungod kay" (because), "gani" (so/therefore/indeed — very Ilonggo), "kon" (if/when), "samtang" (while), "antes" (before), "pagkatapos" (after).

### Ligature
- "**Nga**" connects modifier to head noun (same as Bisaya): "maayo **nga** tawo" | "dako **nga** balay" | "matahum **nga** babayi"
- After vowel: -ng suffix: "dako**ng** balay" | After consonant: nga separate: "maayo **nga** tawo"

### Common Errors to NEVER Make
1. Using "at" instead of "kag" for "and" ✗ → "kag" ✓
2. Using "hindi" instead of "indi" ✗
3. Using "ng" (Tagalog) instead of "sang/sing" ✗
4. Using "dili" (Bisaya) instead of "indi" ✗
5. "Ginhimo niya sing trabaho" (wrong article) ✗ → "Ginhimo niya ang trabaho" (definite) ✓

### Technical Terms — Keep in English
AI, code, function, API, file, app, server, database, terminal, bug, error, install, update, deploy, settings, folder, output, input, script, model, token, prompt.
Natural wrapping: "I-run ta ang code." | "May error bala?" | "I-check mo ang settings." | "Ini-install ko subong."

### ESCAPE HATCH
Unknown Hiligaynon word → use English. Correct mixed sentence beats broken Hiligaynon.
${banned}`;
  }

  if (lang === 'ilocano') {
    return `\n\n## Language Rule (STRICT — Ilocano/Ilokano only)\nRespond ONLY in Ilocano (also spelled Ilokano), the language of Ilocos Norte, Ilocos Sur, La Union, Abra, and widely spoken across Northern Luzon and the global Ilocano diaspora. NOT Tagalog, NOT Bisaya, NOT Indonesian. Verify every sentence against the grammar rules below.

### Register & Tone
- Practical, direct, warm — Ilocanos are known for being hardworking and straightforward. Match that energy: no fluff, but genuinely warm.
- Natural particles: "met" (also/too/well/then — very characteristic, nearly every sentence), "pay" (still/yet/more), "la" (just/only), "man" (softener/emphasis — "ania man?"), "koma" (should/would — wish/hypothetical: "Nagmayatkon koma." = "I should have been fine."), "ngata" (perhaps/I wonder), "ketdi" (but/instead/however), "ket" (and/then/so — main clause connector), "ta" (so that/because), "unay" (very much), "bassit" (a little/few).
- Natural examples: "Ania met ti napasamak?" (What happened?) | "Naimbag ka met?" (Are you okay?) | "Sige, aramidek." (Okay, I'll do it.) | "Agyamanak unay." (Thank you very much.) | "Napaypayso dayta!" (That's very true!)

### Articles (CRITICAL — unique Ilocano system)
- "**Ti**" = definite article singular (the): "**Ti** balay." (The house.) "**Ti** ubing." (The child.)
- "**Dagiti**" = definite article plural (the): "**Dagiti** balay." (The houses.) "**Dagiti** ubing." (The children.)
- "**Iti**" = oblique/locative definite singular (at the/in the/of the): "Adda **iti** balay." (In the house.) "Naggapu **iti** pagilian." (From the country.)
- "**Kadagiti**" = oblique/locative definite plural: "Nagkita kami **kadagiti** tattao." (We saw the people.)
- "**Ti**" is also used to introduce proper nouns in subject position: "Immay **ti** Juan." (Juan came.)
- WRONG: "Ang balay" ✗ (Tagalog) → "Ti balay" ✓ | "Ang mga balay" ✗ → "Dagiti balay" ✓

### Verb Focus System (CRITICAL — predicate-first language)
Ilocano is PREDICATE-FIRST: the verb comes at the beginning of the clause. Subject follows.
- **Actor Focus — future** (ag- for intransitive/reflexive; mang- for transitive with object):
  - ag-: "**Agkanen** ak." (I will eat.) "**Aglagsatok.**" (I'll rest.) "**Agbiahe** da." (They'll travel.)
  - mang- (when there's a direct object): "**Mangkanen** ak ti tinapay." (I will eat bread.)
  - um- (movement/becoming): "**Umayka** ditoy." (Come here.) "**Umanak**." (I'll go home.)
- **Actor Focus — completed** (nag- for ag- verbs; nang- for mang- verbs):
  - "**Nangan** ak." (I ate.) "**Nagbibiag** kami." (We lived.) "**Nangkuha** siak." (I took it.)
  - Note: nag+kanen → nagkanen, but nangan is the irregular completed of agkanen
- **Actor Focus — progressive** (ag- + partial reduplication or nag- + reduplication):
  - "**Agkakanen** ak." (I am eating.) "**Nagbibiahe** da." (They were traveling.)
- **Object Focus — future** (-en suffix): object is topic.
  - "**Kanenmo**." (You will eat it.) "**Aramidenna**." (He/she will do it.) "**Bilinen**." (Will be bought.)
- **Object Focus — completed** (in- infix or ni- prefix):
  - "**Inaramid** na." (He/she did it.) "**Inkuha** ko." (I took it.) "**Binilin** na." (Was bought.)
  - "-in-" is inserted after first consonant: ar**in**amid, k**in**uha, b**in**ilin
- **Locative Focus** (-an suffix): location is topic.
  - "**Kanengan** tayo." (We'll eat in/at it.) "**Trabahuan** mi." (We'll work on/at it.)
- **Benefactive Focus** (i- prefix): thing conveyed or beneficiary is topic.
  - "**Ited** mo kaniak." (Give it to me.) "**Isuro** na kaniak." (Teach me/show me.)

### Negation Rules
- "**Haan**" = general negator (not/no): "**Haan** ak agkanen." (I will not eat.) "**Haan** a naimbag." (Not good.)
- "**Saan**" = variant of haan (dialectal/common written form): "**Saan** ak a mapan." (I won't go.)
- Contracted negation with pronouns: "**Saanka**" (you won't/don't), "**Saanak/Haanak**" (I won't/don't), "**Haanna/Saanna**" (he/she won't), "**Saantayo**" (we won't — incl.), "**Saanmi**" (we won't — excl.).
- "**Awan**" = there is none / it doesn't exist: "**Awan** pera ko." (I have no money.) "**Awan** ti problema." (No problem.)
- WRONG: "Hindi ak agkanen." ✗ (Tagalog) → "Haan ak agkanen." / "Saanak agkanen." ✓

### Pronouns — Full Paradigm (CRITICAL — enclitic system)
Ilocano has FULL pronouns (independent) and ENCLITIC pronouns (suffixed to first word of clause):
- Full subject: siak (I), sika (you), isuna (he/she/it), dakami (we excl.), datayo (we incl.), dakayo (you pl.), isuda (they)
- Enclitic subject (after verb): -ak/-k (I), -ka (you), -na (he/she/it), -mi (we excl.), -tayo/-ta (we incl.), -yo (you pl.), -da (they)
- Genitive (possessive/agent of OV): ko (my), mo (your), na (his/her/its), mi (our excl.), tayo/ta (our incl.), yo (your pl.), da (their)
- Oblique (sa-equivalents): kaniak (to me), kenka (to you), kenkuana (to him/her), kadakami (to us excl.), kadatayo (to us incl.), kadakayo (to you pl.), kadakuada (to them)
- WRONG: "Iited mo sa ko." ✗ → "Ited mo kaniak." ✓
- WRONG: "Nagkita siak." ✗ (full pronoun wrong position) → "Nagkita ak." ✓ (enclitic after verb) OR "Siak ti nagkita." ✓ (full form as subject phrase)
- Enclitic order rule: verb FIRST, then enclitic pronoun attaches. "Nagkanen**ak**." (I ate.) "Inted**na**." (He gave it.) "Immayka**." (You came.)

### Ligature "a" / "-ng" (CRITICAL)
- "**a**" connects adjectives/modifiers to nouns when preceding word ends in a consonant: "naimbag **a** taotao" (good person) | "dakkel **a** balay" (big house) | "adu **a** problema" (many problems)
- "**-ng**" (suffix) when preceding word ends in a vowel: "napintas**ng** babai" (beautiful woman) | "naruay**ng** ubing" (cute child)
- WRONG: "naimbag ng taotao" ✗ (Tagalog ligature) → "naimbag a taotao" ✓

### Common Connectors
- "**Ket**" = and/then/so (main clause connector — very characteristic of Ilocano): "Nangan ak **ket** nanginom ak." (I ate and then I drank.)
- "**Ken**" = and (for nouns/lists, not clauses): "Siak **ken** sika." (You and I.) "Apples **ken** oranges."
- "**Ngem**" = but/however: "Naimbag **ngem** nagbagas." (Good but expensive.)
- "**Wenno**" = or: "Kanen **wenno** inumen?" (Eat or drink?)
- "**Ta**" = because/so that: "Nangan ak **ta** nabisin ak." (I ate because I was hungry.)
- "**No**" = if/when (conditional): "**No** agkanen ka, ited ko kenka." (If you eat, I'll give it to you.)
- "**Bayat**" = while: "**Bayat** ti pagkanen ko..." (While I was eating...)
- WRONG: "kasi" ✗ (Tagalog) → "ta" / "gapu ta" ✓ | "pero" ✗ → "ngem" ✓

### Common Errors to NEVER Make
1. Using "ang" instead of "ti" ✗ | "mga" instead of "dagiti" ✗
2. Using "hindi" instead of "haan/saan" ✗
3. Putting subject before verb ✗ — Ilocano is PREDICATE-FIRST: "Nangan ak." ✓ not "Ak nangan." ✗ (unless emphasizing)
4. Using "ng" as ligature ✗ → use "a" (after consonant) or "-ng" suffix (after vowel) ✓
5. "Inyeg ko sa kanya" ✗ → "Inted ko kenkuana." ✓

### Technical Terms — Keep in English
AI, code, function, API, file, app, server, database, terminal, bug, error, install, update, deploy, settings, folder, output, input, script, model, token, prompt.
Natural wrapping: "I-run ti code." | "Adda error?" | "I-check ti settings mo." | "Naimbag met dayta."

### ESCAPE HATCH
Ilocano verb morphology is complex. If unsure of correct verb form — use a simpler construction or English. Never produce wrong Ilocano grammar.
${banned}`;
  }

  // default: english
  return `\n\n## Language Rule (strict)\nRespond ONLY in English, regardless of what language the user writes in. Use clear, plain English — avoid jargon unless the user uses it first.${banned}`;
}

