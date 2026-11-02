# Superposition (stroke-stacking game)

> **Status: DEPLOYED to PPE 2026-11-01, no migration.** A writing-flp game break, hidden from
> the hub. Grid and tile sizes are first-pass values, due to be tuned by hand. Parent doc:
> [GAMES_FEATURE.md](./GAMES_FEATURE.md). Break host: [FLP_GAME_BREAKS.md](./FLP_GAME_BREAKS.md).

The strokes of four characters are cut out onto transparent tiles, grouped into natural parts
and then merged by ink, and dealt in a bunch on a snapping grid. The learner stacks each character's tiles at one exact grid position. The
stroke keeps its true place inside the tile, so an exact stack redraws the character.

| Layer | Piece | Where |
|---|---|---|
| Contract | Board size, word picking, wire shapes | `server/contracts/superposition.ts` |
| Service | The deal | `server/services/SuperpositionService.ts` |
| DAL | Candidate words (shared with Writing Grid) | `server/dal/implementations/WritingGridDAL.ts` → `findCandidateWords` |
| Controller / route | `GET /api/superposition/deal` | `server/controllers/SuperpositionController.ts`, `server/routes/superpositionRoutes.ts` |
| Game logic (pure) | Tiles, stacks, tap cycle, snapping | `src/games/superposition/board.ts` |
| Stage | The run: deal, stopwatch, marks, end | `src/games/superposition/SuperpositionStage.tsx` |
| Page / break | Hosts | `src/games/superposition/SuperpositionPage.tsx`, `src/games/flpBreak/superpositionBreak.ts` |

## Tuning

`src/games/superposition/constants.ts` → `GRID_UNIT_PX` (8) and `TILE_UNITS` (12, so 96px).
Every board measure derives from these two. `SPAWN_MARGIN_UNITS` (3, so 24px) sets the deal's
gap from the board edges and the word info. `SPAWN_SPREAD_UNITS` (12, so 96px) sets how tight
the opening bunch is. `TILE_OUTLINE_PX` (2) sets the tile outline.

## Deal

`pickSuperpositionWords`: exactly `SUPERPOSITION_CHAR_COUNT` (4) distinct characters from any
mix of the learner's 1–4 character words. Words go down a shuffled ladder: fresh preferred,
fresh, cooled preferred, cooled. "Preferred" means a seed word; a focused break inverts it,
as Writing Grid's does. "Cooled" reads the CHARACTERS' writing clocks, because that is where
the marks land. A short board lends cards, except on a focused break.

Refused: a character shared between words or repeated in one (two identical stacks), and
`SINGLE_STROKE_CHARS` (a lone tile is already a finished stack).

`SuperpositionController` shares `parseWritingDealOptions` with `WritingGridController`.

## Play

- **Grid:** `SuperpositionBoard` fills the whole play area (the `GameFrame` panel's inset is
  removed) and draws a dot on every grid intersection, the points a tile's corner snaps to.
- **Deal:** `scatterTiles` drops every tile in a tight bunch at the bottom centre, spread over
  `SPAWN_SPREAD_UNITS` on each axis, `SPAWN_MARGIN_UNITS` clear of every edge and below the
  word info. Tiles overlap but never start as a stack. Drags may go anywhere.
- **Stack:** tiles at one exact `(x, y)`. An overlap at an offset is not a stack.
- **Green:** `completedStacks`: a stack's outline turns green only when it holds exactly a
  character's strokes. There is no feedback before that, and a green stack can still be moved.
- **Judged on the drop:** the tile held in a drag (`liftedId`, owned by the Stage, set through
  `SuperpositionBoard`'s `onLift`) sits in no stack. Green, marks and the win wait for the drop,
  and lifting a tile out of a green stack clears the stack's green at once.
- **Win:** all four characters finished. Stacks may sit anywhere, and a word's characters
  need not be adjacent or in order.
- **Tap:** `nextTapSelection` walks the pile under the finger, the card icon editor's rule
  (`src/cardIcons/editor/CardIconCanvas.tsx` → `pickTapTarget`,
  [CARD_ICON_LAYOUT.md](./CARD_ICON_LAYOUT.md)). The selected stroke is highlighted.
- **Drag:** `dragTarget` lifts the selection if it is in the pile, else the top tile. A drop
  clears the selection.
- **Hints:** `SuperpositionHints`, drawn on the grid under the tiles: the words side by side
  across the top, each a column of toned pinyin (`TonedPronunciation`), dd (up to three lines)
  and an audio button. A filled green `check_circle` sits in a word's top corner, beside the
  pinyin, while all its characters are finished. Only the button takes input, so a tile lying
  over the info stays grabbable.

Colors: game hue `tea`; finished outline and word check `RAMP.grn.mark`; selection `RAMP.pur.mark`.

## Stroke parts

`groupStrokes` (`src/games/superposition/board.ts`) decides what each tile holds. Natural parts
come first and each keeps its own tile; the strokes left over go to the ink pass below.

`src/games/superposition/strokeParts.json` holds the parts as `{ char: [[stroke indices]] }`,
lazily imported by `SuperpositionStage.tsx` → `loadCharacters`. It is generated and committed
by `server/scripts/backfill/chinese/generate-superposition-parts.js`, which owns the approved
lists. Re-run it after changing a list or upgrading `hanzi-writer-data`:

- `WHOLE_PARTS`: kept whole wherever they appear. A listed part is never opened, because 日
  holds 口 and 田 holds 土. An unlisted part opens, so 语 yields 讠 and the 口 inside 吾.
- `SPLIT_PARTS`: cut into set pieces: ⺮ (two halves), 门 (dot and vertical / frame), 心 (dots /
  hook), 米 (two dots / 木). These apply when the character is the part itself as well.
- A character's radical (the dictionary's `radical`, stroke indices from `radStrokes`) groups
  like a whole part, unless it is in `UNGROUPED_RADICALS`.

A character that is only one whole part (口, 木), or whose single part claims every stroke
(由), gets no parts entry and goes to ink, because one tile would deal as a finished stack. Repeated
parts get a tile each, so 品 is three 口 tiles. Stroke matches come from the Make Me a Hanzi
`matches` field read through `server/scripts/backfill/chinese/lib/decompose.js` →
`loadDecompositionEntries`; strokes it leaves unmatched fall to ink.

## Ink merging

`groupStrokesByInk` (`src/games/superposition/board.ts`) is the fallback for a character with no
parts, and `mergeByInk` is its core, also run on a character's leftover strokes. Strokes
are sorted by `strokeInk` (outline area in square glyph units), smallest first, and collect in
the open group until its ink reaches `INK_MERGE_THRESHOLD`. Grouping reads size only, so a
tile's strokes need not be neighbours. A character that would form one tile gives its largest
stroke a second tile, because a lone tile is already a finished stack.

The threshold, 30,000, is set from 灬. Across 14 characters holding it, three dots peak near
29,300 and all four start near 32,600. Over the common words (`frequencyScore` >= 4), a
board of about 28 strokes deals about 12 tiles with parts and ink together.

## Lookalike strokes

`LOOKALIKE_TOLERANCE_UNITS` (derived from the tile as a fixed 2px on screen, about 21 glyph
units on a 96px tile): a tile `accepts` every stroke whose medians stay within the tolerance
at every resampled point. Without this, swapping two
visually identical strokes would leave a finished-looking stack un-green. `stackFillsCharacter`
runs a bipartite matching because lookalikes are not transitive.

Measured 2026-11-01 over 20,000 random 3-word boards of discoverable words, on the original
32px tile (the 96px tile's 2px tolerance is about 0.67px on this scale, so these rates are an
upper bound): boards holding a pair within 1px / 2px were 34% / 84% (any length) and 6% / 25% (one-character
words). Nearly every such pair also shares a stroke type, and almost none fall inside one
character. Picking clean words from a 20-word loop is possible (17–28% of triples clean at
2px), but the deal does not do it: stroke data is client-only, and the tolerance already
prevents dead ends.

## Scoring and marks

No clock is drawn and a run cannot be lost. `superposition` keeps a lower-is-better personal
best of active time (`server/contracts/personalBests.ts`).

Each character's first finish in a run sends a full writing mark to its single-character card
(`type: "writing"`, `surface: "superposition"`, top level so `writingMarkCounts` passes). The
server still drops a mark on a resting or fully mastered character. Leave ends a break's run
with what stands finished, and no personal best.

## Referenced by

`server/constants.ts` → `KNOWN_GAME_IDS`; `server/contracts/featureFlags.ts` → `GAME_FLAGS`;
`src/games/registry.ts`; `src/games/flpBreak/index.ts` → `FLP_BREAK_GAMES`.
