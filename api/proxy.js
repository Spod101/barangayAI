// ── HOSTED MODEL PROXY (Vercel serverless function) ──────────────────
// Only used by PUBLISHED copies of the app. Locally the browser talks to
// Ollama directly and this file never runs.
//
// Why it exists: a published site needs an API key to reach a hosted
// model, and a key in the repo is a key on GitHub — scrapers find those
// within hours. So the key lives in a Vercel environment variable, the
// browser only ever calls same-origin /api, and the key stays server-side.
// Same-origin also means no CORS setup for visitors, ever.
//
// Set on Vercel → Settings → Environment Variables:
//   MODEL_API_KEY   (required)  your OWN provider key, e.g. a free Groq key.
//                               Every visitor's message spends your allowance.
//   MODEL_API_BASE  (optional)  defaults to Groq
//   MODEL_NAME      (optional)  defaults to a small fast Groq model
// The one-variable path is the taught one: set MODEL_API_KEY, redeploy, done.
// ─────────────────────────────────────────────────────────────────────

const DEFAULT_BASE  = 'https://api.groq.com/openai/v1';
const DEFAULT_MODEL = 'llama-3.1-8b-instant';

// This endpoint is public and unauthenticated — anyone with the URL can
// spend the owner's own quota. The key is theirs, created on their own
// provider account; visitors never see it and never pay for it. These caps
// are what keep a shared link from turning into a bill: the client cannot
// pick a pricier model, cannot ask for a huge completion, and cannot send
// an enormous prompt.
const MAX_TOKENS_CAP = 512;
const MAX_BODY_BYTES = 128 * 1024;

function config() {
  return {
    base: (process.env.MODEL_API_BASE || DEFAULT_BASE).replace(/\/+$/, ''),
    key: process.env.MODEL_API_KEY || '',
    model: process.env.MODEL_NAME || DEFAULT_MODEL,
  };
}

// Reported to the app as an ordinary /v1/models response so the existing
// discovery code (app/models.js) needs no special case, and the header
// chip shows whatever model the owner actually configured.
function sendModels(res, cfg) {
  res.status(200).json({ object: 'list', data: [{ id: cfg.model, object: 'model', owned_by: 'published' }] });
}

// Numeric knobs the app exposes in Settings → Model that every
// OpenAI-compatible provider accepts. Anything not named here never reaches
// upstream — see buildPayload.
const PASSTHROUGH_NUMBERS = ['temperature', 'top_p', 'presence_penalty', 'frequency_penalty', 'seed'];

// role + content only. Extra per-message fields are dropped on purpose:
// `messages[].name`, for one, is a documented 400 on Groq.
function sanitizeMessages(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const m of input) {
    if (!m || typeof m.role !== 'string' || typeof m.content !== 'string') continue;
    out.push({ role: m.role, content: m.content });
  }
  return out;
}

// The client body is advisory, and on a published site it is also untrusted:
// it can come from a stale cached copy of the app, a visitor's older deploy, or
// anyone poking /api directly. Forwarding it verbatim is what broke published
// chat — the app used to attach chat_template_kwargs, an Ollama-only field, and
// providers answer 400 Bad Request for fields they do not recognise. So the
// upstream request is rebuilt from an allowlist rather than spread from input,
// which also means a future client-side option cannot silently break every
// published site until it is added here deliberately.
function buildPayload(body, cfg) {
  const requested = Number(body.max_tokens);
  const payload = {
    // The owner's env vars decide the model and the ceiling, not the client.
    model: cfg.model,
    messages: sanitizeMessages(body.messages),
    max_tokens: Number.isFinite(requested)
      ? Math.max(1, Math.min(Math.floor(requested), MAX_TOKENS_CAP))
      : MAX_TOKENS_CAP,
  };
  for (const k of PASSTHROUGH_NUMBERS) {
    const n = Number(body[k]);
    if (body[k] !== undefined && body[k] !== null && Number.isFinite(n)) payload[k] = n;
  }
  if (body.stream === true) {
    payload.stream = true;
    if (body.stream_options && typeof body.stream_options === 'object') {
      payload.stream_options = { include_usage: body.stream_options.include_usage === true };
    }
  }
  if (typeof body.stop === 'string') payload.stop = body.stop;
  else if (Array.isArray(body.stop)) {
    const stops = body.stop.filter(s => typeof s === 'string').slice(0, 4);
    if (stops.length) payload.stop = stops;
  }
  return payload;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body) return resolve(req.body);   // already parsed by the runtime
    let size = 0;
    const parts = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { reject(new Error('body too large')); req.destroy(); return; }
      parts.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8') || '{}')); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  const cfg = config();
  const what = (req.query && req.query.p) || 'chat';

  // Unconfigured is the single most likely state for a fresh deploy (the
  // student pushed before adding the key), so it gets a message the app
  // can show a human rather than a raw network failure.
  if (!cfg.key) {
    res.status(503).json({
      error: {
        message: 'This AI has no model connected yet. The owner needs to add a MODEL_API_KEY environment variable on Vercel and redeploy.',
        code: 'model_not_configured',
      },
    });
    return;
  }

  if (what === 'models') {
    sendModels(res, cfg);
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: { message: 'Method not allowed' } });
    return;
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    res.status(413).json({ error: { message: 'Request too large' } });
    return;
  }

  const payload = buildPayload(body, cfg);

  // Catch this here rather than letting the provider answer 400 — upstream's
  // wording would surface to the visitor as an unexplained failure.
  if (!payload.messages.length) {
    res.status(400).json({
      error: { message: 'No messages to send.', code: 'no_messages' },
    });
    return;
  }

  try {
    const upstream = await fetch(`${cfg.base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.key}`,
      },
      body: JSON.stringify(payload),
    });

    res.status(upstream.status);
    const type = upstream.headers.get('content-type') || 'application/json';
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'no-store');

    if (!upstream.body) {
      res.end(await upstream.text());
      return;
    }

    // Pass the SSE stream straight through, unbuffered, so replies appear
    // word by word exactly as they do against a local Ollama — the client
    // parser in app/chat.js sees the same shape either way.
    const reader = upstream.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (err) {
    res.status(502).json({
      error: { message: 'Could not reach the model provider. Check the key and try again.', detail: String(err && err.message || err) },
    });
  }
};
