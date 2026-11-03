# Superposition (stroke-stacking game)

> **Status: DEPLOYED to PPE 2026-11-01, no migration.** A writing-flp game break, hidden from
> the hub. Grid and tile sizes are first-pass values, due to be tuned by hand. Parent doc:
> [GAMES_FEATURE.md](./GAMES_FEATURE.md). Break host: [FLP_GAME_BREAKS.md](./FLP_GAME_BREAKS.md).

The strokes of four characters are cut out onto transparent tiles, grouped along stroke order
by ink with natural parts kept whole, and dealt in a bunch on a snapping grid. The learner stacks each character's tiles at one exact grid position. The
stroke keeps its true place inside the tile, so an exact stack redraws the character.

| Layer | Piece | Where |
|---|---|---|
| Contract | Board size, word picking, wire shapes | `server/contracts/superposition.ts` |
| Service | The deal | `server/services/SuperpositionService.ts` |
| DAL | Candidate words (shared with Writing Grid) | `server/dal/implementations/WritingGridDAL.ts` → `findCandidateWords` |
| Controller / route | `GET /api/superposition/deal` | `server/controllers/SuperpositionController.ts`, `server/routes/superpositionRoutes.ts` |
| Contract (pure, shared) | Stroke groups: which strokes share a tile | `server/contracts/superpositionGroups.ts` |
| Game logic (pure) | Tiles, stacks, tap cycle, snapping | `src/games/superposition/board.ts` |
| Stage | The run: deal, stopwatch, marks, end | `src/games/superposition/SuperpositionStage.tsx` |
| Page / break | Hosts | `src/games/superposition/SuperpositionPage.tsx`, `src/games/flpBreak/superpositionBreak.ts` |

## Tuning

`src/games/superposition/constants.ts` → `GRID_UNIT_PX` (16) and `TILE_UNITS` (9, so 144px).
Every board measure derives from these two. The spawn constants are whole grid units, so they
need rescaling when the pitch changes. `SPAWN_MARGIN_UNITS` (2, so 32px) sets the deal's
gap from the board edges and the word info. `SPAWN_SPREAD_UNITS` (6, so 96px) sets how tight
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
- **Judged on the drop:** stacks are judged only when a drag ends (`SuperpositionStage` →
  `handleLift`, called through `SuperpositionBoard`'s `onLift`). Hovering over a stack finishes
  nothing. There is no feedback before a finish.
- **Lock:** a dropped stack that holds exactly a character's strokes (`completedStacks`) fuses
  at once (`board.ts` → `lockFinishedStacks`). Its tiles share a `TileLock` (`id` = the smallest
  tile id, `charIndex` = the character), the outline turns green, and the lock never opens:
  - **Moves as one:** dragging any of its tiles moves the whole stack onto the top of the pile
    (`moveTile`). It cannot be pulled apart, so a finish (and its checks) stands for the run.
  - **Selects as one:** a pile's hits fold each locked stack to one entry (`collapseLocked`),
    so a tap selects it whole, highlights all its strokes, and one drag lifts it.
  - **Never re-judged:** `completedStacks` reads loose tiles only. A loose tile dropped on a
    locked cell is allowed, and neither spoils nor joins the locked stack; loose tiles there
    can finish (and lock) a character of their own.
- **Win:** all four characters finished. Stacks may sit anywhere, and a word's characters
  need not be adjacent or in order.
- **Inspect on win:** a win stops the clock and records the personal best, then holds the
  completed board on screen, locked, with the hint button gone (`SuperpositionStage` phase
  `"inspecting"`). A solid-ink **Exit →** pill in the bottom-right corner
  (`src/games/superposition/SuperpositionExitButton.tsx`, `superposition__inspect-done`) —
  which inflates in like a bubble (scale 0 → 1.08 → 1 from its bottom-right corner, after a
  250 ms beat; none under reduced motion) — moves on to `onRunEnded` — the Deck Tower
  flp's end card, the game's **only** ending (there is no end popup and no Play Again). A
  break's Leave arrow during inspection does the same as Exit, so a won run is always reported.
  Leaving early skips inspection. On the deprecated `/games/superposition` route (no flp to
  report to) Exit simply leaves via `onDone`.
- **Tap:** `nextTapSelection` walks the pile under the finger, the card icon editor's rule
  (`src/cardIcons/editor/CardIconCanvas.tsx` → `pickTapTarget`,
  [CARD_ICON_LAYOUT.md](./CARD_ICON_LAYOUT.md)). The selected stroke is highlighted.
- **Drag:** `dragTarget` lifts the selection if it is in the pile, else the top tile. Once the
  press passes `DRAG_SLOP_PX`, the tile jumps so the finger sits at its bottom-middle grip —
  centred, 1/5 up from the bottom edge (`constants.ts` → `DRAG_GRIP_X_FRACTION`,
  `DRAG_GRIP_Y_FRACTION`; `SuperpositionBoard.tsx` → `handlePointerMove`) — keeping the stroke
  visible above the finger. A drop clears the selection.
- **Hint button:** `SuperpositionHintButton`, top-right on the grid, on the Leave arrow's row in
  a break. A press outlines two tiles and inks their strokes in `RAMP.org.mark` (`board.ts` → `pickHintPair`, held by the
  Stage as `hintedTileIds`). The pair belongs in one stack and is not in one yet; it reads `accepts`,
  so a lookalike swap counts. Locked tiles never qualify, and two lone loose tiles are
  preferred (a locked stack on the same cell does not count against "alone"); failing that, a tile in an unfinished pile can be picked, so a last tile can be
  pointed at its partial stack. The outline clears when the two tiles are dropped together or
  either locks into another stack; moving one elsewhere keeps it. The next hint comes
  `HINT_COOLDOWN_SECONDS` (15) later, counted down on the button and held while the app is
  backgrounded. A hint has no effect on marks or the personal best. The button's armed state
  reads the board at rest: while a tile is lifted the Stage keeps the pair it had before the
  lift (`restingHintPair`), so hovering a tile over a stack doesn't change the button.
- **Word info:** `SuperpositionHints`, drawn on the grid under the tiles and below the hint
  button: the words side by side across the top, each a column of toned pinyin (`TonedPronunciation`), dd (up to three lines)
  and an audio button. Each finished character gets a small filled green `check_circle`
  (`CHAR_CHECK_PX`, 14) under its own syllable, through `TonedPronunciation`'s
  `renderBelowSyllable` slot; the slot is always reserved (hidden until finished) so the pinyin
  never shifts. Syllables pair with characters by position, and a word whose syllable count
  differs from its characters gets no per-syllable checks (`SuperpositionHints.tsx` →
  `syllableChecks`). A larger check sits in a word's top corner once all its characters are
  finished. Only the audio button takes input, so a tile lying over the info stays grabbable.

Colors: game hue `tea`; finished outline, character checks and word check `RAMP.grn.mark`; selection `RAMP.pur.mark`; hint outline and stroke `RAMP.org.mark`.

## Stroke parts

Natural parts are the units `groupStrokes` (§ Stroke groups) builds tiles from: a part is never
opened, but it can share a tile with the strokes beside it in writing order.

`src/games/superposition/strokeParts.json` holds the parts as `{ char: [[stroke indices]] }`,
lazily imported by `SuperpositionStage.tsx` → `loadCharacters`. It is generated and committed
by `server/scripts/backfill/chinese/generate-superposition-parts.js`, which owns the approved
lists. Re-run it after changing a list or upgrading `hanzi-writer-data`:

- `WHOLE_PARTS`: kept whole wherever they appear. A listed part is never opened, because 日
  holds 口 and 田 holds 土. An unlisted part opens, so 语 yields 讠 and the 口 inside 吾.
- `SPLIT_PARTS`: cut into set pieces: ⺮ (two halves), 门 (dot and vertical / frame), 心 (dots /
  hook), 米 (two dots / 木), 西 (the box / the top bar and legs), 那 (left block / 阝, because the source leaves the left block
unmatched). These apply when the character is the part itself as well.
- A character's radical (the dictionary's `radical`, stroke indices from `radStrokes`) groups
  like a whole part, unless it is in `UNGROUPED_RADICALS`.

A character that is only one whole part (口, 木), or whose single part claims every stroke
(由), gets no parts entry and is grouped stroke by stroke, because one tile would deal as a finished stack. Repeated
parts get a tile each, so 品 is three 口 tiles. Stroke matches come from the Make Me a Hanzi
`matches` field read through `server/scripts/backfill/chinese/lib/decompose.js` →
`loadDecompositionEntries`; strokes it leaves unmatched are grouped as single strokes.

## Stroke groups

`groupStrokes` (`server/contracts/superpositionGroups.ts`, pure and shared by the client and the
stored-groups backfill) cuts a character into tiles. A **unit** is a natural part (§ Stroke parts),
never opened, or a stroke no part claims. Units sit in stroke order by their first stroke.

1. **Seed:** the free unit with the least ink (`strokeInk`, outline area in square glyph units)
   opens a group.
2. **Grow in stroke order:** the only candidates are the free unit just before the group and the
   free unit just after it. The better one joins (`compareContact`): touching beats apart
   (`TOUCH_TOLERANCE_UNITS`, 4); between two touching, the bigger overlap wins; between two
   apart, the shorter gap wins; a full tie takes the unit after. Growth stops once the group's
   ink reaches `INK_MERGE_THRESHOLD`, or when both sides are already grouped.
3. Repeat from the smallest free unit. A group never collects the other small units by size.
4. **Stranded:** a group that stopped under the threshold joins the better of its two
   neighbouring groups (same ranking), smallest first.
5. A character left as one group gives back its last addition as a second tile, because a lone
   tile is already a finished stack.

Every group is a contiguous run of units, so a tile's strokes are neighbours in writing order;
a part can still reach around others (囗 in 国). Parts are pullable: a dot may share 口's tile
(点 gives 卜 + 口, then 灬). Groups come out sorted, in stroke order, which is also the order
`groupsLookAlike` compares strokes in.

The threshold, 25,000, is set from 木 (2026-11-02): its smallest stroke holds about 26,000, so all
four strokes stand alone (30,000 merged the first three). 灬 once set it at 30,000, but it is now a
whole part and stays on one tile at any threshold. Over the 710 most frequent discoverable characters
with stroke data, 25,000 deals 2.98 tiles a character (30,000: 2.76) from 7.76 strokes. The rule costs about 13 ms a character in Node, almost all
of it the contact measure, which only runs when both sides are free.

## Stored groups

**Built, flagged OFF** (`FEATURE_FLAGS.superpositionStoredGroups`, docs/DEFERRED_WORK.md item 32).
The groups can be stored once on det instead of computed at every deal:

| Layer | Piece |
|---|---|
| Schema | `dictionaryentries_zh."superpositionGroups"` jsonb (migration 180): `[[stroke indices], …]`, single-character rows only |
| Writer | `server/scripts/backfill/chinese/backfill-superposition-groups.ts`: recomputes every row and writes the ones that differ; refuses to write while the flag is off (`--dry-run` always runs) |
| DAL | `server/dal/implementations/WritingGridDAL.ts` → `findSuperpositionGroups` |
| Service | `SuperpositionService.deal` attaches `strokeGroups` to each `SuperpositionCharacter`, only while the flag is on |
| Client | `board.ts` → `characterGroups` uses `BoardCharacter.groups` when they pass `isStrokePartition`, else computes |

A word reads its characters' rows, so multi-character rows stay NULL.

## Lookalike strokes

`LOOKALIKE_TOLERANCE_UNITS` (derived from the tile as a fixed 2px on screen, about 14 glyph
units on a 144px tile): a tile `accepts` every stroke whose medians stay within the tolerance
at every resampled point. Without this, swapping two
visually identical strokes would leave a finished-looking stack un-green. `stackFillsCharacter`
runs a bipartite matching because lookalikes are not transitive.

Measured 2026-11-01 over 20,000 random 3-word boards of discoverable words, on the original
32px tile (the 144px tile's 2px tolerance is about 0.44px on this scale, so these rates are an
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
