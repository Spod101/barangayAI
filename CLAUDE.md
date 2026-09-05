# Barangay AI

Fully client-side AI chat app (DEVCON.PH). Vanilla JS, no build step, no framework,
no bundler, no npm. Edit a file, refresh the tab.

## Running it

```bash
./start-ollama.sh        # macOS/Linux — or .\start-ollama.cmd on Windows
python -m http.server 8000
```

`file://` does not work — scripts are separate files and browsers block them at
that origin. `api/proxy.js` is a Vercel function and never runs under
`python -m http.server`; use `npx vercel dev` to exercise the published path.

There is no test suite. Verification is manual — send a message, reload to check
IndexedDB persistence, check dark mode and a ~375px viewport for visual changes.

## Layout

| Path | Role |
|---|---|
| `index.html` | markup only |
| `styles.css` | all CSS |
| `app/*.js` | app logic, split by feature |
| `db.js` | SQLite persistence (sql.js + IndexedDB) |
| `rag.js` | chunking + BM25 retrieval, no embedding model |
| `sw.js` | service worker, precaches the app shell |
| `api/proxy.js` | Vercel function — hosted-model proxy for published copies |
| `vendor/` | sql.js, pdf.js, mammoth.js, fonts — committed, never CDN |

`app/` load order (`<script>` tags in `index.html`, dependency order):
`config.js` → `sessions.js` → `settings.js` → `training.js` → `onboarding.js` →
`models.js` → `chat.js` → `actions.js` → `thinking.js` → `publish.js` → `init.js`.

## Invariants

- **Offline is the product.** A change that needs the internet to hold a
  conversation does not ship. Nothing loads from a CDN.
- **A new `app/` file needs three edits:** the `<script>` tag in `index.html`
  (right position), the `PRECACHE` list in `sw.js`, and a `CACHE_VERSION` bump.
  A 404 in `PRECACHE` fails the whole install and silently kills the offline shell.
- **Any shell file change needs a `CACHE_VERSION` bump** in `sw.js`, or returning
  users keep the cached build.
- **Defaults live in the CONFIG block** at the top of `app/config.js`. Don't
  scatter constants.
- **A new model-request field needs two edits:** the payload in `sendMessage`
  (`app/thinking.js`) *and* `buildPayload` in `api/proxy.js`, which rebuilds the
  upstream request from named fields because that endpoint is public. Miss the
  second and it works locally and vanishes on every published site.
- **Ollama-only fields go behind `isOllamaEndpoint`** (`applyThinkingSwitch` in
  `app/thinking.js`). Ollama ignores unknown fields; hosted providers 400.
- **Model-specific text goes behind `supportsThinkingTokens`** (`app/models.js`),
  not an endpoint check. `/think` and `/no_think` are Qwen3/QwQ chat-template
  tokens — Gemma, Llama, Mistral, Phi and Qwen 2.5 all pass `isOllamaEndpoint`
  and would receive them as literal text.
- **Never commit** an API key, `.env`, or your own `my-ai.json`.

## Modes

- **Local** — browser talks to Ollama directly. The private, offline one.
- **Visitor** (`?visitor=1` with `my-ai.json` present) — settings locked down,
  model requests go same-origin through `/api` to a hosted provider.

Test visitor mode after touching publishing or settings; test a fresh browser
profile after touching onboarding or the seeded Source.

## Copy

User-facing text reads plainly for non-developers. Filipino, Bisaya, Hiligaynon
and Ilocano prompts exist in `app/settings.js` — flag native-speaker review.
Comments explain *why*, not what the code does.
