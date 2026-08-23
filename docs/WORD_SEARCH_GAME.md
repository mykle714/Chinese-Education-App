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
- **Same lend-then-borrow top-up** when a bucket is short: first **lend** the
  shortfall (`OnDeckVocabService.lendGameCandidates`, 2026-08-17 — lent words are
  unshifted onto the fresh `Unfamiliar` queue so the substring-dedup replacement
  loop can draw on them too), and only then borrow from the fallback buckets in
  priority order (Target → Comfortable → Unfamiliar → Mastered), matching
  `OnDeckVocabService.getGameVocabPool` / `OnDeckVocabService.GAME_FALLBACK_ORDER`.
  A collection-restricted grid never lends. See docs/PROVISIONAL_CARDS.md § 4b.
  Caveat: lending is not length-aware, so a lend for this game can return words
  longer than the 4-character grid cap and yield nothing usable — the same
  over-lend the `PROVISION_RETRY_FACTOR` loop already accepts.
- Cards are library (`starterPackBucket = 'library'`), language-scoped, same as
  the bubble-match pool.
- **Buckets are per mark type, and differ by mode.** A candidate's
  Unfamiliar/Target/Comfortable/Mastered bucket comes from the recent mark history
  of the mode's own mark type — `reading` in No-Pinyin, `production` in Pinyin —
  via `compute_type_category`, **not** the whole-card **core** mastery bar. So
  the same library yields a different word set in each mode: a card drilled hard in
  Pinyin mode still shows up as Unfamiliar for No-Pinyin. The same per-type category
  also picks that card's cooldown window. See
  [MASTERY_REWORK.md § "Games select by their own mark type"](./MASTERY_REWORK.md).
  The mapping itself lives on `WordSearchModeConfig.markType`
  (`src/games/word-search/constants.ts`) — Pinyin → `production`, No-Pinyin →
  `reading`. This is the mode's **primary** track: the one and only track the pool
  buckets and cooldown-gates on (a pool query can bucket by one mark history, not two),
  and the one challenge eligibility reads. It is **not** the whole list of marks a find
  writes — see § "What a find marks" below.
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

### 1b. English de-duplication (dd collision)

A second, independent constraint on the same 10 words, enforced app-wide across every
game: **no two targets may share a dd**. The word list prints ten English glosses in a
column, and two identical ones leave the player no way to know which grid word a gloss
is asking for.

Enforced in `OnDeckVocabService.getWordSearchGrid` by a `takenDds` set inside `drain`,
keyed on `ddCollisionKey` (`server/utils/definitions.ts`). Unlike the substring rule
above it needs no re-scan pass — a colliding candidate is simply never admitted — but
it does have to **release** a key when the substring loop evicts a word, or the
replacement pull would be reserving a gloss that nothing is showing.

A grid that cannot reach 10 dd-distinct words falls out the same door as a grid that
cannot reach 10 character-distinct ones: `reason: 'insufficient-distinct'`, which the
controller answers by escalating the provisional baseline and retrying.

Full rule and the other two chokepoints:
[GAMES_FEATURE.md](./GAMES_FEATURE.md) § "No two cards may share a dd in one round".
Extending it to NEAR-identical glosses is designed (unbuilt) in
[GLOSS_CONFUSABILITY.md](./GLOSS_CONFUSABILITY.md).

---

### 1c. Study Challenge rounds — 12 words on an 8×8 grid (built 2026-08-22)

Word Search is challenge-eligible **as Pinyin only** (Pinyin is production; No Pinyin is
reading, and a challenge round is recognition or production —
[STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md) § 5.1). A challenge round replaces section 1's
selection entirely: the target list is the challenge's **twelve contested words**, and the
filler that pads it comes from the `mastered-first` ladder rather than from the band
buckets.

Two things about the grid itself change, and both are load-bearing:

| | Ordinary board | Challenge board |
|---|---|---|
| Targets | `TOTAL_WORDS` = 10 | `CHALLENGE_WORD_COUNT` = 12 |
| Size | 7×7 (49 cells) | **8×8 (64 cells)** — `WORD_SEARCH_CHALLENGE_ROWS/COLS` |
| Placement | template mode when it applies, else random | **always random** |

**Why bigger.** Twelve words at the 4-character cap is up to 48 characters, which random
placement would almost never fit into 49 cells. 8×8 restores roughly the density the
placer was tuned at.

**Why always random.** `templateModeApplicable` is defined as 7×7 with exactly 10 words
(docs/NIGHT_MARKET_TEMPLATES.md's sibling, `WORD_SEARCH_TEMPLATES`), so a challenge grid
falls out of template mode by construction and uses its full `MAX_GRID_ATTEMPTS` budget of
random attempts. Acceptable: templates exist to make a pathological 10-word draw cheap,
not to make placement possible at all.

**The substring de-dup pass is why Word Search scores contested and filler differently.**
An arbitrary set of twelve words will not reliably have mutually distinct characters
(§ 1a), so some contested word will sometimes have to be dropped and replaced — and the
replacement is filler. At a flat 100 a player whose set forced four substitutions would be
paid full price for four easy words; at 100/20 the split is invisible when the whole set
places cleanly and correct when it does not. To make sure there is something to substitute
WITH, the challenge branch queues **twice** the board in filler; without that, a set that
shares characters fails as `insufficient-distinct`, which for a challenge round means a
round the player cannot play at all.

**Challenge boards are never saved** to the pause/resume slot (§ 5b): the slot is offered
back as the hub's Resume card, which would restore a scored board outside its challenge
and would also overwrite the player's own casual save.

## 2. Grid generation (new, server-side per user request)

> ⚠️ **Challenge mode wants 12, not 10.** Everything in this document describes the
> normal board, whose size is `TOTAL_WORDS = 10` (`src/games/word-search/constants.ts`,
> derived as half the Bubble Match distribution). A study-challenge round must contain
> every contested word (docs/STUDY_CHALLENGE.md § 5.2) and that set is
> `CHALLENGE_WORD_COUNT = 12` since 2026-08-17, so a challenge grid takes its
> target-word count from that constant instead and scales the distribution to it. Not
> built yet — the scored round runner is the outstanding piece — but the 7×7 grid and
> the distinct-character rule below are what that build has to satisfy with 12 words.

Grid is **7 columns wide × 7 rows tall** (portrait; fills the play rectangle).
Each cell holds exactly one Chinese character (one cpcd cell).

### Placement (snaking)

For each of the 10 words, in order:

1. Pick a **random empty start cell** for the word's first character.
2. For each subsequent character, pick a **random empty cell adjacent** to the
   previous one. Adjacency is **orthogonal only (4-dir: up/down/left/right)** —
   no diagonals. Same adjacency governs valid drag-selection paths. The walk is
   unrestricted at every length; short words are then flipped into reading
   order by `orientPath` (see "Reading order" below).
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

### Reading order (short words)

`orientPath` (`server/services/wordSearchGrid.ts`) runs on every placed path in
**both** random and template mode. A path and its reverse cover the same cells,
so orienting is only ever a possible reversal — it never rejects a placement,
and cell data (char/pinyin/definition) is attached by path index afterwards, so
a flip simply relabels the cells. The rule, by shape:

| Length | Shape | Forced traversal |
|---|---|---|
| 2 | the single step | **down or right** |
| 3 | straight vertical | **top → bottom** |
| 3 | straight horizontal | **left → right** |
| 3 | ⌞ bend (arm above the corner + arm right of it) | **down, then right** — the way the L glyph is drawn |
| 3 | the three *rotated* L bends | **unconstrained** — the rotation gives the player no reading-order cue, so either direction is equally ambiguous |
| 4+ | any | **unconstrained** — a multi-turn snake has no reading order |

Placement has no pinyin-width awareness — words are ordered longest-first and
placed with plain 4-directional snaking (`NEIGHBORS`, then oriented per above),
with no horizontal-neighbor width check. (A prior version graded
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
  grid: Array<Array<{
    char: string;
    pinyin: string;
    sense?: string;        // present ONLY on target-word cells: the char's definitionClusters
    definition?: string;   //   sense label + its ddt (the char's meaning IN THIS WORD). Tap → popup.
  }>>,  // grid[row][col], 8 rows × 8 cols
  rows: number;
  cols: number;
}
```

**Per-character sense definition (`sense`/`definition` on target cells).** Every
cell belonging to one of the 10 target words carries the character's
*context-correct* gloss — the meaning it has **inside that word**, not its generic
standalone gloss (上 in 上班 is "to go up", not "upper"). The server resolves this
at grid-build time (`OnDeckVocabService.getWordSearchGrid`): it reads the word's
`breakdown[char].sense` label (the stable pointer written by
`backfill-breakdown-senses.js`, see docs/BREAKDOWN_FEATURE_IMPLEMENTATION.md §5b)
and calls `resolveSenseGloss(charClusters, sense)` (`server/utils/definitions.ts`)
— i.e. it looks up the character's own det `definitionClusters`, finds the cluster
whose `sense` matches, and returns its `ddt` (stripped lead gloss). Falls back to
the stored `breakdown[char].definition` when a word isn't sense-tagged yet, and
omits both fields entirely on **filler** cells. This is the **same dd** the
flashcard breakdown tab shows (both trace to the char's cluster keyed by that
sense label). A batched query fetches every distinct target character's clusters
once per grid.

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

### Two hub entries (pinyin mode), no in-game toggle

Word Search ships as **two Games-hub sub-cards** in a horizontal strip. Unlike
Bubble Match (a plain `HubMenuArrayItem`), the whole strip is a **dedicated
component**, `src/games/word-search/WordSearchHubItem.tsx`, because its buttons
need custom click handling and it prepends a resume card. `GamesPage.tsx`
renders it in the `game.gameId === "word-search"` branch. It reuses the shared
hub card look via the exported `cardBaseSx`
(`src/components/hubMenuCardBase.ts`) + `HubMenuCardTitle` / `HubMenuRowIconTile`
(`src/components/HubMenu.tsx`). See [BENTO_SYSTEM.md](./BENTO_SYSTEM.md).

| Sub-card | `mode` | Pinyin | Mark type (sub-tile subtitle) |
|---|---|---|---|
| **Pinyin** | `"pinyin"` | grid pinyin on, **always tone-colored**, rendered at **big-pinyin** scale (see "Cell size") | PRODUCTION |
| **No Pinyin** | `"no-pinyin"` | grid pinyin off | READING **+ PRODUCTION** |

- Each mode sub-tile's **subtitle** is the track(s) it feeds, built from
  `modeMarkTypes(cfg)` through the shared `MARK_TYPE_LABELS` — so No Pinyin reads
  "Reading & Production". (This used to be a `MarkTypeChip` on a hub card; the bento
  sub-tile that replaced it has no chip slot, and that component has since been
  deleted for want of any caller. See
  [MASTERY_REWORK.md § "The hub names the track"](./MASTERY_REWORK.md).) Word Search is
  still the only game whose label differs *between* its sub-tiles, which is why it is
  per-sub-tile rather than on the group header. The resume square carries no track
  label — at 1:1 it already holds four lines, and it names its saved mode anyway.

### What a find marks

A found word posts **one `/api/flashcards/mark` per track**, all positive
(`markWordFound` in `WordSearchPage.tsx`, list from `modeMarkTypes`):

| Mode | Marks written | Why |
|---|---|---|
| Pinyin | `production` | The prompt is an English gloss, so the find is recall — but the grid's pinyin row is a phonetic crutch, which is precisely what the reading track is defined by the *absence* of. So no reading mark. |
| No Pinyin | `reading` **and** `production` | Both skills are genuinely exercised in one action: the prompt is an English gloss (recall from meaning → production) and the grid is bare characters (→ reading). This is the only surface in the app that clears two tracks per action. |

Three consequences worth knowing:

- **Two bars move.** `production` feeds the **core** bar, `reading` feeds the
  **reading** bar. The rule "a mark belongs to exactly one bar" is unchanged — these
  are two separate marks — but a No-Pinyin find is the first review ACTION that moves
  two bars. `barForMarkType` and the mark handler are untouched by this.
- **The secondary mark is best-effort.** The board was pooled on the primary track, so
  a card can be off cooldown for `reading` while still cooling for `production`; the
  mark endpoint then drops the production mark and logs `[MarkSuppressed]`
  ([HYDRA_BUBBLES.md § 8](./HYDRA_BUBBLES.md)). The hub label describes the *attempt*.
- **It does NOT make No Pinyin challenge-eligible.** Eligibility reads the primary
  track only, so a reading board can never be drawn into a Study Challenge round —
  pinned by `src/games/__tests__/challengePool.test.ts`.

A hinted word marks **nothing at all**, on either track (§ hints).

- **Both mode buttons ALWAYS start a fresh game.** Tapping one navigates with
  nav `state = { mode, resume: false }`. Because both modes now share ONE saved
  slot (see §5b), starting fresh would clobber any parked board, so if a save
  exists the button first opens a **confirm dialog** ("Starting a new game will
  erase your saved Word Search game …"); only on confirm is the save cleared and
  the new game started.
- The chosen mode is passed via React-Router nav `state.mode` (both sub-cards
  share the single `/games/word-search` route) and is **fixed for the whole
  run** — there is no in-game pinyin toggle. `WordSearchPage` reads it once on
  mount (`modeConfigFor`, `MODE_CONFIGS` in `constants.ts`).
- A direct/stray visit with **no valid mode** (manual URL) **redirects to
  `/games`** rather than defaulting — the player must pick a card. (Bubble Match
  does the same for a missing level.)
- The **colorless pinyin option was removed**: when pinyin is shown it is always
  tone-colored (`showPinyinColor` is a fixed `true`).
- Word Search no longer reads the shared `useFlashcardLearnSettings`
  pinyin/colorless toggles; that hook is gone from `WordSearchPage`.

#### Group header + win count

The strip is topped by a `HubMenuGroupHeader` (wrapped with it in a
`HubMenuGroup`, both from `HubMenu.tsx`) carrying the game title and a
`HubMenuStatBadge variant="header"` with the **aggregate lifetime win count** —
`totalWins` from `useGameWins(GAME_KEY)`. The mode sub-cards carry no badge of
their own: a count on one of them would read as that mode's score.

Win logging goes through the same hook. `WordSearchPage` calls
`recordWin(WIN_LEVEL)` on completion (it previously hand-rolled its own
`POST /api/users/me/wins`); `GAME_KEY` (`"wordSearch"`) and `WIN_LEVEL` (`1`) now
live in `constants.ts` so the page and the hub item share them. Word Search has no
levels — **every completion in either mode lands in the one `level: 1` bucket**,
so its hub count is inherently whole-game. See
[BENTO_SYSTEM.md § BentoStrip vs ShelfHeader](./BENTO_SYSTEM.md).

#### Resume card (leading 1:1 square)

When a saved board exists, `WordSearchHubItem` **prepends a 1:1 square card**
before the two mode buttons. Its **normal face** is styled like a real hub card:
a **"Resume"** title (matches `HubMenuCardTitle` — bodyLg / medium / onSurface),
then the parked board's **timer** (frozen `elapsedMs`) and **X/10 found** inlined
on one row, then the **mode** (Pinyin / No Pinyin), with an **✕** inset in the
top-right corner.

- **Tapping the card resumes** — navigates with `state = { mode: saved.mode,
  resume: true }`; `WordSearchPage` restores the saved board instead of fetching
  a fresh one. No warning (nothing is lost).
- **✕ arms an in-place delete confirmation** (`confirmingErase` state): the
  square flips to a **"Delete saved game?" face** with **Cancel** / **Delete**
  buttons — it does NOT erase on the first tap. Cancel returns to the normal
  face; only **Delete** clears the save (`clearGameState`) and animates the
  square's width to zero (react-spring `useTransition` `leave`), so the mode
  buttons slide left to fill the gap. While the confirm face is showing, a tap on
  the card body does not resume.
- To let the width collapse fully to 0 the card uses `minWidth/minHeight: 0`,
  `boxSizing: border-box`, and an **absolutely-inset content layer** (in-flow
  text would otherwise floor the width at its min-content size).
- Word Search has **no difficulty** concept, so the card intentionally shows the
  **mode** as its only categorical line (no separate difficulty row).

Vertical stack inside the standard leaf-page content area:

```
┌─────────────────────────────┐
│ header (down-arrow · hint · settings cog · fire badge)
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
  recall drill — you read the meaning and hunt the Chinese in the grid), drawn as the
  design's `.chip`s. They used to run together as one centre-justified paragraph
  separated by middots, which made a two-word gloss ("job interview") hard to tell from
  two adjacent one-word ones; an outlined chip gives every target its own boundary, so
  the HUD's count and the things on screen agree. **Two** states and only two:
  **pending** — `.chip.on`, the solid ink pill, deliberately the LOUD state because a
  pending chip is the game's actual instruction; and **found** — struck through and faded
  to the resting outline, still present, because the list is also the record of what the
  run has covered and the fade is what makes the remaining work countable at a glance.
  The **hinted** word has no chip state of its own: the `.hintbar` reveal one row above
  already names it character by character, and a third treatment would have to be
  distinguishable from black-pill-pending, which is the strongest ink the row has. (Glosses are the dd resolved SERVER-side in
  `OnDeckVocabService.getWordSearchGrid` via `resolveDisplayDefinition`, so they honor the
  learner's per-card `selectedSense`; kept short so they tile, and a very long definition is
  truncated. See [DEFINITION_MAPPING.md](./DEFINITION_MAPPING.md) form #3.)
- **Grid (bottom):** one big **rounded-corner rectangle** filling the remaining
  height, containing the 7×7 array of cpcd cells. Each cell is one cpcd
  character (may be wrapped per-row in `CPCDRow`). The grid respects the header
  pinyin toggle uniformly across word + filler cells. Because the prompts are
  English, the **pinyin display only affects the grid** (there is no Chinese in
  the top list to toggle). Whether pinyin shows is fixed by the launched mode
  (see "Two hub entries" above), not a per-session toggle.

### The play panel, top to bottom

Shelf redesign entry 13 (`docs/SHELF_REDESIGN.md`). Everything below lives inside
`GameFrame`'s `.play` panel, above the grid:

| Row | Component | Content |
|---|---|---|
| HUD | `GameHud` | `Pinyin · production` (No Pinyin: `reading & production`) — *clock* — `4 of 7 found` |
| hint | `WordSearchHintBar` | button · charges · reveal (§5a) |
| list header | a `.shelfhd` pair of `Label`s | "Find these words" / "trace to select" |
| chips | `WordSearchWordList` | the target glosses (§ below) |

**The clock is the MIDDLE child of the HUD, and that is load-bearing.** It is the one
element that can vanish (the settings sheet hides its text), and under `space-between`
only a middle child can be removed without moving anything else. It used to be first,
which forced the hint meter beside it to be absolutely positioned so `space-between`
would not drift it as the timer's text changed width.

**The mode is stated, not offered.** Artboard 13 draws a `pinyin` chip in the header;
that was not adopted. Pinyin display is fixed by which hub entry launched the run, so
there is nothing to toggle — a chip that looks like a switch and is not is worse than no
chip, and it would be a second statement of what the HUD already says.

### Header controls

`WordSearchHeader.tsx` fills the leaf-page `rightContent` slot with **the settings cog
and the fire badge, and nothing else**. Three things have left this slot, and the reason
is always the same: the header holds settings-shaped controls, not game ones.

- ~~**Restart button** (`word-search__restart-btn`)~~ — **REMOVED.** A restart
  icon used to sit leftmost and discard the in-progress board via `resetBoard`.
  `resetBoard` still exists in `WordSearchPage.tsx`, but its only caller is now
  the win-screen "Play Again" button: a board in progress can no longer be
  thrown away from the header, only finished or left (it stays parked in the
  saved slot, §5b, resumable from the hub).
- ~~**Hint button** (`word-search__hint-btn`)~~ — **MOVED** into the play panel's
  `.hintbar`, next to its own charges and reveal. Spending a hint is a game action.
  See §5a.
- **Settings cog** (`word-search__settings-btn`) — opens `WordSearchSettingsDialog`,
  a small MUI `Dialog` (not the flp `SheetPanel`/drag-resize sheet — that
  machinery lives inside `features/flashcards` and games don't reach into it;
  this mirrors its *behavior*, not its implementation) holding:
  - **Show pinyin** / nested **Color pinyin by tone** — the same two booleans
    as flp, via the shared `useFlashcardLearnSettings` (`showPinyin`,
    `showPinyinColor`), so the setting stays in sync with flp. Toggling
    redraws both the top word list and the grid. Because the prompts are
    English, pinyin only ever affects the grid (there is no Chinese in the
    top list to toggle). **⚠️ Stale:** the shipped dialog holds only the timer
    row — pinyin display became a property of the hub entry (see "Two hub entries").
  - **Show timer** — Word-Search-only, persisted via `useWordSearchSettings`
    (`wordSearch.settings` in localStorage). Flips only the timer TEXT's
    visibility; the clock keeps ticking regardless (so the finish time / medal
    stays accurate).
- Fire badge (minute points) — route is in `MINUTE_POINTS_ELIGIBLE_PAGES`.

### Cell size

Use `CPCDRow` **`sm`** (32px column) for now, with **big pinyin on** in Pinyin
mode: the grid passes `bigPinyin={showPinyin}` to `ForeignText`
(`WordSearchGrid.tsx`), which scales the pinyin font and its reserved band by
`BIG_PINYIN_SCALE` (1.2 → ~15.6px syllable under the unchanged 26px glyph). The
default 13px `sm` pinyin was too small to scan while dragging. This is not a
separate hub entry — it is simply how the Pinyin board now renders; the smaller
variant is gone.

It is gated on `showPinyin` rather than passed unconditionally because `CPCDRow`
keeps the reserved pinyin band even when the syllable is hidden (so toggling
pinyin never shifts layout) — enlarging it in **No Pinyin** mode would push
every glyph upward for nothing.

One knock-on effect, self-correcting: **grid height is unaffected**, because every
cell is `aspect-ratio: 1` and the taller content simply centres inside the square it
was already given.

More pinyin overflows its 32px column at this scale, so expect more
shifting/separator apostrophes — see
[CPCD_PINYIN_SHIFT.md](./CPCD_PINYIN_SHIFT.md) § "Interaction with `bigPinyin`".

A `useFitScale` wrapper in
`WordSearchGrid.tsx` scales the whole 7×7 grid down to fit the play area
(transforms don't affect `elementFromPoint`, so drag hit-testing still works),
so it renders at real `sm` size and shrinks only as needed on short screens.

**Every cell is a square** (`aspect-ratio: 1`, the design's `.wsg span`) spaced by
`CELL_GAP` px on both axes (`constants.ts`, 4px). Squareness is what lets a traced
path read as a path: on a board of squares a run of lit cells weighs the same going
down as going across, so a word that turns a corner still looks like one word.

### The selection system

Every highlight — resting, tracing, found, hinted, missed — is **a fill on the cell**,
from the design's `.wsg span` / `.hit` / `.now` (artboard 13):

| State | Fill | Meaning |
|---|---|---|
| resting | `COLORS.background` (paper) | an unclaimed tile |
| tracing | `COLORS.org` (`.now`) | the in-progress drag |
| found | `COLORS.grn` (`.hit`) | locked in |
| reviewing | `COLORS.grn` + an inset `COLORS.grnA` ring | the found word whose gloss popup is open |
| hint reveal | `COLORS.org` | "trace THESE" — the same meaning as `.now` |
| miss | `COLORS.red` | wrong trace; transient, and outranks whatever is under it |
| bonus | `COLORS.blu` | a real word that wasn't a target |

The cells sit on a **grey board** — the grid box carries `COLORS.card` (`--grey`) at
radius 16, with the 13px padding as its margin. The design puts paper cells straight
onto the white `.play` panel, which is ~1.03:1 and lets the tiles dissolve into it;
grey is one full lightness step below paper, so every resting tile gets an edge without
anything drawing one. It has to be ACHROMATIC: all four lit fills above are ramp pastels
at the same lightness, so a hued board would sit in the same band as whichever state
shares its hue.

A lit cell also darkens its glyph to `COLORS.onSurface`. That has to be reached through
a **descendant selector** on `.char-pinyin-display__character`: the glyph is a cpcd
element that sets its own color, so an inherited value on the cell is silently
overridden and the state half-applies. It deliberately does **not** bold, though
`.wsg span.hit` does — at this cell size a weight change reflows the glyph inside its
tile, so a traced word twitches as the path grows, and the fill has already carried the
state.

**What this replaced, and why.** Highlights used to be drawn as one continuous
"stadium" tube on a layer *beneath* the cells — a rounded rectangle per consecutive
pair of cells, ends coinciding at the shared cell so a snaking path read as one
unbroken shape, with the cells themselves going transparent to let it through. It was
the prettier shape, but it cost a measured row pitch, a measured glyph-center offset
and two hand-tuned nudge constants (`SELECTION_EXTRA_OFFSET_Y_FRAC*`, both deleted),
all so a shape drawn between *character centers* would line up with cells whose height
depended on whether pinyin was showing. A cell fill needs none of that machinery and
tells the player the same three things.

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

Because a word's grid cells can snake in any direction (up/down/backwards — §2's
"Reading order" only constrains 2-char words and the unambiguous 3-char shapes),
the glyphs alone
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

### Tapping a single target character (context-correct sense popup)

A **lone tap** (a one-cell "selection", no drag) on a cell that belongs to a
target word opens a small popup showing **that character's meaning inside this
word** — the `definition` the server attached to the cell (see § Output payload:
the char's `definitionClusters` gloss keyed by `breakdown[char].sense`). This
helps the player *learn* the word by seeing each character's contextual sense
(上 in 上班 shows "to go up", not "upper").

- Handled in `submit` (`WordSearchGrid.tsx`): a length-1 selection that doesn't
  complete a target and whose cell carries a `definition` sets `charPopup` and
  returns, **before** the single-character "bonus headword" branch — so for a
  target character the contextual sense wins over its generic standalone gloss.
- Renders through the **same** `Popper`/`activePopup` path as the found-word and
  bonus popups (`charPopup` → `{ entryKey: char, pinyin, definition }`), anchored
  over the single cell via `anchorRectForCells`. It leaves no highlight and has no
  auto-dismiss; any new `onPointerDown`/`clearSelection` closes it.
- **Filler** cells carry no `definition`, so they fall through to the existing
  single-character bonus/miss behavior. **Found** words are intercepted earlier in
  `onPointerDown` (whole-word review popup), so the per-character popup applies to
  *unfound* target characters.

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

### 5a. Hints

A lightweight, client-only assist layer (no server/DB involvement). State lives in
`WordSearchPage.tsx` (`hintUnits`, `hintEntryKey`, `hintRevealCount`,
`hintLocationRevealed`, `hintShakeNonce`).

**One mechanic, one row.** `WordSearchHintBar.tsx` is now the whole `.hintbar`: the
button, the charge dots, and the reveal, left to right — press this, you have this many,
here is what you bought. It takes `WordSearchHintRow` as its `children`. Before the shelf
redesign these were three widgets in three places (button in the page header, meter
absolutely centred in the HUD, reveal on its own line under the gloss list), and the
player had to work out that they were one thing.

**Charges, not a gauge.** With `HINT_COST` at 1, the eight-segment meter with its
threshold line after the first segment was already just "how many hints you have" drawn
as a gauge. It is `HINT_BAR_UNITS` dots now; `.chg` filled = banked.

The letter-hint display is `WordSearchHintRow.tsx`,
the pinyin→units split lives in `pinyinUnits.ts`, the matching gloss tint lives
in `WordSearchWordList.tsx`, and the grid-side yellow location reveal + shake
live in `WordSearchGrid.tsx`; tunables are in `constants.ts`
(`HINT_BAR_UNITS = 8`, `HINT_COST = 1`, `HINT_LETTER_BLANK = "_"`,
`HINT_REMAINDER_MARK = "—"`, `HINT_ACCENT_COLOR` — now an alias for `COLORS.warnInk`).

Revealing a word's grid **location** was too easy a hint (v1's cell-pulse
mechanic); v2 replaces it with a cheap, hangman-style **pinyin reveal** so a
hint nudges recall without handing over the answer.

- **Earning:** each successful find adds **one** charge, capped at `HINT_BAR_UNITS` (8).
  A charge is one dot. The button itself carries the armed/disarmed state (full opacity
  and an inert handler when `hintUnits < HINT_COST` or nothing is left unfound) — its
  shape never changes as it arms, so the control does not move under the finger.
- **Reveal granularity (`pinyinUnits.ts`):** a hint reveals one **phonetic
  unit** at a time, not one raw Latin letter — `syllableToPinyinUnits` splits
  each syllable into its initial consonant / medial glide / final (e.g.
  `"xiǎng"` → `["x","i","ǎng"]`, `"gōng"` → `["g","ōng"]`), mirroring how
  Bopomofo (Zhuyin) segments a syllable into its actual sound-blocks, but
  rendered as plain pinyin text (with the original tone diacritics) rather
  than Zhuyin glyphs. This avoids letter-at-a-time reveals giving away more or
  less than one meaningful chunk depending on spelling (e.g. "zh" is one
  initial sound spelled with two letters).
- **The reveal (`WordSearchHintRow.tsx`):** fills the `.rv` slot at the right end of the
  hint row. It used to be a row of its own between the gloss list and the grid, which
  cost a line of board height to show nothing most of the time; it now holds its line
  open (`minHeight`) inside the hint row so spending the first hint of a run does not
  shove the grid down. **Blank by default** — nothing renders here until the
  player's first hint spend. Once a hint has picked a word, the row shows a
  mask built by `buildMask`: **one "island" per Chinese
  character** in the word (space-separated, one per `pinyin` syllable), but
  **only for characters the player has paid to see** — everything is bought
  one press at a time along a **two-stage ladder**:
  1. **Letter counts, one character per press, left to right.** A character
     whose length hasn't been bought yet is **not drawn at all** — no
     placeholder — so the mask never leaks how many characters are still to
     come; the word's **character count is itself learned one press at a
     time**. The Nth press appends the Nth island as **one
     `HINT_LETTER_BLANK` ("_") per hidden letter** — classic hangman spacing
     showing that syllable's full length. So an N-character word spends its
     first N presses purely on lengths.
  2. **Phonetic units, only after every island's length is showing.** The
     remaining presses fill blanks in, and each reveal visibly consumes the
     blanks it fills. Units are distributed **round-robin across characters**
     (`distributeRevealTiers`), not filled one island at a time: every
     character's 1st unit is given out before any character's 2nd, then every
     2nd before any 3rd, wrapping until the word is fully spelled out — a
     character with fewer units than the current tier is simply skipped.

  E.g. a 2-char word like 变化 (biàn huà, units `b·i·àn` and `h·u·à`) goes
  `____` → `____ ___` → `b___ ___` → `b___ h__` → `bi__ h__` →
  `bi__ hu_` → `biàn hu_` → `biàn huà`. The word's total reveal steps are
  therefore `characters + units` (`countPinyinRevealSteps`, `pinyinUnits.ts`),
  which is what `totalRevealUnits` in `WordSearchPage.tsx` gates on before
  moving to the location reveal.

  Tone diacritics ride on their letter, so `ǎ` is one blank
  (`buildMask`/`letterCount` normalize to NFC before counting).
  (History: the hidden portion was 3 fixed underscores, then a single
  count-free `HINT_REMAINDER_MARK` dash, then a blank-per-letter shown for
  every character from the first press; the dash hid the length so well that
  a mask gave the player almost nothing to anchor on, but handing every
  length over at once gave away the whole word's shape for one unit — hence
  the staged ladder above, where an unbought character is simply absent.
  `HINT_REMAINDER_MARK` is no longer used on the pinyin board at all; it
  lives on as the No-Pinyin board's `COMPONENT_BLANK`, §5a-ii, where there
  is no letter count to show.)
- **No matching gloss treatment.** The hinted word's chip used to be tinted (and
  later filled) to pair it with the mask. It no longer is — the `.hintbar` reveal
  names the word directly, and every unfound chip is already the solid ink pill
  (§3), so there is no quieter state left for "hinted" to occupy.
- **Spending (`useHint` / `canUseHint` in `WordSearchPage.tsx`):**
  1. If a word is already being hinted (`hintEntryKey`) and it's still unfound
     with reveal steps left, drain `HINT_COST` (1) and buy **one more step of
     that same word** (`hintRevealCount++` — the next character's letter count,
     or once all lengths are showing, the next pinyin unit in round-robin
     order) — the mask grows in place.
  2. If that word is still unfound but its pinyin is **already fully spelled
     out** (no units left to reveal) and its location **isn't yet
     revealed**, drain `HINT_COST` and lock onto it: `hintLocationRevealed =
     true` lights up its actual grid cells in **`.now` orange** (`WordSearchGrid`'s
     `hintedWord`, painted as a per-cell fill like every other highlight — see the
     selection-system table in §3) and bumps `hintShakeNonce` to shake them
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
- **A hinted word earns NO flashcard mark.** Every word that receives a hint on
  this board — any reveal step, unit or location — is recorded in
  `hintedWordsRef` (`WordSearchPage.tsx`), and `markWordFound` returns early for
  those words: no `POST /api/flashcards/mark` at all, not a negative one. The
  player was shown part of the answer, so the find is no evidence of recall in
  either direction and would otherwise inflate the mode's Reading/Production
  track (see [MASTERY_REWORK.md](./MASTERY_REWORK.md)). The set is reset per
  board in `startBoard` and round-trips through the save slot as
  `SavedWordSearchState.hintedWords` (optional — pre-existing snapshots restore
  as "nothing hinted"), so a paused-and-resumed board doesn't forget it cheated.
  Hint-unit awards and the win are unaffected — only the mark is withheld.
- **Clearing:** when the actively-hinted word is found (matched by `entryKey`
  in `onFound`), `hintEntryKey`/`hintRevealCount`/`hintLocationRevealed` all
  reset — the row, the gloss tint, and the grid's yellow highlight all clear
  together — ready for the next hint press to pick a fresh word.

Open (minor, resolve at build time): minute-points eligibility (likely add the
route to `MINUTE_POINTS_ELIGIBLE_PAGES`), and whether to persist a best-time /
medal per user. An optional best-time could reuse the existing `gameprogress`
JSONB blob (`{ bestTimeMs, medal }`).

#### 5a-ii. Component hints (No Pinyin mode)

The reveal ladder above spends **pinyin units**, which is exactly what the **No
Pinyin** board exists to hide — so that board spends a different currency:
a character's **sub-character visual parts**. Everything after "fully revealed"
(the yellow location reveal, then the free re-shake) is shared between modes;
only the reveal step differs.

Code: `componentUnits.ts` (the counterpart to `pinyinUnits.ts`),
`WordSearchHintRow.tsx` (`currency` prop), `WordSearchPage.tsx`
(`totalRevealUnits`), `src/theme/fonts.ts` (`FONTS.hanziComponents`),
`src/index.css` (`@font-face`).

- **Data:** `dictionaryentries_zh.components` (migration 125) — a jsonb array of
  single-character strings per **single-character** row: 想 → `["木","目","心"]`,
  从 → `["人","人"]` (multiplicity kept), 江 → `["氵","工"]`. The **bound form** is
  stored (氵 not 水, ⺮ not 竹) because the player is matching a *shape*.
  ⚠️ Distinct from `breakdown`, which holds per-CHARACTER glosses of a
  MULTI-character word — see docs/BREAKDOWN_FEATURE_IMPLEMENTATION.md.
- **Ordering is most-common-first**, by component frequency across all ~9.8k
  single-char det rows. Hints therefore **escalate**: the first (cheapest) reveal
  is a part shared by hundreds of characters and barely narrows a grid scan; the
  last is nearly identifying.
- **Transport:** `WordSearchInput.charComponents` / `PlacedWord.charComponents`
  — `string[][]`, one array per character, position-aligned with `entryKey`.
  Populated in `OnDeckVocabService.getWordSearchGrid` by extending the existing
  batched per-target-character query (no extra round trip). Sent in **both**
  modes; only the No Pinyin board consumes it.
- **The per-character ladder:** each character offers `max(components.length, 1)`
  reveals — one per part, except the step that would reveal the **last** part
  instead reveals **the character itself, replacing that character's accumulated
  glyphs**. Showing every part is equivalent to showing the answer, so the ladder
  spends that final step on the answer directly rather than on a complete parts
  list the player still has to assemble. Consequences: an **atomic** character
  (人, 口, 木, 行 — empty array) contributes exactly 1 reveal, and a
  **single-part** character contributes 1 as well, going straight to the
  character without ever showing its lone part.
- **Reveals are distributed in two round-robin phases** (`distributeComponentReveals`),
  each phase using the same tier walk as `distributeRevealTiers`:
  1. **All non-final parts of every character**, cheapest tier first — so no
     character is answered while any character in the word still has a part left
     to give.
  2. **The character-reveal steps**, left to right.

  The total reveal count is unchanged (`countComponentUnits` still sums
  `max(parts.length, 1)`); only the order shifts, so the meter economics are the
  same and only the ladder's shape changes:

  ```
  想     _  →  木_  →  木目_  →  想
  相     _  →  木_  →  相
  人     _  →  人
  银行   _ _  →  钅_ _  →  银 _  →  银 行
  会议   _ _  →  人_ _  →  人_ 讠_  →  会 讠_  →  会 议
  想相人  _ _ _  →  木_ _ _  →  木_ 木_ _  →  木目_ 木_ _  →  想 木_ _  →  想 相 _  →  想 相 人
  ```

  Note 银行: 钅 (银's only non-final part) is spent before 银 or the atomic 行 is
  answered — previously 行 was revealed at tier 1, handing over a whole character
  while a shape hint was still unspent.

- ⚠️ **Font dependency.** index.html loads Noto Sans SC from Google Fonts, which
  subsets CJK by character **frequency, not by Unicode block**. Component glyphs
  are disproportionately rare, so ~4% of them (⺀ ⺮ ⺼ 㐬 耂 ⺌ 龹 殸 ⺈ 兟 矦 ⺍ …)
  are **not served** and would fall back to the OS font (wrong typeface beside
  the grid) or render as tofu. `src/assets/fonts/hanzi-components.woff2` is a
  self-hosted subset of the **same face**, listed first in
  `FONTS.hanziComponents` so the browser falls back per glyph seamlessly.

**Regenerating the data + font** (both deterministic, no AI, free to re-run — and
they must run in that order, since the font subset is built from the column):

```bash
docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-character-components.js
docker exec cow-backend-local npx tsx scripts/backfill/chinese/generate-component-font.js
```

The decomposition source is makemeahanzi's `dictionary.txt` (**LGPLv3**), fetched on
demand into the gitignored `data/hanzi/cache/` — a **build-time input only**, never
vendored and never shipped to a client; only derived per-character facts reach the DB.
The subset's source face `data/hanzi/NotoSansSC-VF.ttf` **is** committed (SIL OFL 1.1,
`data/hanzi/NotoSansSC-OFL.txt`). Decomposition depth follows a radical-stop policy
(radicals are atomic; a part expands only when its expansion is a clean compound of
non-stroke radicals) — the rules and rationale live in
`server/scripts/backfill/chinese/lib/decompose.js`.

### 5b. Pause/resume persistence

Client-only, no server/DB involvement (same design posture as §5a's hint
meter) — the full board payload is already on the client, so a single
localStorage blob (`gameStateStorage.ts`, key `wordSearch.savedGame.<userId>`)
is enough to survive an exit or the app being backgrounded.

**One shared slot for both modes.** The key is scoped by `userId` only; the
`mode` ("pinyin"/"no-pinyin") lives *inside* the payload
(`SavedWordSearchState.mode`), not the key. So there is exactly one parked board
per user, and it's resumed **only** from the hub's resume card (§3), which
restores it in whichever mode it was saved under. `saveGameState` /
`loadGameState` / `clearGameState` take just `userId` (no `mode` parameter).
This replaced the old per-mode keying — the two mode buttons now always start
fresh rather than silently resuming their own board.

- **What's saved** (`SavedWordSearchState`): the `mode`, the grid payload
  (`data`), `found` entryKeys, elapsed timer ms, whether the timer had ever
  been started, and the full hint-meter state (§5a) + rewarded-bonus-word set —
  everything needed to resume as if nothing happened, in the right mode.
- **When it saves** (`WordSearchPage.tsx`):
  - **Continuously while playing** — an effect keyed on `[phase, found]` calls
    `persistSnapshot` on entering play and after every find. This keeps the slot
    current so returning to the Games hub always shows the resume card: the hub
    reads the save during *its own* render, which — on the same back-transition
    — happens **before** this page's unmount save would run, so a save must
    already exist. (Keyed on `found`, not the 500ms `elapsedMs` tick, to avoid
    churn; elapsed is read live off `startRef` at each write.)
  - `visibilitychange` → `document.hidden` (tab backgrounded / app switched
    away) — saves, then pauses the timer.
  - `beforeunload` (hard close/refresh) — a safety net; `visibilitychange`
    already covers tab-hide, but not every close path fires it.
  - Component **unmount** (covers the leaf-page down-arrow back, and any
    other exit) — a `useEffect` cleanup with an empty dep array saves once on
    the way out.
  - All no-op unless `phase === "playing"` and the board isn't already
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
- **On mount:** behavior is gated by the nav `resume` flag (captured once as
  `resumeIntent`). **Resume card** (`resume: true`) → `loadGameState()` is
  checked and a valid, unfinished board is restored via `restoreBoard` (which
  auto-resumes the timer). **Mode button** (`resume: false`/absent) → always
  `fetchGrid()` + `startBoard`, never a silent resume. (If a resume intent finds
  no save — erased between hub and page — it falls through to a fresh board.)
- **Cleared** on win, by "Play Again" (`resetBoard`), by
  the resume card's ✕, and when the hub's confirm dialog approves starting a new
  game over an existing save.

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
  `anchorRectForCells` / `activePopup`; see §4), and the hint's **orange
  location reveal + shake** once a word's
  pinyin is fully spelled out (`hintedWord` / `hintShakeNonce` props,
  `hintedCells`; see §5a).
- `WordSearchWordList.tsx` — the English-gloss prompt chips: solid ink `.chip.on` while
  pending, struck through and faded once found (§3).
- `WordSearchHintBar.tsx` — the whole `.hintbar` row: the hint button, `HINT_BAR_UNITS`
  charge dots, and the reveal slot it renders its `children` into (§5a).
- `WordSearchHintRow.tsx` — the reveal, filling the hint row's right-hand slot. Renders whichever currency the board spends (`currency` prop): the
  Pinyin board's per-syllable islands — nothing at all until that character's
  length is bought, then one `HINT_LETTER_BLANK`
  underscore per still-hidden letter (`buildMask` / `letterCount`;
  §5a), or the No Pinyin board's component glyphs in a line, collapsing to the
  character once its parts run out (§5a-ii).
- `pinyinUnits.ts` — splits a tone-marked pinyin syllable into its phonetic
  building-block units (initial / medial glide / final), Bopomofo-segmentation-
  informed but rendered as plain pinyin text; used by `WordSearchHintRow` and
  `WordSearchPage`'s reveal-cap check (`countPinyinRevealSteps` = characters +
  units, covering both ladder stages; §5a).
- `componentUnits.ts` — the No Pinyin counterpart to `pinyinUnits.ts`: turns a
  word's `charComponents` into the per-character reveal ladder (every part, then
  the character itself), distributed round-robin across characters in two phases
  — all non-final parts word-wide, then the character reveals
  (`countComponentUnits` / `buildComponentReveals`; §5a-ii).
- `WordSearchHeader.tsx` — hint button + settings cog + fire
  badge (LeafPage `rightContent`); the timer toggle lives in the settings
  dialog (see §3 Header controls). Pinyin is no longer a toggle — it's fixed by
  the launched hub mode (§3).
- `WordSearchSettingsDialog.tsx` — the cog's settings sheet: now **timer
  visibility only** (`useWordSearchSettings`). The pinyin display rows were
  removed — pinyin is set by the launched hub mode, not a toggle. See §3.
- `useWordSearchSettings.ts` — localStorage-backed hook for Word-Search-only
  prefs (currently just `showTimer`), mirrors `useFlashcardLearnSettings`.
- `WordSearchHubItem.tsx` — the Games-hub strip (rendered by `GamesPage.tsx`):
  the two mode buttons (start-fresh, with a confirm dialog when a save exists)
  plus the prepended 1:1 resume card (timer / X·10 / mode + ✕ erase, with the
  react-spring collapse animation), under a `HubMenuGroupHeader` carrying the
  game title + the aggregate lifetime win count (`useGameWins(GAME_KEY).totalWins`).
  Owns the saved-board read + confirm state. See §3.
- `gameStateStorage.ts` — `saveGameState`/`loadGameState`/`clearGameState`
  (each takes just `(userId, …)`), the **single-slot** (mode-agnostic key,
  `mode` stored in the payload) localStorage save/resume layer for the one
  in-progress board. See §5b.
- `constants.ts` — grid query, `CELL_SIZE`, medal thresholds, hint tunables
  (`HINT_BAR_UNITS`, `HINT_COST`, `HINT_LETTER_BLANK`, `HINT_REMAINDER_MARK`,
  `HINT_ACCENT_COLOR`),
  the pinyin-mode config (`WordSearchMode`, `MODE_CONFIGS`, `modeConfigFor`;
  see §3), and the `wins`-table keys `GAME_KEY` / `WIN_LEVEL` (shared by
  `WordSearchPage`'s `recordWin` and the hub item's count; see §3);
  re-exports `GAME_DISTRIBUTION` from bubble-match.
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
- `server/routes/onDeckRoutes.ts` — `GET /api/onDeck/wordSearchGrid`.

## 7. Dependencies / cross-references

- **Study Challenge rounds (§ 1c):** `OnDeckVocabService.getWordSearchGrid`'s `challenge`
  parameter + `WORD_SEARCH_CHALLENGE_ROWS/COLS`, `OnDeckVocabController.resolveChallengeRound`,
  `StudyChallengeService.getRoundContext`, `ProvisionalCardService.getFillerPool`, and on the
  client `src/games/runtime/useChallengeRound.ts` + `WordSearchPage.tsx` (`challengeParamsRef`,
  the hint/find events, the scoreboard). Spec: [STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md) §§ 5.2–5.5.
- **Reuses:** `OnDeckVocabService.getGameVocabPool` machinery + `GAME_FALLBACK_ORDER`
  (pool + fallback), `CPCDRow` (`src/components/CPCDRow.tsx`) at `sm`, leaf-page
  shell, `BubbleMatchHeaderControls` pattern, and `GAME_DISTRIBUTION`.
- **Parent doc:** [GAMES_FEATURE.md](./GAMES_FEATURE.md) (framework, registry, leaf-page rules).
- **Related:** [CPCD_PINYIN_SHIFT.md](./CPCD_PINYIN_SHIFT.md) (cpcd spacing),
  [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md).
</content>
</invoke>
