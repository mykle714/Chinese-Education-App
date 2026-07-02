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
- **≤4-character cap**: each per-category candidate query filters
  `LENGTH(ve."entryKey") <= 4` — words longer than that are never selectable
  for this game. This keeps every word compatible with the template fallback's
  4-cell slots (see [WORD_SEARCH_TEMPLATES.md](./WORD_SEARCH_TEMPLATES.md)).

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
   no diagonals. Same adjacency governs valid drag-selection paths. **Exception:**
   2-character words only step **down or right** (`FORWARD_NEIGHBORS`), so their
   single step always reads in character order; 3+ character words are
   unaffected and may snake in any of the 4 directions at each step.
3. If at any step no valid (empty, in-bounds) adjacent cell exists,
   **backtrack**: abandon this placement and retry from a new random start.
4. Retry the word up to **10 times**. If it still fails, **regenerate the whole
   grid from scratch** (all words re-placed). A 7×7 (49-cell) grid holding ≤10
   short words is tighter than the old 10×10, so retries/regenerations will fire
   more often under this cap — revisit `MAX_WORD_ATTEMPTS`/`MAX_GRID_ATTEMPTS`
   (`server/services/wordSearchGrid.ts`) if placement failures become noticeable.

Words are capped at **≤4 characters** (enforced at pool-assembly time, §1) and,
after `RANDOM_GRID_ATTEMPTS` (5) failed whole-grid regenerations, placement
falls back to one of 10 pre-authored template layouts that guarantee all 10
words fit — see [WORD_SEARCH_TEMPLATES.md](./WORD_SEARCH_TEMPLATES.md) for the
full design.

Words **do not overlap** — every character occupies its own cell (a cell used by
one word is not available to another). This keeps each word a single unambiguous
path.

Placement has no pinyin-width awareness — words are ordered longest-first and
placed with plain 4-directional snaking (`NEIGHBORS`, or `FORWARD_NEIGHBORS` for
2-char words per above), with no horizontal-neighbor width check. (A prior version graded
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
3. Breaks each word into its component characters (chars only — the source
   word's `pronunciation` is discarded, since a character's reading inside a
   specific word can be a context-specific tone-sandhi/erhua/neutral-tone
   variant rather than its own standalone reading).
4. Looks up each *unique* harvested character back in `dictionaryentries_zh` as
   its own headword (`word1 = <char>`) and takes that row's `pronunciation` as
   the character's canonical pinyin. Characters with no standalone det entry are
   dropped from the pool.

The resulting multiset (duplicates kept, so frequent characters recur naturally)
is the filler bag. A beginner therefore never sees advanced characters as noise,
and every filler cell always shows the character's most common reading rather
than a word-context-specific one. Each filler still carries a real character +
real pinyin, so filler cells stay indistinguishable from word cells when pinyin
is toggled on. If no level-tagged words exist (difficulty un-backfilled), the
server falls back to any single-character `word1` rows.

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
  bonusWords: Array<{            // every det headword buildable from grid chars — see below
    entryKey: string;
    pinyin: string;
    definition: string;
  }>,
  grid: Array<Array<{ char: string; pinyin: string }>>,  // grid[row][col], 8 rows × 8 cols
  rows: number;
  cols: number;
}
```

The `cells` paths are needed client-side to validate a selection and to
highlight found words. (⚠️ OPEN: shipping the answer paths to the client makes
them inspectable in devtools. Acceptable for a low-stakes learning game; noted.)

**`bonusWords`** (added alongside §4's blue-highlight review popup): every
`dictionaryentries_zh` headword whose **entire** `word1` character sequence is
drawn from the set of distinct characters that ended up somewhere on the
finished grid — computed in `OnDeckVocabService.getWordSearchGrid` right after
`generateWordSearchGrid` returns, via
`WHERE word1 ~ ('^[' || <grid char class> || ']+$')`. The `^…$` anchors pin
*both* ends of the regex to the character class, so a word with even one
character outside the grid's set is excluded — containing a grid character is
not sufficient, every character must be one. Capped at `LIMIT 1000` purely as
a payload safety net (not a product requirement) in case the grid's character
set happens to match an unusually large number of headwords. This list makes
**no claim about traceability** — it's built from the grid's character *set*,
not any adjacency graph, so it will include words the player can't actually
trace through the grid; the client still verifies the real dragged path
against it (§4), so an untraceable entry is simply never matched, not a bug.

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

- **Restart button** (`word-search__restart-btn`) — discards the current board
  (clearing any saved-game snapshot, see §5b) and loads a fresh one, via the
  same `resetBoard` used by the win-screen "Play Again" button.
- **Hint button** (`word-search__hint-btn`) — spends a hint; greyed out
  (disabled) until the hint meter reaches `HINT_COST`. See §5a.
- **Settings cog** (`word-search__settings-btn`) — opens `WordSearchSettingsDialog`,
  a small MUI `Dialog` (not the flp `SheetPanel`/drag-resize sheet — that
  machinery lives inside `features/flashcards` and games don't reach into it;
  this mirrors its *behavior*, not its implementation) holding:
  - **Show pinyin** / nested **Color pinyin by tone** — the same two booleans
    as flp, via the shared `useFlashcardLearnSettings` (`showPinyin`,
    `showPinyinColor`), so the setting stays in sync with flp. Toggling
    redraws both the top word list and the grid. Because the prompts are
    English, pinyin only ever affects the grid (there is no Chinese in the
    top list to toggle).
  - **Show timer** — Word-Search-only, persisted via `useWordSearchSettings`
    (`wordSearch.settings` in localStorage). Flips only the timer TEXT's
    visibility; the clock keeps ticking regardless (so the finish time / medal
    stays accurate).
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
Selected/found highlights render as **stadium shapes** — rounded rectangles
whose corner radius is half their cross-axis thickness, so the ends read as
full semicircles — one per consecutive pair of cells in a drag or found word,
sized off the cell's smaller dimension (not the cell's own box, which isn't
square once pinyin is on) and centered on the character glyph itself (see the
offset computation in `WordSearchGrid.tsx`'s selection-geometry effect). A
one-cell highlight (no pair to connect) draws a standalone circular node
instead. Consecutive stadiums' rounded ends coincide exactly at their shared
cell, so a snaking, multi-turn highlight reads as one unbroken shape with no
separate cap/connector elements (`selectionRects` in `WordSearchGrid.tsx`).

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
`submit` in `WordSearchGrid.tsx`):

- **Target check (client-side, ANY length).** The path is compared against the
  remaining targets' `cells` (exact-ordered or reversed). A match → **mark
  found**: strike the top-list gloss, lock the cell highlight, and play TTS,
  then the selection clears immediately.
  (There is **no on-find popup/notification card** — an earlier green "✓ FOUND"
  info-card was removed as disruptive; the strike-through + audio are the only
  feedback.) Because this is a pure client-side comparison against the
  working set, **single-character targets register too**, and a **lone tap on a
  cell counts as a one-character query**.
- **A miss holds the traced path visible** (`invalid` state) instead of
  resetting silently. Starting a new drag — or any other new interaction, see
  below — dismisses it immediately.
  - **True miss (red, auto-clears after `MISS_FLASH_MS` = 320ms).** The
    spelled-out characters don't match any `bonusWords` entry either: the
    selection shapes switch from yellow (`COLORS.yellowAccent`) to red
    (`COLORS.redAccent`) and each traced cell plays a small nonce-keyed shake
    (`wsInvalidShake-*`, ±4px/±0.5deg, 0.32s) — a scaled-down version of the
    "denied action" shake used elsewhere (fie's icon-shake in
    `CardIconCanvas.tsx`, flp's `cardShake` in `FlashCardSection.tsx`). No
    popup. `MISS_FLASH_MS` is tunable in `constants.ts`.
  - **Bonus word, 2+ characters (blue, no auto-clear).** The path's characters
    (forward or reversed) match a `bonusWords` entry — a real det headword
    built entirely from characters on this grid, but not one of the 10
    targets. The same shake plays once, the selection turns blue
    (`COLORS.blueAccent`) instead of red, and the word's definition appears in
    the review-popup style (below). Unlike a true miss this has **no timer** —
    it stays up until the player dismisses it by tapping elsewhere.
  - **Bonus word, 1 character (no highlight at all, no shake, no auto-clear).**
    A lone tap is just a one-cell query, so if that single character is itself
    a det headword, it resolves here: no selection shape is drawn at all — not
    even the normal yellow in-progress color (`selectionColor` is `null` in
    this case in `WordSearchGrid.tsx`) — no shake, and only the definition
    popup appears, again with no timer until dismissed. A single character is
    a much smaller "find" than a whole word, so it skips the miss-flash
    treatment entirely.
  - **Dismissing a bonus match:** any new `onPointerDown` — starting a fresh
    drag, tapping a found word (which opens that word's own popup instead),
    or a background tap (`WordSearchPage`'s `handleBackgroundPointerDown` →
    `clearSelection`) — clears `invalid` and the stale `path` together, so the
    old highlight/popup can never linger under a new interaction.

There is **no server round-trip on a selection** — `bonusWords` (§2 Output
payload) is fetched once with the grid, and `submit` in `WordSearchGrid.tsx`
checks the traced path against it entirely client-side, the same way it checks
targets. (An earlier "bonus discovery" feature that called `GET
/api/dictionary/lookup/:term` per selection was removed; this replaces it with
a pre-fetched list instead of a live lookup.)

Tapping anywhere off a grid cell clears an in-progress trail.

### Reviewing a found word (English gloss popup)

Once a word is found its cells are **locked** (green) and become **review taps**:
tapping any locked cell opens an **English-gloss popup** above that word — the same
tap-to-reveal affordance as example-sentence segments
([EXAMPLE_SENTENCES.md](./EXAMPLE_SENTENCES.md) / `SegmentedSentenceDisplay`). This
lets the player re-check the meaning of a Chinese word they just uncovered.

Because a word's grid cells can snake in any direction (up/down/backwards, per
§2's forward-only exception only applying to 2-char words), the glyphs alone
don't reliably read in the word's actual character order. Both this popup and
the bonus-word miss popup below therefore **prepend the word's Chinese text**
(`activePopup.entryKey`, bold, space-separated from the definition — no dash)
before the definition — e.g. "学生 student" — so the player can always see the
correctly-ordered word regardless of how it was laid out or traced.

Implemented in `WordSearchGrid.tsx`:

- A `foundWordByCell` reverse index maps each locked cell → its `PlacedWord`. In
  `onPointerDown`, a tap that lands on a locked cell short-circuits the drag and
  calls `toggleWordPopup` instead (locked cells can never belong to a *remaining*
  target because words are disjoint, so they never start a trace).
- The popup is a MUI `Popper` portal (escapes the grid's `overflow:hidden`),
  anchored to a **virtual element** whose rect (`anchorRectForCells`) is the union
  of a set of cells on their **topmost row** — so a snaking multi-row word still
  anchors over its first line. The same helper anchors both this popup (over
  `popupWord.cells`) and the bonus-word miss popup above (over the just-traced
  `path`, via `invalid.bonus`) — `activePopup` picks whichever is active (a
  found-word review always takes precedence; the two can't overlap in practice
  since starting a new drag clears `popupWord`). The rect is recomputed on
  `popupWord`/`invalid`/`scale` change (the `useFitScale` transform moves every
  cell's viewport rect).
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
`WordSearchPage.tsx` (`hintUnits`, `hintEntryKey`, `hintRevealCount`,
`hintLocationRevealed`, `hintShakeNonce`); the meter gauge is
`WordSearchHintBar.tsx`, the letter-hint display row is `WordSearchHintRow.tsx`,
the pinyin→units split lives in `pinyinUnits.ts`, the matching gloss tint lives
in `WordSearchWordList.tsx`, and the grid-side yellow location reveal + shake
live in `WordSearchGrid.tsx`; tunables are in `constants.ts`
(`HINT_BAR_UNITS = 8`, `HINT_COST = 1`, `LETTER_HINT_BLANK_WIDTH = 3`,
`HINT_ACCENT_COLOR`).

Revealing a word's grid **location** was too easy a hint (v1's cell-pulse
mechanic); v2 replaces it with a cheap, hangman-style **pinyin reveal** so a
hint nudges recall without handing over the answer.

- **Earning:** each successful find adds **one** unit to the meter, capped at
  `HINT_BAR_UNITS` (8). The HUD gauge is a row of 8 hollow segments that fill
  left-to-right, with a **threshold line drawn after the `HINT_COST`-th
  segment** marking where a hint becomes usable. Once `hintUnits >= HINT_COST`
  the filled segments and threshold brighten so the meter reads as "armed."
- **Reveal granularity (`pinyinUnits.ts`):** a hint reveals one **phonetic
  unit** at a time, not one raw Latin letter — `syllableToPinyinUnits` splits
  each syllable into its initial consonant / medial glide / final (e.g.
  `"xiǎng"` → `["x","i","ǎng"]`, `"gōng"` → `["g","ōng"]`), mirroring how
  Bopomofo (Zhuyin) segments a syllable into its actual sound-blocks, but
  rendered as plain pinyin text (with the original tone diacritics) rather
  than Zhuyin glyphs. This avoids letter-at-a-time reveals giving away more or
  less than one meaningful chunk depending on spelling (e.g. "zh" is one
  initial sound spelled with two letters).
- **Display row (`WordSearchHintRow.tsx`):** sits between the English gloss
  list and the grid. **Blank by default** — nothing renders here until the
  player's first hint spend. Once a hint has picked a word, the row shows a
  mask built by `buildMask`: **one underscore "island" per Chinese
  character** in the word (space-separated, one per `pinyin` syllable) — so
  the island count openly gives away the word's **character count**, by
  design. Each island is padded to a **fixed `LETTER_HINT_BLANK_WIDTH` (3)
  underscores** regardless of that syllable's real unit count, so a
  syllable's own unit count stays hidden until its units are actually
  revealed. Units are distributed **round-robin across characters**
  (`distributeRevealTiers`), not filled one island at a time: every
  character's 1st unit is given out before any character's 2nd, then every
  2nd before any 3rd, wrapping until the word is fully spelled out — a
  character with fewer units than the current tier is simply skipped. E.g. a
  2-char word like 变化 (biàn huà) goes `___ ___` → `b___ ___` → `b___ h___` →
  `bi___ h___` → … rather than fully spelling out 变 before starting on 化.
- **Matching gloss tint:** while a word is actively hinted (mask showing or
  location revealed), `WordSearchWordList` tints that word's English gloss in
  `HINT_ACCENT_COLOR` — the same color as the mask text — so the player can
  tell which English word the mask/highlight belongs to without it being
  spelled out in the row itself.
- **Spending (`useHint` / `canUseHint` in `WordSearchPage.tsx`):**
  1. If a word is already being hinted (`hintEntryKey`) and it's still unfound
     with unrevealed units left, drain `HINT_COST` (1) and reveal **one more
     pinyin unit of that same word** (`hintRevealCount++`, counted across all
     syllables in round-robin order) — the mask grows in place.
  2. If that word is still unfound but its pinyin is **already fully spelled
     out** (no units left to reveal) and its location **isn't yet
     revealed**, drain `HINT_COST` and lock onto it: `hintLocationRevealed =
     true` lights up its actual grid cells in **yellow** (`WordSearchGrid`'s
     `hintedWord`, painted via the same stadium overlay used for
     selection/found highlights) and bumps `hintShakeNonce` to shake them
     (same nonce-keyed `wsInvalidShake`-style keyframe trick as a miss).
  3. If that word's location is **already revealed** (i.e. this isn't the
     first time hitting case 2), pressing hint again is **FREE** — no unit is
     drained, `hintUnits` unchanged — it only bumps `hintShakeNonce` to
     re-shake the same cells as a "where was that again?" nudge. This state
     persists regardless of what else the player selects in the meantime,
     and hint stays locked on this word — it never advances to another one —
     until the word is actually found.
  4. Otherwise (no active hint yet, or the active word was just found) drain
     `HINT_COST`, pick a new random still-unfound word, and reveal its first
     unit.
  `canUseHint()` — which gates the header hint button — mirrors this: it's
  true whenever case 3 applies (free, no unit check) or whenever
  `hintUnits >= HINT_COST` and some word is still unfound (cases 1/2/4).
- **Bonus-word ("blue match") hint award:** tracing a real multi-character det
  word that isn't a target flashes blue and shows its definition (§4,
  `isMultiCharBonus` in `WordSearchGrid.tsx`) — this fires `onBonusFound`, and
  the first time **each distinct** blue word is found on a board it awards one
  hint unit too (same cap as a real find). Tracked by `entryKey` in a
  `rewardedBonusWordsRef` set in `WordSearchPage.tsx`, reset every new board —
  re-tracing the same bonus word again (its popup has no auto-dismiss, so
  that's easy to do) does **not** re-award, but a *different* bonus word still
  earns its own unit.
- **Clearing:** when the actively-hinted word is found (matched by `entryKey`
  in `onFound`), `hintEntryKey`/`hintRevealCount`/`hintLocationRevealed` all
  reset — the row, the gloss tint, and the grid's yellow highlight all clear
  together — ready for the next hint press to pick a fresh word.

Open (minor, resolve at build time): minute-points eligibility (likely add the
route to `MINUTE_POINTS_ELIGIBLE_PAGES`), and whether to persist a best-time /
medal per user. **No new database tables or columns are anticipated** — the grid
is generated on demand; an optional best-time could reuse the existing
`gameprogress` JSONB blob (`{ bestTimeMs, medal }`).

### 5b. Pause/resume persistence

Client-only, no server/DB involvement (same design posture as §5a's hint
meter) — the full board payload is already on the client, so a single
localStorage blob (`gameStateStorage.ts`, key `wordSearch.savedGame`) is
enough to survive an exit or the app being backgrounded.

- **What's saved** (`SavedWordSearchState`): the grid payload (`data`),
  `found` entryKeys, elapsed timer ms, whether the timer had ever been
  started, and the full hint-meter state (§5a) + rewarded-bonus-word set —
  everything needed to resume as if nothing happened.
- **When it saves** (`WordSearchPage.tsx`):
  - `visibilitychange` → `document.hidden` (tab backgrounded / app switched
    away) — saves, then pauses the timer.
  - `beforeunload` (hard close/refresh) — a safety net; `visibilitychange`
    already covers tab-hide, but not every close path fires it.
  - Component **unmount** (covers the leaf-page down-arrow back, and any
    other exit) — a `useEffect` cleanup with an empty dep array saves once on
    the way out, same as the other two triggers.
  - All three no-op unless `phase === "playing"` and the board isn't already
    complete (`found.size < data.words.length`) — nothing to save while
    loading/blocked/won.
- **Timer pause/resume invariant:** `startRef.current` is non-null **only**
  while the count-up interval is actively ticking; `pausedElapsedRef` mirrors
  the last known elapsed value so a paused board can be measured or resumed
  without it; `hasStartedRef` records whether the clock has *ever* started on
  this board (independent of whether it's ticking right now) — this gates
  whether a resumed board auto-resumes ticking or stays at 0 untouched.
  `pauseTimer`/`resumeTimer`/`startTicking` in `WordSearchPage.tsx` share this
  invariant; `persistSnapshot` reads elapsed directly off
  `startRef`/`pausedElapsedRef` (not the `elapsedMs` React state) so a save
  triggered mid-tick isn't lagged by up to one 500ms interval step.
- **On mount:** `loadGameState()` is checked before `fetchGrid()` — a valid,
  unfinished saved board is restored via `restoreBoard` (which auto-resumes
  the timer if `timerStarted`) instead of fetching a new one from the server.
- **Cleared** on win, and by the restart button / "Play Again" (`resetBoard`
  in `WordSearchPage.tsx`) — both funnel through the same reset path, so
  there's exactly one way a board's save gets discarded on purpose.

---

## 6. Files (as built)

Frontend (`src/games/word-search/`):

- `WordSearchPage.tsx` — page shell + flow (loading → blocked | playing → won),
  count-up timer (pause/resume — see §5b), found-set + win detection, medal,
  and on-find audio wiring.
- `WordSearchGrid.tsx` — the rounded-rect cpcd grid; owns drag path selection
  (a lone tap is a one-cell path), client-side target-path matching against a
  server-sent `bonusWords` list for the blue non-target-word miss (§4, fires
  `onBonusFound` for the hint-award hook — see §5a), a `useFitScale` transform
  so the 7×7 `sm` grid fits short screens, the **English-gloss popup** shared
  by found-word review and bonus-word misses (tap a locked word, or trace a
  bonus word, → `Popper` popup; `foundWordByCell` / `toggleWordPopup` /
  `anchorRectForCells` / `activePopup`; see §4), and the hint's **yellow
  location reveal + shake** once a word's
  pinyin is fully spelled out (`hintedWord` / `hintShakeNonce` props,
  `hintedCells`; see §5a).
- `WordSearchWordList.tsx` — the ~2-line top English-gloss prompt list; tints
  the actively-hinted word's gloss `HINT_ACCENT_COLOR` (§5a).
- `WordSearchHintBar.tsx` — the 8-segment HUD hint gauge with the `HINT_COST`
  threshold line (§5a).
- `WordSearchHintRow.tsx` — the letter-hint display row between the gloss list
  and the grid; one fixed-width underscore island per character, hangman-style
  (`buildMask`; §5a).
- `pinyinUnits.ts` — splits a tone-marked pinyin syllable into its phonetic
  building-block units (initial / medial glide / final), Bopomofo-segmentation-
  informed but rendered as plain pinyin text; used by `WordSearchHintRow` and
  `WordSearchPage`'s reveal-cap check (§5a).
- `WordSearchHeader.tsx` — restart button + hint button + settings cog + fire
  badge (LeafPage `rightContent`); pinyin/timer toggles moved into the
  settings dialog (see §3 Header controls).
- `WordSearchSettingsDialog.tsx` — the cog's settings sheet: pinyin display
  (shared `useFlashcardLearnSettings`) + timer visibility
  (`useWordSearchSettings`). See §3 Header controls.
- `useWordSearchSettings.ts` — localStorage-backed hook for Word-Search-only
  prefs (currently just `showTimer`), mirrors `useFlashcardLearnSettings`.
- `gameStateStorage.ts` — `saveGameState`/`loadGameState`/`clearGameState`,
  the localStorage save/resume layer for an in-progress board. See §5b.
- `constants.ts` — grid query, `CELL_SIZE`, medal thresholds, hint tunables
  (`HINT_BAR_UNITS`, `HINT_COST`, `LETTER_HINT_BLANK_WIDTH`, `HINT_ACCENT_COLOR`); re-exports
  `GAME_DISTRIBUTION` from bubble-match.
- `types.ts` — `GridCell`, `PlacedWord`, `WordSearchResponse`, `Medal`.
- `src/games/registry.ts` — registers the `word-search` `GameDef`.
- `src/constants.ts` — `/games/word-search` added to `MINUTE_POINTS_ELIGIBLE_PAGES`.

Server:

- `server/services/wordSearchGrid.ts` — pure snaking-placement + filler flood
  (`generateWordSearchGrid`, `MAX_WORD_ATTEMPTS`, `MAX_GRID_ATTEMPTS`),
  4-directional orthogonal only, longest-word-first, no pinyin-width awareness —
  see §2. After `RANDOM_GRID_ATTEMPTS` (5) failed whole-grid regenerations,
  switches to the fixed-template fallback (`WORD_SEARCH_TEMPLATES`,
  `templateModeApplicable`) — see
  [WORD_SEARCH_TEMPLATES.md](./WORD_SEARCH_TEMPLATES.md). Also the
  anti-duplicate pass (`findWordOccurrences`, `pathsEqualEitherDirection`,
  `MAX_DEDUP_PASSES`) that re-rolls filler cells so no target's character
  sequence traces through an unintended path elsewhere in the grid — see §2a;
  it runs identically after either placement method.
- `server/services/wordSearchTemplates.ts` — the 10 fixed 7×7 template
  layouts (`WORD_SEARCH_TEMPLATES`) used by the fallback above — see
  [WORD_SEARCH_TEMPLATES.md](./WORD_SEARCH_TEMPLATES.md).
- `server/services/OnDeckVocabService.ts` — `getWordSearchGrid` (pool assembly +
  substring de-dup/replacement + level-bounded filler harvest from
  `dictionaryentries_zh` via `StarterPacksService.estimateLevel` +
  enrich/prewarm + grid gen + the post-generation `bonusWords` regex query — see
  §2 Output payload). Grid dims: `WORD_SEARCH_ROWS`/`WORD_SEARCH_COLS`.
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
