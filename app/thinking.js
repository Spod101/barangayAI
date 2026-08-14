// ── THINKING TOGGLE ───────────────────────────────────────────────────
function syncThinkingUI() {
  const on = !!window._THINKING_ENABLED;
  const btn = document.getElementById('thinking-btn');
  if (!btn) return;
  btn.classList.toggle('active', on);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.title = on ? 'Deep thinking is ON — click to disable' : 'Deep thinking is OFF — click to enable';
  syncToolsIndicator();
}

function toggleThinkingQuick() {
  const next = !window._THINKING_ENABLED;
  window._THINKING_ENABLED = next;
  const s = loadSettings();
  s.thinking_enabled = next;
  saveSettings(s);
  syncThinkingUI();
  showToast(
    next ? 'Deep thinking enabled' : 'Thinking off — faster replies',
    next ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a5 5 0 0 0-5 5c0 1.5.5 2.5 1 3.5.5 1 1 2 1 3.5h6c0-1.5.5-2.5 1-3.5.5-1 1-2 1-3.5a5 5 0 0 0-5-5z"/><path d="M9 21h6"/><path d="M10 18h4"/></svg>' : null
  );
}

// Applies thinking on/off to the request payload for Qwen3-family models.
// Both signals are Ollama/Qwen specific, so they only go to endpoints that have
// identified themselves as Ollama (see isOllamaEndpoint in app/models.js):
//   - chat_template_kwargs is not an OpenAI field. Ollama ignores unknown fields,
//     but cloud providers validate the body strictly and answer 400 Bad Request,
//     which killed every message sent to an added API endpoint.
//   - /think and /no_think are Qwen chat-template tokens. Anywhere else they are
//     just stray text pasted onto the user's question.
function applyThinkingSwitch(payload) {
  if (!isOllamaEndpoint(window.ACTIVE_BASE, window.ACTIVE_KIND)) return;
  const on = !!window._THINKING_ENABLED;
  payload.chat_template_kwargs = { enable_thinking: on };
  const msgs = payload.messages;
  if (msgs && msgs.length) {
    const last = msgs[msgs.length - 1];
    if (last && last.role === 'user') {
      last.content += on ? '\n\n/think' : '\n\n/no_think';
    }
  }
}

// Query Tavily and return its JSON ({ answer, results } on success, { error } on failure).
async function performWebSearch(query) {
  const key = (window._TAVILY_KEY || '').trim();
  if (!key) return { error: 'no-key' };
  try {
    const resp = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: key,
        query,
        max_results: 3,
        search_depth: 'basic',
        include_answer: true
      })
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (e) {
    console.error('[web search] failed:', e);
    return { error: e.message || 'request-failed' };
  }
}

// Turn a Tavily response into a grounding block injected just before the user's
// question. Wording is deliberately forceful so even small models trust the
// results over their (possibly stale) memory. Returns '' if nothing usable.
function buildWebSearchBlock(sr) {
  if (!sr || !Array.isArray(sr.results) || !sr.results.length) return '';
  const results = sr.results.slice(0, 3);
  let block = 'IMPORTANT: Answer using ONLY the web search results below. They were fetched just now and are current and authoritative. '
    + 'They OVERRIDE your own prior knowledge — if a result contradicts what you remember, the result is correct and your memory is outdated. '
    + 'Do NOT answer from memory. Cite sources inline like [1]. If the results do not contain the answer, say so plainly instead of guessing.\n\n'
    + '=== WEB SEARCH RESULTS ===\n';
  if (sr.answer) block += `Summary: ${sr.answer}\n\n`;
  results.forEach((r, i) => {
    block += `[${i + 1}] ${r.title || 'Untitled'} (${r.url || ''})\n${(r.content || '').trim()}\n\n`;
  });
  block += '=== END WEB SEARCH RESULTS ===';
  return block;
}

async function sendMessage() {
  if (isStreaming) return;
  const input = document.getElementById('message-input');
  const text = input.value.trim();
  if (!text) return;

  // No model selected → teach the user what to do (keeps their typed message).
  if (!ensureModelSelected()) return;

  input.value = '';
  input.style.height = 'auto';
  _userCancelled = false;
  _streamAbort = new AbortController();
  setSendMode(true);   // button becomes a Stop button
  isStreaming = true;

  // Ensure a session exists
  if (!currentSessionId) createSession();
  const session = getCurrentSession();

  const userTime = getTime();
  appendUserMessage(text);
  messages.push({ role: 'user', content: text });
  if (session) session.displayMessages.push({ role: 'user', content: text, time: userTime });

  appendTypingIndicator();
  updateThinkingStep('context', 'active', 'Building context...');
  if (window._setEduCard) window._setEduCard('<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>', 'Assembling your conversation history and system instructions into a single prompt for the model...');

  const _runtimeName      = window._AI_NAME_ACTIVE || AI_NAME;
  const _runtimeTone      = (window._AI_TONE_ACTIVE !== undefined ? window._AI_TONE_ACTIVE : AI_TONE);
  const _runtimeKnowledge = window._AI_KNOWLEDGE_ACTIVE || '';
  const _basePrompt = _runtimeTone ||
    `You are ${_runtimeName} — an open source AI assistant built by the Filipino developer community. You run locally via Ollama and Qwen on school lab hardware. Help with programming, open source, AI/ML, local LLM setup, and Filipino tech topics. Be friendly and practical. You may use Filipino/Taglish warmth but stay clear and technical when needed.`;
  const _focusRule = `\n\n## Answer Scope Rule (strict)\nAnswer ONLY what the user explicitly asked for. Do not add adjacent, related, or "bonus" information unless the user asked for it.\n- If the user says "list my projects only", return ONLY projects — no education, no skills, no certifications, no closing offers to add more.\n- If the user asks "what is X", define X — do not also explain Y and Z.\n- If the user asks for a list of N items, return exactly that list — no preamble like "Sure, here's a summary…" and no trailing "If you want, I can also…".\n- Treat words like "only", "just", "specifically" as hard filters. Everything outside that filter must be excluded even if it seems helpful.\n- When information is missing from the provided reference material to answer the exact question, say so briefly instead of substituting related information.\n- Prefer short, direct answers over comprehensive ones. Brevity = accuracy here.`;
  const _languageChoice = window._REPLY_LANG_ACTIVE || 'english';
  const _languageRule = buildLanguageRule(_languageChoice);
  let systemPrompt = _runtimeKnowledge
    ? `${_basePrompt}${_focusRule}${_languageRule}\n\n## Your Knowledge & Abilities\n${_runtimeKnowledge}`
    : `${_basePrompt}${_focusRule}${_languageRule}`;

  const _trainingFiles = Array.isArray(window._TRAINING_FILES_ACTIVE) ? window._TRAINING_FILES_ACTIVE : [];
  const _trainingNotes = window._TRAINING_NOTES_ACTIVE || '';
  let _retrievedCount = 0, _totalChunkCount = 0;
  if (_trainingFiles.length || _trainingNotes) {
    let trainingBlock = '\n\n## Training Reference Material\nThe user has provided the following reference material. Use it as authoritative background knowledge when relevant.\n';
    if (_trainingNotes) trainingBlock += `\n### Instructions\n${_trainingNotes}\n`;

    // Retrieval: score every chunk against the user's message via TF-IDF +
    // cosine similarity (plain JS, no embedding model/network call) and keep
    // only the top-K most relevant, instead of dumping whole files.
    const allChunks = [];
    for (const f of _trainingFiles) {
      const fileChunks = (f.chunks && f.chunks.length) ? f.chunks : window.BarangayRAG.chunkText(f.content);
      for (const chunkStr of fileChunks) allChunks.push({ file: f.name, text: chunkStr });
    }
    _totalChunkCount = allChunks.length;

    if (allChunks.length) {
      const top = window.BarangayRAG.retrieveTopChunks(text, allChunks);
      _retrievedCount = top.length;
      for (const c of top) {
        trainingBlock += `\n### From: ${c.file}\n${c.text}\n`;
      }
    }
    systemPrompt += trainingBlock;
  }

  if (_trainingFiles.length || _trainingNotes) {
    const fileCount = _trainingFiles.length;
    const noteLabel = _trainingNotes ? ' + notes' : '';
    const chunkLabel = _totalChunkCount ? ` · ${_retrievedCount}/${_totalChunkCount} chunks retrieved` : '';
    updateThinkingStep('files', 'done', `Knowledge base loaded · ${fileCount} file${fileCount !== 1 ? 's' : ''}${noteLabel}${chunkLabel}`);
    if (window._setEduCard) window._setEduCard('<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>', `${fileCount} knowledge file${fileCount !== 1 ? 's' : ''}${noteLabel} loaded — retrieved the ${_retrievedCount} most relevant chunk${_retrievedCount !== 1 ? 's' : ''} (of ${_totalChunkCount}) via keyword matching for this question.`);
  }
  updateThinkingStep('context', 'done', 'Context ready');

  // ── Web search augmentation (Tavily) ─────────────────────────────────
  let _webSources = [];   // populated when a search returns results → rendered under the answer
  let _webContext = '';   // grounding block injected just before the user's question
  if (window._WEB_SEARCH_ENABLED && (window._TAVILY_KEY || '').trim()) {
    window._thinkingLabelOverride = 'Searching the web';   // pin the rotating loading label
    updateThinkingStep('websearch', 'active', 'Searching the web…');
    if (window._setEduCard) window._setEduCard('<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18"/></svg>', 'Web search is on — querying Tavily for fresh information, then feeding the top results to the model as context.');
    const sr = await performWebSearch(text);
    window._thinkingLabelOverride = null;   // back to the normal phrases for generation
    const webBlock = buildWebSearchBlock(sr);
    if (webBlock) {
      _webContext = webBlock;
      _webSources = sr.results.slice(0, 3).map(r => ({ title: r.title, url: r.url }));
      updateThinkingStep('websearch', 'done', `Web search · ${_webSources.length} source${_webSources.length !== 1 ? 's' : ''}`);
    } else if (sr && sr.error) {
      updateThinkingStep('websearch', 'error', sr.error === 'no-key' ? 'Web search skipped — no API key' : 'Web search failed — answering without it');
    } else {
      updateThinkingStep('websearch', 'done', 'Web search · no results');
    }
  }

  if (_modelWarm) {
    updateThinkingStep('model', 'active', `Sending to ${window.ACTIVE_MODEL}...`);
    if (window._setEduCard) window._setEduCard('<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>', `${window.ACTIVE_MODEL} is already loaded in memory. Sending your prompt and streaming tokens back to the browser now...`);
  } else {
    updateThinkingStep('model', 'active', `Loading model from disk · ${window.ACTIVE_MODEL}...`);
    if (window._setEduCard) window._setEduCard('<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>', `First request — loading ${window.ACTIVE_MODEL} from disk into RAM. This takes a few seconds the first time. After this, all replies will be much faster.`);
  }

  // Apply prefix / suffix to the message sent to the model (history stays clean)
  const _prefix = window._PROMPT_PREFIX_ACTIVE || '';
  const _suffix = window._PROMPT_SUFFIX_ACTIVE || '';
  let _outgoing = messages;
  if (_prefix || _suffix || _webContext) {
    _outgoing = messages.slice();
    const lastUser = _outgoing.length - 1;
    if (lastUser >= 0 && _outgoing[lastUser].role === 'user') {
      // Web context goes first (strongest grounding), then prefix, then the question.
      _outgoing[lastUser] = {
        ..._outgoing[lastUser],
        content: `${_webContext ? _webContext + '\n\n' : ''}${_prefix ? _prefix + '\n\n' : ''}${_outgoing[lastUser].content}${_suffix ? '\n\n' + _suffix : ''}`
      };
    }
  }

  const _temperature = (typeof window._TEMPERATURE_ACTIVE === 'number') ? window._TEMPERATURE_ACTIVE : 0.3;
  const payload = {
    model: window.ACTIVE_MODEL,
    messages: [{ role: 'system', content: systemPrompt }, ..._outgoing],
    temperature: _temperature
  };
  // _MAX_TOKENS_ACTIVE === null means "No limit" → omit the cap entirely
  if (window._MAX_TOKENS_ACTIVE !== null) {
    payload.max_tokens = (typeof window._MAX_TOKENS_ACTIVE === 'number') ? window._MAX_TOKENS_ACTIVE : 1024;
  }
  applyThinkingSwitch(payload);

  const startTime = Date.now();

  // ── Streaming attempt ────────────────────────────────────────────────
  try {
    const response = await fetch(`${window.ACTIVE_BASE}/chat/completions`, {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${window.ACTIVE_KEY}`,
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify({ ...payload, stream: true, stream_options: { include_usage: true } }),
      signal: _streamAbort.signal
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const chatArea = document.getElementById('chat-area');
    const row = document.createElement('div');
    row.className = 'message-row';
    const avatarDiv = document.createElement('div');
    avatarDiv.className = 'avatar ai';
    avatarDiv.textContent = getAIAvatar();
    const bubble = document.createElement('div');
    bubble.className = 'bubble ai';
    bubble.id = 'ai-bubble-latest';
    row.appendChild(avatarDiv);
    row.appendChild(bubble);

    // Headers arriving doesn't mean the model has produced anything yet — for a big
    // model, prompt-eval + first-token latency can be several seconds. Keep the
    // "Thinking…" indicator up until the first real token streams in, instead of
    // swapping to an empty bubble that just looks like the app went quiet.
    let _revealed = false;
    const revealBubble = () => {
      if (_revealed) return;
      _revealed = true;
      removeTypingIndicator();
      chatArea.appendChild(row);
      scrollToBottom();
    };

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let firstTokenAt = null;   // timestamp of first streamed token → prep/TTFT
    let completionTokens = null;
    let promptTokens = null;
    let finishReason = null;
    let _usingReasoningField = false; // true if model sends reasoning_content separately
    let _dbgChunk = 0;
    let _lastRenderAt = 0;
    const RENDER_THROTTLE_MS = 60; // cap re-render rate so long streams don't reparse markdown on every token

    let cancelled = false;
    try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') break;
        try {
          const parsed = JSON.parse(data);
          if (_dbgChunk++ < 3) console.log('[stream delta]', JSON.stringify(parsed.choices?.[0]?.delta));
          if (parsed.usage) {
            completionTokens = parsed.usage.completion_tokens ?? completionTokens;
            promptTokens = parsed.usage.prompt_tokens ?? promptTokens;
          }
          if (parsed.choices?.[0]?.finish_reason) finishReason = parsed.choices[0].finish_reason;
          const rc = parsed.choices?.[0]?.delta?.reasoning_content;
          const cc = parsed.choices?.[0]?.delta?.content;
          let delta = '';
          if (rc) {
            _usingReasoningField = true;
            if (!fullText.includes('<think>')) fullText += '<think>';
            delta = rc;
          } else if (cc) {
            // Only auto-close if WE synthesized the <think> tag via reasoning_content
            if (_usingReasoningField && fullText.includes('<think>') && !fullText.includes('</think>')) {
              fullText += '</think>';
            }
            delta = cc;
          }
          if (delta) {
            if (firstTokenAt === null) { firstTokenAt = Date.now(); revealBubble(); }
            fullText += delta;
            // Full markdown re-parse is O(current length) — reformatting on every single
            // token turns a long stream into O(n^2) work and stalls the main thread until
            // the whole reply "dumps" at once. Cap how often we actually repaint.
            const now = Date.now();
            if (now - _lastRenderAt >= RENDER_THROTTLE_MS) {
              _lastRenderAt = now;
              const tp = parseThinkDisplay(fullText);
              if (tp.think) {
                renderThinkInBubble(bubble, tp.think, tp.display, tp.partial ?? true);
              } else {
                bubble.innerHTML = formatContent(fullText);
              }
              scrollToBottom();
            }
          }
        } catch (e) { if (_dbgChunk++ < 6) console.error('[stream parse error]', e.message, data?.slice(0, 120)); }
      }
    }
    } catch (readErr) {
      // Stop button aborts the reader — handle gracefully; rethrow real errors.
      if (_userCancelled || readErr.name === 'AbortError') cancelled = true;
      else throw readErr;
    }

    // Guarantee the indicator is cleared and the bubble is on-screen even if the
    // model never emitted a single token (empty response, or cancelled that early).
    revealBubble();

    // If model used reasoning_content but never closed <think>, force-close so the block renders
    if (fullText.includes('<think>') && !fullText.includes('</think>')) {
      fullText += '</think>';
    }

    // Render is throttled during streaming, so the last chunk (and the think-closed
    // state) may not have painted yet — always do one final unthrottled render here.
    if (fullText) {
      const tpFinal = parseThinkDisplay(fullText);
      if (tpFinal.think) {
        renderThinkInBubble(bubble, tpFinal.think, tpFinal.display, false);
      } else {
        bubble.innerHTML = formatContent(fullText);
      }
    }

    // True when the model spent its whole turn on reasoning_content and never emitted
    // any real content — e.g. a reasoning model whose max_tokens cap ran out mid-think.
    const thinkOnly = fullText.includes('<think>') && !parseThinkDisplay(fullText).display;

    if (!fullText && !cancelled) {
      bubble.innerHTML = '<em style="color:var(--text-muted)">No response received.</em>';
      // Remove the user message so this failed turn doesn't poison history
      messages.pop();
      if (session && session.displayMessages.length) session.displayMessages.pop();
    } else if (thinkOnly && !cancelled) {
      // Popping the answerless turn happens below (savedContent is empty, so the
      // existing "model only generated thinking" branch at the bottom handles it).
      const note = document.createElement('div');
      note.style.cssText = 'color:var(--text-muted);font-style:italic;margin-top:6px;font-size:13px';
      note.textContent = (finishReason === 'length')
        ? `The model used its entire${window._MAX_TOKENS_ACTIVE ? ` ${window._MAX_TOKENS_ACTIVE}-token` : ''} limit thinking and didn't get to answer. Try raising the token limit or setting it to "No limit".`
        : "The model finished thinking but didn't produce an answer.";
      bubble.appendChild(note);
    }

    // Show the cancellation note (after any partial answer the model managed to stream).
    if (cancelled) bubble.appendChild(cancelledNoteEl());

    // Attach the web-search source links under the answer (when this turn used search).
    if (!cancelled && fullText && _webSources.length) {
      const srcEl = buildSourcesEl(_webSources);
      if (srcEl) bubble.appendChild(srcEl);
    }

    const aiTime = getTime();
    const timeDiv = document.createElement('div');
    timeDiv.className = 'message-time';
    timeDiv.textContent = aiTime;
    chatArea.appendChild(timeDiv);
    const prepMs = (firstTokenAt != null) ? (firstTokenAt - startTime) : null;
    const stats = appendMsgMeta(chatArea, Date.now() - startTime, completionTokens, fullText, promptTokens, prepMs);

    const savedContent = fullText.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    if (cancelled) {
      // Cancelled turns stay visible but are excluded from the model's context.
      messages.pop();   // remove the unanswered user turn we pushed at send start
      if (session) session.displayMessages.push({ role: 'assistant', content: savedContent + CANCEL_MARK, time: aiTime, stats, cancelled: true });
    } else if (savedContent) {
      messages.push({ role: 'assistant', content: savedContent });
      if (session) session.displayMessages.push({ role: 'assistant', content: savedContent, time: aiTime, stats, sources: _webSources.length ? _webSources : undefined });
    } else if (fullText) {
      // model only generated thinking — pop the user message so history stays consistent
      messages.pop();
      if (session && session.displayMessages.length) session.displayMessages.pop();
    }
    updateHistory(text);
    setConnected(true);
    _modelWarm = true;

  } catch (streamErr) {
    removeTypingIndicator();

    // User pressed Stop before any tokens streamed → show the note, skip fallback.
    if (_userCancelled || streamErr.name === 'AbortError') {
      const ca = document.getElementById('chat-area');
      const row = document.createElement('div');
      row.className = 'message-row';
      row.innerHTML = `<div class="avatar ai">${getAIAvatar()}</div><div class="bubble ai"></div>`;
      row.querySelector('.bubble').appendChild(cancelledNoteEl());
      ca.appendChild(row);
      messages.pop();   // drop the unanswered user turn from API context
      if (session) session.displayMessages.push({ role: 'assistant', content: CANCEL_MARK, time: getTime(), cancelled: true });
      scrollToBottom();
      return;
    }

    // ── Non-streaming fallback ───────────────────────────────────────
    try {
      const res2 = await fetch(`${window.ACTIVE_BASE}/chat/completions`, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${window.ACTIVE_KEY}` },
        body: JSON.stringify({ ...payload, stream: false })
      });

      if (!res2.ok) throw new Error(`HTTP ${res2.status}: ${await res2.text()}`);

      const data = await res2.json();
      const aiText = data.choices?.[0]?.message?.content || 'No response.';
      const aiTime = getTime();
      appendAIMessage(aiText);
      const fallbackTokens = data.usage?.completion_tokens ?? data.usage?.total_tokens ?? null;
      const stats = appendMsgMeta(document.getElementById('chat-area'), Date.now() - startTime, fallbackTokens, aiText, data.usage?.prompt_tokens ?? null);
      messages.push({ role: 'assistant', content: aiText });
      if (session) session.displayMessages.push({ role: 'assistant', content: aiText, time: aiTime, stats });
      updateHistory(text);
      setConnected(true);
      _modelWarm = true;

    } catch (fetchErr) {
      // ── XHR last resort ─────────────────────────────────────────
      const msg = fetchErr.message || '';
      let errorData = {};

      // Every diagnosis below tells the reader to open a terminal and
      // restart Ollama — correct for a student on their own machine, and
      // useless to a visitor on someone's published link, who has neither.
      // Visitors get one honest message aimed at the only person who can
      // actually fix it: the owner.
      if (window.IS_VISITOR) {
        const unconfigured = msg.includes('model_not_configured') || msg.includes('503');
        errorData = unconfigured
          ? {
              title: 'This AI has no model connected yet',
              desc: 'Everything about this AI — its name, personality, and knowledge — is set up and ready. It just hasn\'t been given a model to think with, so it can\'t reply yet. Only its owner can finish that step.',
              steps: [
                { text: 'If this is your AI: on Vercel, open Settings → Environment Variables' },
                { text: 'Add MODEL_API_KEY with a key from console.groq.com (free, no card), then redeploy' },
                { text: 'If it isn\'t yours: let whoever shared the link know — it\'s a two-minute fix' },
              ],
            }
          : {
              title: 'The AI couldn\'t be reached',
              desc: 'The request to this AI\'s model didn\'t come back. It may be briefly overloaded, or its owner\'s free quota may be used up for now.',
              steps: [
                { text: 'Wait a few seconds and send your message again' },
                { text: 'If it keeps failing, let whoever shared this link know' },
              ],
            };
        removeTypingIndicator();
        renderErrorBubble(errorData);
        setConnected(false);
        return;
      }

      // Which endpoint just failed decides which advice is true. Everything
      // below the cloud branch assumes a local Ollama the reader can restart.
      const _isCloud = window.ACTIVE_KIND === 'api';
      const _http = parseHttpError(msg);

      if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('CORS') || msg.includes('Load failed')) {
        try {
          const xhrResult = await xhrFallback(payload);
          removeTypingIndicator();
          const xhrTime = getTime();
          appendAIMessage(xhrResult);
          const stats = appendMsgMeta(document.getElementById('chat-area'), Date.now() - startTime, null, xhrResult);
          messages.push({ role: 'assistant', content: xhrResult });
          if (session) session.displayMessages.push({ role: 'assistant', content: xhrResult, time: xhrTime, stats });
          updateHistory(text);
          setConnected(true);
          _modelWarm = true;
          isStreaming = false;
          setSendMode(false);
          document.getElementById('message-input').focus();
          return;
        } catch {
          errorData = _isCloud ? cloudErrorCard(null, '') : {
            title: "Ollama isn't allowing browser requests",
            desc: "The AI model is running but your browser can't reach it because of a security setting. This is a one-line fix.",
            steps: [
              { text: 'In a terminal, from the project folder, run:', code: OLLAMA_SCRIPT_CMD },
              { text: 'That stops and restarts Ollama correctly. Or do it by hand in one line:', code: OLLAMA_RESTART_CMD },
              { text: 'Wait a few seconds, then try sending your message again' },
              { text: 'Tired of doing this? Set it once and forget it:', code: OLLAMA_PERSIST_CMD },
            ],
            cta: true,
            guidePage: 4,   // Run it locally — start Ollama + connect
            ctaLabel: 'Open the setup guide',
          };
        }
      } else if (_isCloud) {
        errorData = cloudErrorCard(_http.status, _http.detail);
      } else if (msg.includes('401')) {
        errorData = {
          title: "Ollama rejected the connection",
          desc: "Authorization error. Restart Ollama with the correct settings.",
          steps: [
            { text: 'Open a terminal and run:', code: OLLAMA_START_CMD },
            { text: 'Refresh this page and try again' }
          ],
          cta: true,
          guidePage: 4,   // Run it locally — start Ollama + connect
          ctaLabel: 'Open the setup guide',
        };
      } else if (msg.includes('404')) {
        errorData = {
          title: "Model not found",
          desc: "Ollama is running but can't find the Qwen model.",
          steps: [
            { text: 'Open a terminal and run:', code: 'ollama list' },
            { text: 'If qwen2.5:3b is missing, pull it:', code: 'ollama pull qwen2.5:3b' },
            { text: 'Try again once the model finishes loading' }
          ],
          cta: true,
          guidePage: 2,   // Pre-install — install Ollama + pull a model
          ctaLabel: 'How to install a model',
        };
      } else if (msg.includes('500') || msg.includes('502') || msg.includes('503')) {
        errorData = {
          title: "The AI model crashed or is overloaded",
          desc: "Ollama returned a server error — the model may still be loading or your machine ran out of memory.",
          steps: [
            { text: 'Wait 10–15 seconds and try again' },
            { text: 'Try the lighter model:', code: 'ollama run qwen3.5:0.8b' },
            { text: 'Restart Ollama:', code: OLLAMA_START_CMD }
          ],
          cta: true,
          guidePage: 1,   // Models 101 — pick a lighter model that fits
          ctaLabel: 'Find a lighter model',
        };
      } else if (msg.includes('ERR_CONNECTION_REFUSED') || msg.includes('ECONNREFUSED')) {
        errorData = {
          title: "Ollama is not running",
          desc: "Nothing is listening at the AI address. Start Ollama first.",
          steps: [
            { text: 'In a terminal, from the project folder, run:', code: OLLAMA_SCRIPT_CMD },
            { text: 'Or start it by hand:', code: OLLAMA_START_CMD },
            { text: 'Leave that window open, then try again' },
            { text: 'If it says the port is already in use, free it first:', code: OLLAMA_STOP_CMD },
          ],
          cta: true,
          guidePage: 4,   // Run it locally — start Ollama + connect
          ctaLabel: 'Open the setup guide',
        };
      } else {
        errorData = {
          title: "Something went wrong",
          desc: "The AI couldn't be reached. Try these fixes one by one.",
          steps: [
            { text: 'Make sure Ollama is running:', code: OLLAMA_START_CMD },
            { text: 'Check the model is installed:', code: 'ollama list' },
            { text: 'Try the API directly in your browser:', code: 'localhost:11434/v1/models' },
            { text: 'If nothing works, raise your hand — your facilitator can help' }
          ],
          cta: true,
          guidePage: 4,   // Run it locally — start Ollama + connect
          ctaLabel: 'Open the setup guide',
        };
      }

      removeTypingIndicator();
      renderErrorBubble(errorData);
      setConnected(false);
    }
  } finally {
    isStreaming = false;
    _streamAbort = null;
    setSendMode(false);
    document.getElementById('message-input').focus();
  }
}

