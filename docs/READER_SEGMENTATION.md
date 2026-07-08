# Reader Word Segmentation & Tap Navigation (gsa)

The Reader (`/reader`) navigates documents **word by word**: a tap on the right
two-thirds of the text advances the selection to the next word, the left third
steps back, and a caret placed anywhere auto-expands to the word containing it.
"Word" here means a **gsa segment** — the same dictionary-aware greedy
segmentation used for example-sentence enrichment — so the tapped unit is
always something the dictionary (or the user's own vocab) can answer for.

Parent doc: [USER_DOCUMENT_FEATURE_SUMMARY.md](./USER_DOCUMENT_FEATURE_SUMMARY.md)
(document CRUD, validation docs). This doc covers only segmentation + navigation.

## Layering

| Layer | Piece |
|---|---|
| Client util (pure) | `src/features/reader/documentSegmentation.ts` — gsa port, span computation, navigation |
| Client feature | `ReaderPage.tsx` (span memo) → `TextArea.tsx` (arrow keys) / `useTextSelection.ts` (auto select) / `ReaderTapOverlay.tsx` (tap gestures) |
| Server (canonical algorithm) | `server/dal/shared/segmentString.ts` — `segmentWithDict` et al. (est enrichment) |
| Server (data source) | `POST /api/vocabEntries/by-tokens` (`VocabEntryController.getEntriesByTokens`) |

There is **no segmentation API call**: segmentation runs entirely client-side on
data the reader already loads.

## Data flow

1. On document open, `useVocabularyProcessing` (`src/hooks/useVocabularyProcessing.ts`)
   extracts **every 1–4-character substring** of the document
   (`processDocumentForTokens`, `src/utils/tokenUtils.ts` — the client mirror of the
   server's `getAllSubstrings(maxLen=4)`) and fetches matching rows via
   `POST /api/vocabEntries/by-tokens` → `loadedDictionaryCards` (det rows incl.
   `vernacularScore` + `matchException`) and `loadedPersonalCards` (vet rows).
2. `ReaderPage.tsx` memoizes the segmentation
   (`segmentSpans` `useMemo`, keyed on `selectedText?.content` + the two card
   arrays — **never on `token`**, per the silent-token-refresh rule in CLAUDE.md):
   - `buildReaderDictMap(dictCards, personalCards)` — word1 → `{vernacularScore}`;
     personal `entryKey`s are merged in (score 0) so user-created words are
     tappable. They are normally a subset of det, so segmentation is unaffected.
   - `buildExcludeSet(dictCards)` — `matchException` tokens suppressed from matching.
   - `computeSegmentSpans(content, dictMap, excludeSet)` → `SegmentSpan[]`.
3. Before the fetch resolves, the dict map is empty and Han runs degrade to
   per-character spans; the memo recomputes when the card arrays land and the
   spans upgrade to dictionary words. Document edits change `content` and
   recompute likewise (`processDocumentVocabularyIncremental` tops up the cards).

## The span model

```ts
interface SegmentSpan { start: number; end: number; text: string }
```

- Offsets are **UTF-16 code units** into the raw document string — directly
  consumable by `textarea.setSelectionRange`.
- Spans are sorted, non-overlapping, and cover **words only**: whitespace and
  punctuation produce no span and are skipped by navigation.
- `computeSegmentSpans` walks the document:
  - **Han runs** (`\p{Script=Han}+`) → the ported `segmentWithDict` (gsa).
    Unlike the server's `FOREIGN_RUN_REGEX`, CJK punctuation is *excluded* from
    runs (it should not be tappable).
  - **Everything else** → one whole-run `Intl.Segmenter(undefined, {granularity:'word'})`
    pass keeping `isWordLike` segments (Latin/es, Vietnamese, kana/hangul), with
    a letter/number-run regex fallback for engines without `Intl.Segmenter`.
    Whole-run matters: the pre-gsa implementation fed the segmenter two chars at
    a time, which mis-detects non-local boundaries (e.g. glued 借了|一本).

## The gsa port

`documentSegmentation.ts` `segmentWithDict` is a port of
`server/dal/shared/segmentString.ts:segmentWithDict`. **Keep the scoring rules in
sync when editing either side** (both files' headers cross-reference each other):
length tiers 4→1; per tier the highest `vernacularScore` wins (null = 0),
tiebreak later position; winner extracted, remainders recurse; per-char fallback.

Intentional divergences from the server version (not drift):
- **No `prioritySegments` pass** — that forces an est's headword; documents have
  no headword.
- **No `classifierTokens` pass** — classifier boundaries come from the
  example-sentence tagging pass (`partOfSpeechDict`), which documents lack.

## Navigation behavior

Helpers in `documentSegmentation.ts` (binary search over the sorted spans):

- `spanContaining(spans, pos)` — span with `start <= pos < end` (a caret exactly
  on a span's start counts as inside it).
- `spanAfter(spans, pos)` / `spanBefore(spans, pos)` — first span starting at/after
  pos, last span ending at/before pos.
- `selectRelativeSpan(textarea, spans, 'next' | 'prev')` — the single entry point
  for arrows and taps:
  - **next**: collapsed caret inside a word selects **that word**; otherwise the
    first span after the selection end. (The legacy code selected caret→word-end,
    a partial word; whole-word is deliberate.)
  - **prev**: last span ending at/before the selection start.
  - No-op at document edges; calls `scrollSelectionIntoView`
    (`textSelectionUtils.ts` — now scroll-only, boundary logic removed).

Event wiring (one code path for keyboard and touch):

- `TextArea.tsx` `onKeyDown`: ArrowLeft/ArrowRight (when `autoSelectEnabled`) →
  `selectRelativeSpan`.
- `ReaderTapOverlay.tsx`: forward/back taps dispatch **synthetic
  ArrowRight/ArrowLeft keydown+keyup** into the textarea — the keyup makes
  React's onSelect polyfill fire `handleTextSelectionChange` (card lookup), which
  is why the overlay does not call `selectRelativeSpan` directly.
- `useTextSelection.ts` `handleAutoWordSelect`: a collapsed caret (native tap /
  restored focus) expands to `spanContaining(spans, caret)`; drag selections are
  never clobbered.
- Card lookup is unchanged (`textSelection.ts` `findExactMatch` /
  `findDictionaryMatch`): selections are now gsa segments, so det/vet matches are
  the common case rather than the lucky one.

## Code / doc dependencies

- `src/features/reader/documentSegmentation.ts` — everything above; header notes
  the server cross-reference and the intentional divergences.
- `src/types.ts` `DictionaryEntry.matchException` — declared for the client
  because the gsa exclude set reads it (the API always sent it).
- `server/dal/shared/segmentString.ts` — canonical gsa; header points back here.
- CLAUDE.md § "Never reload/reset a page on a silent token refresh" — the span
  memo's dependency list is bound by this rule.
