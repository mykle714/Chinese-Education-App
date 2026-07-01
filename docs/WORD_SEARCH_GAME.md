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

Grid is **14 columns wide × 12 rows tall** (portrait; fills the play rectangle).
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
   grid from scratch** (all words re-placed). The probability of needing this on
   a 168-cell grid with ≤10 short words is very low, so 10 is generous.

Words **do not overlap** — every character occupies its own cell (a cell used by
one word is not available to another). This keeps each word a single unambiguous
path.

### Filler

After all 10 words are placed, every remaining empty cell is filled with a
**random single Chinese character sampled from `dictionaryentries_zh`**
(single-character `word1` rows), so each filler carries a real character + real
pinyin. This keeps filler cells indistinguishable from word cells when pinyin is
toggled on.

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
  grid: Array<Array<{ char: string; pinyin: string }>>,  // grid[row][col], 12 rows × 14 cols
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
│ │   rounded-rect grid     │ │  ← 14×12 cpcd cells
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
  height, containing the 14×12 array of cpcd cells. Each cell is one cpcd
  character (may be wrapped per-row in `CPCDRow`). The grid respects the header
  pinyin toggle uniformly across word + filler cells. Because the prompts are
  English, the **pinyin toggle only affects the grid** (there is no Chinese in
  the top list to toggle).

### Header controls

- **Pinyin toggle** (on/off) — same control pattern as
  `BubbleMatchHeaderControls` (`src/games/bubble-match/BubbleMatchHeader.tsx`),
  filling the leaf-page `rightContent` slot. Toggling redraws both the top word
  list and the grid.
- Fire badge (minute points) — if this route is added to
  `MINUTE_POINTS_ELIGIBLE_PAGES` (⚠️ OPEN, see Q under §5).

### Cell size

Use `CPCDRow` **`sm`** (32px column) for now. A `useFitScale` wrapper in
`WordSearchGrid.tsx` scales the whole 14×12 grid down to fit the play area
(transforms don't affect `elementFromPoint`, so drag hit-testing still works),
so it renders at real `sm` size and shrinks only as needed on short screens.

---

## 4. Interaction

Because words snake, selection is a **path through orthogonally-adjacent cells**,
built up cell-by-cell. **Both input methods are supported** and share one
path-building model:

- **Drag:** press and drag a finger cell-to-cell along the path; the trail
  highlights as it grows.
- **Tap:** tap cells one at a time to extend the path (tap the last cell again,
  or tap away, to back off / clear).

Each added cell must be orthogonally adjacent to the current path tip and not
already in the path.

### On every selection (tap-complete or drag-release): submit + dictionary lookup

When the player finishes a selection — a **drag release**, or a **tap** — the
current path is evaluated in two stages (see `tryFoundTarget` / `submit` in
`WordSearchGrid.tsx`):

1. **Target check (client-side, ANY length).** The path is compared against the
   remaining targets' `cells` (exact-ordered or reversed). A match → **mark
   found**: strike the top-list gloss, lock the cell highlight, play TTS, and pop
   the info-card. Because this is a pure client-side comparison against the
   working set, **single-character targets register too** (a single tap on the
   cell) — no dictionary round-trip needed.
2. **Dictionary lookup (multi-character only).** If the path isn't a target and
   is ≥ 2 characters, the joined term is looked up in `det`
   (`GET /api/dictionary/lookup/:term`). A hit → **discovery info-card** (word,
   pinyin, short definition) + TTS, so valid non-target words the player uncovers
   are still acknowledged. Single-character non-targets do nothing (too noisy).

A failed **drag** clears the trail; tap-building keeps the path so the player can
extend toward a longer word. Tapping anywhere off a grid cell also clears it.

**Win:** all 10 words found. There is **no lose state** — see §5.

> Open (minor): whether discovering a non-target valid word grants any
> reward/score, or is purely informational. Defaulting to **informational**.

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

Open (minor, resolve at build time): minute-points eligibility (likely add the
route to `MINUTE_POINTS_ELIGIBLE_PAGES`), and whether to persist a best-time /
medal per user. **No new database tables or columns are anticipated** — the grid
is generated on demand; an optional best-time could reuse the existing
`gameprogress` JSONB blob (`{ bestTimeMs, medal }`).

---

## 6. Files (as built)

Frontend (`src/games/word-search/`):

- `WordSearchPage.tsx` — page shell + flow (loading → blocked | playing → won),
  count-up timer, found-set + win detection, medal, info-card + audio wiring.
- `WordSearchGrid.tsx` — the rounded-rect cpcd grid; owns drag **and** tap path
  selection (shared model), target-path matching, on-selection det lookup, and a
  `useFitScale` transform so the 14×12 `sm` grid fits short screens.
- `WordSearchWordList.tsx` — the ~2-line top English-gloss prompt list.
- `WordSearchHeader.tsx` — pinyin toggle + fire badge (LeafPage `rightContent`).
- `WordSearchInfoCard.tsx` — animated dictionary info-card (word · pinyin ·
  gloss) shown on any valid multi-char selection; auto-dismisses.
- `constants.ts` — grid query, `CELL_SIZE`, medal thresholds; re-exports
  `GAME_DISTRIBUTION` from bubble-match.
- `types.ts` — `GridCell`, `PlacedWord`, `WordSearchResponse`, `Medal`.
- `src/games/registry.ts` — registers the `word-search` `GameDef`.
- `src/constants.ts` — `/games/word-search` added to `MINUTE_POINTS_ELIGIBLE_PAGES`.

Server:

- `server/services/wordSearchGrid.ts` — pure snaking-placement + filler flood
  (`generateWordSearchGrid`, `MAX_WORD_ATTEMPTS`, `MAX_GRID_ATTEMPTS`).
- `server/services/OnDeckVocabService.ts` — `getWordSearchGrid` (pool assembly +
  substring de-dup/replacement + filler fetch from `dictionaryentries_zh` +
  enrich/prewarm + grid gen). Grid dims: `WORD_SEARCH_ROWS`/`WORD_SEARCH_COLS`.
- `server/controllers/OnDeckVocabController.ts` — `getWordSearchGrid` handler
  (parses the distribution query, defaults to 2/10/6/2).
- `server/server.ts` — `GET /api/onDeck/word-search-grid`.

## 7. Dependencies / cross-references

- **Reuses:** `OnDeckVocabService.getGameVocabPool` machinery + `GAME_FALLBACK_ORDER`
  (pool + fallback), `CPCDRow` (`src/components/CPCDRow.tsx`) at `sm`, leaf-page
  shell, `BubbleMatchHeaderControls` pattern, `GAME_DISTRIBUTION`, and the det
  lookup (`GET /api/dictionary/lookup/:term` via `useDictionaryEntries`) for the
  on-selection info-card.
- **Parent doc:** [GAMES_FEATURE.md](./GAMES_FEATURE.md) (framework, registry, leaf-page rules).
- **Related:** [CPCD_PINYIN_SHIFT.md](./CPCD_PINYIN_SHIFT.md) (cpcd spacing),
  [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md).
</content>
</invoke>
