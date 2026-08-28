// ── Simple RAG layer ──────────────────────────────────────────────────
// Chunks training file content at upload time, then scores chunks against
// the user's message with BM25 so only the genuinely relevant chunks go into
// the prompt instead of the whole file.
// No embedding model, no network call — students only ever pull one
// Ollama model (the chat model).
//
// Retrieval decides what goes IN the prompt, not whether the model may answer.
// Nothing matching is a normal outcome: the prompt simply carries no document
// text and the model answers from what it already knows. "Who is LeBron James?"
// against a barangay handbook should retrieve nothing and still get an answer.
// ─────────────────────────────────────────────────────────────────────

const RAG_CHUNK_SIZE = 800;
const RAG_CHUNK_OVERLAP = 100;
const RAG_TOP_K = 5;

// BM25 tuning. k1 controls term-frequency saturation (the 5th "barangay" in a
// chunk should not count as much as the 1st); b controls how hard long chunks
// are penalised for having more chances to match. 1.2 / 0.75 are the standard
// values and behave well at this corpus size.
const BM25_K1 = 1.2;
const BM25_B = 0.75;

// A query term that appears in more than this share of the corpus is treated as
// a stopword *for this corpus* and dropped from the query. In a brand-kit
// document "name" sits in half the chunks; matching on it is matching on
// nothing. In a barangay records file the same word is real signal — so the
// corpus decides, not a hardcoded list. Only applied once there are enough
// chunks for the ratio to mean something: in a 4-chunk file a term hitting 2
// chunks is signal, not noise.
const RAG_COMMON_TERM_DF = 0.4;
const RAG_DF_FILTER_MIN_CHUNKS = 12;

// Two floors, both on the 0–1 normalised score. The absolute floor rejects weak
// matches outright; the relative floor drops the tail once there is a clear
// winner, so "0.71, 0.68, 0.19, 0.18, 0.17" returns two chunks, not five.
const RAG_MIN_SCORE = 0.15;
const RAG_RELATIVE_FLOOR = 0.45;

// Function words carry no topical signal, and question/pronoun words ("what",
// "your", "how", "ano", "bakit") are the ones that let a conversational aside
// like "what's your name?" match five random chunks of a document.
const RAG_STOPWORDS = new Set([
  // English structure
  'the','a','an','is','are','was','were','be','been','being','am','to','of','and','or','in','on','at','for',
  'with','as','by','it','its','this','that','these','those','from','but','not','so','if','then','than','also',
  'about','into','out','there','here','such','just','very','more','most','some','any','other','only',
  // English question, pronoun and auxiliary words
  'what','when','where','which','who','whom','whose','why','how',
  'i','me','my','mine','you','your','yours','we','us','our','ours','he','him','his','she','her','hers',
  'they','them','their','theirs',
  'can','could','shall','should','will','would','may','might','must',
  'do','does','did','done','has','have','had','get','got','tell','please',
  // Tagalog structure
  'ng','sa','at','ang','mga','na','ay','ito','iyan','yan','yun','yung','ung','doon','dito',
  'din','rin','po','opo','ba','lang','naman','nga','daw','raw','pa','may','meron','para','kung','dahil','pero',
  // Tagalog question and pronoun words
  'ano','sino','saan','kailan','bakit','paano','ilan',
  'ako','ikaw','ka','kayo','ninyo','mo','ko','siya','niya','sila','nila','kami','tayo','natin','namin'
]);

function chunkText(text, size = RAG_CHUNK_SIZE, overlap = RAG_CHUNK_OVERLAP) {
  const clean = String(text || '').trim();
  if (!clean) return [];
  const paragraphs = clean.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const chunks = [];
  let current = '';
  const flush = () => { if (current.trim()) chunks.push(current.trim()); current = ''; };
  for (const para of paragraphs) {
    if (para.length > size) {
      flush();
      for (let i = 0; i < para.length; i += (size - overlap)) {
        chunks.push(para.slice(i, i + size));
        if (i + size >= para.length) break;
      }
      continue;
    }
    if (current && current.length + para.length + 2 > size) flush();
    current += (current ? '\n\n' : '') + para;
  }
  flush();
  return chunks.length ? chunks : [clean.slice(0, size)];
}

function tokenize(text) {
  const matches = String(text || '').toLowerCase().match(/\w+/g) || [];
  return matches.filter(t => t.length > 1 && !RAG_STOPWORDS.has(t));
}

// BM25's probabilistic IDF. The property that matters here, and that the old
// `log(n / (1 + df)) + 1` did not have, is that it falls to ~0 as a term
// approaches every chunk: a word in all 252 chunks scores 0.002, not 1.0. That
// trailing "+ 1" was a floor under every common word — which is how generic
// vocabulary like "name" or "what" ended up carrying a match on its own.
function bm25Idf(df, n) {
  return Math.log(1 + (n - df + 0.5) / (df + 0.5));
}

// Flatten training files into the { file, text, index, total } items the scorer
// takes. `index`/`total` are the chunk's position inside its own file — carried
// so a citation can say "chunk 12 of 47 of handbook.md" instead of quoting an
// anonymous fragment, which is the difference between a source the student can
// go and check and one they have to take on faith.
//
// Tokenising every chunk is the expensive part of a turn and the corpus rarely
// changes between turns, so the built index is cached against the `files` array
// itself. Toggling a source off rebuilds that array, which misses the cache and
// recomputes — correct either way, and never stale.
const _indexCache = new WeakMap();

function buildChunkIndex(files) {
  const list = files || [];
  const cached = _indexCache.get(list);
  if (cached) return cached;
  const items = [];
  for (const f of list) {
    const chunks = (f.chunks && f.chunks.length) ? f.chunks : chunkText(f.content);
    chunks.forEach((text, i) => {
      items.push({ file: f.name, text, index: i + 1, total: chunks.length, tokens: tokenize(text) });
    });
  }
  _indexCache.set(list, items);
  return items;
}

// Score every chunk against `query` with BM25 and return the top matches along
// with the reasoning behind them.
//
// Returns { chunks, terms, ignored, broad, reason }:
//   chunks  — top-K survivors, each with a 0–1 `score`, highest first
//   terms   — the query terms actually used for matching
//   ignored — query terms thrown away for sitting in too much of the corpus to
//             discriminate; the honest answer to "why did it skip my documents?"
//   broad   — true when the match fell back to those common terms (see below)
//   reason  — why it returned what it did. The four ways to come back empty are
//             genuinely different things, and only some are the student's to
//             fix, so they are not collapsed into one "no match":
//               'empty-corpus'     — no files uploaded
//               'all-stopwords'    — the question was nothing but filler words
//                                    ("what's your name?"); nothing to search on
//               'not-in-sources'   — real words, none of them in the files
//                                    ("who is LeBron James?"); a normal question
//                                    the documents simply have no bearing on
//               'terms-too-common' — the words are in so much of the corpus
//                                    they cannot narrow anything down
//               'below-threshold'  — matched, but too weakly to be worth sending
//
// Chunks below the floors are dropped rather than padded out to K. Passing them
// along would spend context on text the retriever itself rated irrelevant —
// costly on the small models this app targets — and would put a "source" under
// the answer that the answer did not come from. An empty result is a real,
// honest outcome: nothing matched, and the model answers from its own knowledge.
function retrieve(query, chunkItems, topK = RAG_TOP_K) {
  const items = chunkItems || [];
  const n = items.length;
  if (!n) return { chunks: [], terms: [], ignored: [], broad: false, reason: 'empty-corpus' };

  const tokenLists = items.map(c => c.tokens || tokenize(c.text));
  const docFreq = new Map();
  let totalLen = 0;
  for (const tokens of tokenLists) {
    totalLen += tokens.length;
    for (const term of new Set(tokens)) docFreq.set(term, (docFreq.get(term) || 0) + 1);
  }
  const avgLen = totalLen / n || 1;

  // Keep only the query terms that can actually discriminate: present in the
  // corpus, and not spread across so much of it that they match everything.
  const queryTerms = [...new Set(tokenize(query))];
  if (!queryTerms.length) return { chunks: [], terms: [], ignored: [], broad: false, reason: 'all-stopwords' };

  const terms = [], ignored = [];
  let present = 0;
  for (const t of queryTerms) {
    const df = docFreq.get(t) || 0;
    if (!df) continue; // absent from the corpus — nothing to match
    present++;
    if (n >= RAG_DF_FILTER_MIN_CHUNKS && df / n > RAG_COMMON_TERM_DF) { ignored.push(t); continue; }
    terms.push(t);
  }
  if (!present) return { chunks: [], terms: [], ignored: [], broad: false, reason: 'not-in-sources' };

  // Every term being too common is two different situations. "what's your
  // name?" reduces to one ubiquitous word and genuinely retrieves nothing. But
  // a repetitive corpus — a template deck where every chunk says "copy
  // pattern" — can flag a real four-term question the same way, and there the
  // terms still discriminate *together*: a chunk holding all four beats one
  // holding a single term. So a multi-term question falls back to scoring on
  // them and is marked `broad`; a one-term question does not.
  let broad = false;
  if (!terms.length) {
    if (ignored.length < 2) return { chunks: [], terms: [], ignored, broad, reason: 'terms-too-common' };
    terms.push(...ignored);
    broad = true;
  }

  // Normalising by the query's total IDF turns an unbounded BM25 score into
  // "how much of this question's distinctive content does the chunk cover?" —
  // 1.0 means every distinctive term is present, 0.3 means roughly a third of
  // them are. That is a number a student can read, and one a fixed threshold
  // can be set against. A raw BM25 score is neither.
  const idf = new Map(terms.map(t => [t, bm25Idf(docFreq.get(t), n)]));
  let idfTotal = 0;
  for (const w of idf.values()) idfTotal += w;
  if (!idfTotal) return { chunks: [], terms, ignored, broad, reason: 'terms-too-common' };

  const scored = [];
  for (let i = 0; i < n; i++) {
    const tokens = tokenLists[i];
    if (!tokens.length) continue;
    const freq = new Map();
    for (const t of tokens) if (idf.has(t)) freq.set(t, (freq.get(t) || 0) + 1);
    if (!freq.size) continue;
    const norm = BM25_K1 * (1 - BM25_B + BM25_B * (tokens.length / avgLen));
    let raw = 0;
    for (const [term, f] of freq) raw += idf.get(term) * (f * (BM25_K1 + 1)) / (f + norm);
    const score = Math.min(1, raw / idfTotal);
    if (score >= RAG_MIN_SCORE) scored.push({ ...items[i], score });
  }
  if (!scored.length) return { chunks: [], terms, ignored, broad, reason: 'below-threshold' };

  scored.sort((a, b) => b.score - a.score);
  const cutoff = scored[0].score * RAG_RELATIVE_FLOOR;
  return { chunks: scored.filter(c => c.score >= cutoff).slice(0, topK), terms, ignored, broad, reason: 'ok' };
}

// Array-only form, for callers that just want the chunks.
function retrieveTopChunks(query, chunkItems, topK = RAG_TOP_K) {
  return retrieve(query, chunkItems, topK).chunks;
}

window.BarangayRAG = {
  chunkText,
  buildChunkIndex,
  retrieve,
  retrieveTopChunks,
};
