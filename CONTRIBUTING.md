# Contributing to Barangay AI

Thanks for wanting to help. This project exists so people at DEVCON camps and in barangays can run their own private AI — contributions that make it simpler, faster on low-end laptops, or friendlier in Filipino languages are especially welcome.

No build step, no framework, no bundler. If you can edit a file and refresh a browser tab, you can contribute.

---

## Before you start

- **Small fixes** — typos, a broken link, a CSS nudge — just open a pull request. No need to ask first.
- **Anything bigger** — a new feature, a UI rework, a change to how sources or publishing work — **open an issue first** and describe what you're after. It saves you building something that doesn't fit the direction of the project.
- **Bugs** — open an issue with your OS, browser, the model you were running, and what you expected to happen.

---

## The workflow

`main` is protected: nobody pushes to it directly, including the maintainer. Every change lands through a pull request.

1. **Fork** [`Spod101/barangayAI`](https://github.com/Spod101/barangayAI) (Fork button, top-right on GitHub), then clone your fork:

   ```bash
   git clone https://github.com/YOUR-USERNAME/barangayAI.git
   cd barangayAI
   ```

2. **Branch** off `main`. Name it after what it does:

   ```bash
   git checkout -b fix/mobile-composer-overlap
   ```

   Prefixes in use: `feat/`, `fix/`, `refactor/`, `design/`, `docs/`, `chore/`.

3. **Make your change** and test it (see below).

4. **Commit** with a summary line that says what changed and, where it isn't obvious, why:

   ```
   fix: keep streaming UI responsive on long or large-model replies
   ```

   Imperative mood, no trailing period. A `feat:` / `fix:` / `docs:`-style prefix is welcome but not required.

5. **Push** to your fork and **open a pull request** against `Spod101/barangayAI` `main`.

6. A maintainer reviews it. Expect comments — they're about the code, not about you. Push follow-up commits to the same branch and the PR updates itself.

---

## Running it locally

Full setup is in the [README](README.md#quick-start). The short version:

```bash
# 1. start Ollama with browser access enabled
./start-ollama.sh          # macOS / Linux
.\start-ollama.cmd         # Windows (PowerShell)

# 2. serve the folder — file:// will not work, browsers block script loading there
python -m http.server 8000
# then open http://localhost:8000
```

You need at least one model pulled: `ollama pull qwen2.5:3b`.

---

## Testing your change

There is no test suite. Verification is manual, so please actually do it and say what you did in the PR:

- **Send a message** and confirm the reply streams in cleanly.
- **Reload the page** — sessions live in IndexedDB, and persistence bugs only show up after a refresh.
- **Check dark mode** and a **narrow viewport** (~375px) if you touched anything visual. The composer and sidebar are the usual casualties.
- **Check visitor mode** if you touched publishing or settings: drop a `my-ai.json` in the folder and open `?visitor=1`.
- **Try a fresh browser profile** (or clear site data) if you touched onboarding, the seeded Source, or first-run behaviour. Most of that code only runs once.

Screenshots or a short screen recording in the PR help a lot for visual changes.

---

## Code style

Match what's already there rather than importing your own conventions.

- **Vanilla JS, no dependencies.** The three CDN libraries (sql.js, pdf.js, mammoth.js) are the ceiling — please don't add a fourth without discussing it in an issue first. Anything that requires npm, a bundler, or a build step is out of scope for this project.
- **Script order matters.** `app/*.js` files load in dependency order via `<script>` tags in `index.html` — `config.js` first, `init.js` last. If you add a file, add its tag in the right spot.
- **One concern per file.** `app/` is split by feature; put new code where it belongs rather than growing `init.js`.
- **Comments explain *why*.** The existing comments are about intent and trade-offs, not restating the code. Follow that.
- **Defaults live in the CONFIG block** at the top of [`app/config.js`](app/config.js). Don't scatter new constants through the app.
- **Keep it working offline.** Local-first is the whole point — a change that requires an internet connection to chat will not be merged.

### Adding an option to the model request

Two things to know before you add a field to the body sent to the model.

**Published sites need the same field allowlisted.** [`api/proxy.js`](api/proxy.js) rebuilds the upstream request from named fields rather than forwarding what the browser sent, because that endpoint is public and unauthenticated. So a new option needs adding in **two** places — the payload in `sendMessage` ([`app/thinking.js`](app/thinking.js)) and `buildPayload` in the proxy — or it will work locally and silently vanish on every published site, which is a confusing afternoon to debug.

**Ollama-only fields must stay behind the Ollama check.** Ollama ignores request fields it doesn't recognise; hosted providers answer `400 Bad Request` for them. Anything outside the OpenAI chat-completions spec — `chat_template_kwargs`, Qwen's `/think` and `/no_think` — goes inside `applyThinkingSwitch`'s `isOllamaEndpoint` guard. Sending one to a cloud endpoint breaks every message to it, not just the feature you added.

### Copy and language

User-facing text should read plainly for someone who isn't a developer. If you touch the Filipino, Bisaya, Hiligaynon, or Ilocano prompts or UI copy and you're a native speaker — please say so in the PR. That's exactly the review the project can't do on its own.

---

## Never commit

- **API keys or `.env` files.** Public repos get scraped within hours. The hosted-model key belongs in a Vercel environment variable, read server-side by [`api/proxy.js`](api/proxy.js) — never in the repo.
- **Your own `my-ai.json`.** That file is for *your* published deployment, not for upstream.
- **`node_modules/`, editor folders, OS cruft.** Already covered by [`.gitignore`](.gitignore).
- **Large binaries.** Ask in an issue before adding anything over ~1&nbsp;MB.

---

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE), same as the rest of the project.
