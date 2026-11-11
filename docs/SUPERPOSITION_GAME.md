# Superposition (stroke-stacking game)

> **Status: DEPLOYED to PPE 2026-11-01, no migration.** A writing-flp game break and nothing else:
> break-only, with no route or hub tile (`src/games/registry.ts`). Grid and tile sizes are first-pass values, due to be tuned by hand. Parent doc:
> [GAMES_FEATURE.md](./GAMES_FEATURE.md). Break host: [FLP_GAME_BREAKS.md](./FLP_GAME_BREAKS.md).

The strokes of four characters are cut out onto transparent tiles, grouped into
pieces that read as parts of the character (AI-authored per character, § Stored groups; the
density algorithm in § Stroke groups covers a character not authored yet), and dealt in a bunch on a snapping grid. The learner stacks each character's tiles at one exact grid position. The
stroke keeps its true place inside the tile, so an exact stack redraws the character.

| Layer | Piece | Where |
|---|---|---|
| Contract | Board size, word picking, wire shapes | `server/contracts/superposition.ts` |
| Service | The deal | `server/services/SuperpositionService.ts` |
| DAL | Candidate words (shared with Writing Grid) | `server/dal/implementations/WritingGridDAL.ts` → `findCandidateWords` |
| Controller / route | `GET /api/superposition/deal` | `server/controllers/SuperpositionController.ts`, `server/routes/superpositionRoutes.ts` |
| Contract (pure, shared) | Stroke groups: the fallback algorithm | `server/contracts/superpositionGroups.ts` |
| Backfill (pipeline step) | Stroke groups: AI-authored, stored on det | `server/scripts/backfill/chinese/backfill-superposition-groups.js` |
| Game logic (pure) | Tiles, stacks, tap cycle, snapping | `src/games/superposition/board.ts` |
| Stage | The run: deal, stopwatch, marks, end | `src/games/superposition/SuperpositionStage.tsx` |
| Break | The one host | `src/games/flpBreak/superpositionBreak.ts`, `SuperpositionBreakStage.tsx` |

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
  Leaving early skips inspection.
- **Tap:** `nextTapSelection` walks the pile under the finger, the card icon editor's rule
  (`src/cardIcons/editor/CardIconCanvas.tsx` → `pickTapTarget`,
  [CARD_ICON_LAYOUT.md](./CARD_ICON_LAYOUT.md)). The selected stroke is highlighted.
- **Drag:** `dragTarget` lifts the selection if it is in the pile, else the top tile. Once the
  press passes `DRAG_SLOP_PX`, the tile jumps so the finger sits at its bottom-middle grip —
  centred, 1/5 up from the bottom edge (`constants.ts` → `DRAG_GRIP_X_FRACTION`,
  `DRAG_GRIP_Y_FRACTION`; `SuperpositionBoard.tsx` → `handlePointerMove`) — keeping the stroke
  visible above the finger. A drop clears the selection.
- **Hint button:** `SuperpositionHintButton`, on the Leave arrow's row, just left of the
  break's audio chip (`GameFrame` → `exitRowTrailing`), and in the chip's outlined pill at the
  chip's height (`outlinedChipSx`, `OUTLINED_CHIP_HEIGHT_PX`) so the two read as a pair. A press outlines two tiles and inks their strokes in `RAMP.org.mark` (`board.ts` → `pickHintPair`, held by the
  Stage as `hintedTileIds`). The pair belongs in one stack and is not in one yet; it reads `accepts`,
  so a lookalike swap counts. Locked tiles never qualify, and two lone loose tiles are
  preferred (a locked stack on the same cell does not count against "alone"); failing that, a tile in an unfinished pile can be picked, so a last tile can be
  pointed at its partial stack. The outline clears when the two tiles are dropped together or
  either locks into another stack; moving one elsewhere keeps it. The next hint comes
  `HINT_COOLDOWN_SECONDS` (15) later, counted down on the button and held while the app is
  backgrounded. A hint has no effect on marks or the personal best. The button's armed state
  reads the board at rest: while a tile is lifted the Stage keeps the pair it had before the
  lift (`restingHintPair`), so hovering a tile over a stack doesn't change the button.
- **Word info:** `SuperpositionHints`, drawn on the grid under the tiles, starting just below
  Leave's row (`GAME_FRAME_EXIT_CLEARANCE_PX` + `INFO_GAP_PX`): the words side by side across the top, each a column of toned pinyin (`TonedPronunciation`), dd (up to three lines)
  and an audio button. Each finished character gets a small filled green `check_circle`
  (`CHAR_CHECK_PX`, 14) under its own syllable, through `TonedPronunciation`'s
  `renderBelowSyllable` slot; the slot is always reserved (hidden until finished) so the pinyin
  never shifts. Syllables pair with characters by position, and a word whose syllable count
  differs from its characters gets no per-syllable checks (`SuperpositionHints.tsx` →
  `syllableChecks`). A larger check sits in a word's top corner once all its characters are
  finished. Only the audio button takes input, so a tile lying over the info stays grabbable.

Colors: game hue `tea`; finished outline, character checks and word check `RAMP.grn.mark`; selection `RAMP.pur.mark`; hint outline and stroke `RAMP.org.mark`.

## Stroke parts

Natural parts are closed tiles for `groupStrokes` (§ Stroke groups): a part is never opened and
never takes on other strokes. Each part deals as exactly its own tile.

`src/games/superposition/strokeParts.json` holds the parts as `{ char: [[stroke indices]] }`,
lazily imported by `SuperpositionStage.tsx` → `loadCharacters`. It is generated and committed
by `server/scripts/backfill/chinese/generate-superposition-parts.js`, which owns the approved
lists. Re-run it after changing a list or upgrading `hanzi-writer-data`:

- `WHOLE_PARTS`: kept whole wherever they appear. A listed part is never opened, because 日
  holds 口 and 田 holds 土. An unlisted part opens, so 语 yields 讠 and the 口 inside 吾. 自 is listed because the source
  names only its 目 (`⿻目？`): unlisted, its 丿 was left free (息, 鼻, 嗅, 夏).
- `SPLIT_PARTS`: cut into set pieces: ⺮ (two halves), 门 (dot and vertical / frame), 心 (dots /
  hook), 米 (two dots / 木), 西 (the box / the top bar and legs), 那 (left block / 阝, because the source leaves the left block
unmatched), 首 (the 丷一 hat / 自, because the source leaves 首's long bar unmatched, so neither
would form; 道 and 導 get both). These apply when the character is the part itself as well.
- A character's radical (the dictionary's `radical`, stroke indices from `radStrokes`) groups
  like a whole part, unless it is in `UNGROUPED_RADICALS`.
- A character that IS its own radical (黑, 言, 金, 走, …) is opened at the root rather than taken
  whole, so its inner parts are found: 黑 gets 灬 and 言 gets 亠 and 口 (95
  characters gained parts when this was fixed on 2026-11-03). Only a listed whole part at the root (口, 木) stays closed (`collectParts`'s
  `isRoot && !WHOLE_PARTS.has(char)` check).

A character that is only one whole part (口, 木), or whose single part claims every stroke
(由), gets no parts entry and is grouped stroke by stroke, because one tile would deal as a finished stack. Repeated
parts get a tile each, so 品 is three 口 tiles. Stroke matches come from the Make Me a Hanzi
`matches` field read through `server/scripts/backfill/chinese/lib/decompose.js` →
`loadDecompositionEntries`; strokes it leaves unmatched are grouped as single strokes.

## Stroke groups

**The fallback.** Stored AI groups (§ Stored groups) win whenever a character has them; this
algorithm runs on the device only for a character whose `superpositionGroups` is still NULL.
`groupStrokes` (`server/contracts/superpositionGroups.ts`, pure, shared with the backfill for its
helpers) cuts a character into tiles. Each natural part (§ Stroke parts) is a
**closed** tile: exactly its own strokes, never opened, never added to. Grouping runs only over
the **free** strokes (the ones no part claims), and works on where strokes sit, not on stroke
order.

No stroke-count limit sizes a tile; the density curve does (density = a group's ink,
`strokeInk`, over its bounding-box area).

0. **Simple characters:** a character of at most `SINGLE_STROKE_MAX` (4) strokes deals every
   stroke alone, parts ignored (木, 人, 口).
1. **Seed:** the densest pair of free strokes starts a group (a tie takes the lowest indices).
2. **Grow:** add the free stroke that leaves the group densest, and repeat. Stop before a **sharp
   drop**: when the next best stroke would leave the group under `DENSITY_DROP_RATIO` (0.9) × its
   current density, the group closes at that local peak of its density curve. Then seed again
   from the strokes left.
3. **Leftover:** a lone free stroke left at the end joins the group it leaves densest, so a free
   tile always has two strokes or more. It stays alone only when no free group exists (every
   other stroke is in a part). One-stroke *parts* (心's split dot, § Stroke parts) are parts, not
   leftovers.
4. A character left as one tile is cut where its growth's density fell hardest, both halves
   keeping at least two strokes, because a lone tile is already a finished stack.

**Tuning (`DENSITY_DROP_RATIO`, 2026-11-03, still being tuned):** a lower ratio tolerates bigger
drops and grows bigger tiles. At 0.85 球's right side grows into one 7-stroke tile; at 0.6 黑 is
one tile before rule 4. Growing a stroke into a box that already covers it always raises density,
so the curve mostly climbs and a drop marks the step that reaches for a stroke outside the cluster.

A tile's strokes need not be neighbours in writing order. Examples: 点 gives 卜 | 口 | 灬; 球 gives
王 | 一 + the right dot | 亅 + the left dot + ㇀ | ノ + ㇏; 象 gives ⺈ | 口 | 5 6 7 8 | 9 10; 我
gives its part | 一 + 戈; 耳 gives 0 2 5 | 1 3 4; 木 and 水 stay four strokes. 黑 gives
0 1 3 | 2 5 | 4 6 7 | 灬, its 灬 a part because own-radical characters are opened (§ Stroke
parts). Groups come out with
their strokes sorted, which is also the order `groupsLookAlike` compares strokes in, and ordered
by their first stroke.

Over the 710 most frequent discoverable characters with stroke data (7.76 strokes each):

| Rule | Tiles a character | Single-stroke tiles | Tiles of 5+ strokes |
|---|---|---|---|
| **density drop 0.9; ≤ 4 strokes all single** | **3.06** | **19%** (4% in characters of 5+ strokes) | **4%** |
| density drop 0.85 | 2.97 | 19% | 6% |
| density drop 0.8 | 2.86 | 20% | 8% |
| density score; min ¼, max ⅓ of strokes; floor 0.18 (replaced 2026-11-03) | 3.19 | 23% | 4% |

The single-stroke tiles left in characters of 5+ strokes are one-stroke parts and strokes whose
only neighbours are parts (the dot of 国). Earlier rules, all replaced on 2026-11-02/03: pairwise
density merging gated by stroke-count fractions (above), least box growth with box limits (3.09 /
24%), an ink threshold (3.30 / 30% at 20,000), and stroke-order chunking (3.24) or seeding at the
smallest stroke (3.16). Growing is O(n³) over a character's free strokes (≤ ~30), so no priority
queue.

## Stored groups

**ON** (`FEATURE_FLAGS.superpositionStoredGroups`). Each character's tiles are **AI-authored once**
and stored on det; the algorithm above (§ Stroke groups) is only the fallback for a character the
backfill has not reached yet.

| Layer | Piece |
|---|---|
| Schema | `dictionaryentries_zh."superpositionGroups"` jsonb (migration 180): `[[stroke indices], …]`, single-character rows only |
| Writer | `server/scripts/backfill/chinese/backfill-superposition-groups.js`: a `/mark-discoverable` pipeline step (`REQUIRED_SCRIPTS_ZH`, `when: 'always'`), so the PPE oracle workers pick it up through `oracle-plan.js`. Model `claude-opus-5-5` |
| DAL | `server/dal/implementations/WritingGridDAL.ts` → `findSuperpositionGroups` |
| Service | `SuperpositionService.deal` attaches `strokeGroups` to each `SuperpositionCharacter` (while the flag is on) |
| Client | `board.ts` → `characterGroups` uses `BoardCharacter.groups` when they pass `isStrokePartition`, else computes with `groupStrokes` |

**How the writer works.** It is handed WORDS but authors CHARACTERS: it collects the distinct
characters of the selected words and skips any whose rows are already stamped at its
`SCRIPT_VERSION`, so a character shared by many words is authored once.
- A character of ≤ `SINGLE_STROKE_MAX` strokes gets every stroke alone with no model call.
- A character with no hanzi-writer-data file gets a decided NULL.
- Every other character gets one model call. Its answer is written to every zh row with that
  `word1`, and each row is stamped.
- A word row is stamped once all of its characters are.

Done-ness is the `enrichmentLog` stamp, never the column: multi-character rows stay NULL for good.
An answer must be an exact partition into ≥ 2 tiles, or it is left unwritten and unstamped and
printed as `⚠ SUPERPOSITION GROUPS REVIEW <char>` so a later round retries it.

**The prompt** (`SYSTEM_TEXT` in the script) was worked out with the owner on 2026-11-03 and tried
on 球 我 黑 象, 想 道 跳 慢 and 重 鬼 黄 赛. In priority order:
1. Natural parts stay whole.
2. Tiles are dense.
3. No lone strokes.
4. No tile of half the character.
5. Writing order is free.
6. Never one tile.
7. Leftover strokes form clean sub-shapes.

One boundary rule overrides the size rule: a tile never mixes strokes from two components, and a
too-big part splits only along its own sub-components. That rule is why 道 deals its 丷一 hat and
its 自 apart. Each stroke is shown with its full component path (`componentPath`, which recurses
into each component's own Make Me a Hanzi entry), its median, its box and its ink, plus the
strokeParts.json parts as hints.

Revising the prompt means bumping `SCRIPT_VERSION` and its `REQUIRED_SCRIPTS_ZH` version together.
The oracle workers then re-author every character once.

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

A finished run earns a **speed tier** (1 = best … 7) on the results card:
`src/games/superposition/constants.ts` → `SPEED_TIERS` (⚠️ first-guess placeholders for the
4-character board: 20 s · 30 s · 45 s · 60 s · 90 s · 120 s), read by `SuperpositionStage`
through `speedTierFor`. No accuracy tier. A left run is "Run ended", untiered. The game logs
no wins. Shared model: [GAMES_FEATURE.md § Run tiers](./GAMES_FEATURE.md).

Each character's first finish in a run sends a full writing mark to its single-character card
(`type: "writing"`, `surface: "superposition"`, top level so `writingMarkCounts` passes). The
server still drops a mark on a resting or fully mastered character. Leave ends a break's run
with what stands finished, and no personal best.

## Referenced by

`server/constants.ts` → `KNOWN_GAME_IDS`; `server/contracts/featureFlags.ts` → `GAME_FLAGS`;
`src/games/registry.ts`; `src/games/flpBreak/index.ts` → `FLP_BREAK_GAMES`.
