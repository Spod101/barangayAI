# Barangay AI

A polished, fully client-side AI chat app by **DEVCON.PH** — built to run on top of a **local** large language model so anyone can have a private, offline-capable AI assistant. No accounts, no cloud, no server. Just a handful of files and your browser.

Built for DEVCON camps and barangay-level digital literacy: open one HTML file, point it at a local model, and start chatting — in English, Filipino, Taglish, or your own regional language.

**Repository:** [github.com/Spod101/barangayAI](https://github.com/Spod101/barangayAI)

---

## Features

- **Local-first AI chat** — talks to any OpenAI-compatible endpoint (designed for [Ollama](https://ollama.com) running on your own machine).
- **Conversation history** — multiple sessions, saved durably in your browser via SQLite (sql.js + IndexedDB). Your chats never leave your device.
- **Filipino language support** — reply in **English, Filipino (Tagalog), Taglish, Bisaya, Hiligaynon, or Ilocano**, with grammar rules tuned to keep responses natural and free of Indonesian/Malay contamination.
- **Customizable persona** — name your AI, pick a tone (friendly, formal, teacher, strict), or write your own system prompt. There's even an AI-assisted prompt expander.
- **Ground it on your docs** — upload `.txt`, `.md`, `.json`, `.csv`, `.log`, `.pdf`, or `.docx` files as knowledge the AI can draw on. Ships pre-loaded with a study guide so answers are grounded from the first run (removable like any other source).
- **Review Study Buddy** — the same AI, pointed the other way: it turns your Sources into flashcards, tags every card with its **Bloom's Taxonomy** level, then drills you with active recall and Leitner spacing. Per-level scoring turns the deck into a diagnosis — weak *Apply* and weak *Remember* need opposite fixes. See [Review Study Buddy](#review-study-buddy).
- **Shows its receipts** — every answer can show exactly which chunk of which of your files it used, the similarity score that earned each one its place in the prompt, and the **literal prompt that was sent to the model**. Retrieval is a mechanism you can inspect and tune, not a black box.
- **Works with the internet unplugged** — libraries and fonts are vendored, and a service worker precaches the whole app on first visit. After that the only thing that has to be reachable is your model, which is on your own machine.
- **Web search** — optional live web results via [Tavily](https://tavily.com) (bring your own API key).
- **Onboarding flow + Camp Guidebook** — a friendly first-run experience and an in-app guide.
- **Dark mode**, markdown rendering, streaming responses, context-usage stats, and a collapsible sidebar.

> **On "training":** nothing is fine-tuned. Your files are chunked, and the chunks most relevant to each question are retrieved and pasted into the prompt (BM25 keyword scoring, no embedding model). That's retrieval-augmented generation — the model is *grounded* on your documents, not trained on them. The Sources panel under each answer shows precisely what got pulled in.
>
> Retrieval decides what goes *in* the prompt, not whether the model may answer. Ask something your files don't cover and it retrieves nothing, says so in the trace, and answers from its own knowledge — grounded when your documents are relevant, a normal assistant when they aren't.

---

## Quick start

### 1. Install Ollama and pull a model

Download Ollama from [ollama.com](https://ollama.com), then pull the default model:

```bash
ollama pull qwen2.5:3b
```

### 2. Start Ollama so the browser can reach it

Opening the Ollama app is **not enough**. Browsers refuse to talk to a local server that hasn't declared the page allowed, and that permission is the `OLLAMA_ORIGINS` environment variable. Without it the app loads but every message fails with a CORS error.

**Easiest — run the included script** from the project folder:

```powershell
.\start-ollama.cmd     # Windows (PowerShell) — the leading .\ is required
```
```bash
./start-ollama.sh      # macOS / Linux  (chmod +x start-ollama.sh once)
```

It checks whether Ollama is already running and browser-reachable and, if it is, stops there rather than restarting a healthy server for nothing. Otherwise it frees port 11434 and starts the server with browser access enabled. Leave that terminal open. (Double-clicking the file in Explorer/Finder does the same thing.)

**Or type it yourself** — one line, stops anything stale and starts clean:

```powershell
# Windows (PowerShell)
Stop-Process -Name "ollama*" -Force -ErrorAction SilentlyContinue; $env:OLLAMA_ORIGINS="*"; ollama serve
```

```bash
# macOS / Linux
pkill -f ollama; OLLAMA_ORIGINS=* ollama serve
```

> Note for Windows: `OLLAMA_ORIGINS=* ollama serve` is **bash** syntax. PowerShell doesn't understand it — use `$env:OLLAMA_ORIGINS="*"` as above.

Ollama now serves an OpenAI-compatible API at `http://127.0.0.1:11434/v1`.

#### Skip this step forever

Set the variable permanently instead of per-session. Run it once, restart Ollama, and the normal Ollama app (tray / menu bar) is browser-reachable on every boot — no script, no manual `ollama serve` ever again:

```powershell
# Windows (PowerShell) — then quit Ollama from the tray and reopen it
[Environment]::SetEnvironmentVariable("OLLAMA_ORIGINS","*","User")
```

```bash
# macOS / Linux — then restart your terminal and Ollama
echo 'export OLLAMA_ORIGINS="*"' >> ~/.zshrc
```

> `*` means *any* page you visit can send requests to your local Ollama while it's running. That's the right trade for a camp laptop or a dev machine. If you'd rather be strict, set the exact origin instead — e.g. `http://localhost:8000` — and it will still work with the Quick start below.

### 3. Get the code

Clone the repo — or [download it as a ZIP](https://github.com/Spod101/barangayAI/archive/refs/heads/main.zip) if you don't have Git:

```bash
git clone https://github.com/Spod101/barangayAI.git
cd barangayAI
```

Planning to change anything and send it back? [Fork it](https://github.com/Spod101/barangayAI/fork) first and clone your own fork instead — see [CONTRIBUTING.md](CONTRIBUTING.md).

### 4. Open the app

Because the app loads its CSS and JS as separate files (`styles.css`, `db.js`, `rag.js`, `app/*.js`), open it through a local web server rather than `file://` (browsers block script loading from `file://`):

```bash
# from the project folder — pick whichever you have
python -m http.server 8000
# then visit http://localhost:8000

# or, with Node installed:
npx serve .
```

Then open the served URL and **pick a model** when prompted. That's it.

> No model is selected by default — choose one from the model picker after the app discovers what Ollama has available.

---

## Configuration

All defaults live in the **CONFIG block at the top of [`app/config.js`](app/config.js)** — edit it to customize your build:

```js
const API_BASE     = 'http://127.0.0.1:11434/v1';  // your local model endpoint
const API_KEY      = 'ollama';                       // any value works for Ollama
const MODEL        = 'qwen2.5:3b';                   // default model id
const AI_NAME      = 'DEVCON';                        // display name
const AI_AVATAR    = 'DV';                            // avatar initials
const BRAND_COLOR  = '#0B7A55';                       // must match --dc-blue in styles.css
const AI_TONE      = null;   // set a string to override the default system prompt
const SUGGESTIONS  = null;   // set an array of suggestion cards to override defaults
const CONTEXT_WINDOW = 32768; // model context window, used for the "context used" stat
```

Most settings (tone, language, max tokens, web search key, training files, custom system prompt) can also be changed at runtime in **Settings** inside the app — those are saved to your browser.

### Publishing your AI (optional)

Everything you customize is saved **in your browser**, not in the code — that's what makes it private, and it means `git push` alone would deploy the blank starter app rather than *your* AI. To share yours as a link:

1. **Settings → Publish → Download `my-ai.json`**, then drop that file into the project folder (beside `index.html`).
2. Commit and push it, then import the repo on [Vercel](https://vercel.com) (Add New → Project → Deploy).
3. Add a model for your visitors. They can't reach the Ollama on *your* machine, so the deployed copy proxies to a hosted model through `/api`. On Vercel: **Settings → Environment Variables** → add `MODEL_API_KEY` → Redeploy.

```
MODEL_API_KEY    required — your own free key from console.groq.com (no card)
                 GROQ_API_KEY is accepted as an alias, since that is the name
                 Groq's own docs use. MODEL_API_KEY wins if both are set.
MODEL_API_BASE   optional — defaults to https://api.groq.com/openai/v1
MODEL_NAME       optional — which model(s) to offer, comma-separated.
                 Unset = all of them, and visitors pick.
```

> **Tick every environment.** Vercel scopes each variable to **Production**, **Preview** and **Development** separately, and a key set for Production only leaves preview builds with no key at all — the site loads but answers "This AI has no model connected yet". Variables also only apply to builds created *after* they are saved, so **redeploy** once you add one. If you do hit that message, it now names the environment it was missing from, which is usually the whole answer.

The key is **yours** — you create it on your own provider account, and every message a visitor sends draws on your allowance, not anyone else's. It stays in Vercel and is only ever read server-side by [`api/proxy.js`](api/proxy.js). **Never commit one** — public repos get scraped for keys within hours. `my-ai.json` is written without any key by design.

**What visitors get:** your AI's name, personality, reply language, brand color, greeting, and uploaded sources — plus their own private chat history in their own browser. **What they can't do:** open Settings, change the personality or language, add or remove sources, or change what the AI *is*. They **can** switch models, from the picker under the composer — by default the picker offers every chat model your key can reach. Set `MODEL_NAME` to restrict that to one model (or a comma-separated few) and the picker offers only those. Either way the deployed `/api` asks your provider for the live list at request time rather than trusting a name baked into the code, so a model your provider retires drops out of the picker instead of taking the site down.

To see exactly what they'll see, open your local copy at `?visitor=1` once `my-ai.json` is in the folder.

That covers the *page*, not the *server*. [`api/proxy.js`](api/proxy.js) is a Vercel function, and a plain `python -m http.server` never runs it — so nothing behind `/api` (the key, the request caps, the live model list) is exercised on localhost. To test the hosted path before you deploy:

```bash
npx vercel link          # once — connects this folder to your Vercel project
npx vercel env pull      # writes MODEL_API_KEY into .env.local (git-ignored)
npx vercel dev           # serves the app AND runs api/proxy.js
```

Worth the trouble because the two paths don't behave the same: a local Ollama ignores request fields it doesn't recognize, while a cloud provider rejects them with a `400`. "Works against Ollama" is not evidence the published copy works. If you skip this, at least open the Vercel **preview deployment** and send one message before merging.

> The published copy answers using a **hosted** model, so it is not the private, offline AI — and it says so on the page. The copy on your own machine is still the free, local, no-cloud one. Anyone with the link spends your key's quota. On a free tier that just means your demo goes quiet until the allowance resets — which is why you should start there rather than on a paid key.

### Using a different backend

Any OpenAI-compatible server works. Point `API_BASE` at it and set `API_KEY` appropriately (e.g. LM Studio, llama.cpp server, or a remote OpenAI-compatible gateway).

### Enabling web search

Web search is off until you add a key. Get one from [Tavily](https://tavily.com), then paste it into **Settings → Model → Tavily API key**.

---

## Review Study Buddy

The **Review** tab in the sidebar (third segment, or the cards icon on the rail) is a second way to use the same AI. Instead of you asking it questions, it asks you.

**Build** — give it a topic, leave *Build from my Sources* on, and it writes a deck from the documents you already uploaded. The same TF-IDF retrieval the chat uses picks which parts of them get read, so a topic of "chapter 3" pulls chapter 3. With the toggle off it builds from the model's own knowledge of the topic instead, which is what you want for a subject you have no file for.

**Bloom's levels** — every card is tagged with the level of thinking it demands, from *Remember* up to *Create*:

| | Level | What it asks for |
|---|---|---|
| 1 | Remember | Retrieve a fact or term from memory |
| 2 | Understand | Restate an idea in your own words |
| 3 | Apply | Use it in a new but similar situation |
| 4 | Analyze | Break it apart and relate the parts |
| 5 | Evaluate | Judge it against criteria and defend that |
| 6 | Create | Build something new out of the parts |

This is the part that makes the deck worth more than a word list. A deck that is all *Remember* trains recall, and recall is not what a question like "which approach would you choose here, and why" tests. Leave all six chips on for a balanced deck, or switch five off to drill one weak level. The **Progress** tab scores each level separately and names the weakest one, because the fix differs: weak *Remember* means drill the vocabulary, while weak *Analyze* is usually a *Remember* or *Understand* gap wearing a disguise.

**Study** — click the card to flip it, then grade yourself *Again / Good / Easy* (or press `Space`, then `1` `2` `3`). Grading drives a **Leitner** schedule: a correct answer moves the card up a box and pushes its next appearance further out, a wrong one sends it straight back to box 1 and requeues it in the same run. Intervals start at 5 minutes and 1 hour, so spacing does real work inside a single sitting rather than only across days.

**Quiz** — four-option multiple choice over the same deck, with the wrong answers drawn from other cards at the same Bloom level. It is labelled honestly in the app as the weaker exercise: recognising an answer is far easier than recalling one, so a strong quiz score beside a weak Study score means the material is *familiar*, not *known*.

Decks are stored in the same local SQLite database as your conversations, so they survive a reload and never leave the device.

### Which model writes the cards

By default Review borrows whatever model the app already has selected — your local Ollama, or the hosted model through `/api` on a published copy. Nothing to configure.

If nothing is running locally, paste a **Groq** key into **Settings → Model → Groq API Key** and Review uses Groq instead. Keys are free at [console.groq.com](https://console.groq.com) with no card. The app asks Groq which models the key can actually reach and lets you pick one, rather than pinning a name that stops existing the day the provider retires it.

The key is stored only in this browser and is **never** written into `my-ai.json`, so publishing cannot leak it. Chat is deliberately left on your local model either way — a key pasted here should not quietly move every conversation off-device. For a *deployed* copy, use the `MODEL_API_KEY` environment variable instead, where the key stays server-side and the browser never sees it at all.

---

## Project structure

```
barangayAI/
├── start-ollama.cmd    # one-click: free port 11434, then serve with browser access (Windows)
├── start-ollama.sh     # same, for macOS / Linux
├── index.html          # markup only
├── styles.css          # all CSS
├── sw.js               # service worker — precaches the app so it opens offline
├── my-ai.json          # (optional) your published AI — created by Settings → Publish
├── vercel.json         # routes /api/* to the model proxy when deployed
├── api/
│   └── proxy.js        # serverless proxy — holds the hosted model key server-side
├── app/                # app logic, split by feature — loaded in this order via <script> tags
│   ├── config.js       # CONFIG block, tone presets, in-memory state
│   ├── sessions.js     # session list — create/load/switch/persist
│   ├── settings.js     # settings modal — personalization, personas, language picker
│   ├── training.js     # training tab + sidebar sources panel (RAG knowledge sources)
│   ├── onboarding.js   # welcome modal + Camp Guidebook
│   ├── models.js       # model selector, endpoint manager, connectivity checks
│   ├── chat.js         # send/stream, markdown rendering, message rendering, history
│   ├── thinking.js     # deep-thinking toggle + display
│   ├── publish.js      # export my-ai.json + visitor-mode lockdown
│   ├── review.js       # Review tab — flashcards, Bloom's levels, Leitner spacing, quiz
│   └── init.js         # welcome screen, chat actions, app bootstrap (window 'load')
├── db.js               # SQLite persistence layer (sql.js + IndexedDB)
├── rag.js              # local knowledge retrieval — chunking + BM25 scoring, no embedding model
├── vendor/             # sql.js, pdf.js, mammoth.js, fonts — committed, not CDN (see vendor/README.md)
├── assets/
│   ├── logos/          # vendor + brand logos shown in the model picker and welcome screen
│   └── Study-Buddy-Review-Guide.md   # seeded as the default Source on first run (app/training.js)
└── README.md
```

### Changing the pre-loaded Source

The app ships one Source already loaded so answers are grounded on first run — and so the Review tab has something to build a first deck from. To swap in your own document, drop it in `assets/`, update `SEED_SOURCE` near the top of the seed block in `app/training.js`, and add it to `PRECACHE` in `sw.js`. The markdown is read at runtime, so your edit shows up on the next reload — nothing to rebuild.

The seed only ever applies to a library that is empty or still holds the untouched default; it never injects itself into sources you added. When the default itself changes, the old name goes into `LEGACY_SEED_NAMES` so installs still carrying nothing but the previous default get upgraded in place rather than stranded on it. It also needs the app served over `http://` (see Quick start) — `fetch()` is blocked at the `file://` origin.

No build step. No framework. No bundler. Just more files instead of one — open any of them, edit, refresh. Script tags load in dependency order (`config.js` first, `init.js` last); if you add a file, add its `<script>` tag in `index.html` in the right spot.

### External libraries (vendored, not fetched)

- [sql.js](https://sql.js.org) — SQLite compiled to WASM, for chat persistence
- [pdf.js](https://mozilla.github.io/pdf.js/) — extracting text from uploaded PDFs
- [mammoth.js](https://github.com/mwilliamson/mammoth.js) — extracting text from `.docx` files
- Plus Jakarta Sans + JetBrains Mono — the interface fonts

All of these live in [`vendor/`](vendor/) and are served from the same origin as the app. Nothing is fetched from a CDN, so the app needs **no internet at all** — not even on the first run. See [`vendor/README.md`](vendor/README.md) for versions, licenses, and how to update one.

### Offline

[`sw.js`](sw.js) precaches the app shell on the first visit. After that you can pull the network cable and the page still opens, loads its fonts, restores your conversations, and talks to Ollama on `127.0.0.1`.

Two caveats: a service worker needs a secure context, so this only kicks in on `localhost` or `https://` — the app still works without it, just not offline. And **web search** obviously needs the internet.

When you change an app file, bump `CACHE_VERSION` in `sw.js` so returning users get your version instead of the cached one.

---

## Privacy

Everything stays on your device. Conversations, uploaded sources and review decks are stored in your browser's IndexedDB, and prompts go only to your local model.

Two things can send data off your machine, and both are off until you supply a key:

- **Web search** — the question is sent to Tavily. Needs a Tavily key and the toggle switched on.
- **Review card generation with a Groq key** — if you paste one into Settings → Model, the topic and the retrieved chunks of your Sources are sent to Groq to write the cards. Leave it blank and Review uses your local model, and nothing leaves the device. Chat never uses this key.

---

## Troubleshooting

- **"Port already in use" / "address already in use" when starting Ollama** — an Ollama started quietly in the background is already holding port 11434, and it does *not* have `OLLAMA_ORIGINS` set. It has to be stopped before a new one can take the port:

  ```powershell
  Stop-Process -Name "ollama*" -Force    # Windows
  ```
  ```bash
  pkill -f ollama                        # macOS / Linux
  ```

  Then start it again (step 2 above). `start-ollama.cmd` / `start-ollama.sh` already do both.

- **"Ollama isn't allowing browser requests" / CORS error, but Ollama is clearly running** — same cause as above: the running instance is a stale one without `OLLAMA_ORIGINS`. Stop it, start it again with the script or the one-liner.

- **The `OLLAMA_ORIGINS=* ollama serve` command does nothing on Windows** — that's bash syntax. In PowerShell use `$env:OLLAMA_ORIGINS="*"; ollama serve`.

- **"Can't connect" / no models found** — make sure Ollama is running and you've pulled a model (`ollama list`). Test the API directly in your browser: `http://127.0.0.1:11434/v1/models`.
- **Adding a local endpoint fails with `http://localhost:11434/v1`** — use `http://127.0.0.1:11434/v1` instead. On Windows `localhost` resolves to IPv6 `::1` first and Ollama listens on IPv4 only, so the browser is refused before it reaches the server. (Setting `OLLAMA_HOST=0.0.0.0` makes `localhost` work too, but it also exposes Ollama to your whole network — the numeric address is the safer fix.)
- **Blank page / scripts not loading** — you opened `index.html` via `file://`. Serve it over a local web server instead (see Quick start).
- **Responses are slow** — small models like `qwen2.5:3b` are chosen for low-end hardware. Larger models are smarter but need more RAM/GPU.

---

## Contributing

Pull requests are welcome — especially ones that make the app lighter on low-end laptops or better in Filipino languages. `main` is protected, so every change lands through a PR. See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow, how to test a change without a test suite, and what never belongs in a commit.

---

## License

Released under the [MIT License](LICENSE) — free to use, modify, fork, and share. Perfect for camps and classrooms.

---

Made with 💙 by [DEVCON.PH](https://devcon.ph)
