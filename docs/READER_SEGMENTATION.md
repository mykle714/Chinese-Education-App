# Reader Word Segmentation & Tap Navigation (gsa)

The Reader (`/reader`) navigates documents **word by word**: on mobile, a tap on the
right two-thirds of the screen advances the selection to the next word, the left third
steps back, and a caret placed anywhere auto-expands to the word containing it. The tap
region is the **whole screen below the display strip** (edge to edge, down to the bottom),
not just the reading box (`ReaderDocumentPage.tsx` → `.reader-page-tap-region`, which
mounts `ReaderTapOverlay`; `ReaderTapOverlay.tsx` → `TAP_LEFT_ZONE_FRACTION`).
"Word" here means a **gsa segment** — the same dictionary-aware greedy
segmentation used for example-sentence enrichment — so the tapped unit is
always something the dictionary (or the user's own vocab) can answer for.

Parent doc: [USER_DOCUMENT_FEATURE_SUMMARY.md](./USER_DOCUMENT_FEATURE_SUMMARY.md)
(document CRUD, validation docs). This doc covers only segmentation + navigation.

## Layering

| Layer | Piece |
|---|---|
| Client util (pure) | `src/features/reader/documentSegmentation.ts` — gsa port, span computation, navigation |
| Client feature | `ReaderDocumentPage.tsx` (span memo) → `TextArea.tsx` (arrow keys) / `useTextSelection.ts` (auto select) / `ReaderTapOverlay.tsx` (tap gestures) / `ReaderCpcdView.tsx` (Pinyin display mode: renders the same spans as cpcd words and highlights the textarea's selected span — see USER_DOCUMENT_FEATURE_SUMMARY.md § Display modes) |
| Server (canonical algorithm) | `server/dal/shared/segmentString.ts` — `segmentWithDict` et al. (est enrichment) |
| Server (data source) | `POST /api/vocabEntries/byTokens` (`VocabEntryController.getEntriesByTokens`) |

There is **no segmentation API call**: segmentation runs entirely client-side on
data the reader already loads.

## Data flow

1. On document open, `useVocabularyProcessing` (`src/hooks/useVocabularyProcessing.ts`)
   extracts **every 1–4-character substring** of the document
   (`processDocumentForTokens`, `src/utils/tokenUtils.ts` — the client mirror of the
   server's `getAllSubstrings(maxLen=4)`) and fetches matching rows via
   `POST /api/vocabEntries/byTokens` → `loadedDictionaryCards` (det rows incl.
   `frequencyScore` + `matchException`) and `loadedPersonalCards` (vet rows).
2. `ReaderDocumentPage.tsx` memoizes the segmentation
   (`segmentSpans` `useMemo`, keyed on `selectedText?.content` + the two card
   arrays — **never on `token`**, per the silent-token-refresh rule in CLAUDE.md):
   - `buildReaderDictMap(dictCards, personalCards)` — word1 → `{frequencyScore}`;
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
length tiers 4→1; per tier the highest `frequencyScore` wins (null = 0),
tiebreak later position; winner extracted, remainders recurse; per-char fallback.

Intentional divergences from the server version (not drift):
- **No `prioritySegments` pass** — that forces an est's headword; documents have
  no headword.
- **No `classifierTokens` pass** — classifier boundaries come from the
  example-sentence tagging pass (`partOfSpeechDict`), which documents lack.
- **Tiebreak alternatives** (extra output; scoring is identical) and **forced spans**
  (the learner's switches) — see § "Tiebreak alternatives" below.

## Tiebreak alternatives

The gsa can pick the wrong word when two **same-length** words overlap and
`frequencyScore` decides between them. Example: in 都怪我没治愈我的伤, 没治 (score 3)
beats 治愈 (null → 0, not yet processed by the backfill), which leaves 愈 stranded.
The Pinyin view lets the learner fix this in place.

**What counts as a tiebreak loser.** A candidate from the winner's length tier that
**overlaps** the winner. A same-tier candidate that does *not* overlap is not a loser,
because the remainder recursion still finds it. For each side of the winner, the
best-scoring overlapping loser is kept (same score-then-later-position rule as the
winner), so a chain AB | BC | CD with a BC winner yields **both** AB and CD.

**Data.** `SegmentSpan.alternatives?: SpanRange[]` on the winning span.

**Display (Pinyin mode only).** Only while the selected word is a tiebreak winner, each
loser is painted with the search-match wash (`readerSearchColors(...).match`, joined
into one box like a search match). The box covers the **whole** loser, including the
character it shares with the selected word: with 没治 selected, 治愈 is boxed, and on 治
the translucent yellow lies over the blue selection. The Text mode draws nothing.

**Switching.** A tap anywhere inside the yellow box (glyph, pinyin band, or the shared
cell) makes that word the selection. It is the only tap that overrides the Reader's
left/right zone step. Hit-testing is geometric (`readerAlternatives.ts` → `findAlternativeCellAt`
checks the bounding box of each `[data-reader-alternative]` cell), because the pinyin is not
inside its cell's DOM subtree:
- mobile: `ReaderTapOverlay` → `handlePointerUp` runs the check **before** the zone step
  and clicks the cell;
- desktop: `ReaderCpcdView`'s scroll box catches the click in the capture phase, so the
  word group's own onClick never runs.

Both paths call `ReaderDocumentPage` → `switchToAlternative`. That adds the loser to
`segmentOverrides`, which reaches `computeSegmentSpans(…, forcedSpans)`. The forced word
is placed first and the rest of its Han run re-segments around it (没 | 治愈). The shared
span list then follows the switch in both modes and in navigation.

**Undo.** A forced span carries, as its `alternatives`, the unforced winner(s) that
listed it. In the example, 没治 is boxed while 治愈 is selected, and tapping it removes
the override (an alternative that overlaps an existing override means "undo"; a loser
can never straddle a forced span, because forced spans split the run).

**Lifetime.** Page session only, with no persistence. Overrides are tagged with the
content they were made against, so an edit or another document drops them. A forced span
that no longer fits its run (offsets or text changed) is ignored.

Code: `src/features/reader/documentSegmentation.ts` → `segmentRange` (losers),
`computeSegmentSpans` / `segmentDocument` (forced spans, switch-back);
`src/features/reader/ReaderDocumentPage.tsx` → `segmentOverrides`, `switchToAlternative`;
`src/features/reader/readerAlternatives.ts` → `ALTERNATIVE_CELL_ATTR`, `findAlternativeCellAt`;
`src/features/reader/ReaderCpcdView.tsx` → `paragraphAlternatives`,
`handleAlternativeClickCapture`, `ReaderCpcdParagraph` (`items` memo);
`src/features/reader/ReaderTapOverlay.tsx` → `handlePointerUp`;
`src/components/CPCDRow.tsx` → `CPCDRowItem.attrs`.
Tests: `src/__tests__/documentSegmentation.test.ts`.

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
    (`textSelectionUtils.ts` — textarea geometry only (mirror div): scroll-into-view and
    `textareaOffsetAtPoint`; boundary logic removed).

Event wiring (one code path for keyboard and touch):

- `TextArea.tsx` `onKeyDown`: ArrowLeft/ArrowRight (when `autoSelectEnabled`) →
  `selectRelativeSpan`.
- `ReaderTapOverlay.tsx`: forward/back taps dispatch **synthetic
  ArrowRight/ArrowLeft keydown+keyup** into the textarea — the keyup makes
  React's onSelect polyfill fire `handleTextSelectionChange` (card lookup), which
  is why the overlay does not call `selectRelativeSpan` directly. Its long-press
  (WORD JUMP) selects the span under the finger through `useTextSelection` →
  `selectSpanAtOffset` (docs/USER_DOCUMENT_FEATURE_SUMMARY.md § Display modes).
- `useTextSelection.ts` `handleAutoWordSelect`: a collapsed caret (native tap /
  restored focus) expands to `spanContaining(spans, caret)`; drag selections are
  never clobbered.
- Card lookup is unchanged (`textSelection.ts` `findExactMatch` /
  `findDictionaryMatch`): selections are now gsa segments, so det/vet matches are
  the common case rather than the lucky one.

## Keyboards: reading mode vs edit mode

The reading box is a focused `<textarea>` (focus drives the caret, the word
highlight and arrow navigation, and `useTextSelection` → `handleTextAreaBlur`
re-asserts focus whenever it is lost), but it is **not for typing**. So in reading
mode it declines **both** keyboards:

- `inputMode="none"` — no OS soft keyboard.
- `data-beginner-keyboard="off"` — no app handwriting keyboard
  (docs/BEGINNER_KEYBOARD.md § 7a's opt-out). Without it, the provider's `focusin`
  trigger raised the keyboard on every one of the box's refocuses.

Edit mode (`useReaderContentEditor`, `ReaderEditToolbar`) drops both overrides, so
the learner's chosen keyboard comes up there and only there.

⚠️ **Each mode gets its own `<textarea>`** (`key` on the `TextField` in
`TextArea.tsx`). The beginner keyboard resets its field's `inputMode` to `''` when
it closes, and that cleanup lands after the exit-edit re-render; on a shared element
it stripped reading mode's `inputMode="none"` and the OS keyboard came back.
Remounting leaves that cleanup on the detached edit element. The cost is that
scroll offset and caret must be handed across the swap: `TextArea` snapshots them
from the outgoing element on the render where `editMode` flips, then focuses the
incoming edit element with them restored. That focus also matters for the keyboard:
a tap on an already-focused field fires no `focusin`, so without it nothing would
open until the learner tapped away and back.

Code: `src/features/reader/TextArea.tsx` → `TextArea` (`inputProps`, the `key`,
the read ⇄ edit hand-off effect); `src/features/beginnerKeyboard/eligibility.ts` →
`OPT_OUT_ATTRIBUTE`; `src/features/beginnerKeyboard/BeginnerKeyboardHost.tsx`
(the `inputMode` cleanup).

## Code / doc dependencies

- `src/features/reader/documentSegmentation.ts` — everything above; header notes
  the server cross-reference and the intentional divergences.
- `src/features/reader/ReaderCpcdView.tsx`, `ReaderTapOverlay.tsx`,
  `readerAlternatives.ts`, `ReaderDocumentPage.tsx` — tiebreak alternatives (§ "Tiebreak alternatives").
- `src/features/reader/TextArea.tsx` — reading/edit keyboard suppression and the
  per-mode textarea (§ "Keyboards: reading mode vs edit mode").
- `src/types.ts` `DictionaryEntry.matchException` — declared for the client
  because the gsa exclude set reads it (the API always sent it).
- `server/dal/shared/segmentString.ts` — canonical gsa; header points back here.
- CLAUDE.md § "Never reload/reset a page on a silent token refresh" — the span
  memo's dependency list is bound by this rule.
