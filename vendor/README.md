# vendor/

Third-party libraries and fonts, committed to the repo on purpose.

They used to load from cdnjs and Google Fonts. That made the README's headline
claim — *private, offline-capable* — false in the one situation the app is built
for: a camp laptop with no internet and a cold browser cache. `sql.js` is the
worst case, because no WASM means no database means the app doesn't boot at all.

Everything here is served same-origin, precached by [`../sw.js`](../sw.js), and
needs no network after the first visit.

| File | Version | Upstream | License |
|---|---|---|---|
| `sql-wasm.js`, `sql-wasm.wasm` | 1.12.0 | [sql.js](https://sql.js.org) | MIT |
| `pdf.min.mjs`, `pdf.worker.min.mjs` | 4.0.379 | [pdf.js](https://mozilla.github.io/pdf.js/) | Apache-2.0 |
| `mammoth.browser.min.js` | 1.6.0 | [mammoth.js](https://github.com/mwilliamson/mammoth.js) | BSD-2-Clause |
| `fonts/*.woff2`, `fonts.css` | — | Plus Jakarta Sans, JetBrains Mono | SIL OFL 1.1 |

Total: ~2.7 MB, of which ~1.3 MB is pdf.js (mostly its worker — only used when
someone uploads a PDF, but precached so that still works offline) and ~640 KB is
mammoth. The fonts are 68 KB for both families combined.

## Refreshing a library

Download the new file over the old one, keeping the filename, then bump
`CACHE_VERSION` in [`../sw.js`](../sw.js) so returning users get it instead of
the cached copy:

```bash
curl -L -o vendor/sql-wasm.js https://cdnjs.cloudflare.com/ajax/libs/sql.js/<version>/sql-wasm.js
```

Update the version in the table above too. If you add or remove a file, edit the
`PRECACHE` list in `sw.js` to match — a path in that list that 404s fails the
whole install and silently leaves the app without an offline shell.

## Fonts

**Two files, one per family.** Both are *variable* fonts: a single file carries
every weight in a continuous range, declared in `fonts.css` as
`font-weight: 200 800` (sans) and `100 800` (mono). Do not add per-weight files —
requesting `wght@400;500;600;700` from Google returns the same file four times
under four URLs, which is how this folder originally ended up with ~113 KB of
byte-identical duplicates and, because each copy declared one fixed weight, a
`font-weight: 800` that the browser had to fake.

**Latin subset only.** `ñ` is U+00F1, inside the latin range, so Filipino,
Bisaya, Hiligaynon, and Ilocano are fully covered. latin-ext (U+0100+), cyrillic,
greek, and vietnamese are all dropped — nothing in the app renders them.

To refresh, fetch the stylesheet with a browser User-Agent (Google serves woff2
only to browsers that support it), take the `latin` block's URL, and save it over
the existing file:

```bash
curl -A "Mozilla/5.0 ... Chrome/120.0 Safari/537.36" \
  "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@200..800&display=swap"
```

The `wght@200..800` range syntax is what asks for the variable font; a single
weight like `wght@800` gets you a static instance instead.
