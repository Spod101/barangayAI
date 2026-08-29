# Study Buddy Review Guide

*The default knowledge source for Barangay AI. It is loaded automatically on a fresh install so the chat and the Review tab both have something real to work with before anyone uploads a file.*

This guide is deliberately written as a study reference rather than as documentation. It is the material the Review tab draws on when it generates flashcards, so every section is meant to be answerable: definitions are stated plainly, lists are short enough to recall, and the reasoning behind each technique is spelled out so questions at the higher Bloom levels have something to bite on.

Replace this file with your own notes when you want the AI grounded on your subject instead. See "Swapping this file out" at the end.

---

## 1. Bloom's Taxonomy

Bloom's Taxonomy is a framework for classifying learning goals by the kind of thinking they demand. The original version was published in 1956 by a committee chaired by Benjamin Bloom; the version in common use today is the 2001 revision by Lorin Anderson and David Krathwohl, which renamed the categories from nouns to verbs and swapped the top two levels.

The taxonomy matters for review because **the level you study at is the level you can perform at**. A student who only ever answers "what is the definition of X" is practising one skill, and it is not the skill an exam question like "which approach would you choose here, and why" is testing. Reviewing across levels is what closes that gap.

### The six levels

**1. Remember** — retrieve facts, terms, and basic concepts from memory. This is recognition and recall with no transformation. Typical verbs: define, list, name, identify, recall, state, label. A Remember question has one correct answer and it is short. *Example: "What does TF-IDF stand for?"*

**2. Understand** — explain ideas in your own words. The test is whether you can restate something without reusing its original phrasing, and whether you can say what it means rather than what it says. Typical verbs: explain, describe, summarise, paraphrase, classify, compare, interpret. *Example: "In your own words, why does a stopword list improve retrieval?"*

**3. Apply** — use what you know in a new but similar situation. The knowledge is given; the situation is not. Typical verbs: use, solve, demonstrate, calculate, implement, execute, show. *Example: "Given a 2,400-character document and a chunk size of 800 with 100 overlap, how many chunks result?"*

**4. Analyze** — break something into parts and work out how the parts relate. This is where causes, distinctions, and hidden assumptions live. Typical verbs: differentiate, organise, compare, contrast, examine, deconstruct, attribute. *Example: "What is the difference between chunk overlap and chunk size, and what breaks if overlap is set to zero?"*

**5. Evaluate** — judge something against criteria and defend the judgement. An Evaluate answer is not correct or incorrect on its own; it is well-argued or poorly argued. Typical verbs: judge, critique, defend, justify, assess, argue, prioritise. *Example: "Is TF-IDF a reasonable choice for a small offline app, or is it a compromise? Argue one side."*

**6. Create** — put parts together into something new, or design an original solution. This is the level that cannot be faked by recall, because there is no stored answer to retrieve. Typical verbs: design, construct, compose, formulate, plan, devise, generate. *Example: "Design a retrieval strategy for a 500-page handbook where most questions concern three chapters."*

### Lower order and higher order

Levels 1 to 3 (Remember, Understand, Apply) are conventionally called **lower-order thinking**, and levels 4 to 6 (Analyze, Evaluate, Create) **higher-order thinking**. The labels describe cognitive complexity, not importance or difficulty. A Remember question about an obscure fact can be far harder than an Evaluate question about a familiar one.

The levels are also not a strict staircase. In practice you move up and down constantly, and it is normal to analyze something you cannot yet define precisely. The useful claim is weaker but still true: higher levels tend to *depend* on lower ones, so persistent failure at Analyze is often a Remember or Understand problem wearing a disguise.

### Using the levels to diagnose

Because each level is a different skill, a per-level score is a diagnosis rather than just a grade. Weak Remember with strong Understand usually means the concepts landed but the vocabulary did not — drill terms. Strong Remember with weak Apply is the classic symptom of memorising without comprehension, and it is the most common reason confident students fail exams. Weak Evaluate and Create with everything else solid usually means the material was only ever studied as facts, never argued about.

A balanced review deck therefore weights the lower levels for coverage and the higher levels for depth. A rough starting split for a 12-card deck is 3 Remember, 3 Understand, 2 Apply, 2 Analyze, 1 Evaluate, 1 Create — then shift weight toward whichever levels are scoring worst.

---

## 2. How to actually review

### Active recall

**Active recall** means retrieving an answer from memory before checking it. Re-reading, highlighting, and copying notes are all *passive* review: they feel productive because the material feels familiar, but familiarity is not retrieval. The act of struggling to remember is what strengthens the memory, which is why a flashcard you got wrong and then corrected is worth more than a page you read twice.

This is also why the answer side of a flashcard must stay hidden until you have committed to an answer. Peeking converts an active recall exercise into a passive one, and the card stops working.

### Spaced repetition

**Spaced repetition** means reviewing material at increasing intervals rather than in one sitting. Memory decays predictably, and each successful retrieval flattens that decay curve — so the efficient moment to review something is just before you would have forgotten it. Reviewing sooner wastes effort on something you already know; reviewing later means relearning from scratch.

The **Leitner system** is the simplest workable implementation. Cards live in numbered boxes. A card you answer correctly moves up one box and is scheduled further out; a card you get wrong drops back to box 1 and comes back immediately. Box 1 might be reviewed every session, box 2 every second session, box 3 every fourth, and so on, roughly doubling each time. No algorithm is needed beyond "up on success, back to the start on failure."

The Review tab uses Leitner boxes rather than a full scheduling algorithm on purpose. A doubling interval captures most of the benefit of spaced repetition, and it stays legible: you can look at a card and see exactly why it is due.

### Interleaving

**Interleaving** means mixing topics or question types within a single session instead of finishing one block before starting the next. Blocked practice (all of topic A, then all of topic B) produces better performance *during* the session and worse retention afterwards. Interleaving feels harder because each question requires you to first work out what kind of question it is — and that extra step is the part that transfers to an exam, where the questions are not pre-sorted.

### Elaboration and self-explanation

**Elaboration** means asking "why is this true?" and "how does this connect to what I already know?" rather than accepting a fact as a standalone item. Facts stored with connections have more retrieval routes, so they are easier to find later. In practice, elaboration is what turns a Remember card into an Understand one: instead of memorising that overlap is 100 characters, you ask why overlap exists at all, and the number becomes a consequence you can re-derive.

### Desirable difficulty

The techniques above share a shape: each one makes studying feel *worse* while making learning work *better*. This is the principle of **desirable difficulty** — effort during encoding is what produces durable memory. The practical consequence is that your sense of how well a session went is an unreliable signal, and often an inverted one. Judge a session by what you can retrieve tomorrow, not by how smooth it felt today.

---

## 3. Writing good flashcards

**One idea per card.** A card that asks three things gets graded on the weakest of them, so you cannot tell what you actually knew. Split it.

**Make the front unambiguous.** "Bloom's Taxonomy?" could mean the definition, the author, the year, or the list of levels. If the front does not determine the answer, you will grade yourself inconsistently and the card becomes noise.

**Keep the back short.** The back should be the answer, not a lesson. If the back runs past a couple of sentences, the card is really several cards, or it is a Remember card doing an Understand card's job.

**Avoid cards answerable by pattern.** If the phrasing of the front gives away the answer, or the answer is the only plausible-sounding option, the card tests recognition rather than recall. Recognition is much easier than recall and it is not what you need.

**Tag the level, then check the balance.** A deck that is 80% Remember is a vocabulary list, whatever the subject. Tagging each card by Bloom level makes the imbalance visible, which is most of the way to fixing it.

**Write higher-level cards as prompts, not questions with one answer.** An Evaluate or Create card's back is a model answer or a checklist of what a good answer contains, not a fact. Grade those cards on whether your answer hit the key points, not on whether it matched word for word.

---

## 4. Reference: retrieval in this app

Included because the Review tab and the chat both run on it, and because it gives the higher Bloom levels something concrete to reason about.

**Chunking.** Uploaded sources are split into overlapping segments before storage. The default chunk size is 800 characters with 100 characters of overlap. Splitting happens on paragraph boundaries where possible, so a chunk usually contains whole thoughts; paragraphs longer than the chunk size are cut at fixed stride. Overlap exists so a fact that straddles a boundary is fully present in at least one chunk — with zero overlap, a sentence split across two chunks may match neither query well.

**Scoring.** Chunks are ranked against the question with TF-IDF weighting and cosine similarity. **Term frequency** rewards a term that appears often in a chunk. **Inverse document frequency** discounts terms that appear in many chunks, since a word present everywhere cannot distinguish anything. The product of the two favours chunks containing terms that are frequent *here* and rare *elsewhere*. Cosine similarity then compares the question's weighted term vector against each chunk's, measuring the angle between them so that a long chunk is not favoured over a short one simply for containing more words.

**Top-K and the zero-score rule.** Only the highest-scoring chunks are put into the prompt — five by default. Chunks scoring zero share no meaningful term with the question and are dropped rather than used as padding: including them would spend context on text the retriever itself rated irrelevant, and would cite a source the answer did not come from. An empty result is a legitimate outcome meaning nothing matched.

**Stopwords.** Common words carry no retrieval signal, so they are removed before scoring. The list is bilingual, covering English function words (*the, is, and, of, to*) and Filipino ones (*ang, ng, sa, mga, na, ay*), because questions at a Philippine code camp arrive in both languages and often in one sentence.

**No embedding model.** Retrieval is pure arithmetic over term counts — no vectors from a neural model, no second download, no network call. The trade-off is real: TF-IDF matches words, not meanings, so a question phrased entirely in synonyms of the source text will retrieve poorly. In exchange it runs instantly on any laptop, works with the network unplugged, and needs no model beyond the chat model itself.

---

## 5. Swapping this file out

This document is the app's default Source, seeded on first run only. To ground the AI on your own material instead:

1. Put your markdown file in `assets/`.
2. Update `SEED_SOURCE` near the top of the seed block in `app/training.js` to its name and path.
3. Add it to `PRECACHE` in `sw.js` and bump `CACHE_VERSION` so returning visitors get it.
4. Reload. The file is read at runtime, so there is nothing to rebuild.

The seed only installs itself into a library that is empty or still holds the untouched default, so it will never appear alongside sources you added yourself. You can also skip all of the above and simply add files through **Sources → + Add** in the sidebar, or **Settings → Training**.

Serving matters: the seed is fetched with `fetch()`, which is blocked at the `file://` origin. Open the folder over HTTP (`python -m http.server 8000`) rather than double-clicking `index.html`, or the Sources panel will come up empty.
