// ── CONFIG (edit this to customize your AI) ──────────────────────────
const API_BASE    = 'http://127.0.0.1:11434/v1';
const API_KEY     = 'ollama';
const MODEL       = 'qwen2.5:3b';
const AI_NAME     = 'DEVCON';
const AI_AVATAR   = 'DV';
const BRAND_COLOR = '#4F46E5';
const AI_TONE     = null;   // set a string here to override the default system prompt
const SUGGESTIONS = null;   // set an array of { icon, label, desc, prompt } to override suggestion cards
const CONTEXT_WINDOW = 32768; // model context window (tokens) — used for the "context used" stat
// ─────────────────────────────────────────────────────────────────────

// ── OLLAMA COMMANDS (OS-aware) ────────────────────────────────────────
// Every "start Ollama" hint in the app comes from here so the user is
// never shown a command their shell can't run. `OLLAMA_ORIGINS=* cmd` is
// bash syntax and silently fails in PowerShell (Windows' default shell),
// which is the single most common setup dead-end at camps.
// OLLAMA_ORIGINS is what lets the browser talk to Ollama at all — without
// it the model rejects the page's requests as cross-origin.
const IS_WINDOWS = /win/i.test(navigator.userAgentData?.platform || navigator.platform || '');

const OLLAMA_START_CMD = IS_WINDOWS
  ? '$env:OLLAMA_ORIGINS="*"; ollama serve'
  : 'OLLAMA_ORIGINS=* ollama serve';

// Frees port 11434 when a stale/background Ollama is already holding it —
// the usual cause of "address already in use" when starting the server.
const OLLAMA_STOP_CMD = IS_WINDOWS
  ? 'Stop-Process -Name "ollama*" -Force'
  : 'pkill -f ollama';

// The bundled helper script that does stop-then-start for you. PowerShell
// won't run a script in the current folder without the leading `.\` — it
// only searches PATH otherwise.
const OLLAMA_SCRIPT_CMD = IS_WINDOWS ? '.\\start-ollama.cmd' : './start-ollama.sh';

// Stop-then-start, for when the port is occupied: the copy-paste one-liner.
const OLLAMA_RESTART_CMD = IS_WINDOWS
  ? 'Stop-Process -Name "ollama*" -Force -ErrorAction SilentlyContinue; $env:OLLAMA_ORIGINS="*"; ollama serve'
  : 'pkill -f ollama; OLLAMA_ORIGINS=* ollama serve';

// Sets OLLAMA_ORIGINS permanently so the normal Ollama app (tray/menu bar)
// is browser-reachable on every boot — after this, no manual serve at all.
const OLLAMA_PERSIST_CMD = IS_WINDOWS
  ? '[Environment]::SetEnvironmentVariable("OLLAMA_ORIGINS","*","User")'
  : 'echo \'export OLLAMA_ORIGINS="*"\' >> ~/.zshrc';

window.ACTIVE_MODEL = null;       // no model is selected by default — the user must pick one
window.ACTIVE_BASE  = API_BASE;   // default endpoint used for discovery; switched when a model is selected
window.ACTIVE_KEY   = API_KEY;
// 'local' (Ollama) or 'api' (cloud, OpenAI-compatible). Local endpoints ignore
// unknown request fields; cloud ones reject them with a 400, so a few
// Ollama-only knobs have to be left out for 'api'. Also picks which
// troubleshooting advice makes sense when a request fails.
window.ACTIVE_KIND  = 'local';

// ── TONE PRESETS ──────────────────────────────────────────────────────
const TONE_PRESETS = {
  default:  '',
  friendly: 'You are {name} — a warm, encouraging AI assistant. You celebrate curiosity, use simple language, add friendly emojis occasionally, and always make the user feel confident and supported. Keep answers clear and concise.',
  formal:   'You are {name} — a professional AI assistant. Communicate in clear, structured, formal language. No slang or emojis. Provide thorough, accurate, well-formatted answers.',
  teacher:  'You are {name} — a patient, educational AI tutor. Break complex topics into clear steps, use analogies, ask clarifying questions, and prioritize helping the user understand rather than just giving answers.',
  strict:   'You are {name} — a precise, no-nonsense AI. Give direct, concise answers only. No filler phrases or excessive praise. Prioritize accuracy and brevity above all else.',
};

// ── STATE ─────────────────────────────────────────────────────────────
let messages = [];           // current session API messages [{role, content}]
let sessions = [];           // [{id, title, displayMessages, created}]
let currentSessionId = null;
let isStreaming = false;
let isDark = false;
let isConnected = false;
let _KB_DISABLED = new Set(); // names of sources excluded from the model's context
let _modelWarm = false;      // true after first successful model response in this session

