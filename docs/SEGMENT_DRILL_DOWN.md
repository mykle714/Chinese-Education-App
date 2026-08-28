# Tap-to-Drill (segment drill-down)

**Status: BUILT 2026-08-28. No migration, no stored column, no backfill.**

A repeat tap on a highlighted segment **narrows** the selection to the longest
dictionary headword still under the finger, instead of dismissing it. Repeating walks
the selection down to a single character; the tap after that cancels it.

```
中华人民共和国      ← tap 民      the whole segment, "People's Republic of China"
    人民            ← tap 民      "the people"
      民            ← tap 民      "the people / citizen"
   (cancelled)      ← tap 民
```

This replaced a plain deselect-on-second-tap. Cancelling still happens — it is now the
**end of the chain** rather than the whole of it — so a one-character segment behaves
exactly as it always did (tap to select, tap to dismiss), because a single character
reaches the floor of the chain immediately.

## 1. Where it applies

| Surface | Component | Chain |
|---|---|---|
| Example sentences (est) | `SegmentedSentenceDisplay` | GSA segment → sub-word(s) → character → cancel |
| Long definition / compare paragraph | `LongDefinitionDisplay` → `SegmentedSentenceDisplay` | same; a **whole-run citation** adds one rung above (see §4) |
| Word Search, found-word review | `WordSearchGrid` | found word → sub-word(s) → character → cancel |

The Spanish path is unaffected: `es` sentences tokenize on whitespace, one cell per
word, and a word has no shorter headword inside it to drill to.

## 2. The pick rule

Given the current selection, the character under the finger, and the parent segment's
drill candidates:

1. Consider only candidates that are **strictly narrower** than the current selection.
   (This is what makes the chain terminate — every rung is shorter than the last, so it
   is bounded by the length of the first selection and cannot loop.)
2. Consider only candidates that **contain the tapped character** — that is what makes
   the drill feel aimed rather than arbitrary.
3. Consider only candidates that stay **inside the current selection** — drilling
   narrows, it never slides sideways.
4. Among the survivors, **longest wins**. The intermediate rungs are the point: jumping
   from 中华人民共和国 straight to a bare 民 would skip 人民, which is the piece a learner
   most needs named.
5. Ties break **leftmost**, arbitrarily but deterministically. 人人 is the case that
   forces this to be decided by offset rather than by text; a wobbling pick would make
   the gesture feel unreliable.
6. No survivor → **cancel the selection**.

**Code:** `src/utils/segmentDrill.ts` → `pickDrillRung`. One implementation for all
three surfaces, so the chains cannot drift apart. Tested in
`src/__tests__/segmentDrill.test.ts` (including a termination test).

The picker works in the caller's own index space — absolute character indices in a
sentence, or indices into a word's cell path on the Word Search board — which is why the
same function serves a snaking grid word and a run of prose.

## 3. Where the rungs come from

A rung is a det headword that is a **strict substring** of its parent segment, carried
with its **character offset** inside that parent (the offset, not just the text, is what
lets 人人 drill to the half that was actually tapped).

```ts
interface SegmentDrillRung {
  text: string;          // the sub-word, a det headword
  offset: number;        // character offset within the parent segment
  definition: string;    // always present — see below
  pronunciation?: string;
}
```

**Server:** `buildDrillRungs` in `server/dal/shared/segmentString.ts`, emitted onto
`RenderedSegmentMeta.drill` by `buildSegmentMetadata` and shipped as
`SegmentMetadata[segment].drill` (`server/contracts/wire.ts`).

**This costs nothing extra for est and long definitions.** Both paths already batch-load
a det row for *every* ≤4-char substring of the text (`getAllSubstrings` → `buildDictMap`),
because that is how the greedy segmenter picks its winners. Everything that lost the
segmentation used to be discarded; a rung is one of those losers, kept. And
`segmentMetadata` is built at **read time**, so there is no column, no migration, and no
backfill behind this feature.

Details that matter:

- **A rung with no resolvable gloss is dropped**, not shipped. The popup only renders
  when it has text, and a blank popup reads as a broken tap rather than as the end of the
  chain. This is also how a chain can end above the single character.
- **`matchException` is honored** for multi-char rungs exactly as `segmentWithDict`
  honors it, so a token the dictionary says is not a real word here cannot come back as a
  rung. Single characters are never excluded, mirroring the segmenter.
  On an **example sentence** the exclusion set additionally carries that sentence's own
  `segmentExceptions` — the multi-char tokens the segmentation-audit pass judged not to be
  one word *here* (docs/EXAMPLE_SENTENCES.md § Segmentation audit) — so a token the
  segmenter was told to split cannot reappear as a rung inside a neighbouring segment.
- **A single-character rung is glossed with the sense the BREAKDOWN gives it.** The
  parent word's `breakdown` map (`Record<char, { definition, sense }>`, AI-tagged by
  `backfill-breakdown-senses.js`) is the same data the flashcard breakdown tab (bt)
  renders, so drilling into a character and reading the bt can never disagree: 银行 → 行
  says *business* / **háng**, not the standalone lead sense *to walk* / *xíng*.
- **Multi-character rungs get no breakdown answer**, because `breakdown` is keyed by
  CHARACTER only — there is no stored "which sense does 人民 carry inside 中华人民共和国".
  Those rungs fall back to the translation-context match that un-tagged segments use,
  which is the right level of effort: a rung answers "what is this piece?", it is not the
  card's dd.
- **Rungs always come from the top-level segment's list**, whatever rung the selection is
  currently standing on — the containment filter in step 3 is what supplies 人民 first and
  then 人 / 民 once the selection has narrowed. There is no nested tree.

### 3a. The sense a rung is glossed with

`resolveSenseView` (same file) is the ONE priority order, shared by top-level segments
and drill rungs so the two can never disagree:

| | Definition | Pronunciation |
|---|---|---|
| 1 | manual override (`exampleSentenceDefinitionPronunciationOverride`) | manual override |
| 2 | the tagged cluster's lead gloss (`ddt`) | the tagged cluster's own `reading`, tone-converted and syllable-count-guarded by `senseReading` |
| 3 | the breakdown's **stored** gloss | the breakdown's stored pinyin |
| 4 | translation-context match against the flat `definitions` | the entry-level `pronunciation` column |

Where the **tag** at row 2 comes from depends on the caller: a top-level segment is
labelled by the example-sentence tagging pass (`senseDict`), a single-character rung by
the parent word's `breakdown[char].sense`.

Row 3 sits *below* row 2 on purpose. The breakdown's `sense` **label** is the source of
truth — it survives re-clustering, the same stability contract as `vet.selectedSense` —
while the `definition` stored beside it is a snapshot that
`backfill-dictionary-breakdown.js` can clobber and that goes stale when a character's
glosses are later reordered (docs/BREAKDOWN_FEATURE_IMPLEMENTATION.md § 5b). So the
label is re-resolved live against the character's current clusters, and the stored gloss
is only the fallback for a label that no longer matches any cluster.

`SegmentMeta.breakdown` carries the map through `buildDictMap`; it costs no extra query
on any surface (est and long definitions already load the parent's row, and the Word
Search grid build selects the column on the query it already runs).

## 4. Per-surface notes

### Example sentences and long definitions

`toggleFromIndex` (`src/components/SegmentedSentenceDisplay.tsx`) routes a tap landing
**inside** the live selection to `drillFromIndex`, and any other tap to a fresh
`rangeFromIndex` selection. The highlight rects and the popup anchor are already computed
from the selection's character range, so narrowing repaints for free.

- **Whole-run citations get one extra rung at the top.** A translated run
  (`runTranslation`, `LongDefinitionPart.translation`) is selected as one phrase with an
  empty `segment`. Its next rung is simply the GSA segment under the finger; from there
  the segment's own rungs take over. A side effect worth knowing: the popup is passive
  while the whole run is selected (a clause is not a headword), and becomes **eip-tappable**
  the moment the drill reaches a real segment.
- **Narration follows the drill.** Each rung that gets selected is narrated where
  `onSegmentSpeak` is wired (est only) — a tap that cancels stays silent, as before. The
  rung's pronunciation is carried **on the selection**, not looked up from
  `segmentMetadata`, because a rung is not a key in that map; only top-level segments are.
- **Desktop hover** still selects the whole segment on `onMouseEnter`. Hovering does not
  drill and does not narrate; the drill is on the tap/click path.

### Word Search

`WordSearchGrid` replaced its `popupWord: PlacedWord | null` with a `WordReview` holding
`{ word, start, end, text, pinyin, definition }`, where `start`/`end` index into
`word.cells`. Cell-path indices rather than grid coordinates is what keeps a rung
contiguous however the word snakes across the board.

- The **reviewing ring** (`isPopup` → `COLORS.grnA`) now paints only the cells of the
  current rung, so drilling visibly shrinks the ring from the whole word to one tile.
- **The last rung reads its gloss from the grid cell** rather than from the drill list.
  Both now resolve through `breakdown[char].sense` and agree; the cell is preferred
  because it is the more direct source and it also covers the case where the drill list
  has no rung for that character at all. A character with neither ends the chain.
- **Audio follows the drill** — the whole word on the first tap (cached from the find),
  then each rung.
- Tapping a *different* found word, or a part of the same word outside the reviewed span,
  starts a fresh review there rather than drilling.
- The separate **single-target-character popup** (a lone tap on a not-yet-found target
  cell) is untouched: it is already a single character, so it has nothing to drill to.

**Server cost, Word Search only.** A grid build never had a reason to load substrings, so
the existing per-character `definitionClusters`/`components` query in
`OnDeckVocabService.getWordSearchGrid` was **widened** from the target characters to every
≤4-char substring of every target word. Same round trip, more rows; rungs are then built
with the shared `buildDrillRungs` so the two chains cannot diverge. The same query also
selects `breakdown`, so a single-character rung in the shipped list carries the bt's sense
even though the client prefers the cell for it. `PlacedWord.drill` is optional — boards saved before this shipped simply go straight from the whole word to the
tapped character.

## 5. Files

| File | Role |
|---|---|
| `server/dal/shared/segmentString.ts` | `SegmentDrillRung`, `buildDrillRungs`, `resolveSenseView` (the shared sense priority), `SegmentMeta.breakdown`, emitted via `buildSegmentMetadata` |
| `server/dal/implementations/DictionaryDAL.ts` | passes `excludeTokens` at both `buildSegmentMetadata` call sites (est + long definition) |
| `server/services/OnDeckVocabService.ts` | widened substring query + `drill` on each `WordSearchInput` |
| `server/services/wordSearchGrid.ts` | `WordSearchInput.drill` (inherited by `PlacedWord`) |
| `server/contracts/wire.ts` | `SegmentDrillRung`, `SegmentMetadata[...].drill` |
| `src/utils/segmentDrill.ts` | `pickDrillRung` — the shared pick rule |
| `src/components/SegmentedSentenceDisplay.tsx` | `drillFromIndex`, `SelectedRange`, drill routing in `toggleFromIndex` |
| `src/games/word-search/WordSearchGrid.tsx` | `WordReview`, `drillReview`, `tapFoundWord`, `reviewedCells` |
| `src/games/word-search/types.ts` | `PlacedWord.drill` |

## 6. Related

- [EXAMPLE_SENTENCES.md](./EXAMPLE_SENTENCES.md) — the est segment popup, its eip
  drill-in chevron, tap-to-speak, and the one-selection-at-a-time invariant.
- [WORD_SEARCH_GAME.md](./WORD_SEARCH_GAME.md) §4 — reviewing a found word.
- [DEFINITION_MAPPING.md](./DEFINITION_MAPPING.md) — which definition *form* a rung's
  gloss is (the entry's context-matched lead gloss, not a dd).
- [BREAKDOWN_FEATURE_IMPLEMENTATION.md](./BREAKDOWN_FEATURE_IMPLEMENTATION.md) § 5b —
  where a single-character rung's sense tag comes from, and why the stored gloss beside
  it can go stale.
- [DEFINITION_CLUSTERS.md](./DEFINITION_CLUSTERS.md) — the sense clusters a rung's tag
  is resolved against.
