// ── Simple RAG layer ──────────────────────────────────────────────────
// Chunks training file content at upload time, then scores chunks against
// the user's message with classic TF-IDF + cosine similarity so only the
// top-K relevant chunks go into the prompt instead of the whole file.
// No embedding model, no network call — students only ever pull one
// Ollama model (the chat model).
// ─────────────────────────────────────────────────────────────────────

const RAG_CHUNK_SIZE = 800;
const RAG_CHUNK_OVERLAP = 100;
const RAG_TOP_K = 5;
const RAG_STOPWORDS = new Set([
  'the','a','an','is','are','was','were','be','been','being','to','of','and','or','in','on','at','for',
  'with','as','by','it','this','that','these','those','from','but','not','so','if','then','than','also',
  'ng','sa','at','ang','mga','na','ay','ito','yun','yan','din','rin','po','opo'
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

function computeIdf(chunkTokenLists) {
  const n = chunkTokenLists.length || 1;
  const docFreq = new Map();
  for (const tokens of chunkTokenLists) {
    for (const term of new Set(tokens)) docFreq.set(term, (docFreq.get(term) || 0) + 1);
  }
  const idf = new Map();
  for (const [term, df] of docFreq) idf.set(term, Math.log(n / (1 + df)) + 1);
  return idf;
}

function tfidfVector(tokens, idf) {
  const tf = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  const vec = new Map();
  for (const [term, count] of tf) {
    const weight = (count / tokens.length) * (idf.get(term) || Math.log(2));
    if (weight > 0) vec.set(term, weight);
  }
  return vec;
}

function cosineSimSparse(vecA, vecB) {
  const [small, big] = vecA.size <= vecB.size ? [vecA, vecB] : [vecB, vecA];
  let dot = 0;
  for (const [term, w] of small) { const w2 = big.get(term); if (w2) dot += w * w2; }
  let normA = 0; for (const w of vecA.values()) normA += w * w;
  let normB = 0; for (const w of vecB.values()) normB += w * w;
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Flatten training files into the { file, text, index, total } items the scorer
// takes. `index`/`total` are the chunk's position inside its own file — carried
// so a citation can say "chunk 12 of 47 of handbook.md" instead of quoting an
// anonymous fragment, which is the difference between a source the student can
// go and check and one they have to take on faith.
function buildChunkIndex(files) {
  const items = [];
  for (const f of (files || [])) {
    const chunks = (f.chunks && f.chunks.length) ? f.chunks : chunkText(f.content);
    chunks.forEach((text, i) => {
      items.push({ file: f.name, text, index: i + 1, total: chunks.length });
    });
  }
  return items;
}

// Score every { file, text } chunk against `query` and return the top-K,
// each augmented with a `score` field, sorted highest first.
//
// Chunks that score zero share no meaningful term with the question, so they are
// dropped rather than padded out to K. Passing them along would spend context on
// text the retriever itself rated irrelevant — costly on the small models this
// app targets — and would put a "source" under the answer that the answer did
// not come from. An empty result is a real, honest outcome: nothing matched.
function retrieveTopChunks(query, chunkItems, topK = RAG_TOP_K) {
  if (!chunkItems || !chunkItems.length) return [];
  const idf = computeIdf(chunkItems.map(c => tokenize(c.text)));
  const queryVec = tfidfVector(tokenize(query), idf);
  const scored = chunkItems.map(c => ({
    ...c,
    score: cosineSimSparse(queryVec, tfidfVector(tokenize(c.text), idf))
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.filter(c => c.score > 0).slice(0, Math.min(topK, scored.length));
}

window.BarangayRAG = {
  chunkText,
  buildChunkIndex,
  retrieveTopChunks,
};
