// ── SQLite persistence layer ──────────────────────────────────────────
// Uses sql.js (SQLite compiled to WASM) with IndexedDB for durability.
// All SQLite queries are synchronous; only IndexedDB I/O is async.
//
// Two stores, on purpose. The SQLite file has to be exported whole on every
// save, so anything living inside it is rewritten to disk every time anything
// changes. Conversations are small and change constantly, which is fine.
// Uploaded sources are the opposite — up to 8 MB that changes only when
// someone adds or removes a file — so they get their own store and are written
// only when they actually change.
// ─────────────────────────────────────────────────────────────────────

const _IDB_NAME    = 'barangayai_db';
const _IDB_VERSION = 2;             // v2 added the `sources` store
const _IDB_STORE   = 'sqlitedb';
const _IDB_KEY     = 'main';
const _IDB_SOURCES = 'sources';

let _db = null;
// The running app's source of truth for uploaded files. Populated once by
// initDB() so dbLoadSettings() can stay synchronous — every caller of it
// (app/settings.js, app/training.js, app/publish.js, app/onboarding.js) is.
let _sources = [];
// Which stored row currently carries a prompt snapshot, per session. Only the
// newest answer keeps one (see _messageMeta), so when a newer answer arrives the
// previous row has to give its snapshot up — this is how that row is found
// without scanning every message's meta. Rebuilt on load, maintained on save;
// if it ever went stale the cost is one old answer keeping a snapshot it should
// have dropped, not a corrupt conversation.
const _promptRow = new Map();

// ── IndexedDB helpers ─────────────────────────────────────────────────

// One connection, reused. Every read and write used to call indexedDB.open and
// leave the handle open, so a long session accumulated hundreds of live
// connections for a database that is only ever written from this one tab.
let _idbConn    = null;
let _idbOpening = null;   // in-flight open, so parallel callers share one request

function _idbOpen() {
  if (_idbConn) return Promise.resolve(_idbConn);
  if (_idbOpening) return _idbOpening;

  _idbOpening = new Promise((resolve, reject) => {
    const req = indexedDB.open(_IDB_NAME, _IDB_VERSION);
    req.onupgradeneeded = e => {
      const idb = e.target.result;
      // Guarded: on a v1 → v2 upgrade `sqlitedb` is already there, and
      // createObjectStore throws on a name that already exists.
      if (!idb.objectStoreNames.contains(_IDB_STORE))   idb.createObjectStore(_IDB_STORE);
      if (!idb.objectStoreNames.contains(_IDB_SOURCES)) idb.createObjectStore(_IDB_SOURCES);
    };
    req.onsuccess  = e  => {
      const idb = e.target.result;
      // Another tab wants a newer schema. Holding this handle open is what would
      // block it, so let go and reopen on the next call.
      idb.onversionchange = () => {
        try { idb.close(); } catch (err) { /* already closing */ }
        if (_idbConn === idb) _idbConn = null;
      };
      idb.onclose = () => { if (_idbConn === idb) _idbConn = null; };
      _idbConn = idb;
      resolve(idb);
    };
    req.onerror    = () => reject(req.error);
    // Another tab is holding the older version open. Rejecting rather than
    // hanging lets initDB fall back to a memory-only session.
    req.onblocked  = () => reject(new Error('database is open in another tab'));
  });

  // A failed open must not stay cached, or every later call inherits the failure.
  _idbOpening.catch(() => {}).then(() => { _idbOpening = null; });
  return _idbOpening;
}

// Storage can be unavailable outright — a private window, site data disabled, a
// second tab pinning the old schema version. None of that should stop the app
// from booting; it only means this session isn't durable. So reads report
// "nothing saved" instead of throwing out of initDB.
async function _idbLoad() {
  try {
    const idb = await _idbOpen();
    return await new Promise(resolve => {
      const tx  = idb.transaction(_IDB_STORE, 'readonly');
      const req = tx.objectStore(_IDB_STORE).get(_IDB_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror   = () => resolve(null);
    });
  } catch (e) {
    console.warn('[DB] storage unavailable — this session will not be saved:', e && e.message || e);
    return null;
  }
}

// Writes reject on failure, deliberately. They used to resolve, which made a
// quota-exceeded or aborted transaction indistinguishable from a successful
// save — the caller's .catch() could never fire, so history vanished silently.
async function _idbSave(data) {
  const idb = await _idbOpen();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(_IDB_STORE, 'readwrite');
    tx.objectStore(_IDB_STORE).put(data, _IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
    tx.onabort    = () => reject(tx.error || new Error('transaction aborted'));
  });
}

async function _idbLoadSources() {
  try {
    const idb = await _idbOpen();
    return await new Promise(resolve => {
      const tx  = idb.transaction(_IDB_SOURCES, 'readonly');
      const req = tx.objectStore(_IDB_SOURCES).getAll();
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror   = () => resolve([]);
    });
  } catch (e) {
    return [];
  }
}

// Wholesale replace, which is the semantic dbSaveSettings has always had. Only
// called when the list actually changed — see _sourcesEqual.
async function _idbSaveSources(files) {
  const idb = await _idbOpen();
  return new Promise((resolve, reject) => {
    const tx    = idb.transaction(_IDB_SOURCES, 'readwrite');
    const store = tx.objectStore(_IDB_SOURCES);
    store.clear();
    // `chunks` is deliberately not stored. It is derived from `content` and cost
    // more than the content itself — 9.18 MB of JSON for 8 MB of text, because
    // chunks overlap by design. Recomputed on load instead, which is the same
    // trade app/publish.js already makes for my-ai.json.
    for (const f of files) {
      store.put({
        name:    f.name,
        size:    f.size || 0,
        content: f.content || '',
        addedAt: f.addedAt || Date.now(),
      }, f.name);
    }
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
    tx.onabort    = () => reject(tx.error || new Error('transaction aborted'));
  });
}

// Chunks are rebuilt here rather than read from storage: once per boot over the
// whole library, instead of once per message the way rag.js would otherwise
// have to (buildChunkIndex falls back to chunking on the fly when they're absent).
function _hydrateSources(records) {
  const chunk = (typeof window !== 'undefined' && window.BarangayRAG && window.BarangayRAG.chunkText) || null;
  return (records || []).map(r => ({
    name:    r.name,
    size:    r.size || 0,
    content: r.content || '',
    addedAt: r.addedAt || Date.now(),
    chunks:  chunk ? chunk(r.content || '') : [],
  }));
}

// Compared on the fields that decide what gets stored. Unchanged strings are the
// common case and compare by reference in a single step, so this stays cheap
// even with the library at its 8 MB cap.
function _sourcesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].name !== b[i].name) return false;
    if ((a[i].size || 0) !== (b[i].size || 0)) return false;
    if ((a[i].content || '') !== (b[i].content || '')) return false;
  }
  return true;
}

// ── Persist the in-memory SQLite DB to IndexedDB ──────────────────────
// Debounced. Every mutation used to export and write the entire database on the
// spot, so a burst (new chat → first message, or a run of deletes) meant several
// full writes back to back. Now mutations mark the DB dirty and one write
// covers all of them.

const _PERSIST_DEBOUNCE_MS = 800;
let _persistTimer = null;
let _persistDirty = false;

function _persistDB() {
  if (!_db) return;
  _persistDirty = true;
  if (_persistTimer) return;   // a flush is already on the way
  _persistTimer = setTimeout(() => { _persistTimer = null; dbFlush(); }, _PERSIST_DEBOUNCE_MS);
}

// Write now if anything is waiting. Returns a promise so a caller can await it,
// though none has to.
function dbFlush() {
  if (_persistTimer) { clearTimeout(_persistTimer); _persistTimer = null; }
  if (!_db || !_persistDirty) return Promise.resolve();
  _persistDirty = false;
  return _idbSave(_db.export()).catch(e => {
    // Put the flag back — the data is still only in memory, so the next flush
    // must try again rather than assume it landed.
    _persistDirty = true;
    console.warn('[DB] save failed — recent changes are still only in memory:', e && e.message || e);
  });
}

// The debounce opens a window where the newest message is in memory but not on
// disk. These close it: visibilitychange is the signal that actually fires when
// a phone backgrounds the tab, pagehide covers desktop close and navigation.
// Both fire early enough that an IndexedDB transaction already started is
// normally allowed to finish.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') dbFlush();
  });
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { dbFlush(); });
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
  // Every read and every incremental save asks for one session's messages in
  // order. Without this that is a scan of every message in every conversation;
  // with it, a range read of just the one asked for.
  _db.run(`CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id)`);
  _db.run(`CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);
  // No training_files table any more — uploaded sources live in their own
  // IndexedDB store (_IDB_SOURCES). Databases written before this change still
  // carry the table; _adoptLegacySources() empties it on the first load after.
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
      // Straight into the in-memory list; initDB persists it to the sources store.
      if (trainingFiles.length) {
        _sources = _hydrateSources(trainingFiles.map(f => ({
          name:    f.name,
          size:    f.size || 0,
          content: f.content || '',
          addedAt: f.addedAt || new Date().toISOString(),
        })));
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

// ── One-time move of sources out of the SQLite file ───────────────────
// For databases written before sources had their own store, and for a
// localStorage import that just populated _sources. Reads whatever the old
// training_files table holds, hands it to the new store, then empties the table
// and VACUUMs — without the VACUUM the freed pages stay in the file and the
// export never actually shrinks, which is the entire point of the move.
async function _adoptLegacySources() {
  let fromSqlite = false;

  if (!_sources.length) {
    let rows = [];
    try {
      // `chunks` is not read on purpose — it gets recomputed, so this query works
      // against every older schema, including ones written before that column.
      const res = _db.exec('SELECT name, size, content, added_at FROM training_files ORDER BY id ASC');
      rows = res.length ? res[0].values : [];
    } catch (e) {
      return;   // no such table — a fresh install, nothing to move
    }
    if (!rows.length) return;
    _sources = _hydrateSources(rows.map(([name, size, content, addedAt]) => ({ name, size, content, addedAt })));
    fromSqlite = true;
  }

  try {
    await _idbSaveSources(_sources);
  } catch (e) {
    // Keep them in memory so this session still works, and leave the SQLite rows
    // alone so the next load can try the move again.
    console.warn('[DB] could not move sources into their own store — retrying next load:', e && e.message || e);
    return;
  }

  if (fromSqlite) {
    _db.run('DELETE FROM training_files');
    _db.run('VACUUM');
    console.log(`[DB] moved ${_sources.length} source(s) out of the SQLite file`);
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

  const stored = await _idbLoadSources();
  _sources = _hydrateSources(stored);

  if (!saved) _migrateFromLocalStorage();          // may populate _sources
  if (!stored.length) await _adoptLegacySources(); // old table, or that import

  _persistDB();
  console.log(`[DB] SQLite ready · ${_sources.length} source${_sources.length === 1 ? '' : 's'}`);
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

// Ids of the rows already stored for a session, in order. Only `id` is selected:
// the point is to compare against what is in memory without reading back the
// message bodies, traces and prompt snapshots that make a conversation heavy.
function _storedRowIds(sessionId) {
  const res = _db.exec('SELECT id FROM messages WHERE session_id = ? ORDER BY id ASC', [sessionId]);
  return res.length ? res[0].values.map(r => r[0]) : [];
}

function _insertMessage(sessionId, m, withPrompt) {
  _db.run(
    'INSERT INTO messages (session_id, role, content, time, stats, trace, meta) VALUES (?,?,?,?,?,?,?)',
    [sessionId, m.role, m.content, m.time || null,
     m.stats ? JSON.stringify(m.stats) : null,
     m.trace ? JSON.stringify(m.trace) : null,
     _messageMeta(m, withPrompt)]
  );
}

// Brings one session's stored rows in line with the in-memory list, appending
// what is new rather than rewriting the thread. A 50-turn conversation used to
// re-insert all 100 rows on every message; now it inserts the two that arrived.
function _syncSession(s) {
  const msgs    = s.displayMessages || [];
  const created = s.created instanceof Date ? s.created.getTime() : (s.created || Date.now());

  if (_db.exec('SELECT 1 FROM sessions WHERE id = ?', [s.id]).length) {
    // Title is the only thing that changes on an existing session (renames, and
    // the auto-title taken from the first message).
    _db.run('UPDATE sessions SET title = ? WHERE id = ?', [s.title, s.id]);
  } else {
    _db.run('INSERT INTO sessions VALUES (?,?,?)', [s.id, s.title, created]);
  }

  let stored = _storedRowIds(s.id);

  // The thread got shorter — "Clear chat", or a turn that produced only thinking
  // and popped itself. The stored tail no longer lines up with memory, so this
  // one session is rebuilt. Rare, and still cheaper than rebuilding all of them.
  if (stored.length > msgs.length) {
    _db.run('DELETE FROM messages WHERE session_id = ?', [s.id]);
    _promptRow.delete(s.id);
    stored = [];
  }

  let lastAssistant = -1;
  msgs.forEach((m, i) => { if (m.role === 'assistant') lastAssistant = i; });

  // Ids of the appended rows are taken from last_insert_rowid() as they go in,
  // so the row the updates below need can be found without a second pass over
  // the table — the scan this replaced grew with the conversation.
  const firstNew = stored.length;
  const newIds   = [];
  for (let i = firstNew; i < msgs.length; i++) {
    _insertMessage(s.id, msgs[i], i === lastAssistant);
    const r = _db.exec('SELECT last_insert_rowid()');
    newIds.push(r.length ? r[0].values[0][0] : null);
  }

  if (lastAssistant < 0) return;

  // Two rows can need rewriting even when nothing was appended:
  //   · the newest answer, when follow-ups land after it was first saved
  //     (app/thinking.js resolves those in the background)
  //   · the answer before it, which has to give up its prompt snapshot
  // Both are addressed by row id, so this is at most two UPDATEs per save.
  const newestId = lastAssistant >= firstNew
    ? newIds[lastAssistant - firstNew]
    : stored[lastAssistant];
  if (newestId == null) return;

  _db.run('UPDATE messages SET meta = ? WHERE id = ?',
          [_messageMeta(msgs[lastAssistant], true), newestId]);

  const prevId = _promptRow.get(s.id);
  if (prevId != null && prevId !== newestId) {
    // A row that already carried a snapshot is by definition an older one, so it
    // is always in the ids that were already stored.
    const prevIdx = stored.indexOf(prevId);
    if (prevIdx >= 0 && msgs[prevIdx]) {
      _db.run('UPDATE messages SET meta = ? WHERE id = ?',
              [_messageMeta(msgs[prevIdx], false), prevId]);
    }
  }
  _promptRow.set(s.id, newestId);
}

function dbSaveSessions(sessions, currentSessionId) {
  if (!_db) return;

  // Sessions the user deleted. Messages are removed explicitly rather than left
  // to ON DELETE CASCADE — the pragma is set per connection, and this should not
  // depend on that having taken.
  const live   = new Set((sessions || []).map(s => s.id));
  const stored = _db.exec('SELECT id FROM sessions');
  for (const [id] of (stored.length ? stored[0].values : [])) {
    if (live.has(id)) continue;
    _db.run('DELETE FROM messages WHERE session_id = ?', [id]);
    _db.run('DELETE FROM sessions WHERE id = ?', [id]);
    _promptRow.delete(id);
  }

  for (const s of (sessions || [])) _syncSession(s);

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
      'SELECT id, role, content, time, stats, trace, meta FROM messages WHERE session_id = ? ORDER BY id ASC',
      [id]
    );
    const displayMessages = msgRes.length
      ? msgRes[0].values.map(([rowId, role, content, time, stats, trace, meta]) => {
          const m = { role, content, time: time || undefined };
          if (stats) { try { m.stats = JSON.parse(stats); } catch (e) { /* ignore */ } }
          if (trace) { try { m.trace = JSON.parse(trace); } catch (e) { /* ignore */ } }
          if (meta)  { try { Object.assign(m, JSON.parse(meta)); } catch (e) { /* ignore */ } }
          // Note which row holds the prompt snapshot, so the first save after a
          // reload knows which one to strip when a newer answer supersedes it.
          if (m.prompt) _promptRow.set(id, rowId);
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
  const incoming = Array.isArray(s.training_files) ? s.training_files : [];

  // Sources are written only when they actually changed. A settings save fires
  // for any toggle at all — theme, temperature, a persona rename — and
  // rewriting the whole library each time would put back exactly the megabytes
  // that moving it out of the SQLite file removed.
  if (!_sourcesEqual(incoming, _sources)) {
    const chunk = (window.BarangayRAG && window.BarangayRAG.chunkText) || null;
    _sources = incoming.map(f => ({
      name:    f.name,
      size:    f.size || 0,
      content: f.content || '',
      addedAt: f.addedAt || Date.now(),
      // Uploads arrive already chunked (app/training.js); anything else gets
      // chunked here so the in-memory list is always ready for retrieval.
      chunks:  (f.chunks && f.chunks.length) ? f.chunks : (chunk ? chunk(f.content || '') : []),
    }));
    _idbSaveSources(_sources).catch(e =>
      console.warn('[DB] sources not saved — they are still only in memory:', e && e.message || e));
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

  // Fresh wrappers, so a caller mutating the list it gets back can't reach into
  // the cache. `chunks` is shared by reference because it is only ever read.
  s.training_files = _sources.map(f => ({
    name: f.name, size: f.size, content: f.content, addedAt: f.addedAt, chunks: f.chunks,
  }));

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
  dbFlush,
};
