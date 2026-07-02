# Word Search Game (`/games/word-search`)

> Status: **built (v1).** All design questions below are resolved. This doc
> describes the shipped structure for future agents.

The second game in the Games hub (see [GAMES_FEATURE.md](./GAMES_FEATURE.md)).
The player is given 10 of their own vocabulary words and hunts for each one
inside a grid of Chinese characters. Words are hidden as **snaking paths**
(orthogonally-connected runs of cells), padded out with filler characters.

Like Bubble Match it is a **leaf page** (down-arrow back → `/games`, no footer)
and reuses the same colored-pinyin cell primitive (`CPCDRow` / cpcd).

---

## 1. Card selection (which 10 words)

Reuses Bubble Match's pool machinery so the two games feel like siblings.

- **Half of Bubble Match's distribution**, same category proportions
  (derived from `GAME_DISTRIBUTION` in `src/games/bubble-match/constants.ts`):
  `1 Unfamiliar + 5 Target + 3 Comfortable + 1 Mastered = 10`. The word-search
  `GAME_DISTRIBUTION` (`src/games/word-search/constants.ts`) halves each bucket.
- **Same fallback top-up** when a bucket is short: borrow from the fallback
  buckets in priority order (Target → Comfortable → Unfamiliar → Mastered),
  matching `OnDeckVocabService.getGameVocabPool` /
  `OnDeckVocabService.GAME_FALLBACK_ORDER`.
- Cards are library (`starterPackBucket = 'library'`), language-scoped, same as
  the bubble-match pool.

### 1a. Substring de-duplication (new)

A word search breaks if one target's Chinese text is a **substring** of
another's (e.g. `学` inside `学生`) — the shorter word would be "found"
everywhere the longer one is placed. So after the pool is assembled we enforce:

> **No selected word's `word1` may be a contiguous substring of any other
> selected word's `word1` (and vice-versa).**

Algorithm (server-side):

1. Assemble the 10-card pool (distribution + fallback, as above).
2. Scan for any pair where one word's Chinese text is a substring of another's.
3. For each offending pair, **drop the shorter word** and pull a replacement
   **of the same progress category** first, then falling back through the same
   fallback order — excluding cards already in the pool.
4. Re-run the substring scan. Repeat until the pool is clean **or** the user's
   entire library has been exhausted as replacement candidates.
5. If a clean set of 10 cannot be assembled, the game is **blocked** with:
   *"You need at least 10 Learn Now cards with distinct characters to play Word
   Search."* (mirrors the bubble-match blocked-phase copy).

> Note: substring, not just equality — `国` is a substring of `中国`, so they
> can't coexist. Single-character words are the most collision-prone.

---

## 2. Grid generation (new, server-side per user request)

Grid is **7 columns wide × 7 rows tall** (portrait; fills the play rectangle).
Each cell holds exactly one Chinese character (one cpcd cell).

### Placement (snaking)

For each of the 10 words, in order:

1. Pick a **random empty start cell** for the word's first character.
2. For each subsequent character, pick a **random empty cell adjacent** to the
   previous one. Adjacency is **orthogonal only (4-dir: up/down/left/right)** —
   no diagonals. Same adjacency governs valid drag-selection paths.
3. If at any step no valid (empty, in-bounds) adjacent cell exists,
   **backtrack**: abandon this placement and retry from a new random start.
4. Retry the word up to **10 times**. If it still fails, **regenerate the whole
   grid from scratch** (all words re-placed). A 7×7 (49-cell) grid holding ≤10
   short words is tighter than the old 10×10, so retries/regenerations will fire
   more often under this cap — revisit `MAX_WORD_ATTEMPTS`/`MAX_GRID_ATTEMPTS`
   (`server/services/wordSearchGrid.ts`) if placement failures become noticeable.

Words **do not overlap** — every character occupies its own cell (a cell used by
one word is not available to another). This keeps each word a single unambiguous
path.

Placement has no pinyin-width awareness — words are ordered longest-first and
placed with plain 4-directional snaking (`NEIGHBORS`), with no vertical-only
restriction and no horizontal-neighbor width check. (A prior version graded
horizontally-adjacent pinyin widths and forced colliding words to snake
vertically; that rule was removed — wide pinyin in adjacent cells may now visually
crowd on the row axis. Revisit if that reads as a real usability issue in
practice.)

### Filler

After all 10 words are placed, every remaining empty cell is filled with a
character drawn from a **level-appropriate filler bag**. The server:

1. Computes the user's estimated difficulty level via
   `StarterPacksService.estimateLevel` (1–6; the HSK level for zh).
2. Pulls real words (single- AND multi-character) from `dictionaryentries_zh`
   with `difficulty BETWEEN 1 AND <level>` — i.e. at or below the user's level.
3. Breaks each word into its component characters, pairing each char with its
   pinyin syllable from the word's space-separated `pronunciation`.

The resulting multiset (duplicates kept, so frequent characters recur naturally)
is the filler bag. A beginner therefore never sees advanced characters as noise.
Each filler still carries a real character + real pinyin, so filler cells stay
indistinguishable from word cells when pinyin is toggled on. If no level-tagged
words exist (difficulty un-backfilled), the server falls back to any
single-character `word1` rows.

### 2a. Anti-duplicate pass

Because filler is drawn from real words, a target's full character sequence
could — purely by chance — also trace through some *other* orthogonally-
adjacent path in the finished grid (through filler cells, or through another
word's cells), turns included, matching the same freedom the player's own drag
has (§4). If that happened, a player tracing that other path would see the
right characters but the client's found-check compares **exact coordinates**
against the word's stored `cells` (§4), so it would silently not register —
confusing, since the player did the "right" thing.

After placement + filler are both committed, `generateWordSearchGrid`
(`server/services/wordSearchGrid.ts`) runs a fixup pass (`findWordOccurrences`,
`MAX_DEDUP_PASSES = 20`):

1. For every placed word with **2+ characters**, DFS the whole grid for every
   simple path (no cell reused within one path) spelling its characters
   forward or reversed.
2. Any occurrence that isn't the word's own official placement (in either
   direction) is "unintended." Break it by re-rolling one of its cells — but
   only a **filler** cell (`!occupied[r][c]`); a placed word's own cells are
   never touched. The replacement is drawn from the full level-appropriate
   filler pool, excluding the character just removed where possible.
3. Repeat until a pass finds nothing left to fix, or bail (regenerate the whole
   grid from scratch, like a failed placement) if an occurrence has **no**
   fillable cell — i.e. it's made entirely of other placed words' cells lining
   up by chance — or if `MAX_DEDUP_PASSES` is exhausted without converging.

**Single-character words are exempt** — the filler bag deliberately reuses
common characters ("duplicates kept, so frequent characters recur naturally,"
above), so one recurring common character is by design, not a placement bug.

### Output payload

The grid endpoint returns, roughly:

```ts
{
  words: Array<{                 // the 10 targets (order = top-of-screen order)
    entryKey: string;            // Chinese word1
    pinyin: string;              // tone-marked, per-syllable for cpcd
    definition: string;          // English gloss shown in the top list
    cells: Array<[row, col]>;    // the path, in character order
  }>,
  grid: Array<Array<{ char: string; pinyin: string }>>,  // grid[row][col], 8 rows × 8 cols
  rows: number;
  cols: number;
}
```

The `cells` paths are needed client-side to validate a selection and to
highlight found words. (⚠️ OPEN: shipping the answer paths to the client makes
them inspectable in devtools. Acceptable for a low-stakes learning game; noted.)

---

## 3. Layout & rendering (frontend)

Vertical stack inside the standard leaf-page content area:

```
┌─────────────────────────────┐
│ header (down-arrow · pinyin toggle · fire badge)
├─────────────────────────────┤
│  10 English glosses, 1–2 compact lines              │  ← "Lv1 Chill" type style
├─────────────────────────────┤
│ ╭─────────────────────────╮ │
│ │                         │ │
│ │   rounded-rect grid     │ │  ← 7×7 cpcd cells
│ │   of cpcd cells         │ │
│ │                         │ │
│ ╰─────────────────────────╯ │
└─────────────────────────────┘
```

- **Word list (top):** the 10 targets shown as their **English glosses** (a
  recall drill — you read the meaning and hunt the Chinese in the grid),
  rendered so they fill **~2 compact lines**. Typography matches the Bubble
  Match HUD "Lv 1 · Chill" label: `fontSize: SIZE.body` (14px),
  `fontWeight: WEIGHT.bold`, `color: "#6b6b6b"`
  (`src/games/bubble-match/BubbleStage.tsx:889`). Found glosses get struck
  through / dimmed. (Glosses are `stripParentheses(definition)`, kept short so
  they tile; a very long definition is truncated.)
- **Grid (bottom):** one big **rounded-corner rectangle** filling the remaining
  height, containing the 7×7 array of cpcd cells. Each cell is one cpcd
  character (may be wrapped per-row in `CPCDRow`). The grid respects the header
  pinyin toggle uniformly across word + filler cells. Because the prompts are
  English, the **pinyin toggle only affects the grid** (there is no Chinese in
  the top list to toggle).

### Header controls

`WordSearchHeader.tsx` fills the leaf-page `rightContent` slot with, left→right:

- **Pinyin toggle — 3-state** (`pinyin-toggle-btn`): a single button cycling
  **off → plain → tone-colored → off** (replacing the old separate `pinyin` +
  `color` buttons). It maps onto the two persisted booleans in
  `useFlashcardLearnSettings` (`showPinyin`, `showPinyinColor`): off =
  `!showPinyin`; plain = `showPinyin && !showPinyinColor`; color = both. In the
  color state the button's own label "pinyin" is rendered with one `TONE_COLORS`
  hue per letter, previewing the mode. Toggling redraws both the top word list
  and the grid.
- **Timer toggle** (`timer-toggle-btn`) — flips only the timer's visibility; the
  clock keeps ticking (so the finish time / medal stays accurate).
- **Hint button** (`word-search__hint-btn`) — spends a hint; greyed out
  (disabled) until the hint meter reaches `HINT_COST`. See §5a.
- Fire badge (minute points) — route is in `MINUTE_POINTS_ELIGIBLE_PAGES`.

### Cell size

Use `CPCDRow` **`sm`** (32px column) for now. A `useFitScale` wrapper in
`WordSearchGrid.tsx` scales the whole 7×7 grid down to fit the play area
(transforms don't affect `elementFromPoint`, so drag hit-testing still works),
so it renders at real `sm` size and shrinks only as needed on short screens.

Columns are spaced apart by `CELL_GAP` px (`constants.ts`), applied as the CSS
grid `columnGap`. `WordSearchGrid` measures the rendered column width and locks
`gridTemplateRows` to a fixed `columnWidth + CELL_GAP` px track (`rowGap: 0`) so
the character-center-to-character-center pitch is equal on both axes even
though pinyin makes a cell's own content taller than it is wide — rows are
deliberately packed tighter than that content height, so adjacent rows'
char/pinyin content overlaps slightly rather than spacing characters unevenly.
Selected/found highlights render as a fixed-diameter circle (not the cell's own
box, which isn't square once pinyin is on) centered on the character glyph
itself — see `discOffsetY` in `WordSearchGrid.tsx` — and consecutive cells in a
drag or found word are joined by a "bridge" bar so a multi-cell highlight reads
as one continuous shape.

`useFitScale` also reserves `GRID_MARGIN` px on every side (passed as its `inset`
arg): the available width/height are shrunk before computing the scale, so the
fitted, center-aligned grid keeps a uniform gap from the container edges. This is
done in the scale math rather than as a CSS margin because the grid's measured
`offsetHeight` excludes margin and the container's `overflow: hidden` would clip
a real margin at the bottom.

---

## 4. Interaction

Because words snake, selection is a **path through orthogonally-adjacent cells**.
Selection is **drag-only**: press a finger on the starting cell and drag it
cell-to-cell along the path; the trail highlights as it grows. Each added cell
must be orthogonally adjacent to the current path tip and not already in the path
(dragging back onto the previous cell shrinks the trail). There is **no
tap-cell-by-cell building** — a lone tap is simply a one-cell path.

### On release: submit

**Letting go is the query.** On pointer release the current path is checked
**client-side against the remaining targets only** (see `tryFoundTarget` /
`submit` in `WordSearchGrid.tsx`), then the selection is **always cleared**
regardless of outcome:

- **Target check (client-side, ANY length).** The path is compared against the
  remaining targets' `cells` (exact-ordered or reversed). A match → **mark
  found**: strike the top-list gloss, lock the cell highlight, and play TTS.
  (There is **no on-find popup/notification card** — an earlier green "✓ FOUND"
  info-card was removed as disruptive; the strike-through + audio are the only
  feedback.) Because this is a pure client-side comparison against the
  working set, **single-character targets register too**, and a **lone tap on a
  cell counts as a one-character query**. Anything that isn't a target simply
  clears the trail.

There is **no dictionary lookup** — the game never calls the server on a
selection. (An earlier "bonus discovery" feature that looked up non-target
selections in `det` via `GET /api/dictionary/lookup/:term` to acknowledge valid
words the player uncovered has been **removed**.)

Tapping anywhere off a grid cell clears an in-progress trail.

### Reviewing a found word (English gloss popup)

Once a word is found its cells are **locked** (green) and become **review taps**:
tapping any locked cell opens an **English-gloss popup** above that word — the same
tap-to-reveal affordance as example-sentence segments
([EXAMPLE_SENTENCES.md](./EXAMPLE_SENTENCES.md) / `SegmentedSentenceDisplay`). This
lets the player re-check the meaning of a Chinese word they just uncovered.

Implemented in `WordSearchGrid.tsx`:

- A `foundWordByCell` reverse index maps each locked cell → its `PlacedWord`. In
  `onPointerDown`, a tap that lands on a locked cell short-circuits the drag and
  calls `toggleWordPopup` instead (locked cells can never belong to a *remaining*
  target because words are disjoint, so they never start a trace).
- The popup is a MUI `Popper` portal (escapes the grid's `overflow:hidden`),
  anchored to a **virtual element** whose rect (`anchorRectForWord`) is the union
  of the word's cells on its **topmost row** — so a snaking multi-row word still
  anchors over its first line. The rect is recomputed on `popupWord`/`scale`
  change (the `useFitScale` transform moves every cell's viewport rect).
- Toggling: tapping the open word (or another found word) closes/switches it;
  tapping an unfound cell or the background dismisses it (`clearSelection` also
  clears `popupWord`). The reviewed word's cells get a darker-green
  `word-search__cell--reviewing` fill.

**Win:** all 10 words found. There is **no lose state** — see §5.

---

## 5. Game mode — count-up timer + medals

- **No difficulty levels, no lose state.** One relaxed mode; the player can work
  on a board **indefinitely** until all 10 are found.
- **Incrementing (count-up) timer** runs from the first interaction to the last
  find, shown live in the header/HUD.
- On completion, a **medal** is awarded by total time against tunable thresholds
  (e.g. gold ≤ Xs, silver ≤ Ys, bronze otherwise) — thresholds live in
  `constants.ts`. Because play is unbounded, a slow finish still completes the
  board (just at the lowest medal tier). This mirrors the completion-stars idea
  in [PRACTICE_WRITING.md](./PRACTICE_WRITING.md).

### 5a. Hint meter

A lightweight, client-only assist layer (no server/DB involvement). State lives in
`WordSearchPage.tsx` (`hintUnits`, `hintCell`); the gauge is `WordSearchHintBar.tsx`;
tunables are in `constants.ts` (`HINT_BAR_UNITS = 8`, `HINT_COST = 4`).

- **Earning:** each successful find adds **one** unit to the meter, capped at
  `HINT_BAR_UNITS` (8). The HUD gauge is a row of 8 hollow segments that fill
  left-to-right, with a **threshold line drawn after the 4th segment** marking
  where a hint becomes usable. Once `hintUnits >= HINT_COST` the filled segments
  and threshold brighten so the meter reads as "armed."
- **Spending:** the header hint button is enabled only while `phase === "playing"`
  and `hintUnits >= HINT_COST`. Pressing it drains `HINT_COST` (4) units and picks
  a **random still-unfound word** (preferring one not already hinted), then pulses
  that word's **first cell** (`cells[0]`) in the grid via `hintCell`.
- **Clearing the pulse:** `hintCell` is retired when the hinted word is found
  (matched in `onFound` by comparing `cells[0]`) and reset on every new board.
  The grid renders it as an amber fill + ring pulse (`word-search__cell--hint`,
  `@keyframes wsHintPulse`), and a found/in-progress highlight takes precedence.

Open (minor, resolve at build time): minute-points eligibility (likely add the
route to `MINUTE_POINTS_ELIGIBLE_PAGES`), and whether to persist a best-time /
medal per user. **No new database tables or columns are anticipated** — the grid
is generated on demand; an optional best-time could reuse the existing
`gameprogress` JSONB blob (`{ bestTimeMs, medal }`).

---

## 6. Files (as built)

Frontend (`src/games/word-search/`):

- `WordSearchPage.tsx` — page shell + flow (loading → blocked | playing → won),
  count-up timer, found-set + win detection, medal, and on-find audio wiring.
- `WordSearchGrid.tsx` — the rounded-rect cpcd grid; owns drag path selection
  (a lone tap is a one-cell path), client-side target-path matching, a
  `useFitScale` transform so the 7×7 `sm` grid fits short screens, and the
  **found-word English-gloss popup** (tap a locked word → `Popper` review popup,
  `foundWordByCell` / `toggleWordPopup` / `anchorRectForWord`; see §4).
- `WordSearchWordList.tsx` — the ~2-line top English-gloss prompt list.
- `WordSearchHintBar.tsx` — the 8-segment HUD hint gauge with the `HINT_COST`
  threshold line (§5a).
- `WordSearchHeader.tsx` — 3-state pinyin toggle + timer toggle + hint button +
  fire badge (LeafPage `rightContent`).
- `constants.ts` — grid query, `CELL_SIZE`, medal thresholds, hint tunables
  (`HINT_BAR_UNITS`, `HINT_COST`); re-exports `GAME_DISTRIBUTION` from bubble-match.
- `types.ts` — `GridCell`, `PlacedWord`, `WordSearchResponse`, `Medal`.
- `src/games/registry.ts` — registers the `word-search` `GameDef`.
- `src/constants.ts` — `/games/word-search` added to `MINUTE_POINTS_ELIGIBLE_PAGES`.

Server:

- `server/services/wordSearchGrid.ts` — pure snaking-placement + filler flood
  (`generateWordSearchGrid`, `MAX_WORD_ATTEMPTS`, `MAX_GRID_ATTEMPTS`),
  4-directional orthogonal only, longest-word-first, no pinyin-width awareness —
  see §2. Also the anti-duplicate pass (`findWordOccurrences`,
  `pathsEqualEitherDirection`, `MAX_DEDUP_PASSES`) that re-rolls filler cells so
  no target's character sequence traces through an unintended path elsewhere in
  the grid — see §2a.
- `server/services/OnDeckVocabService.ts` — `getWordSearchGrid` (pool assembly +
  substring de-dup/replacement + level-bounded filler harvest from
  `dictionaryentries_zh` via `StarterPacksService.estimateLevel` +
  enrich/prewarm + grid gen). Grid dims: `WORD_SEARCH_ROWS`/`WORD_SEARCH_COLS`.
- `server/controllers/OnDeckVocabController.ts` — `getWordSearchGrid` handler
  (parses the distribution query, defaults to 2/10/6/2).
- `server/routes/onDeckRoutes.ts` — `GET /api/onDeck/word-search-grid`.

## 7. Dependencies / cross-references

- **Reuses:** `OnDeckVocabService.getGameVocabPool` machinery + `GAME_FALLBACK_ORDER`
  (pool + fallback), `CPCDRow` (`src/components/CPCDRow.tsx`) at `sm`, leaf-page
  shell, `BubbleMatchHeaderControls` pattern, and `GAME_DISTRIBUTION`.
- **Parent doc:** [GAMES_FEATURE.md](./GAMES_FEATURE.md) (framework, registry, leaf-page rules).
- **Related:** [CPCD_PINYIN_SHIFT.md](./CPCD_PINYIN_SHIFT.md) (cpcd spacing),
  [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md).
</content>
</invoke>
