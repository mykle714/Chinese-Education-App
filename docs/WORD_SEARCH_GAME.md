# Word Search Game (`/games/word-search`)

> Status: **built (v1).** All design questions below are resolved. This doc
> describes the shipped structure for future agents.

> **How it is reached (2026-11-06): as an flp break only.** The Games hub
> (`src/games/GamesPage.tsx`) was deleted and the standalone `/games/word-search` page is
> not mounted while the `standaloneGames` feature flag is off
> (`server/contracts/featureFlags.ts`; `src/games/registry.ts` → `ROUTED_GAMES` is empty).
> Word Search is played as a break inside the Deck Tower study session
> (`src/games/flpBreak/index.ts` → `FLP_BREAK_GAMES`, `WORD_SEARCH_BREAK`). The page, the hub
> entry (`WordSearchHubItem`, `WordSearchResumeTile`, `useWordSearchLauncher`) and the resume
> flow described below are kept but dormant: they have no live caller. Sections that talk about
> the Games hub and `/games` describe that dormant route.

Originally the second game in the Games hub (see [GAMES_FEATURE.md](./GAMES_FEATURE.md)).
The player is given 9 of their own vocabulary words and hunts for each one
inside a grid of Chinese characters. Words are hidden as **snaking paths**
(orthogonally-connected runs of cells), padded out with filler characters.

As a route (dormant) it is a **leaf page** (down-arrow back → `GAMES_HUB_EXIT`, now `/` "Deck Tower", no footer)
and reuses the same colored-pinyin cell primitive (`CPCDRow` / cpcd).

---

## 1. Card selection (which 9 words)

Reuses Bubble Match's pool machinery so the two games feel like siblings.

- **Word Search's own distribution**, no longer a clean half of Bubble Match's
  (`GAME_DISTRIBUTION` in `src/games/bubble-match/constants.ts` is 2/10/6/2):
  `1 Unfamiliar + 5 Target + 2 Comfortable + 1 Mastered = 9`. It started as a
  literal half of Bubble Match's (1/5/3/1 = 10), went to 2/6/3/1 = 12 on
  2026-08-23, and came back to 9 on 2026-08-28 when the board shrank to 7×6 —
  the word that came off was a Comfortable one, so the board still leans on the
  band the player is actively learning. The mix is `WORD_SEARCH_BOARDS.standard.distribution`
  (`server/contracts/wire.ts`), a literal record, not derived from Bubble Match's.
- **Same lend-then-borrow top-up** when a bucket is short: first **lend** the
  shortfall (`OnDeckVocabService.lendGameCandidates`, 2026-08-17 — lent words are
  unshifted onto the fresh `Unfamiliar` queue so the substring-dedup replacement
  loop can draw on them too), and only then borrow from the fallback buckets in
  priority order (Target → Comfortable → Unfamiliar → Mastered), matching
  `OnDeckVocabService.getGameVocabPool` / `OnDeckVocabService.GAME_FALLBACK_ORDER`.
  A focus-scoped grid never lends. See docs/PROVISIONAL_CARDS.md § 4b.
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

1. Assemble the 9-card pool (distribution + fallback, as above).
2. Scan for any pair where one word's Chinese text is a substring of another's.
3. For each offending pair, **drop the shorter word** and pull a replacement
   **of the same progress category** first, then falling back through the same
   fallback order — excluding cards already in the pool.
4. Re-run the substring scan. Repeat until the pool is clean **or** the user's
   entire library has been exhausted as replacement candidates.
5. If a clean set of 9 cannot be assembled, the game is **blocked** with:
   *"You need at least 9 Learning cards with distinct characters to play Word
   Search."* (mirrors the bubble-match blocked-phase copy). ⚠️ This description predates
   the provisional-cards system (docs/PROVISIONAL_CARDS.md) — a short library is now
   topped up with lent cards rather than blocking; see `WordSearchStage.tsx`'s note that
   "the old ... block is gone".

> Note: substring, not just equality — `国` is a substring of `中国`, so they
> can't coexist. Single-character words are the most collision-prone.

### 1b. English de-duplication (dd collision)

A second, independent constraint on the same 9 words, enforced app-wide across every
game: **no two targets may share a dd**. The word list prints nine English glosses in a
column, and two identical ones leave the player no way to know which grid word a gloss
is asking for.

Enforced in `OnDeckVocabService.getWordSearchGrid` by a `takenDds` set inside `drain`,
keyed on `ddCollisionKey` (`server/utils/definitions.ts`). Unlike the substring rule
above it needs no re-scan pass — a colliding candidate is simply never admitted — but
it does have to **release** a key when the substring loop evicts a word, or the
replacement pull would be reserving a gloss that nothing is showing.

A grid that cannot reach 9 dd-distinct words falls out the same door as a grid that
cannot reach 9 character-distinct ones: `reason: 'insufficient-distinct'`, which the
controller answers by escalating the provisional baseline and retrying.

Full rule and the other two chokepoints:
[GAMES_FEATURE.md](./GAMES_FEATURE.md) § "No two cards may share a dd in one round".
Extending it to NEAR-identical glosses is designed (unbuilt) in
[GLOSS_CONFUSABILITY.md](./GLOSS_CONFUSABILITY.md).

---

### 1c. Study Challenge rounds — the same 9-word 7×6 board (built 2026-08-22)

Word Search is challenge-eligible **as Pinyin only** (Pinyin is production; No Pinyin is
reading, and a challenge round is recognition or production —
[STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md) § 5.1). A challenge round replaces section 1's
selection entirely: the target list is the challenge's **nine contested words**, and the
filler that pads it comes from the `mastered-first` ladder rather than from the band
buckets.

The GRID, however, no longer changes at all:

| | Ordinary board | Challenge board |
|---|---|---|
| Targets | `TOTAL_WORDS` = 9 | `CHALLENGE_WORD_COUNT` = 9 (separately declared) |
| Size | 7×6 (42 cells) — `WORD_SEARCH_BOARDS.standard` | the same board |
| Placement | template mode when it applies, else random | identical |

**Why one size (2026-08-28).** A challenge round used to get its own roomier **8×8**
board, because twelve words at the 4-character cap is up to 48 characters and random
placement would almost never fit that into the then-54-cell ordinary grid. Two sizes meant
two densities and two tunings, and — since `templateModeApplicable` gates on the exact
board dimensions — a challenge board could never reach template mode, which is precisely
the fallback a dense board needs most. Dropping both counts to 9 removed the pressure that
justified the split: 9 words × 4 cells = 36 of 42 cells either way. Both boards read
`WORD_SEARCH_BOARDS.standard`, so a challenge board is template-eligible on the same terms
as any other.

**The substring de-dup pass is why Word Search scores contested and filler differently.**
An arbitrary set of nine words will not reliably have mutually distinct characters
(§ 1a), so some contested word will sometimes have to be dropped and replaced — and the
replacement is filler. At a flat 100 a player whose set forced four substitutions would be
paid full price for four easy words; at 100/20 the split is invisible when the whole set
places cleanly and correct when it does not. To make sure there is something to substitute
WITH, the challenge branch queues **twice** the board in filler; without that, a set that
shares characters fails as `insufficient-distinct`, which for a challenge round means a
round the player cannot play at all.

**The time penalty is charged on a clock the player cannot see** (2026-11-01, § 5): the
round's −10/s past 1:00 still runs, but no clock is on the board during a round.

**Challenge boards are never saved** to the pause/resume slot (§ 5b): the slot is offered
back as the hub's Resume card, which would restore a scored board outside its challenge
and would also overwrite the player's own casual save.

## 2. Grid generation (new, server-side per user request)

> ⚠️ **Challenge mode's word count matches the ordinary board's — but the two are
> separately declared, not derived from each other.** Everything in this document
> describes the normal board, whose size is `TOTAL_WORDS = 9`
> (`src/games/word-search/constants.ts`, own literal distribution — see §1). A
> study-challenge round must contain every contested word
> (docs/STUDY_CHALLENGE.md § 5.2) and that set is `CHALLENGE_WORD_COUNT = 9`
> (since 2026-08-28), so a challenge grid still takes its target-word count from
> that constant (the SPECIFIC contested ids, not a band distribution) rather than
> `TOTAL_WORDS`. The GRID is now identical in both modes (§1c). Not built yet —
> the scored round runner is the outstanding piece — but that shared board and the
> distinct-character rule below are what that build has to satisfy with 9 words.

The standard grid is **6 columns wide × 7 rows tall** (portrait; fills the play rectangle);
a Deck Tower break plays a 6×5, 7-word version (§5c). This section describes the standard
board; placement is the same on both.
Each cell holds exactly one Chinese character (one cpcd cell).

### Placement (snaking)

For each of the 9 words, in order:

1. Pick a **random empty start cell** for the word's first character.
2. For each subsequent character, pick a **random empty cell adjacent** to the
   previous one. Adjacency is **orthogonal only (4-dir: up/down/left/right)** —
   no diagonals. Same adjacency governs valid drag-selection paths. The walk is
   unrestricted at every length; short words are then flipped into reading
   order by `orientPath` (see "Reading order" below).
3. If at any step no valid (empty, in-bounds) adjacent cell exists,
   **backtrack**: abandon this placement and retry from a new random start.
4. Retry the word up to **10 times**. If it still fails, **regenerate the whole
   grid from scratch** (all words re-placed). A 7×6 (42-cell) grid holding ≤9
   short words is tighter than the old 10×10, so retries/regenerations will fire
   more often under this cap — revisit `MAX_WORD_ATTEMPTS`/`MAX_GRID_ATTEMPTS`
   (`server/services/wordSearchGrid.ts`) if placement failures become noticeable.

Words are capped at **≤4 characters** (enforced at pool-assembly time, §1) and,
after `RANDOM_GRID_ATTEMPTS` (5) failed whole-grid regenerations, placement
falls back to one of 11 pre-authored template layouts that guarantee every
word fits — see [WORD_SEARCH_TEMPLATES.md](./WORD_SEARCH_TEMPLATES.md) for the
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

After all 9 words are placed, every remaining empty cell is filled with a
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
  words: Array<{                 // the 9 targets (order = top-of-screen order)
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
cell belonging to one of the 9 target words carries the character's
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

### Hub card (Pinyin mode), no in-game toggle

Word Search's Games-hub entry is the shared `GameCard` (`src/games/shared/GameCard.tsx`) fed by
`buildWordSearchCard` (`src/games/word-search/wordSearchCard.tsx`) — an all-pur card
with the title + lifetime win pill on top, the compact resume tile (one Bubble Match
level slot wide) at the bottom-left when a board is parked, and the round ink play
button at the bottom-right. On the hub it spans the grid's full row
(`gridColumn: "1 / -1"`), exactly like Bubble Match's card above it. The card — and the
save-slot read, resume, erase and confirm dialog — come from ONE hook,
`useWordSearchLauncher` (`src/games/word-search/useWordSearchLauncher.tsx`), parameterised
by `mode` and `classPrefix`. It is rendered by `src/games/word-search/WordSearchHubItem.tsx`
(Pinyin slot), in `GamesPage.tsx`'s `game.gameId === "word-search"` branch.

| Mode | `mode` | Pinyin | Mark type | Launched from |
|---|---|---|---|---|
| **Pinyin** | `"pinyin"` | grid pinyin on, **always tone-colored**, rendered at **big-pinyin** scale (see "Cell size") | PRODUCTION | Games hub card |
| **No Pinyin** | `"no-pinyin"` | grid pinyin off | READING **+ PRODUCTION** | flp break on the reading world only (§ 5c) |

- The card shows **only the game's name** — no subtitle, like every Games hub tile
  since 2026-10-03 (it used to read *Pinyin · Production*; see
  [MASTERY_REWORK.md § "The hub no longer names the track"](./MASTERY_REWORK.md)). The
  resume card carries no track or mode label either — the hub only ever parks a Pinyin
  board.

### What a find marks

A found word posts **one `/api/flashcards/mark` per track**, all positive
(`markWordFound` in `WordSearchStage.tsx`, list from `modeMarkTypes`):

| Mode | Marks written | Why |
|---|---|---|
| Pinyin | `production` | The prompt is an English gloss, so the find is recall — but the grid's pinyin row is a phonetic crutch, which is precisely what the reading track is defined by the *absence* of. So no reading mark. |
| No Pinyin | `reading` **and** `production` | Both skills are genuinely exercised in one action: the prompt is an English gloss (recall from meaning → production) and the grid is bare characters (→ reading). This is the only surface in the app that clears two tracks per action. |

Three consequences worth knowing:

- **Two bars move.** `production` feeds the **core** bar, `reading` feeds the
  **reading** bar. The rule "a mark belongs to exactly one bar" is unchanged — these
  are two separate marks — but a No-Pinyin find is the first review ACTION that moves
  two bars. `worldForMarkType` and `FlashcardMarkService.applyMark` are untouched by this.
- **The secondary mark is best-effort.** The board was pooled on the primary track, so
  a card can be off cooldown for `reading` while still cooling for `production`; the
  mark endpoint then drops the production mark and logs `[MarkSuppressed]`
  ([HYDRA_BUBBLES.md § 8](./HYDRA_BUBBLES.md)). The hub label describes the *attempt*.
- **It does NOT make No Pinyin challenge-eligible.** Eligibility reads the primary
  track only, so a reading board can never be drawn into a Study Challenge round —
  pinned by `src/games/__tests__/challengePool.test.ts`.

A hinted word marks **nothing at all**, on either track (§ hints).

- **Each mode has ONE launch surface.** The Games hub offers only **Pinyin**
  (`WordSearchHubItem` → `HUB_MODE`); **No Pinyin** is a reading drill played only as an
  flp game break on the reading world (§ 5c), which never saves a board.
- **The hub card's play button ALWAYS starts a fresh game** — and so does a tap
  anywhere else on the card outside the resume tile (`GameCard`: a card with a play
  button is tappable as a whole, see [GAMES_FEATURE.md](./GAMES_FEATURE.md) § "Design
  decisions"). It navigates with nav
  `state = { mode: "pinyin", resume: false }`. That would clobber the parked Pinyin
  board (§5b), so if one exists the button first opens a **confirm dialog** ("Starting a
  new game will erase your saved Word Search game …"); only on confirm is the save
  cleared and the new game started (`NewGameConfirmDialog`).
- The chosen mode is passed via React-Router nav `state.mode` and is **fixed for the whole
  run** — there is no in-game pinyin toggle. `WordSearchPage` reads it once on
  mount (`modeConfigFor`, `MODE_CONFIGS` in `constants.ts`).
- A direct/stray visit with **no valid mode** (manual URL) **redirects to
  `/games`** rather than defaulting — the player must pick a card. (Bubble Match
  does the same for a missing level.)
- The **colorless pinyin option was removed**: when pinyin is shown it is always
  tone-colored (`showPinyinColor` is a fixed `true`).
- Word Search no longer reads the shared `useFlashcardLearnSettings`
  pinyin/colorless toggles; that hook is gone from `WordSearchStage`. **This is now the
  app-wide rule** — pinyin is a per-game setting, and Word Search is its precedent; see
  [GAMES_FEATURE.md § "Pinyin is a per-game setting"](./GAMES_FEATURE.md).

#### Win count

The card header's **win pill** (`GameCard`'s `WinCountPill`) is a trophy glyph + the
**aggregate lifetime win count** — `totalWins` from `useGameWins(GAME_KEY)`.

Win logging goes through the same hook. `WordSearchStage` calls
`recordWin(WIN_LEVEL)` on completion (it previously hand-rolled its own
`POST /api/users/me/wins`); `GAME_KEY` (`"wordSearch"`) and `WIN_LEVEL` (`1`) now
live in `constants.ts` so the page and the hub item share them. Word Search has no
levels — **every completion in either mode lands in the one `level: 1` bucket**,
so its hub count is inherently whole-game.

#### Resume card

One component, **`WordSearchResumeTile`** (`src/games/word-search/WordSearchResumeTile.tsx`),
renders the resume card on the Games hub (`WordSearchHubItem`, Pinyin slot), through
`buildWordSearchCard` → a
`kind: "resume"` `GameCardOption`. It is drawn on `GameOptionTile`
(`src/games/shared/GameCard.tsx`), the SAME shell as a Bubble Match level tile, so its
radius, padding, 62px floor, outline and title type (`OPTION_TITLE_SX`) are shared rather
than copied. The tile owns its two faces and the `confirmingErase` state;
`useWordSearchLauncher` owns the save slot (`onResume`, `onErase` → `clearGameState`), and
`GameCard`'s option slot owns its footprint. It spans **two** Bubble Match
level slots (`slots: 2` on the option → `slotFlex(2)`: two level widths plus the gap between
them, ~207px on the hub's full-row card) and is 62px
tall; the delete face reads **"Delete?"** with Cancel / Delete **stacked** and a 6px inset.

**Colour + ghost** (since 2026-10-06): the ground is the card hue's tint tier,
`RAMP[GAME_HUE].tint` (purTint — the purple card's near-white second tone; it replaced the
old `cardBeige`), and the normal face wears the game's registry glyph (`grid_on`, passed in
as `glyph` by `buildWordSearchCard`) as a small corner ghost via `GameOptionTile`'s `glyph`
prop — the parent card's ghost treatment scaled to the tile, the same one Bubble Match's
level tiles use — but pulled inward (`glyphRight = ERASE_CLEAR_RIGHT`, 26px) so it sits
just left of the ✕ rather than under it. The delete face hides it. (The roomier "Delete save?" / side-by-side variant, `compact={false}`,
was deleted 2026-10-03 when the hub moved onto the shared card and left it no caller.)

When a saved board exists, the tile sits at the left of the card's options row. Its **normal
face**: just a **"Resume"** title (`OPTION_TITLE_SX` — 12.5 / 600 / onSurface, same as a
level tile) and an **✕** inset in the top-right corner. It shows **no parked time and no
found count** (both removed 2026-10-06) — the tile is a plain way back in, not a progress
readout, so it takes no `saved` prop at all. (The parked board's X/N found still appears in
`NewGameConfirmDialog`'s "your saved game will be lost" copy, via `savedWordCount`.) **No mode label**:
the hub only ever parks a Pinyin board.

**Outlines:** the resume tile wears the app's button outline (`1px solid COLORS.border`,
CLAUDE.md § "Buttons & cards"); the Word Search card *around* it deliberately does not —
`buildWordSearchCard` sets `GameCardData.outlined: false` (the frame stays a transparent
1px so its footprint matches Bubble Match's outlined card).

- **Tapping the card resumes** — navigates with `state = { mode: saved.mode,
  resume: true }`; `WordSearchStage` restores the saved board instead of fetching
  a fresh one. No warning (nothing is lost).
- **✕ arms an in-place delete confirmation** (`confirmingErase` state): the
  tile flips to a **"Delete?" face** with **Cancel** / **Delete**
  buttons — it does NOT erase on the first tap. Cancel returns to the normal
  face; only **Delete** clears the save (`clearGameState`) and the tile unmounts
  (no exit animation — the card's `minHeight: 62` options row keeps the card's height
  steady). While the confirm face is showing, a tap on the tile body does not resume.
- **The delete face is absolutely inset (6px) and must stay that way**,
  and so must its one-line copy. In the card's flex row, anything that face
  measures becomes the height of the tiles beside it (historically, "Delete saved
  game?" wrapped to two lines and arming the ✕ grew the whole hub strip). Out of flow
  the face contributes nothing, so arming the ✕ never resizes its host. The normal resume face may stay in
  flow because every one of its lines is `whiteSpace: nowrap`.
- Word Search has **no difficulty** concept, so the card intentionally shows the
  **mode** as its only categorical line (no separate difficulty row).

Vertical stack inside the standard leaf-page content area:

```
┌─────────────────────────────┐
│ header (down-arrow · audio chip · fire badge)
├─────────────────────────────┤
│  9 English glosses, 1–2 compact lines              │  ← "Lv1 Chill" type style
├─────────────────────────────┤
│ ╭─────────────────────────╮ │
│ │                         │ │
│ │   rounded-rect grid     │ │  ← 7×6 cpcd cells
│ │   of cpcd cells         │ │
│ │                         │ │
│ ╰─────────────────────────╯ │
└─────────────────────────────┘
```

- **Word list (top):** the 9 targets shown as their **English glosses** (a
  recall drill — you read the meaning and hunt the Chinese in the grid), set as **one
  inline run at `SIZE.bodyLg` (16px; 11px until 2026-09-25), separated by faint middots** (changed 2026-08-24). **Two** states
  and only two: **pending** — full ink, still the loud one relative to its neighbours
  because a pending gloss is the game's actual instruction; and **found** — struck
  through and faded, still present, because the list is also the record of what the run
  has covered and the fade is what makes the remaining work countable at a glance.
  A **third** state was added 2026-08-28: the **hinted** word (`hintEntryKey`, passed down
  from `WordSearchStage`) is marked — since v2 with a `HINT_HIGHLIGHT_BG` highlighter fill
  (`COLORS.org`, the board's own hint-reveal colour; `src/games/word-search/constants.ts`),
  because v2 made `HINT_ACCENT_COLOR` plain ink and a text tint could no longer tell it
  apart — so the mask is visibly attached to the gloss it is spelling. It used to have no state at all, on the theory that the reveal
  one row above already named it; but the reveal names it in PINYIN (or in component
  glyphs), which is exactly what the player cannot yet read, so nothing on screen connected
  the mask to a meaning. The tint is colour only — no weight or size change — so the run's
  rhythm is unchanged, and **found beats hinted** (a found gloss keeps the struck-through
  fade). Code: `WordSearchWordList.tsx` (`hintEntryKey` prop, `isHinted`,
  `.word-search__word-list-item--hinted`).

  ⚠️ **This replaced the design's `.chip`s, and it reinstates a shape that was itself
  replaced once.** The chips were a solid ink pill per pending word; ten black pills are
  the loudest thing on the screen, and the screen's subject is the BOARD — the list is
  what you glance at between traces. Set small and inline it reads as a caption under the
  section header instead of as a second board. The reason chips existed is still live,
  though: a middot run makes a multi-word gloss ("job interview") hard to tell from two
  adjacent one-word ones. Two things answer it — the middot is `textFaint` with a 7px gap
  on each side (against a word space of ~4px), and each gloss is `white-space: nowrap`, so
  a two-word gloss never breaks across rows and a found one strikes through exactly its
  own words. If it still reads ambiguously, the next lever is trimming glosses to a single
  word, **not** a return to boxes. (Glosses are the dd resolved SERVER-side in
  `OnDeckVocabService.getWordSearchGrid` via `resolveDisplayDefinition`, so they honor the
  learner's per-card `selectedSense`; kept short so they tile, and a very long definition is
  truncated. See [DEFINITION_MAPPING.md](./DEFINITION_MAPPING.md) form #3.)
- **Grid (bottom):** the 7×6 array of cpcd cells, **sitting directly on the white
  `.play` panel with no container of its own** (changed 2026-08-24 — see "The board has
  no ground" below). Each cell is one cpcd
  character (may be wrapped per-row in `CPCDRow`). The grid respects the header
  pinyin toggle uniformly across word + filler cells. Because the prompts are
  English, the **pinyin display only affects the grid** (there is no Chinese in
  the top list to toggle). Whether pinyin shows is fixed by the launched mode
  (see "Two hub entries" above), not a per-session toggle.

### The play panel, top to bottom

Shelf redesign entry 13 (`docs/SHELF_REDESIGN.md`). Everything below lives inside
`GameFrame`'s `.play` panel:

| Row | Component | Content |
|---|---|---|
| glosses | `.word-search__word-band` → `WordSearchWordList` | the target glosses, inline and middot-separated (§ above), centred both ways in the height above the board |
| grid | `WordSearchGrid` | the board, at its natural height, anchored on the screen (below); it shrinks only when the screen is too short for it |
| spacer | `.word-search__grid-spacer` | whatever height the board leaves below it |
| hint | `WordSearchHintBar` | reveal · button (charge bars under it) (§5a). Last row, pinned to the panel's bottom edge; hairline on its TOP |

**There is no strip above the glosses.** The HUD held the clock until 2026-11-01, when the
clock went out of sight (§ 5), and with it the eye toggle and the whole strip.

**The board is anchored to the screen.** Its centre sits `GRID_CENTER_FROM_BOTTOM` (2/5) of
the screen's height up from the bottom edge, on the page and in an flp break. "The screen"
is the `.mobile-demo-frame` shell, so the desktop phone frame counts as one.
`useGridScreenAnchor` (`useGridScreenAnchor.ts`) measures the shell and the panel, and sets
the gloss band's height to put the board there (`anchoredBandHeight`). The board only leaves
that line when there is no room:

- **The hint row pushes it up**, when the board would otherwise run into the row.
- **The glosses push it down**: the height is a `min-height`, so taller content wins.
- **It scales down last**, when both are pushing (`useFitScale`).

The panel's offsets are read through `offsetTop`, not `getBoundingClientRect`, so a page
transition's transform cannot be baked into the anchor.

**The glosses are centred above the grid** (2026-11-01). The grid container's flex basis is
the board's natural height (`boardNaturalHeight`, `boardMetrics.ts`), and the rows are centred
horizontally. The list sits at the middle of the visible gap above the first row of tiles. That gap starts at the
top of the panel on the page, and at the bottom of Leave's back arrow in an flp break
(`GAME_FRAME_EXIT_ARROW_BOTTOM_PX`). The band's top padding is that start plus `GRID_EDGE_PX`,
matching the empty space the grid box already holds above its tiles. On a short screen the band holds its content height
and the board scales down instead.

**There is no list header.** The "Find these words" / "trace to select" caption pair that
used to sit above the glosses was removed (2026-09-25), so the gloss list opens the panel. The hint row moved to the BOTTOM of the panel (2026-09-25), below
the grid — in thumb reach, and out from above the words the eye reads first. The trace gesture is no longer stated anywhere on the play panel.

**Type on the play panel (2026-09-25).** Every text element of the panel — the gloss list
and the hint reveal — is set at ONE size,
`SIZE.bodyLg` (16px), from the app's type tokens (`src/theme/scale.ts`); change them
together. Faces follow `src/theme/fonts.ts`'s roles:

| Element | Face | Weight | Where |
|---|---|---|---|
| gloss list | `FONTS.sans` | `WEIGHT.medium` | `WordSearchWordList.tsx` |
| pinyin reveal | `FONTS.mono` (the blanks need a fixed pitch) | `WEIGHT.regular` | `WordSearchHintRow.tsx` |
| component reveal | `FONTS.hanziComponents` (the only face with the rare component glyphs) | `WEIGHT.regular` | `WordSearchHintRow.tsx` |

Line heights are `LEADING.tight`.

There is **no found count** either (removed 2026-09-25): the gloss list already strikes
through each found word.

**The mode is not stated at all** (2026-09-25). The HUD used to lead with the mode label
(`Pinyin · production`, `No Pinyin · reading & production`); it was removed. The mode is
fixed by which hub entry launched the run and is visible on the board itself (pinyin is on
the grid or it is not), so no chip, toggle or label repeats it. `modeConfig.label`
(via `modeLabel`) survives only in the "Start a new game?" confirm (`NewGameConfirmDialog`).

### Header controls

`WordSearchHeader.tsx` fills the leaf-page `rightContent` slot with **the audio-mode
chip (`AudioModeChip`, `word-search__audio-chip`) and nothing else**; `PageHeader` adds the
fire badge. Four things have left this slot:

- ~~**Restart button** (`word-search__restart-btn`)~~ — **REMOVED.** A restart
  icon used to sit leftmost and discard the in-progress board via `resetBoard`.
  `resetBoard` was deleted 2026-11-10 with its last caller, the win popup's "Play
  Again": a board in progress can no longer be thrown away from the header, only
  finished or left (it stays parked in the
  saved slot, §5b, resumable from the hub).
- ~~**Hint button** (`word-search__hint-btn`)~~ — **MOVED** into the play panel's
  `.hintbar`, next to its own charges and reveal. Spending a hint is a game action.
  See §5a.
- ~~**Pinyin display rows**~~ — **REMOVED.** Pinyin is a property of the hub entry that
  launched the run (see "Two hub entries"), and per
  [GAMES_FEATURE.md § "Pinyin is a per-game setting"](./GAMES_FEATURE.md) no game reads
  or writes the flp's shared setting.
- ~~**Settings cog** (`word-search__settings-btn`) + `WordSearchSettingsDialog`~~ —
  **DELETED 2026-09-30.** Its last row, "Show timer", moved to an eye toggle in the HUD,
  and that went too on 2026-11-01 (§ 5). Word Search has no settings, sheet or hook.
- Fire badge (minute points) — rendered by `PageHeader` on every header, flush right of
  these controls; this route is in `MINUTE_POINTS_ELIGIBLE_PAGES`, so it burns orange here.

### Cell size

Use `CPCDRow` **`sm`** (32px column) on the standard board and **`smd`** (40px column) on
the compact one (`BOARD_CELL_SIZE`, §5c), with **big pinyin on** in Pinyin
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

One knock-on effect: the reserved band is part of what sets the tile's size, since
the square tile is sized from the cpcd cell's natural box (see below) and that box is
taller with `bigPinyin` on. On the standard board **Pinyin** tiles are 57px and **No Pinyin** tiles 53px.

**No Pinyin glyph centering.** The tile flex-centers the whole glyph+band stack, so
with the band empty the character would ride half a band above the tile's center.
The tile's `ForeignText` passes `centerGlyphWhenPinyinHidden`, and CPCDRow itself
paints the glyph half a band lower whenever every syllable in the row is hidden
(`src/components/CPCDRow.tsx` → `centerHiddenPinyinGlyph`; see
[CPCD_PINYIN_SHIFT.md](./CPCD_PINYIN_SHIFT.md) § "Centering the glyph when pinyin is
hidden"). It is a paint offset rather than padding, so the square track and
`useFitScale`'s measured box are unchanged; it does nothing on the Pinyin board.

More pinyin overflows its 32px column at this scale, so expect more
shifting/separator apostrophes — see
[CPCD_PINYIN_SHIFT.md](./CPCD_PINYIN_SHIFT.md) § "Interaction with `bigPinyin`".

A `useFitScale` wrapper in
`WordSearchGrid.tsx` scales the whole 7×6 grid down to fit the play area
(transforms don't affect `elementFromPoint`, so drag hit-testing still works),
so it renders at real `sm` size and shrinks only as needed on short screens.

**Every cell is a square** (the design's `.wsg span`) spaced by
`CELL_GAP` px on both axes (`constants.ts`, 4px). Squareness is what lets a traced
path read as a path: on a board of squares a run of lit cells weighs the same going
down as going across, so a word that turns a corner still looks like one word.

The square comes from **explicit, equal px tracks** — `WordSearchGrid`'s `cellSide`
memo asks `cpcdNaturalSize` (`src/components/cpcdLayout.ts`, via `boardMetrics.ts`) for the cpcd cell's natural
box and takes `ceil(max(width, height))`, which both `gridTemplateColumns` and
`gridAutoRows` are then set to; the cell stretches into its track.

> ⚠️ It must NOT go back to `aspect-ratio: 1` on the cell inside `repeat(N, 1fr)`
> tracks, which is how this shipped until 2026-08-24. A cpcd cell is far taller than
> it is wide (a 32px `sm` column under a ~57px glyph+pinyin stack), so that asked the
> engine to reconcile a track width derived from content-**width** with a tile height
> derived from content-**height**. Chromium reconciled them; **Safari did not** — it
> laid the grid box out at the narrow figure and painted the wide tracks, so on iOS
> the board overflowed the play panel to the right with columns clipped off-screen,
> a dead gutter on the left, and `useFitScale` (which measures the grid **box** via
> `offsetWidth`, not the painted tracks) reporting that everything fit and leaving
> the scale at 1. Explicit px tracks keep the box and the tracks equal in every
> engine, which is also what keeps the fit-scaler's input honest.

### The selection system

Every highlight — resting, tracing, found, hinted, missed — is **a fill on the cell**,
from the design's `.wsg span` / `.hit` / `.now` (artboard 13). Every lit state is the
**SURFACE tier** of its hue (`COLORS.grn`/`org`/`red`/`blu` = `RAMP[hue].surface`) —
changed 2026-09-25 from the MID tier artboard 13's caption names ("Mid: found and active
letters"): a cell fill is a large pastel field behind a character, which is the surface
tier's job, and the paler fill leaves the glyph and its pinyin more contrast. All states
share the one tier so none reads louder than the others. The word list's hinted-gloss
highlight (`HINT_HIGHLIGHT_BG`) moves with the hint fill — `WordSearchGrid.tsx`:

| State | Fill | Meaning |
|---|---|---|
| resting | `COLORS.background` (paper) + the ring | an unclaimed tile |
| tracing | `COLORS.org` (`.now`) | the in-progress drag |
| found | `COLORS.grn` (`.hit`), ring swapped to a 1.5px **ink** ring (v2 `#ws .wsg span.hit`) | locked in |
| reviewing | unchanged `found` tiles, plus **one continuous 2.5px `COLORS.orgMk` line around the whole shape**, `REVIEW_OUTLINE_OUTSET` outside the word's tiles (the app's addition — the design has no reviewed state). `orgMk` is the mark tier of the tracing orange: the line sits on the white panel, where the surface tier `COLORS.org` is only ~1.29:1 against ~2.16:1 | the found word whose gloss popup is open; the line shrinks with each drill rung, down to one tile |
| hint reveal | `COLORS.org` | "trace THESE" — the same meaning as `.now` |
| miss | `COLORS.red` | wrong trace; transient, and outranks whatever is under it |
| bonus | `COLORS.blu` | a traced **multi-character** real det word that wasn't a target (it also shakes). Outranks the miss fill. A **single-cell tap** never paints blue (2026-09-25) — a one-character headword or one character of a target showing its contextual gloss keeps the orange tracing fill and just opens its popup. |

#### The board has no ground (2026-08-24)

**Every cell carries the palette's `COLORS.markOutline` inset ring**, and the grid box
draws nothing at all — no fill, no radius, 4px of padding purely so the outer tiles'
shadows are not clipped by the scaler's `overflow: hidden`. The cells sit directly on
`GameFrame`'s white panel.

The problem this has to solve has not gone away: a paper cell on the white panel is
~1.03:1, so with nothing drawing an edge the tiles dissolve and the board stops reading
as a board. **The edge moved from behind the tile to on it.** That is the app's own
device — the palette states that a pastel fill at ~1.15:1 is not a shape until it carries
the inset ring — so the board is now one more caller of a rule the rest of the app already
follows, rather than a special case with its own container.

It also **helps the lit states**. A pastel fill on a paper tile is a value step; a pastel
fill on the grey board it used to sit on was the *same value as its ground*, so tracing lit
up a tile that was already as dark as everything around it.

⚠️ **What the grey board was doing right, for the record**, in case this needs reverting:
it was achromatic on purpose. All four lit fills are ramp pastels at the same lightness, so
a HUED ground would have sat in the same band as whichever state shared its hue. Any future
attempt to give the board a ground again has to stay achromatic for the same reason.

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

**The one exception: the reviewing outline.** It is the only highlight not painted on a
cell, and it needs none of that machinery, because it is anchored to tile *edges* and those
follow from `cellSide` + `CELL_GAP` + `GRID_BOX_PADDING` alone.
`wordOutlinePath` (`src/games/word-search/wordOutlinePath.ts`) walks the boundary of the
rung's cells as a set, so a word that doubles back encloses its inner gutter, and a ring
gets a second loop for its hole. `WordSearchGrid.tsx` strokes that path on an SVG above the
tiles (`REVIEW_OUTLINE_WIDTH`), and the tiles keep their normal rings and gaps. It sits
`REVIEW_OUTLINE_OUTSET` (one full gutter) outside the word's tile edge, so it runs along the
neighbouring tiles' edges and overlaps them by half its stroke. Its two corner radii keep it
concentric with whichever tile corner it turns around. At the board edge the line passes
`GRID_BOX_PADDING`, so the SVG is `overflow: visible`; `GRID_MARGIN` leaves room for it. The
SVG is `pointer-events: none`, so `cellFromPoint` still resolves to the cells.

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
    built entirely from characters on this grid, but not one of the 9
    targets. The same shake plays once, the traced cells turn blue
    (`COLORS.blu`) instead of red, and the word's definition appears in
    the review-popup style (below). Unlike a true miss this has **no timer** —
    it stays up until the player dismisses it by tapping elsewhere.

    > Until 2026-08-29 the blue never actually appeared: the cell-fill chain in
    > `WordSearchGrid.tsx` tested `isInvalidCell` **first**, and a multi-character
    > bonus satisfies that predicate too (it is the shake condition), so red won
    > every time. The fill now tests `isBonusCell` first and `isInvalidCell`
    > second; `isInvalidCell` still governs the shake alone.
  - **Bonus word, 1 character (stays orange, no shake, no auto-clear).**
    A lone tap is just a one-cell query, so if that single character is itself
    a det headword, it resolves here: the tapped cell **keeps its orange
    selection fill** with **no shake**, and its definition popup appears with no
    timer until dismissed. Until 2026-09-25 it turned the bonus blue; it no
    longer does — a tap is not a trace, so it gets no "find" colour. Blue is
    reserved for a traced multi-character bonus word (`isMultiCharBonus`).
  - **Dismissing a bonus match:** any new `onPointerDown` — starting a fresh
    drag, tapping a found word (which opens that word's own popup instead),
    or a background tap (`WordSearchStage`'s `handleBackgroundPointerDown` →
    `clearSelection`) — clears `invalid` and the stale `path` together, so the
    old highlight/popup can never linger under a new interaction.
  - **Tapping the same single character again toggles its popup off**
    (2026-11-10). Applies to both one-cell popups — the 1-character bonus
    headword above and the target-character `charPopup` (§ Tapping a single
    target character). `onPointerDown` notes whether it landed on the cell whose
    one-cell popup is open (`toggleOffCellRef`, captured before the dismissals
    wipe that state); if the release is still that lone cell, `submit` calls
    `clearSelection` and returns instead of reopening the popup. A drag that
    starts on that cell grows the path past one cell and is traced normally.
    Code: `WordSearchGrid.tsx` → `toggleOffCellRef`, `onPointerDown`, `submit`.

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
  calls `tapFoundWord` instead (locked cells can never belong to a *remaining*
  target because words are disjoint, so they never start a trace).
- The popup is a MUI `Popper` portal (escapes the grid's `overflow:hidden`),
  anchored to a **virtual element** whose rect (`anchorRectForCells`) is the union
  of a set of cells on their **topmost row** — so a snaking multi-row word still
  anchors over its first line. The same helper anchors both this popup (over
  `popupWord.cells`) and the bonus-word miss popup above (over the just-traced
  `path`, via `invalid.bonus`) — `activePopup` picks whichever is active (a
  found-word review always takes precedence; the two can't overlap in practice
  since starting a new drag clears the review). The rect is recomputed on
  `review`/`invalid`/`scale` change (the `useFitScale` transform moves every
  cell's viewport rect).
- Tapping an unfound cell or the background dismisses the review (`clearSelection`
  also clears it). The reviewed span's cells get a darker-green
  `word-search__cell--reviewing` fill.

#### Repeat taps drill down (2026-08-28)

A second tap **inside the reviewed span narrows it** rather than closing it:
学生 → 生 → closed; 中国人 → 中国 → 国 → closed. The chain, the pick rule and the
server side are documented once in
**[SEGMENT_DRILL_DOWN.md](./SEGMENT_DRILL_DOWN.md)** — it is the same gesture, and the
same `pickDrillRung`, that the example-sentence popups use.

Word-search specifics:

- The open review is a `WordReview` (`{ word, start, end, text, pinyin, definition }`)
  where `start`/`end` index into `word.cells`, so a rung stays contiguous however the
  word snakes. It replaced the old `popupWord: PlacedWord | null`.
- The **reviewing fill/ring paints only the current rung's cells**, so drilling visibly
  shrinks it from the whole word down to a single tile.
- **The last rung's gloss comes from the grid cell**, not from the drill list — the cell
  carries the character's sense *in this word* (see the next section), while a rung only
  knows the standalone lead sense.
- **Audio follows the drill**: the whole word on the first tap (cached from the find),
  then each rung. A tap that closes the review is silent — and, since 2026-08-28, it also
  **cancels** narration that is still fetching or still sounding (`silence` prop on
  `WordSearchGrid`, wired to `tts.cancel()` as `silenceWord` in `WordSearchStage`). The
  audio is part of the SELECTION, not something fired alongside it: without the cancel, a
  play requested by the opening tap could land a beat after the highlight it belonged to
  was already dismissed, which reads as "deselecting played a sound". Dismissing a review
  by tapping off the word silences it the same way. Opening a new selection needs no
  explicit stop — the TTS provider cancels the previous play before starting its own.
- Tapping a different found word — or a part of the same word outside the reviewed span —
  starts a fresh review there instead of drilling.
- Rungs ride on `PlacedWord.drill`, resolved at grid build by widening the existing
  per-character `definitionClusters` query to every ≤4-char substring of every target
  word (same round trip). The field is **optional**: boards saved before this shipped go
  straight from the whole word to the tapped character.

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
  over the single cell via `anchorRectForCells`. The tapped cell **stays lit in the
  orange selection fill** (it is still the one-cell `path`); it used to turn the bonus
  blue via a `charPopupCells` set, removed 2026-09-25 along with that colour. Before
  2026-08-29 `submit` cleared the path here, which left the popup floating with
  nothing on the board pointing at it. There is no auto-dismiss; any new
  `onPointerDown`/`clearSelection` closes it and clears the highlight.
- **Filler** cells carry no `definition`, so they fall through to the existing
  single-character bonus/miss behavior. **Found** words are intercepted earlier in
  `onPointerDown` (whole-word review popup), so the per-character popup applies to
  *unfound* target characters.
- This popup is **already a single character**, so it has nothing to drill to and the
  drill-down above does not apply to it — it is dismissed, not narrowed, by the next tap.
  Tapping the **same** cell again closes it outright (it used to close on pointer-down
  and reopen on release); see `toggleOffCellRef` under § Dismissing a bonus match.

**Win:** all 9 words found. There is **no lose state** — see §5.

---

## 5. Game mode — count-up timer + speed tier

- **No difficulty levels, no lose state.** One relaxed mode; the player can work
  on a board **indefinitely** until all 9 are found.
- **A count-up clock runs out of sight** from the deal to the last find
  (`useRunClock.ts`). Nothing on the board shows it, and there is no option to
  (removed 2026-11-01, along with the eye toggle and `useWordSearchSettings`). The time
  appears only after the run, on an flp break's results card. It still
  pauses for a modal popup or a hidden tab (§ 5b).
- On completion the run earns a **speed tier** (1 = best … 7) by total time
  (`src/games/word-search/constants.ts` → `SPEED_TIERS`, `runResultTiers`; cutoffs 45s ·
  60s · 90s · 120s · 180s · 240s on the 9-word board, ⚠️ placeholders). `runResultTiers`
  scales the time by word count, so a board asks for the same pace at any size. Because
  play is unbounded, a slow finish still completes the board, on tier 7. **No accuracy
  tier:** a miss swipe is not counted. Shared model: [GAMES_FEATURE.md § Run
  tiers](./GAMES_FEATURE.md). The gold/silver/bronze medals (`MEDAL_THRESHOLDS`,
  `medalForTime`, the `Medal` type) were removed 2026-11-10.

### Personal best

The fastest completion time (ms, lower wins) is kept **per board mode and size** — the mode
key is the slug `pinyin` / `no-pinyin`, suffixed on a compact board (`pinyin-compact`,
`no-pinyin-compact`; `personalBestMode` in `constants.ts`), because seven words beat nine on
time alone. `WordSearchStage` →
the win effect calls `recordPersonalBest(ms)` with the same final time the results card
shows (a resumed board's time includes its saved elapsed time). The line renders on the flp
break's results card (`GameBreakResultCard`); the route's win `GameEndPopup` was deleted
2026-11-10. **A challenge round is not recorded** — its board is the round's shared word
set and it ends on the scoreboard.

The shared plumbing is `src/games/shared/usePersonalBest.ts` → `usePersonalBest` (load, `record` once per run, `reset` on a new run) and `src/games/shared/PersonalBestLine.tsx` → `PersonalBestLine` (the "Personal best m:ss" row + gold "New best!" pill, hidden until a best exists); the direction/unit lives in `server/contracts/personalBests.ts` → `PERSONAL_BEST_GAMES`. Storage and API: [WRITING_PRACTICE_REWORK.md § 2a](./WRITING_PRACTICE_REWORK.md).

### 5a. Hints

A lightweight, client-only assist layer (no server/DB involvement). State lives in
`useWordSearchHints.ts` (`units`, `entryKey`, `revealCount`,
`hintLocationRevealed`, `hintShakeNonce`).

**One mechanic, one row.** `WordSearchHintBar.tsx` is now the whole `.hintbar`: the
reveal on the LEFT, and the button (with its charge bars stacked underneath it) on the
RIGHT, in right-thumb reach (swapped 2026-11-10; the button used to lead on the left). It takes `WordSearchHintRow` as its `children`. Before the shelf
redesign these were three widgets in three places (button in the page header, meter
absolutely centred in the HUD, reveal on its own line under the gloss list), and the
player had to work out that they were one thing.

**Charges, not a gauge.** With `HINT_COST` at 1, the eight-segment meter with its
threshold line after the first segment was already just "how many hints you have" drawn
as a gauge. It is `HINT_BAR_UNITS` short bars now, stacked directly under the hint
button and spanning exactly its width (`.word-search__hint-control` column; each bar is
`flex: 1`, so the button sets the width); `.chg` filled = banked, and no threshold line.
The bars are not dimmed with the disarmed button — the count matters most when you can't
hint.

The letter-hint display is `WordSearchHintRow.tsx`,
the pinyin→units split lives in `pinyinUnits.ts`, the matching gloss tint lives
in `WordSearchWordList.tsx`, and the grid-side yellow location reveal + shake
live in `WordSearchGrid.tsx`; tunables are in `constants.ts`
(`HINT_BAR_UNITS = 8`, `HINT_COST = 1`, `HINT_LETTER_BLANK = "_"`,
`HINT_REMAINDER_MARK = "—"`, `HINT_ACCENT_COLOR` — an alias for `COLORS.warnInk`, which
v2 made plain ink; `HINT_HIGHLIGHT_BG`).

Revealing a word's grid **location** was too easy a hint (v1's cell-pulse
mechanic); v2 replaces it with a cheap, hangman-style **pinyin reveal** so a
hint nudges recall without handing over the answer.

- **Earning:** each successful find adds **one** charge, capped at `HINT_BAR_UNITS` (8).
  A charge is one bar. The button itself carries the armed/disarmed state (full opacity
  and an inert handler when `units < HINT_COST` or nothing is left unfound) — its
  shape never changes as it arms, so the control does not move under the finger.
- **The row's colours changed with the accent ground** (2026-08-23,
  [SHELF_REDESIGN.md](./SHELF_REDESIGN.md) § A6b). The **lightbulb is black**: the arm
  state is already carried by the glyph's FILL axis and the button's opacity, and a third
  channel on one 16px icon made the button look like a warning rather than a tool. A
  **banked charge bar is ink** (v2 `#ws .hintbar .chg i{background:var(--ink)}`; it was the
  game's purple ink before v2 removed the ink tier — `WordSearchHintBar.tsx`).
  `HINT_ACCENT_COLOR` colours the pinyin REVEAL, and is plain ink in v2 too.
- **Reveal granularity (`pinyinUnits.ts`):** a hint reveals one **phonetic
  unit** at a time, not one raw Latin letter — `syllableToPinyinUnits` splits
  each syllable into its initial consonant / medial glide / final (e.g.
  `"xiǎng"` → `["x","i","ǎng"]`, `"gōng"` → `["g","ōng"]`), mirroring how
  Bopomofo (Zhuyin) segments a syllable into its actual sound-blocks, but
  rendered as plain pinyin text (with the original tone diacritics) rather
  than Zhuyin glyphs. This avoids letter-at-a-time reveals giving away more or
  less than one meaningful chunk depending on spelling (e.g. "zh" is one
  initial sound spelled with two letters).
- **The reveal (`WordSearchHintRow.tsx`):** fills the `.rv` slot at the left end of the
  hint row (left-aligned, taking the row's spare width). It used to be a row of its own between the gloss list and the grid, which
  cost a line of board height to show nothing most of the time; it now holds its line
  open (`minHeight`) inside the hint row so spending the first hint of a run does not
  shove the grid down. **Blank by default** — nothing renders here until the
  player's first hint spend. Once a hint has picked a word, the row shows a
  mask built by `buildMask`: **one "island" per Chinese
  character** in the word (space-separated, one per `pinyin` syllable), bought
  along a **two-stage ladder**:
  0. **The skeleton, whole, for one press.** The first press draws **every**
     island at once as **one `HINT_LETTER_BLANK` ("_") per hidden letter** —
     classic hangman spacing for the entire word. A single charge therefore
     buys the word's character count *and* every character's letter count.
     This is scaffolding, not an answer: it says where to put your attention
     and fixes the mask's width, while the reveals that actually cost the
     puzzle something are the SOUNDS below.
  1. **Phonetic units, one per press thereafter.** Each fills blanks in, and
     each reveal visibly consumes the blanks it fills. Units are distributed
     **round-robin across characters** (`distributeRevealTiers`), not filled
     one island at a time: every character's 1st unit is given out before any
     character's 2nd, then every 2nd before any 3rd, wrapping until the word is
     fully spelled out — a character with fewer units than the current tier is
     simply skipped.

  E.g. a 2-char word like 变化 (biàn huà, units `b·i·àn` and `h·u·à`) goes
  `____ ___` → `b___ ___` → `b___ h__` → `bi__ h__` → `bi__ hu_` →
  `biàn hu_` → `biàn huà`. The word's total reveal steps are therefore
  `1 + units` (`countPinyinRevealSteps`, `pinyinUnits.ts`), which is what
  `totalRevealUnits` in `useWordSearchHints.ts` gates on before moving to the
  location reveal — the mask saturates on exactly that press, so the next one
  buys the location.

  Tone diacritics ride on their letter, so `ǎ` is one blank
  (`buildMask`/`letterCount` normalize to NFC before counting).

  **History — this rung has been re-cut four times, always around the same
  question: how much of the word's SHAPE one charge buys.** (a) three fixed
  underscores; (b) a single count-free `HINT_REMAINDER_MARK` dash per island,
  which hid the length so completely the mask gave nothing to anchor on;
  (c) the whole skeleton from the first press; (d) one character's letter count
  per press with unbought characters **not drawn at all** — which fixed (c)'s
  "whole shape for one unit" complaint but created the opposite one, since the
  first press on a two-character word printed `____`, selling the character
  count and the first syllable's length together; and briefly (e) a dedicated
  count-only rung (`— —`) ahead of (d)'s per-character lengths. **Settled
  2026-08-29 on (c)**: staging the skeleton meant spending three or four
  charges before the mask said a single letter, which read as a tax rather than
  a hint. `HINT_REMAINDER_MARK` is consequently unused on the pinyin board and
  lives on as the No-Pinyin board's `COMPONENT_BLANK` (§5a-ii), where there is
  no letter count to show.

  > ⚠️ `hintRevealCount` was **re-priced** by this change: the same stored
  > number now sits further along a shorter ladder. A board resumed from a
  > snapshot written before 2026-08-29 shows *more* of its hinted word than it
  > did when parked, and a counter above the new cap (`1 + units`) simply reads
  > as fully spelled out, so the next press buys the location reveal. Harmless
  > and self-correcting; no migration.

- **Matching gloss treatment (reinstated 2026-08-28).** The hinted word's gloss in the
  top list is tinted `HINT_ACCENT_COLOR`, pairing it with the mask (§3). This was dropped
  when the list was chips — a solid ink pill left no quieter state for "hinted" to occupy
  — but the list is now an inline 16px run, where a colour change is available and cheap.
  Without it the mask spells a word in pinyin the player cannot yet read, with nothing on
  screen saying which meaning it belongs to.
- **Spending (`spend` / `canUse` in `useWordSearchHints.ts`):**
  1. If a word is already being hinted (`entryKey`) and it's still unfound
     with reveal steps left, drain `HINT_COST` (1) and buy **one more step of
     that same word** (`hintRevealCount++` — the next pinyin unit in round-robin
     order, the skeleton having been bought by the first press) — the mask grows
     in place.
  2. If that word is still unfound but its pinyin is **already fully spelled
     out** (no units left to reveal) and its location **isn't yet
     revealed**, drain `HINT_COST` and lock onto it: `hintLocationRevealed =
     true` lights up its actual grid cells in **`.now` orange** (`WordSearchGrid`'s
     `hintedWord`, painted as a per-cell fill like every other highlight — see the
     selection-system table in §3) and bumps `hintShakeNonce` to shake them
     (same nonce-keyed `wsInvalidShake`-style keyframe trick as a miss).
  3. If that word's location is **already revealed** (i.e. this isn't the
     first time hitting case 2), pressing hint again is **FREE** — no unit is
     drained, `units` unchanged — it only bumps `shakeNonce` to
     re-shake the same cells as a "where was that again?" nudge. This state
     persists regardless of what else the player selects in the meantime,
     and hint stays locked on this word — it never advances to another one —
     until the word is actually found.
  4. Otherwise (no active hint yet, or the active word was just found) drain
     `HINT_COST`, pick a new random still-unfound word, and set
     `hintRevealCount = 1` — its **stage-0 rung**, i.e. the whole skeleton
     (pinyin board) or its first component reveal (No Pinyin board).
  `canUse()` — which gates the header hint button — mirrors this: it's
  true whenever case 3 applies (free, no unit check) or whenever
  `units >= HINT_COST` and some word is still unfound (cases 1/2/4).
- **Bonus-word ("blue match") hint award:** tracing a real multi-character det
  word that isn't a target flashes blue and shows its definition (§4,
  `isMultiCharBonus` in `WordSearchGrid.tsx`) — this fires `onBonusFound`, and
  the first time **each distinct** blue word is found on a board it awards one
  hint unit too (same cap as a real find). Tracked by `entryKey` in a
  `rewardedBonusWordsRef` set in `useWordSearchHints.ts`, reset every new board —
  re-tracing the same bonus word again (its popup has no auto-dismiss, so
  that's easy to do) does **not** re-award, but a *different* bonus word still
  earns its own unit.
- **A hinted word earns NO flashcard mark.** Every word that receives a hint on
  this board — any reveal step, unit or location — is recorded in
  `hintedWordsRef` (`useWordSearchHints.ts`), and `markWordFound` returns early for
  those words: no `POST /api/flashcards/mark` at all, not a negative one. The
  player was shown part of the answer, so the find is no evidence of recall in
  either direction and would otherwise inflate the mode's Reading/Production
  track (see [MASTERY_REWORK.md](./MASTERY_REWORK.md)). The set is reset per
  board in `startBoard` and round-trips through the save slot as
  `SavedWordSearchState.hintedWords` (optional — pre-existing snapshots restore
  as "nothing hinted"), so a paused-and-resumed board doesn't forget it cheated.
  Hint-unit awards and the win are unaffected — only the mark is withheld.
- **Clearing:** when the actively-hinted word is found (matched by `entryKey`
  in `onFound`), `entryKey`/`revealCount`/`locationRevealed` all
  reset — the row, the gloss tint, and the grid's yellow highlight all clear
  together — ready for the next hint press to pick a fresh word.

Open (minor, resolve at build time): minute-points eligibility (likely add the
route to `MINUTE_POINTS_ELIGIBLE_PAGES`). *(The best-time half of this question was
answered by the personal best, § 5.)*

#### 5a-ii. Component hints (No Pinyin mode)

The reveal ladder above spends **pinyin units**, which is exactly what the **No
Pinyin** board exists to hide — so that board spends a different currency:
a character's **sub-character visual parts**. Everything after "fully revealed"
(the yellow location reveal, then the free re-shake) is shared between modes;
only the reveal step differs.

Code: `componentUnits.ts` (the counterpart to `pinyinUnits.ts`),
`WordSearchHintRow.tsx` (`currency` prop), `useWordSearchHints.ts`
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
docker exec cow-backend npx tsx scripts/backfill/chinese/backfill-character-components.js
docker exec cow-backend npx tsx scripts/backfill/chinese/generate-component-font.js
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
localStorage blob per mode (`gameStateStorage.ts`, key
`wordSearch.savedGame.<mode>.<userId>`) is enough to survive an exit or the app
being backgrounded.

**One slot per mode.** Neither mode can resume or clobber the other's board. In
practice only `pinyin` is ever written: the Games hub and Study Challenge launch Pinyin,
and No Pinyin is played only as an flp break, which never saves (§ 5c). `loadGameState` / `clearGameState` take
`(userId, mode)`; `saveGameState` reads the mode from the payload
(`SavedWordSearchState.mode`, still stored — it routes legacy saves and guards a
wrong-mode restore). A fresh launch never silently resumes; only the surface's
resume affordance does (`resume: true` in nav state).

**Legacy shared slot.** From the previous design until 2026-10-03 both modes
shared one key, `wordSearch.savedGame.<userId>`. `loadGameState` still reads it and
moves a board into its mode's slot the first time that mode looks, so no parked
board was lost in the split. ⚠️ Delete that read once no device can hold such a save.

- **What's saved** (`SavedWordSearchState`): the `mode`, the grid payload
  (`data`), `found` entryKeys, elapsed timer ms, whether the timer had ever
  been started, and the full hint-meter state (§5a) + rewarded-bonus-word set —
  everything needed to resume as if nothing happened, in the right mode.
- **When it saves** (`WordSearchStage.tsx`):
  - **Continuously while playing** — an effect keyed on `[phase, found]` calls
    `persistSnapshot` on entering play and after every find. This keeps the slot
    current so returning to the Games hub always shows the resume card: the hub
    reads the save during *its own* render, which — on the same back-transition
    — happens **before** this page's unmount save would run, so a save must
    already exist. (Elapsed is read live off the clock at each write.)
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
  while the clock is running; `pausedElapsedRef` holds the elapsed value while it
  is not, so a paused board can be measured or resumed without it; `hasStartedRef` records whether the clock has *ever* started on
  this board (independent of whether it's ticking right now) — this gates
  whether a resumed board auto-resumes ticking or stays at 0 untouched.
  `pauseTimer`/`resumeTimer`/`startClock` in `useRunClock.ts` share this
  invariant; the clock holds refs only, so it never re-renders the Stage, and
  `readElapsedMs` is the one way to read it.
- **On mount:** behavior is gated by the nav `resume` flag (captured once as
  `resumeIntent`). **Resume card** (`resume: true`) → `loadGameState()` is
  checked and a valid, unfinished board is restored via `restoreBoard` (which
  auto-resumes the timer). **Mode button** (`resume: false`/absent) → always
  `fetchGrid()` + `startBoard`, never a silent resume. (If a resume intent finds
  no save — erased between hub and page — it falls through to a fresh board.)
- **Cleared** on win, by
  the resume card's ✕, and when the hub's confirm dialog approves starting a new
  game over an existing save.

---

### 5c. As an flp game break

`WordSearchStage` also runs inside an flp game break
([FLP_GAME_BREAKS.md](./FLP_GAME_BREAKS.md) § 6): Pinyin on the core flp, No Pinyin on the
reading flp, through the adapter `src/games/flpBreak/wordSearchBreak.ts`. What changes:

- **The board** is prefetched with the working loop as `seedIds`, so Play has no spinner.
  `getWordSearchGrid` fills the same tiers as the game pool; seeds over 4 characters are
  dropped because the grid cannot place them, and the substring pass replaces a dropped
  word from the seeds first. A focused break sends `flpBreak=1` and deals outside today's
  set; `outsideFocusWords` names those words on the payload.
- **The board arrives letter by letter.** Each cell fades and scales in at its own random
  delay (`WordSearchGrid` → a mount-time `staggerFadeIn`, `src/games/shared/staggerFadeIn.ts`:
  within 400ms, 200ms each), over the hosted frame's own fade — the break's header row was
  already up through the circle grow, so only the board arrives. It runs once per grid mount,
  on the game's own route too. Web Animations, so it composes over the cells' CSS miss / hint
  shakes.
- **The save slot is never touched.** `persistSnapshot` no-ops and `clearGameState` is
  skipped: the slot is the hub's Resume card, and a break's board cannot return to it.
- **Leave** on a live run ends it in phase `left`: "Run ended", no tiers, win or personal
  best, and the results card shows `n of N words found`.
- **Results** go to the flp's card (`runResultTitle`, `runResultTiers`, `runResultScore`).
  A finished run records its win and personal best.
- **The tower** drops off the mark on the mode's PRIMARY track only (`onCardCleared`, in
  `markWordFound`). No Pinyin's secondary production mark lands in the core world, not the
  reading one. A hinted word earns no mark, so it does not drop.
- **The lent-card offer** names only the lent words the player found, and holds the end of
  the run until it is answered.

- **Every break plays the compact board** (below): the flp runs only inside the Deck
  Tower, whose card-sized break layer fits five columns.

#### The compact board (every flp break, built 2026-11-01)

| | Standard | Compact |
|---|---|---|
| Grid | 7 rows × 6 columns (42 cells) | 6 rows × 5 columns (30 cells) |
| Tile | `sm`: 57px with pinyin, 53px without | `smd`: 70px with pinyin, 66px without |
| Words | 9 (1 / 5 / 2 / 1) | 7 (1 / 4 / 1 / 1) |
| Full-length occupancy | 36 cells, 86% | 28 cells, 93% |
| Played by | hub, challenge | every flp break (core or reading world) |
| Speed tier 2 cutoff | ≤ 60s | ≤ ~46.7s (same pace per word) |
| Personal best key | `pinyin` / `no-pinyin` | `pinyin-compact` / `no-pinyin-compact` |

`WORD_SEARCH_BOARDS` (`server/contracts/wire.ts`) declares both, distribution included, and
is read by both halves. The break adapter always deals `WORD_SEARCH_BREAK_BOARD`
(`"compact"`), sends `?board=compact`, and passes the board to the Stage so its own
refetch deals the same one. The server sizes the grid from it and rejects a distribution
larger than the board (400), since placement could not be promised a fit.

At this density random placement rarely fits a full-length set, so the board has its own
template set ([WORD_SEARCH_TEMPLATES.md](./WORD_SEARCH_TEMPLATES.md)). A set of shorter words,
the usual case, still places randomly.

In focus mode a compact break needs 7 cards rather than 9 (`FlpBreakGame.focusMinimum`,
[FOCUS_MODE.md](./FOCUS_MODE.md) § 5). The controller's lending retry still tops up to the
9-word `CARD_BASELINES` target, so a learner short of cards can be lent two more than this
board uses.

`WordSearchGrid` takes its dimensions from the payload. Its tile comes from the cpcd cell's
natural box (§3 "Cell size"), so five columns of `sm` tiles would leave the board narrower
than the screen: `useFitScale` never scales above 1. The `smd` cpcd size exists to fill that
width. It sits between `sm` and `md` (32px glyph, 16px pinyin, 40px column, and `md`'s 3px `GLYPH_DROP_PX`, which closes the glyph-to-pinyin gap without changing the tile) and is declared in
every cpcd size table. `BOARD_CELL_SIZE` (`constants.ts`) maps a board to its size, and the
Stage passes it as `cellSize`. Five 70px tiles span about 378px, which fits a 402px break
screen, and a narrower phone scales them down as usual.

Code: `WordSearchStage.tsx` → `board` prop; `src/games/flpBreak/wordSearchBreak.ts` →
`WORD_SEARCH_BREAK`, `WORD_SEARCH_BREAK_BOARD`; `WordSearchBreakStage.tsx`;
`src/games/word-search/gridRequest.ts` → `wordSearchGridRequest`;
`src/api/wordSearchGrid.ts` → `wordSearchGridParams`;
`server/services/OnDeckVocabService.ts` → `getWordSearchGrid` (`seedIds`, `board`);
`server/controllers/OnDeckVocabController.ts` → `getWordSearchGrid`.

## 6. Files (as built)

Frontend (`src/games/word-search/`):

- `WordSearchPage.tsx` — the route: title, edge-swipe block, the launch's mode and
  resume intent, and where "Back to …" goes. Everything else is the Stage.
- `WordSearchStage.tsx` — the run, hosted by the page or by an flp break (§5c): flow
  (loading → blocked | playing → won | left), the out-of-sight clock (pause/resume — see
  §5b), found-set + win detection, the results-card report, and on-find audio wiring.
  The route has no end card since 2026-11-10 (the win popup and Play Again were deleted;
  the routed page sits behind the OFF `standaloneGames` flag).
- `useRunClock.ts` — the count-up clock: refs only, with an exact read, pause and resume.
- `useWordSearchHints.ts` — the hint meter and the reveal ladder (§5a), including which
  words were hinted and so earn no mark.
- `gridRequest.ts` → `wordSearchGridRequest` — the one builder for a grid request;
  `src/api/wordSearchGrid.ts` → `fetchWordSearchGrid`, `wordSearchGridParams` make the call.
- `WordSearchGrid.tsx` — the rounded-rect cpcd grid; owns drag path selection
  (a lone tap is a one-cell path), client-side target-path matching against a
  server-sent `bonusWords` list for the blue non-target-word miss (§4, fires
  `onBonusFound` for the hint-award hook — see §5a), a `useFitScale` transform
  so the 7×6 `sm` grid fits short screens, the **English-gloss popup** shared
  by found-word review and bonus-word misses (tap a locked word, or trace a
  bonus word, → `Popper` popup; `foundWordByCell` / `toggleWordPopup` /
  `anchorRectForCells` / `activePopup`; see §4), and the hint's **orange
  location reveal + shake** once a word's
  pinyin is fully spelled out (`hintedWord` / `hintShakeNonce` props,
  `hintedCells`; see §5a).
- `WordSearchWordList.tsx` — the English-gloss prompt chips: solid ink `.chip.on` while
  pending, struck through and faded once found (§3).
- `WordSearchHintBar.tsx` — the whole `.hintbar` row: the hint button, `HINT_BAR_UNITS`
  charge bars under it, and the reveal slot it renders its `children` into (§5a).
- `WordSearchHintRow.tsx` — the reveal, filling the hint row's left-hand slot. Renders whichever currency the board spends (`currency` prop): the
  Pinyin board's per-syllable islands — nothing at all until that character's
  length is bought, then one `HINT_LETTER_BLANK`
  underscore per still-hidden letter (`buildMask` / `letterCount`;
  §5a), or the No Pinyin board's component glyphs in a line, collapsing to the
  character once its parts run out (§5a-ii).
- `pinyinUnits.ts` — splits a tone-marked pinyin syllable into its phonetic
  building-block units (initial / medial glide / final), Bopomofo-segmentation-
  informed but rendered as plain pinyin text; used by `WordSearchHintRow` and
  `WordSearchStage`'s reveal-cap check (`countPinyinRevealSteps` = characters +
  units, covering both ladder stages; §5a).
- `componentUnits.ts` — the No Pinyin counterpart to `pinyinUnits.ts`: turns a
  word's `charComponents` into the per-character reveal ladder (every part, then
  the character itself), distributed round-robin across characters in two phases
  — all non-final parts word-wide, then the character reveals
  (`countComponentUnits` / `buildComponentReveals`; §5a-ii).
- `WordSearchHeader.tsx` — the audio-mode chip (LeafPage `rightContent`), and
  nothing else (see §3 Header controls). Pinyin is no longer a toggle — it's fixed by
  the launched hub mode (§3).
- `WordSearchHubItem.tsx` — the Games-hub entry (rendered by `GamesPage.tsx`):
  `useWordSearchLauncher` for the Pinyin slot + the shared `GameCard` (full grid row).
- `useWordSearchLauncher.tsx` — the launcher both surfaces share: owns the save-slot
  read, resume, erase, the confirm-before-clobber state and `NewGameConfirmDialog`;
  returns `{ card, confirmDialog }`. See §3.
- `wordSearchCard.tsx` — `buildWordSearchCard`: the ONE definition of Word Search's
  `GameCard` data (pur ground, `outlined: false`, the resume tile as a `kind: "resume"`
  option, play button).
- `WordSearchResumeTile.tsx` — the hub card's resume tile ("Resume" + ✕ → in-place
  delete confirm), drawn on
  `GameOptionTile`. See § "Resume card".
- `NewGameConfirmDialog.tsx` — the "Start a new game?" clobber confirm, rendered by
  `useWordSearchLauncher`.
- `gameStateStorage.ts` — `saveGameState`/`loadGameState`/`clearGameState`, `savedWordCount`:
  the localStorage save/resume layer, **one slot per (user, mode)** since 2026-10-03
  (`loadGameState` migrates a legacy mode-agnostic save on first read). See §5b.
- `constants.ts` — `BOARD_CELL_SIZE`, speed tiers (`SPEED_TIERS`, `runResultTiers`), `personalBestMode`, hint tunables
  (`HINT_BAR_UNITS`, `HINT_COST`, `HINT_LETTER_BLANK`, `HINT_REMAINDER_MARK`,
  `HINT_ACCENT_COLOR`),
  the pinyin-mode config (`WordSearchMode`, `MODE_CONFIGS`, `modeConfigFor`;
  see §3), and the `wins`-table keys `GAME_KEY` / `WIN_LEVEL` (shared by
  `WordSearchStage`'s `recordWin` and the hub item's count; see §3). Board sizes and
  band mixes are `WORD_SEARCH_BOARDS` in `server/contracts/wire.ts`.
- `types.ts` — `GridCell`, `PlacedWord`, `WordSearchResponse`.
- `src/games/registry.ts` — registers the `word-search` `GameDef`.
- `src/constants.ts` — `/games/word-search` added to `MINUTE_POINTS_ELIGIBLE_PAGES`.

Server:

- `server/services/wordSearchGrid.ts` — pure snaking-placement + filler flood
  (`generateWordSearchGrid`, `MAX_WORD_ATTEMPTS`, `MAX_GRID_ATTEMPTS`),
  4-directional orthogonal only, longest-word-first, no pinyin-width awareness —
  see §2. After `RANDOM_GRID_ATTEMPTS` (5) failed whole-grid regenerations,
  switches to the fixed-template fallback (`WORD_SEARCH_TEMPLATE_SETS`,
  `templateSetFor`) — see
  [WORD_SEARCH_TEMPLATES.md](./WORD_SEARCH_TEMPLATES.md). Also the
  anti-duplicate pass (`findWordOccurrences`, `pathsEqualEitherDirection`,
  `MAX_DEDUP_PASSES`) that re-rolls filler cells so no target's character
  sequence traces through an unintended path elsewhere in the grid — see §2a;
  it runs identically after either placement method.
- `server/services/wordSearchTemplates.ts` — the fixed template layouts, 11 per board
  (`WORD_SEARCH_TEMPLATE_SETS`), used by the fallback above — see
  [WORD_SEARCH_TEMPLATES.md](./WORD_SEARCH_TEMPLATES.md).
- `server/services/OnDeckVocabService.ts` — `getWordSearchGrid` (pool assembly +
  substring de-dup/replacement + level-bounded filler harvest from
  `dictionaryentries_zh` via `StarterPacksService.estimateLevel` +
  enrich/prewarm + grid gen + the post-generation `bonusWords` regex query — see
  §2 Output payload). Grid dims come from `WORD_SEARCH_BOARDS`
  (`server/contracts/wire.ts`): `standard` for every mode, challenge rounds
  included (§1c), `compact` for a Deck Tower break (§5c).
- `server/controllers/OnDeckVocabController.ts` — `getWordSearchGrid` handler
  (parses `board` and the distribution query; a missing distribution falls back to the
  board's own).
- `server/routes/onDeckRoutes.ts` — `GET /api/onDeck/wordSearchGrid`.

## 7. Dependencies / cross-references

- **Study Challenge rounds (§ 1c):** `OnDeckVocabService.getWordSearchGrid`'s `challenge`
  parameter, `OnDeckVocabController.resolveChallengeRound`,
  `StudyChallengeService.getRoundContext`, `ProvisionalCardService.getFillerPool`, and on the
  client `src/games/runtime/useChallengeRound.ts` + `WordSearchStage.tsx` (`challengeParamsRef`,
  the hint/find events, the scoreboard). Spec: [STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md) §§ 5.2–5.5.
- **Reuses:** `OnDeckVocabService.getGameVocabPool` machinery + `GAME_FALLBACK_ORDER`
  (pool + fallback), `CPCDRow` (`src/components/CPCDRow.tsx`) at `sm`, leaf-page
  shell, and the `BubbleMatchHeaderControls` pattern.
- **Parent doc:** [GAMES_FEATURE.md](./GAMES_FEATURE.md) (framework, registry, leaf-page rules).
- **Related:** [CPCD_PINYIN_SHIFT.md](./CPCD_PINYIN_SHIFT.md) (cpcd spacing),
  [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md).
</content>
</invoke>
