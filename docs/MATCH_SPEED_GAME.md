# Match Speed (`/games/match-speed`)

> **STATUS: SHIPPED.** Every file under [Files](#files) exists,
> the game is registered in `src/games/registry.ts`, and the per-card
> `gameCategory` backend change is live
> ([§ Backend change](#backend-change-per-card-gamecategory)). The pure selection
> logic is covered by `src/__tests__/matchSpeedCardBuffer.test.ts`.
>
> ⚠️ **Endpoint name.** This doc says `game-pool` throughout for readability, but
> the real route is camelCase: **`GET /api/onDeck/gamePool`** (project convention,
> see docs/BACKEND_LAYERING.md). It also requires an explicit
> **`?markType=recognition`** — the parameter is no longer defaulted per caller.

Third game. A **recognition** speed drill: two columns × five rows of cards, the
left column holding the foreign word, the right column holding its English
definition. Tap one card, then tap a card in the *other* column to attempt a
match. Sixty seconds; match as many pairs as you can.

Where Bubble Match is a spatial/physical game (drag bubbles through a packing
field) and Word Search is a scanning game, Match Speed is a pure **read-and-recall
throughput** test. There is no physics, no grid generation, and no drag — only
taps, a clock, and a board that keeps refilling.

---

## Table of contents

- [Gameplay](#gameplay)
- [Board model](#board-model)
- [The 3-second refill tick](#the-3-second-refill-tick)
- [Card selection: distribution + buffer](#card-selection-distribution--buffer)
- [Backend change: per-card `gameCategory`](#backend-change-per-card-gamecategory)
- [Marks](#marks)
- [Scoring and medals](#scoring-and-medals)
- [End popup and cleanup phase](#end-popup-and-cleanup-phase)
- [Page shell, header, and chrome](#page-shell-header-and-chrome)
- [Rendering a card](#rendering-a-card)
- [Phase state machine](#phase-state-machine)
- [Files](#files)
- [Implementation checklist](#implementation-checklist)
- [Resolved decisions](#resolved-decisions-were-open-questions-before-the-game-shipped)
- [Dependencies (docs ↔ code)](#dependencies-docs--code)

---

## Gameplay

1. The board shows **5 pairs** — 5 foreign-word cards in the left column, their 5
   English definitions in the right column. Every card on the board always has
   its partner on the board.
2. Row position is **randomized independently per column**, so vertical alignment
   never hints at which cards pair up.
3. Tap a card → it is **selected** (raised/outlined).
4. Tap a card in the **other** column → a match is attempted.
   - **Correct** → both cards play a **pop** animation and disappear, leaving two
     empty slots. Score +1. A `correct` mark is sent (see [Marks](#marks)).
   - **Wrong** → both cards flash red, an `incorrect` mark is sent for the
     **foreign-word** card of the two, and both deselect. The board stays live
     during the flash (taps are not swallowed).
5. Tap a card in the **same** column as the current selection → the first card
   deselects and the new one selects. (Never an attempt; same-column cards can
   never be a pair.)
6. Tapping the already-selected card deselects it.
7. **Every 3 seconds**, all empty slots are refilled with fresh pairs, fading in.
8. At **1:00**, the run ends and the end popup appears with the score + medal.

### Selection is never locked

**No animation ever blocks input.** At every moment of live play, tapping any card
that is still on the board selects it. Specifically:

- The **wrong-attempt red flash** does not swallow taps — a fast player is never
  made to wait out their own mistake.
- The **entry fade-in** does not gate interaction; a card arriving mid-stagger is
  selectable.
- A **popping (matched) pair** is set to `pointer-events: none` the instant it is
  matched, so a tap that lands on a card already on its way out falls *through*
  rather than being consumed by it.

The only input freezes in the whole game are the 3·2·1 countdown and the gap
between the run ending and the end popup being minimized — both are phase
transitions, not animations. If you add an animation here, it must not gate
`handleTap`.

#### Taps fire on `pointerdown`, never on `click`

`MatchSpeedCard` selects from `onPointerDown` (`MatchSpeedCard.tsx`, the card
`Box`). This is a **correctness requirement, not a latency preference.**

A `click` is synthesized only if the browser decides the gesture earned one, and
**any `preventDefault()` on the underlying `touchend` destroys it silently.** The
app-wide double-tap-zoom guard (`src/hooks/useBlockZoom.ts`, `onTouchEnd`) does
precisely that to the second of two taps within 300ms whenever it judges the
target non-interactive — and its judgement reads the computed `cursor` of the
*deepest touched node*. A foreign card fails that test, because the tap lands
inside `CPCDRow`, whose character cells render `cursor: default` unless they are
individually interactive (`src/components/CPCDRow.tsx`, the cell `sx`).

The symptom was a board that went dead exactly when the player tapped fastest:
every tap inside the double-tap window was cancelled before `handleTap` ever ran,
which reads as "the animations are locking me out" because animations are when
rapid tapping happens. `useBlockZoom` now also treats any `touch-action: none`
subtree as interactive (such a surface cannot double-tap zoom anyway, so there is
nothing to suppress there — only a click to preserve), but the game does not rely
on that: `pointerdown` cannot be suppressed this way at all.

**Do not "simplify" this back to `onClick`.**

#### Selection outranks every other visual state

`visualState` (`MatchSpeedBoard.tsx`) resolves `selected` **before** `wrong`. The
`wrong` style overrides background, border *and* the selection lift, so with the
opposite precedence a card re-tapped during its own 400ms flash was genuinely
selected while drawing as an ordinary card — no border, no lift, no
acknowledgement. Input was never blocked there; the *feedback* was, which is
indistinguishable from a lockout to the player. A player who has moved on to
their next guess is owed feedback about that guess, not a replay of the mistake.

The general rule this section encodes: **a card that is visible must never be
unresponsive, and a tap that registers must always be visible.**

### Why the board can never hold a half-pair

Cards only ever leave the board **as a matched pair** (both members pop
together). Wrong attempts remove nothing. So the number of empty slots in the
left column always equals the number in the right column, and a refill can always
place whole pairs. This invariant is what lets the refill logic be trivial — and
it **is** asserted rather than silently assumed: `refill()` compares the two
columns' hole counts and `console.error`s the mismatch under `import.meta.env.DEV`.

---

## Board model

```
        LEFT (foreign)          RIGHT (English)
  row 0   ┌──────────┐          ┌──────────┐
          │   你好    │          │  to eat  │
  row 1   ├──────────┤          ├──────────┤
          │   吃      │          │  water   │
  row 2   ├──────────┤          ├──────────┤
          │   水      │          │  hello   │
  row 3   ├──────────┤          ├──────────┤
          │   书      │          │  book    │
  row 4   ├──────────┤          ├──────────┤
          │   谢谢    │          │  thanks  │
          └──────────┘          └──────────┘
```

The board is **two fixed-length slot arrays** of length `ROWS` (5), not a list of
live cards. A slot is either occupied by a card or empty:

```ts
/** A board position: holds a card, or is empty awaiting the next refill tick. */
type Slot = BoardCard | null;

interface BoardCard {
    /** Stable id for React keys + animation identity. */
    id: string;
    /** Both members of a pair share this. */
    pairId: string;
    side: "foreign" | "english";
    entry: VocabEntry;
    /** ms delay applied to this card's fade-in (0–500, see FADE_IN_MAX_DELAY_MS). */
    fadeDelayMs: number;
    /** Drives the pop-out animation before removal. */
    exiting: boolean;
}
```

Modeling slots (rather than a card list) is what makes "new cards drop into the
vacated rows, surviving cards never move" fall out for free, and it keeps React
keys stable so a surviving card's DOM node is never re-created mid-tap.

### Card sizing: locked to 2:1

**Every card is the same 2:1 rectangle** (`CARD_ASPECT` = width ÷ height, i.e.
1:2 height-to-width), and the ten cards on a board are always identical. This is
a correctness requirement, not a style preference: card *shape* must carry no
information. A card that stretched to fill leftover height would make a
half-empty board look different from a full one, and any per-row variation would
leak which pair is which. A long definition is absorbed by
[strip → scale → clamp](#rendering-a-card), never by the card box.

The size is **measured, not pure CSS** (`MatchSpeedBoard`, the `gridElRef` /
`cardHeight` block). CSS `aspect-ratio` derives one dimension from the other and
a `max-width`/`max-height` clamp on the derived side breaks the ratio rather than
re-deriving it, so it cannot satisfy a fixed ratio against *both* a width and a
height constraint. The board therefore measures its own box with a
`ResizeObserver` and picks the one card height that fits in both directions:

```
cardHeight = min( (boxHeight − (ROWS−1)·ROW_GAP_PX) / ROWS,     // height-limited
                  ((boxWidth − COL_GAP_PX) / 2) / CARD_ASPECT )  // width-limited
cardWidth  = cardHeight × CARD_ASPECT
```

Whichever axis is tighter wins and the grid is centered in the slack. Columns are
rendered only once measured, so no frame ever paints zero-height cards (which
would restart every card's fade-in). Cell height is fixed per row rather than
shared via `1fr`, so an **empty slot holds its row open** and surviving cards
never slide when a pair pops.

---

## The 3-second refill tick

**One global interval, started at run start**, not a per-slot timer.

```
t=0.0s   [A][B][C][D][E]   tick — board full
t=0.1s   match C           → 2 holes
t=3.0s   tick              → both holes filled (fade in)
t=4.5s   match A, match D  → 4 holes
t=6.0s   tick              → all 4 filled
```

Consequence, and it is **intentional**: a pair matched right after a tick leaves
a visible hole for nearly 3 seconds. Clearing fast means playing a partly-empty
board. That's the game's pacing pressure — it's why the medal thresholds sit
where they do, and it's the reason the refill is not per-hole.

### Fill algorithm (one tick)

1. Count empty slots in the left column → `n` (equals the right column's count).
2. Draw `n` pairs from the buffer (see below). If the buffer can't supply `n`,
   fill as many as it can; the rest wait for the next tick.
3. For each drawn pair, place the foreign card in a random empty **left** slot
   and the English card in a random empty **right** slot — chosen independently,
   so a pair's two rows are uncorrelated.
4. Assign each newly placed card a random `fadeDelayMs` in
   `[0, FADE_IN_MAX_DELAY_MS]` (500ms) so a batch of 4 cards staggers in rather
   than appearing as one block.
5. Fire the async buffer top-up (see below). **Never await it inside the tick** —
   the tick must not be able to stall on the network.

### Constants

| Constant | Value | Meaning |
|---|---|---|
| `ROWS` | 5 | rows per column |
| `RUN_DURATION_MS` | 60_000 | one minute |
| `REFILL_TICK_MS` | 3_000 | board refill cadence |
| `FADE_IN_MAX_DELAY_MS` | 500 | upper bound of the per-card random fade delay |
| `FADE_IN_DURATION_MS` | ~260 | the fade itself |
| `POP_DURATION_MS` | ~280 | match pop before removal (mirrors Bubble Match) |
| `WRONG_FEEDBACK_MS` | ~400 | red flash on a wrong attempt; **board stays live** |

---

## Card selection: distribution + buffer

### Probability distribution

Each pair drawn for the board rolls a category **independently**, weighted:

| Category | Weight |
|---|---|
| Unfamiliar | 12% |
| Target | 60% |
| Comfortable | 20% |
| Mastered | 8% |

This is a **per-draw roll**, not a fixed board quota — unlike Bubble Match's
`GAME_DISTRIBUTION` (`src/games/bubble-match/constants.ts:23-28`), which requests
a fixed 2/10/6/2 mix for a whole run. A Match Speed board can legitimately come
up 5 Target cards.

⚠️ These categories are the **per-mark-type** categories (recognition, the track
this game emits), not the goal-blended overall utcm category the decks page
shows. The `game-pool` endpoint already buckets this way — see
[MASTERY_REWORK.md § "Games select by their own mark type"](./MASTERY_REWORK.md).

**Empty-category fallback.** If the rolled category's buffer is empty, walk the
existing bubble-match fallback order —
**Target → Comfortable → Unfamiliar → Mastered**
(`OnDeckVocabService.GAME_FALLBACK_ORDER`, `server/services/OnDeckVocabService.ts:803`)
— and take from the first non-empty one. The weights are **not** re-normalized;
the roll happens against the full 12/60/20/8 table every time and the fallback is
purely a "that shelf was bare" recovery.

### The buffer

API latency is far too high to fetch a card at the moment a slot empties, so the
page keeps a **client-side buffer of pairs, keyed by category, target depth 5
each** (20 cards buffered). The buffer is filled once before the run starts and
topped up continuously during it.

```
buffer = {
  Unfamiliar:  [pair, pair, pair, pair, pair],
  Target:      [pair, pair, pair, pair, pair],
  Comfortable: [pair, pair, pair, pair, pair],
  Mastered:    [pair, pair, pair, pair, pair],
}
```

**Top-up trigger: after every refill tick.** Once the tick has placed its cards,
fire a single `game-pool` request for exactly what was consumed, restoring each
bucket toward 5. Small steady requests; the buffer rarely dips. The request is
fire-and-forget with a `.catch()` — a failed top-up degrades to a thinner buffer
and more fallbacks, never to a broken run.

### `exclude`: what the request must never hand back

The refill request sends as `exclude` **every card currently on the board plus
every card sitting in the buffer**.

This is **not** a repeat gate. Repeats across a run are prevented by the server's
own cooldown mechanism (a card marked during this run goes on cooldown and drops
to the `cooled` tier); when a library is too small, falling back to a cooled card
is the correct behavior and the client must not block it. There is deliberately
**no client-side "seen this run" exclusion**.

`exclude` exists to prevent a **duplicate on screen**. A card that is currently on
the board or in the buffer has *not been marked yet*, so it is not on cooldown and
a top-up would happily return it — putting the same word in two rows at once.
Bubble Match has the identical case and solves it the identical way with its
`keepIds` hard exclude (`BubbleMatchPage.tsx`, `playAgain`).

`exclude` is enforced in SQL and is absolute (`fetchGameCandidates`'s
`excludeIds`, `server/services/OnDeckVocabService.ts:252-293`).

We do **not** use the `avoid` (soft-demote) param.

### Entry gate

**20 Learn Now cards** required, matching Bubble Match's gate. A 60-second run at
gold pace consumes 20+ pairs, so below this the run would be mostly cooled-tier
repeats. On a shortfall, block with the same message pattern Bubble Match uses:

> You need 20 Learn Now cards to play Match Speed — you have N. Study more cards
> to unlock it.

---

## Backend change: per-card `gameCategory`

**Implemented.** `server/services/OnDeckVocabService.ts` — `fetchGameCandidates`
stamps `row.gameCategory = category` as it partitions each bucket's rows into
fresh/cooled; the `drain()` helper in `getGameVocabPool` then preserves it for
free. The field is declared on `VocabEntryBase` in `server/contracts/wire.ts`, so
both the server and client types carry it from one definition.

The buffer is keyed by category, but `GET /api/onDeck/game-pool` returns a **flat
`cards[]` with no per-card game-category label**
(`server/services/OnDeckVocabService.ts:974`). The `category` field the rows do
carry comes from `UTCM_CATEGORY_SELECT` — the goal-blended **overall** utcm
category, *not* the per-mark-type category the buckets were selected by. So today
a client cannot sort a response back into four buffers.

**The change:** stamp each returned card with the category bucket it was drawn
from. The value already exists inside `fetchGameCandidates` — it is the loop key
(`server/services/OnDeckVocabService.ts:270`) — it is simply not carried onto the
row. Tag the rows as they're bucketed, then the `drain()` helper in
`getGameVocabPool` preserves it automatically.

```
GET /api/onDeck/game-pool?Unfamiliar=5&Target=5&Comfortable=5&Mastered=5
  → { cards: [{ ...entry, gameCategory: "Target" }, ...], ... }
```

Properties:

- **Additive and backwards-compatible.** Bubble Match and Word Search ignore the
  new field; no existing behavior changes.
- **Truthful under fallback.** When a bucket is short and the fill tops up from
  the fallback order, the card is stamped with the bucket it *actually* came
  from, so the client's buffer never silently mislabels a card.
- **Distinct from `category`.** Both fields ride on the entry and mean different
  things. `gameCategory` is per-mark-type and game-scoped; `category` is the
  blended one the decks page uses. The name should stay explicit for exactly this
  reason.

### Why not the alternative

Firing four separate single-bucket requests (`?Target=5`, `?Mastered=5`, …) was
rejected: `getGameVocabPool`'s fallback would top a short `Mastered` request up
with Target cards and the client would have no way to tell, silently poisoning
that buffer with cards of the wrong difficulty — the exact thing the distribution
exists to control.

---

## Marks

Match Speed is a **recognition** drill (foreign → meaning), same track as Bubble
Match. Marks go to `POST /api/flashcards/mark` with
`{ cardId, isCorrect, type: "recognition", excludeIds: [] }`.

| Event | Mark |
|---|---|
| Correct match | `isCorrect: true` on the pair's vocab entry |
| Wrong match | `isCorrect: false` on the **foreign-word card** of the two tapped |
| Any match during the post-run cleanup phase | **none** |

**Why the foreign card on a wrong match.** This is a recognition test: the
question is whether the player knows what the foreign word means. Whichever pair
of cards was tapped, exactly one is foreign and one is English, so "the foreign
card of the two" is unambiguous regardless of tap order — and it is the card whose
recognition actually failed. Marking the English card too would penalize a word
the player may know perfectly well and was merely guessing at.

Marks are **fire-and-forget** with a `.catch()`; the game never blocks or fails on
a mark request.

---

## Scoring and medals

**Score = pairs matched.** Nothing else affects it. A wrong match costs only the
time it wastes.

| Medal | Threshold (pairs in 60s) | ≈ pace |
|---|---|---|
| 🥇 Gold | 18+ | ~3.3s/pair |
| 🥈 Silver | 12+ | ~5.0s/pair |
| 🥉 Bronze | 6+ | ~10s/pair |
| — none | 0–5 | |

There is a genuine **no-medal tier** — unlike Word Search's `medalForTime`, whose
bronze row is `maxSeconds: Infinity` and therefore always awarded
(`src/games/word-search/constants.ts:152-162`). Structure the resolver the same
way (an ordered threshold table + a `medalForScore(score)` helper) but let it
return `null`.

The end card also shows **accuracy** — correct attempts / total attempts — as
information only. It does not gate a medal.

### Win badge

`recordWin(1)` fires **only on a gold-medal run** (`useGameWins`,
`src/hooks/useGameWins.ts`, `GAME_KEY = "matchSpeed"`). Since the game ships with
a single difficulty, level `1` is the only key. Gold-only keeps the hub badge an
achievement rather than a play counter.

---

## End popup and cleanup phase

Reuses `GameEndPopup` (`src/games/runtime/GameEndPopup.tsx`) with
`classPrefix="match-speed"` — the shared scrim + card + × button + FLIP-style
collapse into a corner puck. Bubble Match wraps it in `BubbleMatchEndPopup` to
pin its prefix; Match Speed should do the same (`MatchSpeedEndPopup`).

Card content: score, medal, accuracy, and two actions —

- **Play Again** (primary) — new run, fresh board. Unlike Bubble Match there is no
  partial-refresh logic to carry over: Match Speed's board is fully transient, so
  a replay simply re-primes the buffer and starts a new 60s run.
- **Back to Games** (secondary) → `/games`.

### Cleanup phase

Minimizing the popup to its corner puck (the `phase === "ended" && popupMinimized`
condition, mirroring Bubble Match's `cleanupMode`) turns the leftover board into a
no-stakes study surface:

```
timer       ⏹ stopped
refill tick ⏹ stopped
marks       ✗ suppressed entirely
tap a card  → its partner highlights light green
match       → both pop and disappear, no refill
board empty → nothing happens (the run is already scored)
```

The partner highlight is the direct analogue of Bubble Match's `revealed` status
and should use the same `CORRECT_BUBBLE_BG` light green
(`src/games/bubble-match/constants.ts`) so the two games teach the same visual
vocabulary. No new pairs ever enter during cleanup; the board only drains. Re-
expanding the puck brings the score card back.

---

## Page shell, header, and chrome

**Leaf page.** `LeafPage` wrapper — down-arrow back to `/games`, **no footer**,
slides up on enter. Same as both shipped games. Do **not** add a per-page
`IPhoneFrame`; the frame comes from `MobileDemoFrame` via `Layout.tsx`.

`useBlockEdgeSwipe(true)` is **mandatory** (project rule, CLAUDE.md) — an edge
swipe would otherwise navigate away mid-run.

Header right slot (`MatchSpeedHeader`, filling `LeafPage`'s `rightContent`) is
deliberately **thin** — modeled on `WordSearchHeader.tsx`, not on
`BubbleMatchHeader.tsx`:

| Control | Notes |
|---|---|
| **Settings cog** | Opens `MatchSpeedSettingsDialog`. |
| **Minute-points fire badge** | `MinutePointsFireBadge`. |

Everything else that used to live in the header moved out, because inline toggles
plus a clock consumed roughly half the bar:

| Moved | To | Why |
|---|---|---|
| **pinyin / color / autoplay toggles** | `MatchSpeedSettingsDialog` (behind the cog) | They are set-once-and-forget, not per-tap controls. Same "quick controls in the header, everything else behind the cog" split flp and Word Search use. |
| **Countdown timer** | `MatchSpeedTimerBar`, pinned to the top of the **play area** | The clock is game state, not page chrome. A countdown the player has to look away from the board to read is a countdown they stop reading. |

### `MatchSpeedSettingsDialog`

A `Dialog` sheet mirroring `WordSearchSettingsDialog` (same switch-row shape).
Three rows, all backed by the shared `useFlashcardLearnSettings` so they persist
across games: **Show pinyin**, **Tone colors**, **Speak the word on tap**
(`autoplayChinese` — pool cards are pre-warmed with `tts.prefetch(card)` as Bubble
Match does). The two pinyin rows are **language-gated** — see below.

### `MatchSpeedTimerBar`

`m:ss` counting down from 1:00 via the shared `formatTimeMs`
(`src/utils/timeUtils.ts`) — hoisted there out of
`src/games/word-search/constants.ts` as part of this work, since a game-agnostic
formatter had no business living in one game's tunables. Under `URGENT_MS` (10s)
both the digits and the drain bar turn red and the digits pulse. A **drain bar**
sits under the digits so the run's end is legible peripherally, without parsing
digits.

The bar is mounted from the **countdown phase onward**, at a full bar — so the
board never shifts down when the run starts — and is **dimmed rather than
removed** once the run ends, for the same reason (the end card owns the result;
a frozen `0:00` would otherwise read as broken).

Minute points: add `/games/match-speed` to `MINUTE_POINTS_ELIGIBLE_PAGES`
(`src/constants.ts:13-20`). The start-on-entry subset is already the path prefix
`/games` (`MINUTE_POINTS_AUTO_ACTIVE_PAGES`, `src/constants.ts:29-31`), so it is
covered automatically.

### Language scope

The game is **language-agnostic**, following the user's selected language exactly
as Bubble Match does — the pool endpoint is already language-scoped and
`ForeignText` renders Latin-script languages (`es`) as plain text with no pinyin
overlay.

**But the pinyin toggles must be language-gated**: for a Latin-script language the
pinyin and pinyin-color controls are meaningless (`ForeignText` ignores them
entirely) and must be **hidden**, not merely inert. `MatchSpeedSettingsDialog`
therefore takes the active language and renders those two rows only for
character-based languages, via `isLatinScriptLang` imported from `ForeignText` —
the canonical owner of that set — rather than re-testing `=== "es"`. (Bubble
Match's header had the same latent bug; it was fixed in the same pass.)

---

## Rendering a card

### Foreign card (left column)

Rendered through **`ForeignText`** — never `CPCDRow` / `CPCDBlock` directly
(project rule: `ForeignText` is the public container, the cpcd components are its
private Chinese-script implementation). Pass the language and let it choose
between cpcd and plain text.

### English card (right column)

The gloss **must** come from `resolveDisplayDefinition(entry)`
(`src/utils/definitionUtils.ts`) — never `entry.definition` or `definitions[0]`.
The `game-pool` payload carries `definitionClusters` + `selectedSense`, so this
resolves client-side, exactly as Bubble Match does. Showing a different gloss than
the flashcard the player learned the word from reads as the game not knowing their
word. See
[GAMES_FEATURE.md § Sense correctness](./GAMES_FEATURE.md#sense-correctness--every-game-must-honor-the-learners-selected-sense)
and [DEFINITION_MAPPING.md](./DEFINITION_MAPPING.md) form #3 (dd).

### Fitting the gloss into a fixed-height cell

Three steps, in order:

1. **Strip parentheticals** — run the same `stripParentheses` pass Bubble Match
   uses when sizing definition bubbles, dropping "(literary)"-style asides before
   anything else. This buys room for the part of the gloss that actually
   distinguishes it.
2. **Scale the font by length** — interpolate the font size down as the stripped
   gloss gets longer, between a `DEF_LEN_MIN`/`DEF_LEN_MAX` character band, the
   same length→size idea Bubble Match applies to bubble radius
   (`DEFINITION_LEN_MIN`/`MAX`, `src/games/bubble-match/constants.ts`). Clamp at
   both ends.
3. **Clamp at 3 lines** with an ellipsis.

Card size stays **fixed at 2:1 and equal across all ten cards** throughout — see
[Card sizing](#card-sizing-locked-to-21) for why this is a correctness
constraint.

### Card visual states

| State | Treatment |
|---|---|
| idle | resting card surface |
| selected | raised / outlined accent |
| wrong | red flash, ~400ms, **board stays live** |
| partner-hint (cleanup only) | light green — Bubble Match's `CORRECT_BUBBLE_BG` |

The first four are the `CardVisualState` union the board resolves and passes in.
The remaining two are **not** union members, because they aren't mutually exclusive
with a selection — they ride on the card itself:

| State | Driven by | Treatment |
|---|---|---|
| correct | `BoardCard.exiting` | green pop (`POP_DURATION_MS`), then the board removes it |
| entering | `BoardCard.fadeDelayMs` | CSS fade-in on a **wrapper** element, keyed by card id, `fadeDelayMs` stagger up to 500ms |

Border width is deliberately constant across every state: a 2px→3px swap on
selection would re-wrap a 3-line gloss mid-tap.

**The entry fade-in must live on a wrapper element, never on the card itself.** A
CSS animation with `both` fill keeps overriding the properties it animates for as
long as the element lives. A fade-in declared on the card animates `opacity` and
`transform`, and therefore permanently beat the card's own `scale(1.04)` selection
lift and its `scale(1.14)` + `opacity: 0` exit pop — both were silently dead until
the split. Wrapper animates *arrival*; card animates *state*; neither touches the
other's properties.

All class names BEM-style under `match-speed__` (`match-speed__cell`,
`match-speed__card--selected`, `match-speed__column--foreign`, …).

---

## Phase state machine

```
loading ──► blocked            (not signed in / < 20 Learn Now cards / fetch failed)
   │
   └─────► playing ──(60s)──► ended ──► (popup minimized) ──► cleanup
                                 ▲                               │
                                 └───────(popup restored)────────┘
              ▲                                  │
              └────────── Play Again ────────────┘
```

`cleanup` is not a separate phase value — it is `phase === "ended" &&
popupMinimized`, matching how Bubble Match derives `cleanupMode`. Keeping it
derived avoids a state pair that can disagree.

---

## Files

```
src/games/match-speed/
  MatchSpeedPage.tsx       page shell + phase machine + pool/buffer + marks
  MatchSpeedBoard.tsx      the 2×5 slot grid, tap handling, refill tick
  MatchSpeedCard.tsx       one card (foreign or english) + its visual states
  MatchSpeedHeader.tsx     right-slot controls: settings cog + fire badge
  MatchSpeedSettingsDialog.tsx  settings sheet: pinyin / tone colors / autoplay
  MatchSpeedTimerBar.tsx   run clock + drain bar, top of the play area
  MatchSpeedEndPopup.tsx   GameEndPopup wrapper pinning classPrefix
  cardBuffer.ts            weighted category roll + per-category buffer + fallback
  constants.ts             tunables, medal table, GAME_KEY
  types.ts                 BoardCard, Slot, Phase, Medal
```

`cardBuffer.ts` is **pure and injectable-rng**, the way
`spawnSelection.ts` is for Bubble Match
(`src/games/bubble-match/spawnSelection.ts` — `Rng = () => number`, defaulting to
`Math.random`). The weighted roll and the fallback walk are exactly the kind of
logic that is miserable to verify through the UI and trivial to verify as a pure
function — see `src/__tests__/matchSpeedCardBuffer.test.ts`, which pins the weight
bands, the fallback walk, the no-re-normalization rule, and the real no-medal tier.

**Both columns live in ONE `useState` object inside `MatchSpeedBoard`, mirrored by
a ref.** Every board mutation (refill, pop-out removal, marking a pair exiting)
touches both columns and must be atomic; two separate `useState`s would force one
updater to read the other's committed value, reachable only by nesting `setState`
inside an updater — a side effect React re-runs under StrictMode. The ref mirror is
what lets `refill()` know synchronously how many pairs it actually placed, so the
buffer top-up fires exactly once for exactly what was consumed.

Edits outside that folder:

| File | Edit |
|---|---|
| `src/games/registry.ts` | one `GameDef` (title, subtitle, `bgColor`, lazy `Component`) — this alone wires the hub, router, and phone frame |
| `src/constants.ts` | add `/games/match-speed` to `MINUTE_POINTS_ELIGIBLE_PAGES` |
| `server/services/OnDeckVocabService.ts` | stamp `gameCategory` on pool cards |
| `server/contracts/wire.ts` | `gameCategory?: FlashcardCategory` on `VocabEntryBase` — one declaration serves both sides |
| `docs/GAMES_FEATURE.md` | register the game in its game list |
| `src/utils/timeUtils.ts` | `formatTimeMs` hoisted here out of word-search constants; both word-search importers re-pointed |
| `src/games/bubble-match/BubbleMatchHeader.tsx` | takes `language`, hides the pinyin toggle for Latin-script languages (same latent bug, fixed in this pass) |
| `src/__tests__/matchSpeedCardBuffer.test.ts` | unit coverage for the weighted roll, the fallback walk, and the medal table |

---

## Implementation checklist

All steps complete — kept as the build order a similar game should follow.

1. ✅ Backend: stamp `gameCategory` in `fetchGameCandidates`; declare the field on
   `VocabEntryBase`. Bubble Match and Word Search verified unaffected (they never
   read it; the response shape is otherwise unchanged).
2. ✅ `constants.ts` + `types.ts` + `cardBuffer.ts` (pure, injectable rng), covered
   by `src/__tests__/matchSpeedCardBuffer.test.ts`.
3. ✅ `MatchSpeedCard.tsx` — `ForeignText`, `resolveDisplayDefinition`, strip →
   scale → clamp, the visual states.
4. ✅ `MatchSpeedBoard.tsx` — slot arrays, tap/selection rules, refill tick, pop and
   fade animations.
5. ✅ `MatchSpeedPage.tsx` — `LeafPage`, `useBlockEdgeSwipe(true)`, phase machine,
   pool prefetch + buffer top-up, marks, timer.
6. ✅ `MatchSpeedHeader.tsx` + `MatchSpeedSettingsDialog.tsx` +
   `MatchSpeedTimerBar.tsx` + `MatchSpeedEndPopup.tsx`; `formatTimeMs` hoisted to
   `src/utils/timeUtils.ts` (word-search importers re-pointed).
7. ✅ Registry entry + `MINUTE_POINTS_ELIGIBLE_PAGES`.
8. ✅ `docs/GAMES_FEATURE.md` + `docs/MASTERY_REWORK.md` updated; this doc flipped
   to shipped and its open questions resolved.

---

## Resolved decisions (were open questions before the game shipped)

| Question | Decision |
|---|---|
| **Timer start** (was #1, #2) | A **3·2·1·Go countdown**, `COUNTDOWN_STEPS` at `COUNTDOWN_STEP_MS` each. The board is primed and fully readable behind a dimming scrim during it, so the opening board gets a beat to be read and the clock starts from an identical state every run — nobody is billed for reading time. The board is `frozen` (renders, ignores taps, no refill tick) until the last step clears. |
| **Buffer under-supply mid-run** (was #3) | **Just gaps**, no placeholder. `takePairs` short-returns, the tick fills what it can, and the rest wait for the next tick. A placeholder would advertise a network problem the player can do nothing about, and the hole is already the game's normal resting state right after a match. |
| **Tap on an empty slot** (was #4) | **No-op**; the selection is preserved. An empty slot has no `MatchSpeedCard` to receive the tap, so this is the natural behavior rather than a coded rule. Clearing the selection would punish a near-miss on a card that had just popped out. |
| **Bubble Match's pinyin toggles** (was #5) | **Fixed in the same pass.** `BubbleMatchHeader` now takes `language` and hides the toggle for Latin-script languages, same as `MatchSpeedHeader`. Both import `isLatinScriptLang` from `ForeignText` rather than re-testing `=== "es"`. |
| **Accuracy on the end card** (was #6) | **Shown**, as `Accuracy {score}/{attempts} ({pct}%)` under the score. Information only — it never gates a medal. Without it a wrong match leaves no trace at all on the end card. |
| **Sound** (was #7) | **None**, consistent with both other shipped games. |

---

## Dependencies (docs ↔ code)

Per the project's dependency-documentation rule: what this doc describes, and what
it reads from.

| This doc's section | Depends on |
|---|---|
| Card selection, buffer, `exclude` | `server/services/OnDeckVocabService.ts` — `getGameVocabPool` (856-976), `fetchGameCandidates` (252-293), `GAME_FALLBACK_ORDER` (803) |
| Backend change | same, plus `server/routes/onDeckRoutes.ts`, `server/dal/shared/dictJoin.ts` (`DICT_COLS`) |
| Marks | `POST /api/flashcards/mark`; per-type categories → [MASTERY_REWORK.md](./MASTERY_REWORK.md) |
| Rendering a card | `src/components/ForeignText.tsx`; `src/utils/definitionUtils.ts` (`resolveDisplayDefinition`) |
| Medals | `src/games/match-speed/constants.ts` (`MEDAL_THRESHOLDS`, `medalForScore`); shape modeled on `src/games/word-search/constants.ts` (`medalForTime`) |
| Timer format | `src/utils/timeUtils.ts` (`formatTimeMs`) — shared with Word Search |
| End popup, cleanup | `src/games/runtime/GameEndPopup.tsx`; `src/games/bubble-match/BubbleStage.tsx` (`cleanupMode`, `revealed`) |
| Page shell, header | `src/components/LeafPage.tsx`; `src/games/word-search/WordSearchHeader.tsx` + `WordSearchSettingsDialog.tsx` (the cog-sheet pattern this header follows); `src/hooks/useBlockEdgeSwipe.ts` |
| Card sizing (2:1) | `src/games/match-speed/MatchSpeedBoard.tsx` (`gridElRef` / `cardHeight` measurement block); `constants.ts` (`CARD_ASPECT`, `ROW_GAP_PX`, `COL_GAP_PX`) |
| Registry, minute points | `src/games/registry.ts`; `src/constants.ts:13-31` |
| Win badge | `src/hooks/useGameWins.ts` |
| Pure-selection precedent | `src/games/bubble-match/spawnSelection.ts` |

Docs updated when this shipped:

- [GAMES_FEATURE.md](./GAMES_FEATURE.md) — ✅ game list (three shipped), registry
  example, and the `gameCategory` field on the `gamePool` response under § Backend.
- [MASTERY_REWORK.md](./MASTERY_REWORK.md) — ✅ Match Speed added to the
  which-type-each-surface table, plus a note that the bucket is now on the wire as
  `gameCategory`.
- [HUB_MENU_SYSTEM.md](./HUB_MENU_SYSTEM.md) — only if Match Speed ever grows a
  level strip; a single row needs no change.
