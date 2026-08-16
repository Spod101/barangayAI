// ── SQLite persistence layer ──────────────────────────────────────────
// Uses sql.js (SQLite compiled to WASM) with IndexedDB for durability.
// All SQLite queries are synchronous; only IndexedDB I/O is async.
// ─────────────────────────────────────────────────────────────────────

const _IDB_NAME  = 'barangayai_db';
const _IDB_STORE = 'sqlitedb';
const _IDB_KEY   = 'main';

let _db = null;

// ── IndexedDB helpers ─────────────────────────────────────────────────

function _idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(_IDB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(_IDB_STORE);
    req.onsuccess  = e  => resolve(e.target.result);
    req.onerror    = () => reject(req.error);
  });
}

async function _idbLoad() {
  const idb = await _idbOpen();
  return new Promise(resolve => {
    const tx  = idb.transaction(_IDB_STORE, 'readonly');
    const req = tx.objectStore(_IDB_STORE).get(_IDB_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror   = () => resolve(null);
  });
}

async function _idbSave(data) {
  const idb = await _idbOpen();
  return new Promise(resolve => {
    const tx = idb.transaction(_IDB_STORE, 'readwrite');
    tx.objectStore(_IDB_STORE).put(data, _IDB_KEY);
    tx.oncomplete = resolve;
    tx.onerror    = resolve;
  });
}

// ── Persist the in-memory SQLite DB to IndexedDB (fire-and-forget) ────

function _persistDB() {
  if (!_db) return;
  _idbSave(_db.export()).catch(e => console.warn('DB persist failed:', e));
}

// ── Schema setup ──────────────────────────────────────────────────────

function _createSchema() {
  _db.run(`PRAGMA foreign_keys = ON`);
  _db.run(`CREATE TABLE IF NOT EXISTS sessions (
    id      TEXT    PRIMARY KEY,
    title   TEXT    NOT NULL DEFAULT 'New conversation',
    created INTEGER NOT NULL
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT    NOT NULL,
    role       TEXT    NOT NULL,
    content    TEXT    NOT NULL,
    time       TEXT,
    stats      TEXT,
    trace      TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  )`);
  // Migration for DBs created before the `stats` column existed
  try { _db.run(`ALTER TABLE messages ADD COLUMN stats TEXT`); } catch (e) { /* already exists */ }
  // Migration for DBs created before the `trace` column existed
  try { _db.run(`ALTER TABLE messages ADD COLUMN trace TEXT`); } catch (e) { /* already exists */ }
  // Provenance: web sources, retrieved knowledge chunks, follow-ups, and the
  // prompt snapshot. One JSON column rather than four typed ones — these travel
  // together, are only ever read whole, and a single migration is one thing to
  // get right instead of four. (Web sources were rendered on reload before this
  // existed but never actually saved, so they always came back empty.)
  try { _db.run(`ALTER TABLE messages ADD COLUMN meta TEXT`); } catch (e) { /* already exists */ }
  _db.run(`CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS training_files (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT    NOT NULL,
    size     INTEGER NOT NULL,
    content  TEXT    NOT NULL,
    added_at TEXT    NOT NULL
  )`);
  // Migration for DBs created before the `chunks` column existed
  try { _db.run(`ALTER TABLE training_files ADD COLUMN chunks TEXT`); } catch (e) { /* already exists */ }
}

// ── Migration from localStorage (runs once on first launch) ───────────

function _migrateFromLocalStorage() {
  try {
    const rawSessions = localStorage.getItem('barangayai_sessions');
    const currentId   = localStorage.getItem('barangayai_current_session');
    const rawSettings = localStorage.getItem('barangayai_settings');

    if (rawSessions) {
      const parsed = JSON.parse(rawSessions);
      if (Array.isArray(parsed)) {
        for (const s of parsed) {
          _db.run('INSERT OR IGNORE INTO sessions VALUES (?,?,?)', [
            s.id,
            s.title || 'New conversation',
            s.created ? new Date(s.created).getTime() : Date.now(),
          ]);
          for (const m of (s.displayMessages || [])) {
            _db.run(
              'INSERT INTO messages (session_id, role, content, time) VALUES (?,?,?,?)',
              [s.id, m.role, m.content, m.time || null]
            );
          }
        }
      }
    }

    if (currentId) {
      _db.run('INSERT OR REPLACE INTO settings VALUES (?,?)', ['current_session_id', currentId]);
    }

    if (rawSettings) {
      const s = JSON.parse(rawSettings);
      const trainingFiles = Array.isArray(s.training_files) ? s.training_files : [];
      for (const f of trainingFiles) {
        _db.run(
          'INSERT INTO training_files (name, size, content, added_at, chunks) VALUES (?,?,?,?,?)',
          [f.name, f.size || 0, f.content || '', f.addedAt || new Date().toISOString(), '[]']
        );
      }
      const rest = Object.assign({}, s);
      delete rest.training_files;
      _db.run('INSERT OR REPLACE INTO settings VALUES (?,?)', ['app_settings', JSON.stringify(rest)]);
    }

    console.log('[DB] Migrated data from localStorage');
  } catch (e) {
    console.warn('[DB] Migration from localStorage failed:', e);
  }
}

// ── Public: init ──────────────────────────────────────────────────────

async function initDB() {
  // Vendored, not CDN — the WASM binary is what the whole database rides on, so
  // fetching it over the network would make "works offline" false on a cold cache.
  const SQL   = await initSqlJs({ locateFile: f => `vendor/${f}` });
  const saved = await _idbLoad();
  _db = saved ? new SQL.Database(saved) : new SQL.Database();
  _createSchema();
  if (!saved) _migrateFromLocalStorage();
  _persistDB();
  console.log('[DB] SQLite ready');
}

// ── Public: sessions ──────────────────────────────────────────────────

// Every prompt snapshot embeds the whole conversation up to that point, so
// keeping one per message makes storage grow with the square of the thread
// length — a long chat would balloon IndexedDB for panels nobody reopens. Only
// the newest answer keeps its snapshot; that is the one the inspector exists to
// answer ("what did the app just send, with my current settings?"), and older
// turns were assembled from settings that no longer apply anyway.
function _messageMeta(m, keepPrompt) {
  const meta = {};
  if (m.sources)    meta.sources    = m.sources;
  if (m.kbSources)  meta.kbSources  = m.kbSources;
  if (m.followUps)  meta.followUps  = m.followUps;
  if (m.prompt && keepPrompt) meta.prompt = m.prompt;
  return Object.keys(meta).length ? JSON.stringify(meta) : null;
}

function dbSaveSessions(sessions, currentSessionId) {
  if (!_db) return;
  _db.run('DELETE FROM sessions');
  _db.run('DELETE FROM messages');
  for (const s of sessions) {
    _db.run('INSERT INTO sessions VALUES (?,?,?)', [
      s.id,
      s.title,
      s.created instanceof Date ? s.created.getTime() : (s.created || Date.now()),
    ]);
    const msgs = s.displayMessages || [];
    let lastAssistant = -1;
    msgs.forEach((m, i) => { if (m.role === 'assistant') lastAssistant = i; });
    msgs.forEach((m, i) => {
      _db.run(
        'INSERT INTO messages (session_id, role, content, time, stats, trace, meta) VALUES (?,?,?,?,?,?,?)',
        [s.id, m.role, m.content, m.time || null,
         m.stats ? JSON.stringify(m.stats) : null,
         m.trace ? JSON.stringify(m.trace) : null,
         _messageMeta(m, i === lastAssistant)]
      );
    });
  }
  if (currentSessionId) {
    _db.run('INSERT OR REPLACE INTO settings VALUES (?,?)', ['current_session_id', currentSessionId]);
  }
  _persistDB();
}

function dbLoadSessions() {
  if (!_db) return { sessions: [], currentId: null };

  const sessRes = _db.exec('SELECT id, title, created FROM sessions ORDER BY created DESC');
  if (!sessRes.length) return { sessions: [], currentId: null };

  const loaded = [];
  for (const [id, title, created] of sessRes[0].values) {
    const msgRes = _db.exec(
      'SELECT role, content, time, stats, trace, meta FROM messages WHERE session_id = ? ORDER BY id ASC',
      [id]
    );
    const displayMessages = msgRes.length
      ? msgRes[0].values.map(([role, content, time, stats, trace, meta]) => {
          const m = { role, content, time: time || undefined };
          if (stats) { try { m.stats = JSON.parse(stats); } catch (e) { /* ignore */ } }
          if (trace) { try { m.trace = JSON.parse(trace); } catch (e) { /* ignore */ } }
          if (meta)  { try { Object.assign(m, JSON.parse(meta)); } catch (e) { /* ignore */ } }
          return m;
        })
      : [];
    loaded.push({ id, title, displayMessages, created: new Date(created) });
  }

  const curRes  = _db.exec("SELECT value FROM settings WHERE key = 'current_session_id'");
  const currentId = curRes.length ? curRes[0].values[0][0] : null;

  return { sessions: loaded, currentId };
}

function dbSetCurrentSession(id) {
  if (!_db) return;
  _db.run('INSERT OR REPLACE INTO settings VALUES (?,?)', ['current_session_id', id]);
  _persistDB();
}

// ── Public: settings ──────────────────────────────────────────────────

function dbSaveSettings(s) {
  if (!_db) return;
  const trainingFiles = Array.isArray(s.training_files) ? s.training_files : [];

  _db.run('DELETE FROM training_files');
  for (const f of trainingFiles) {
    _db.run(
      'INSERT INTO training_files (name, size, content, added_at, chunks) VALUES (?,?,?,?,?)',
      [f.name, f.size || 0, f.content || '', f.addedAt || new Date().toISOString(), JSON.stringify(f.chunks || [])]
    );
  }

  const rest = Object.assign({}, s);
  delete rest.training_files;
  _db.run('INSERT OR REPLACE INTO settings VALUES (?,?)', ['app_settings', JSON.stringify(rest)]);
  _persistDB();
}

function dbLoadSettings() {
  if (!_db) return {};

  const settRes = _db.exec("SELECT value FROM settings WHERE key = 'app_settings'");
  const s       = settRes.length ? JSON.parse(settRes[0].values[0][0]) : {};

  const filesRes    = _db.exec('SELECT name, size, content, added_at, chunks FROM training_files ORDER BY id ASC');
  s.training_files  = filesRes.length
    ? filesRes[0].values.map(([name, size, content, addedAt, chunks]) => {
        let parsedChunks = [];
        if (chunks) { try { parsedChunks = JSON.parse(chunks); } catch (e) { /* ignore */ } }
        return { name, size, content, addedAt, chunks: parsedChunks };
      })
    : [];

  return s;
}

// ── Public: model endpoints ───────────────────────────────────────────

function dbSaveModels(models) {
  if (!_db) return;
  _db.run('INSERT OR REPLACE INTO settings VALUES (?,?)', ['model_endpoints', JSON.stringify(models || [])]);
  _persistDB();
}

function dbLoadModels() {
  if (!_db) return [];
  const res = _db.exec("SELECT value FROM settings WHERE key = 'model_endpoints'");
  return res.length ? JSON.parse(res[0].values[0][0]) : [];
}

// Generic JSON key/value store (used for model enable/disable + removed endpoints).
function dbSetItem(key, value) {
  if (!_db) return;
  _db.run('INSERT OR REPLACE INTO settings VALUES (?,?)', [key, JSON.stringify(value)]);
  _persistDB();
}

function dbGetItem(key, fallback) {
  if (!_db) return fallback;
  const res = _db.exec("SELECT value FROM settings WHERE key = '" + key + "'");
  return res.length ? JSON.parse(res[0].values[0][0]) : fallback;
}

// ── Exports ───────────────────────────────────────────────────────────

window.BarangayDB = {
  initDB,
  dbSaveSessions,
  dbLoadSessions,
  dbSetCurrentSession,
  dbSaveSettings,
  dbLoadSettings,
  dbSaveModels,
  dbLoadModels,
  dbSetItem,
  dbGetItem,
};
