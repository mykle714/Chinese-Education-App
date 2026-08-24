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

Third game. A **recognition** speed drill: two columns × six rows of cards, the
left column holding the foreign word, the right column holding its English
definition. Tap one card, then tap a card in the *other* column to attempt a
match. Thirty seconds; match as many pairs as you can.

Where Bubble Match is a spatial/physical game (drag bubbles through a packing
field) and Word Search is a scanning game, Match Speed is a pure **read-and-recall
throughput** test. There is no physics, no grid generation, and no drag — only
taps, a clock, and a board that keeps refilling.

---

## Table of contents

- [Gameplay](#gameplay)
- [Board model](#board-model)
- [The 3-second refill tick](#the-3-second-refill-tick)
- [Board cleared celebration](#board-cleared-celebration)
- [Difficulty modes (Study Mix / Review / Challenge)](#difficulty-modes-study-mix--review--challenge)
- [Card selection: distribution + buffer](#card-selection-distribution--buffer)
- [Backend change: per-card `gameCategory`](#backend-change-per-card-gamecategory)
- [Study Challenge rounds: the alternation rule](#study-challenge-rounds-the-alternation-rule)
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
8. At **0:30**, the run ends and the end popup appears with the score + medal.

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

#### The other kind of "lockout": a render stalling the next tap

Everything above is about input being *blocked*. There is a second failure mode
that feels identical to the player but has nothing to do with hit-testing: the
tap is **queued behind a render**.

`MatchSpeedCard` is `React.memo`'d (`MatchSpeedCard.tsx`, the default export) and
`MatchSpeedBoard`'s `handleTap` is **referentially stable** — `frozen`,
`cleanupMode`, `onMatch`, `onMiss` and `onSpeak` are read through refs
(`MatchSpeedBoard.tsx`, the prop-ref block above `refill`) rather than captured in
its dependency array. Both halves are required, and together they are an
input-latency mechanism, not a micro-optimisation:

- Without the memo, every `setSelectedId` re-rendered **all 10 cards**, each
  re-running `resolveDisplayDefinition`, a full cpcd character+pinyin render, and
  MUI/emotion serialization of two large `sx` objects.
- Without a stable `onTap`, the memo misses on every card and you get the same
  12-card render anyway.

That render is one blocking main-thread task sitting between the player's tap and
their next one. It never *blocked* input, but a tap landing inside it waits — and
it only bites taps in **separate React batches**, because two fingers inside one
batch are handled before React re-renders at all (see § Two-finger taps). "Taps
close together work, taps slightly further apart don't" is the signature of this
bug, not of an animation.

**Rule: a tap must never depend on a render.** Selection state is read from refs
so the game logic is correct regardless of render timing, and the render that
follows a tap is kept small so it cannot stall the next one. If you add props to
`MatchSpeedBoard` that `handleTap` needs, route them through a ref — do not add
them to its dependency array.

#### Tap telemetry (server-side)

Every tap calls `reportTap` (`src/utils/perfDiagnostics.ts`) on its way out of
`handleTap`, tagged with the **outcome** the handler chose: `match`, `miss`,
`select`, `deselect`, `cleanup-*`, or one of the three no-ops —
`ignored-frozen`, `ignored-exiting`, `ignored-removed`. Records ship to
`POST /api/diagnostics/perf` with `inputDelay` (pointerdown → handler entry),
`processing`, and `presentation` (handler → next frame).

Taps that reach **no card at all** are reported too, as `no-card`, by a
board-level `onPointerDown` fallback (`handleBoardPointerDown` on the
`.match-speed__board` box). `handleTap` can only see taps that hit a card, but
the likeliest causes of "I tapped and nothing happened" never get that far: the
gutter between cells, an empty slot held open by a popped pair, a card that went
`pointer-events: none` the instant it matched (so the tap falls *through* rather
than hitting `ignored-exiting`), or an overlay above the board. The card handler
stamps `claimedEventRef` with the event's `timeStamp` at the target phase; the
board handler runs on the way up and reports anything unstamped, tagging
`target` with the class of the element that absorbed it. Without this, those
taps produce no record — and a missing record is indistinguishable from the
player not tapping.

This exists because the dead-tap reports **do not reproduce locally**, and the
browser's own Performance APIs cannot see the difference that matters here: a tap
dropped by a guard in 0.1ms looks perfectly healthy to Event Timing and is
indistinguishable from a tap that never happened. The two hypotheses read
differently in the data:

| Signal | Diagnosis |
|---|---|
| `no-card` outcomes in volume | taps are missing the cards — hit-area/layout, not a guard |
| `ignored-*` outcomes appearing in volume | a guard is eating real input |
| Healthy outcomes with large `inputDelay` | the tap was queued behind a render (above) |
| Large `presentation` | this tap's own render is what will stall the *next* one |

**A no-op tap is not by itself a bug.** All three `ignored-*` outcomes are
deliberate rules, and two of them are *expected* during correct play:
`ignored-frozen` is the pre-run countdown (the board is readable but not live),
while `ignored-exiting` / `ignored-removed` are the second finger of a
two-finger grab landing on a pair the first finger already matched — which is
the multi-touch design working, not failing (see § Two-finger (multi-touch)
taps). What indicts a guard is the **rate and the context**: `ignored-frozen`
outside a countdown, or `ignored-removed` rising with tap speed, is a defect;
a few percent of `ignored-exiting` in a fast run is not.

Tap records are a **census** — every tap ships, healthy or not — so the
analyzer's `%` column is a true share of taps and rates are readable directly.
The 600/min cap is a flood backstop only. Same production gate as the rest of
the module. Read it with `npx tsx scripts/analyze-client-perf.ts` → "Game tap
outcomes". See [CLIENT_PERF_DIAGNOSTICS.md](./CLIENT_PERF_DIAGNOSTICS.md).

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
nothing to suppress there — only a click to preserve), and additionally bails out
on a **detached** target: `touchend` carries the *touchstart* element, so a card
that popped out in between is no longer in the document, `getComputedStyle`
returns empty strings, and both of the guard's heuristics silently fail. That hole
swallowed taps on any surface whose element animates away — but the game does not
rely on either fix: `pointerdown` cannot be suppressed this way at all.

**Do not "simplify" this back to `onClick`.**

#### Two-finger (multi-touch) taps

**Multi-touch is supported and intentional.** A player may press a foreign card and
its gloss *at the same time*, with two fingers; both select, and the pair resolves
as one match attempt on the second contact. `MatchSpeedCard`'s `onPointerDown`
therefore checks only `e.button !== 0` (secondary *mouse* buttons) and deliberately
**does not check `e.isPrimary`**, which would drop every finger after the first.

The gate on this working is not the event filter — it is **where `handleTap` reads
its state from.** Two "simultaneous" contacts still arrive as two sequential
`pointerdown` events inside a *single* task, so React has not re-rendered between
them and both handler invocations close over the *same* render's `selectedId` and
slot arrays. With state reads, finger B would see "nothing selected" and simply
overwrite finger A's selection — no attempt, no score. So:

| Mutable state | Read in `handleTap` via | Why |
|---|---|---|
| Selection | `selectedIdRef.current` (mirror of `selectedId`, written by `setSelected`) | Finger B must see finger A's selection |
| The board / the tapped card | `findCard` → `boardRef.current` | Finger B must see the `exiting` flag finger A just set, or a matched pair could be scored twice |
| Wrong-flash ids | `setWrongIds(prev => …)` (append, never replace) | A second wrong attempt must not cancel the first's flash |

`handleTap` re-resolves its argument (`findCard(tapped.id)`) instead of trusting the
`BoardCard` captured at render, for exactly that `exiting` reason. Its dependency
array intentionally omits `selectedId`, `foreignSlots` and `englishSlots`.

**Rule for future edits: nothing inside `handleTap` may read game state from a
`useState` value.** Adding one silently breaks two-finger play while leaving
one-finger play perfectly healthy, which makes it very hard to notice.

*Accepted trade-off:* a stray second contact (a resting thumb over a card in the
opposite column) is now a real match attempt and can cost an `incorrect` mark,
where previously it was ignored. This was chosen over the alternative of accepting
non-primary contacts only in the opposite column, because the two-finger grab is
the natural fast gesture for this game and half-allowing it is harder to explain.

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

### Card sizing: locked to 2.4:1

**Every card is the same 2.4:1 rectangle** (`CARD_ASPECT` = width ÷ height), and
the ten cards on a board are always identical. This is
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

Whichever axis is tighter wins and the grid is centered in the slack. On a phone
the **width-limited** branch is the tighter one, so `CARD_ASPECT` doubles as the
card-height dial: raising it shortens every card (columns keep their width, the
grid re-centers in the freed vertical slack); lowering it makes them taller. Columns are
rendered only once measured, so no frame ever paints zero-height cards (which
would restart every card's fade-in). Cell height is fixed per row rather than
shared via `1fr`, so an **empty slot holds its row open** and surviving cards
never slide when a pair pops.

---

## The 3-second refill tick

**One global interval, started at run start**, not a per-slot timer.

```
t=0.0s   [A][B][C][D][E][F]   tick — board full
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
   than appearing as one block. The delay is drawn **per card, not per pair** —
   partners fading in simultaneously would reveal the match for free.
5. Fire the async buffer top-up (see below). **Never await it inside the tick** —
   the tick must not be able to stall on the network.

### Constants

| Constant | Value | Meaning |
|---|---|---|
| `ROWS` | 5 | rows per column |
| `RUN_DURATION_MS` | 30_000 | thirty seconds |
| `REFILL_TICK_MS` | 3_000 | board refill cadence |
| `FADE_IN_MAX_DELAY_MS` | 500 | upper bound of the per-card random fade delay |
| `FADE_IN_DURATION_MS` | ~260 | the fade itself |
| `POP_DURATION_MS` | ~280 | match pop before removal (mirrors Bubble Match) |
| `WRONG_FEEDBACK_MS` | ~400 | red flash on a wrong attempt; **board stays live** |
| `CLEAR_BANNER_MS` | 1_400 | "Board Cleared!" banner lifetime (cosmetic only) |

---

## Board cleared celebration

When the **last pair leaves the board**, a green **"Board Cleared!"** banner pops
in over the centre of the grid, drifts up and fades
(`MatchSpeedClearBanner.tsx`, `CLEAR_BANNER_MS` = 1400ms).

**It is an indicator and nothing else** — no score, no medal, no mark, no bonus,
no phase change. The board refills on its normal tick exactly as it would have.
It exists because clearing the board is the best thing that can happen in a run
and the game otherwise passes over it in silence.

| Property | Value | Why |
|---|---|---|
| Trigger | the removal that empties **all** `2 × ROWS` slots | see below |
| Duration | `CLEAR_BANNER_MS` (1400ms) | comfortably under `REFILL_TICK_MS`, so it is gone by the time replacement cards fade in beneath it |
| Input | `pointerEvents: "none"` | it must never swallow a tap on a card arriving underneath it |
| A11y | `aria-hidden` | carries no information; the board state already does |

**The trigger lives in `removePair`, not in a `useEffect` on the board state**, and
that placement is load-bearing: the board is *also* legitimately empty before the
very first refill lands, so an effect watching "is the board empty" would fire the
banner on mount, every run. A pair removal is the only way a populated board
becomes empty, so it is the one place the transition is unambiguous.

The banner is re-mounted via a changing `key` (`clearId`, bumped per clear) rather
than being shown/hidden by a flag — a reused DOM node keeps the CSS animation in
its finished state and a second clear would render nothing visible. Same trick
`MatchSpeedCard` uses for its per-card fade-in (and that Speed Reading's float
indicator used for repeat taps at one spot, before it was removed).

**Reachability.** With `ROWS` = 5 and a 3-second tick, clearing during live play
means matching five pairs inside one tick window — very rare, which is the point.
The common case is the **cleanup phase**, where the board drains and never
refills; the banner fires there too, on the final pair.

---

## Difficulty modes (Study Mix / Review / Challenge)

> ⚠️ **No mode is reachable from the UI today.** The Games hub briefly carried a
> `HubMenuArrayItem` strip with one sub-card per mode; it was removed and Match
> Speed is a **single `HubMenuRow`** again, so every launch arrives with no
> `state.mode` and plays **Study Mix**. Everything below still describes live code —
> the mode machinery is intact and still honours a `state.mode` passed by any
> caller — but Review and Challenge are currently unreachable. Re-adding the strip
> (or any other picker) is all that's needed to bring them back.

The game defines **three independently-playable modes**, selected via nav
`state.mode` (there is no in-game picker). Modes do **not** chain and nothing is
unlocked by clearing one.

A mode changes **only which mastery buckets the pool may draw from**. The 30s
clock, the 5×2 board, the 3-second refill tick and the medal thresholds are
identical across all three — difficulty comes purely from which cards you are
asked to recognize, which is exactly what Review/Challenge mean on `/decks`.

| Mode | `wins` level | Buckets | Per-draw weights | Buffer depth / bucket |
|---|---|---|---|---|
| **Study Mix** (default) | 1 | all four | 12 / 60 / 20 / 8 | 6 |
| **Review** | 2 | Comfortable + Mastered | 70 / 30 | 12 |
| **Challenge** | 3 | Unfamiliar + Target | 20 / 80 | 12 |

- **The bucket split is the `/decks` rule verbatim** — Review draws
  Comfortable+Mastered, Challenge draws Unfamiliar+Target
  (`src/features/flashcards/FlashcardsDecksPage.tsx`). Same rule, same
  card colors on the hub (see [BENTO_SYSTEM.md](./BENTO_SYSTEM.md)).
- **Within a restricted mode the two buckets keep roughly their Study Mix ratio**
  (20:8 → 70:30, 12:60 → 20:80), so Challenge still leans on Target and Review still
  leans on Comfortable rather than flattening to 50/50.
- **Study Mix keeps `wins` level 1**, the key the game used when it had a single
  difficulty, so pre-existing win history stays attached to the default mode
  instead of being orphaned.
- **Buffer depth is derived, not per-mode-hardcoded**:
  `ceil(BUFFER_TOTAL_TARGET / categories.length)`, so every mode buffers ~24
  pairs no matter how many buckets it spans and the board draws at the same rate.
  `BUFFER_TOTAL_TARGET` is **24** so that even Study Mix's thinnest bucket (24 / 4 = 6)
  can fill a whole board (`ROWS` = 5) by itself — a per-bucket depth below the
  board size would fire the fallback walk on an ordinary tick and quietly pull the
  run off its weight table.

### A mode is a hard restriction, in three places

The server tops a short bucket up **from its own fallback order**, so a Review
request can legitimately come back holding an `Unfamiliar` card. The mode is
therefore enforced client-side at every point where a category is chosen:

1. `rollCategory` rolls **only** over `mode.categories`, against `mode.weights`.
2. The empty-bucket fallback walk uses `mode.fallbackOrder` — which contains only
   in-mode buckets, so a bare Review buffer draws **nothing** rather than reaching
   for Target.
3. `fillBuffer` **drops** an off-mode card on arrival. Shelving a card no roll can
   ever draw would only bloat the `exclude` list. (An *unstamped* card is still
   filed — under `mode.fallbackOrder[0]` — for the reason given below.)

Nothing below `MatchSpeedPage` branches on the mode *name*: every function in
`cardBuffer.ts` takes the run's `ModeConfig` as a trailing optional argument
defaulting to Mix, which is exactly the game's pre-modes behavior.

### Implementation

- `ModeConfig` / `MatchSpeedMode` — `src/games/match-speed/types.ts`
- `MODE_CONFIGS` (hub order), `defineMode`, `modeConfigFor`, `DEFAULT_MODE_CONFIG`
  — `src/games/match-speed/constants.ts`
- Mode-aware `rollCategory` / `takePair` / `takePairs` / `fillBuffer` /
  `topUpRequest` — `src/games/match-speed/cardBuffer.ts`
- `modeConfigFor(location.state.mode)` and the pool/gate/`recordWin` wiring —
  `src/games/match-speed/MatchSpeedPage.tsx`
- Hub entry — `src/games/GamesPage.tsx` (a plain single `HubMenuRow`; the mode
  strip and its `MATCH_SPEED_MODE_COLORS` palette were removed)
- Coverage — `src/__tests__/matchSpeedCardBuffer.test.ts` (roll bands per mode,
  no off-mode fallback, off-mode drop, in-mode-only top-up)

A visit with no/invalid `state.mode` **falls back to Mix** rather than bouncing to
the hub the way Bubble Match does — this route shipped before the modes existed and
must stay playable on its own. That fallback is now the ONLY path in the app, since
the hub passes no state. The page's load effect is still keyed on
`modeConfig.mode` as well as `user?.id`: if a picker returns, switching modes lands
on the same route with only `state.mode` changed, and without that key a
remount-less switch would keep playing the previous mode's buffer.

---

## Card selection: distribution + buffer

### Probability distribution

Each pair drawn for the board rolls a category **independently**, weighted (this
is the **Study Mix** table; Review and Challenge roll over their own buckets — see
[§ Difficulty modes](#difficulty-modes-study-mix--review--challenge)):

| Category | Weight |
|---|---|
| Unfamiliar | 12% |
| Target | 60% |
| Comfortable | 20% |
| Mastered | 8% |

This is a **per-draw roll**, not a fixed board quota — unlike Bubble Match's
`GAME_DISTRIBUTION` (`src/games/bubble-match/constants.ts`), which requests
a fixed 2/10/6/2 mix for a whole run. A Match Speed board can legitimately come
up 5 Target cards.

⚠️ These categories are the **per-mark-type** categories (recognition, the track
this game emits), not the whole-card **core** mastery bar the decks page
shows. The `game-pool` endpoint already buckets this way — see
[MASTERY_REWORK.md § "Games select by their own mark type"](./MASTERY_REWORK.md).

**Empty-category fallback.** This is the *client-side* buffer's recovery, and it is
distinct from the server's tier order — the server lends before it borrows across
buckets, but only for the part of the shortfall borrowing cannot cover
([PROVISIONAL_CARDS.md § 4b](./PROVISIONAL_CARDS.md)), so a buffer top-up for a short
bucket arrives as lent `Unfamiliar` cards only when the library has no fresh cards left;
otherwise it arrives as borrowed cards, still before this walk ever fires.
If the rolled category's buffer is still empty, walk the
mode's fallback order — in Study Mix, the existing bubble-match one —
**Target → Comfortable → Unfamiliar → Mastered**
(`OnDeckVocabService.GAME_FALLBACK_ORDER`, `server/services/OnDeckVocabService.ts`)
— and take from the first non-empty one. The weights are **not** re-normalized;
the roll happens against the full 12/60/20/8 table every time and the fallback is
purely a "that shelf was bare" recovery.

### The buffer

API latency is far too high to fetch a card at the moment a slot empties, so the
page keeps a **client-side buffer of pairs, keyed by category, target depth 5
each in Study Mix** (20 cards buffered; a restricted mode buffers 10 in each of its two
buckets for the same 20 total). The buffer is filled once before the run starts
and topped up continuously during it.

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
**in-mode** bucket toward the mode's depth (off-mode buckets are never requested). Small steady requests; the buffer rarely dips. The request is
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
`excludeIds`, `server/services/OnDeckVocabService.ts`).

We do **not** use the `avoid` (soft-demote) param.

### The duplicate gate (client-side, three layers)

`exclude` is the *first* line of defence, not the only one, because it cannot be
airtight: a top-up in flight was built from a **snapshot** of the board and
buffer, and the server tops a short bucket up from its own fallback order, so one
response can legitimately repeat an entry.

Two cards for the same vocab entry on the board at once is not a cosmetic bug —
`pairId` is derived from the entry id (`pair-<entry.id>`), so the four resulting
cards would **all match each other** and the board would stop being a pairing
puzzle. Hence three layers, each covering what the one before it cannot see:

| Layer | Where | Catches |
|---|---|---|
| `exclude` on the request | `MatchSpeedPage.fetchPool` | Everything known at request time |
| Buffer dedupe | `fillBuffer` | An entry already shelved, or repeated twice inside one response |
| Draw gate | `takePairs` (`isBlocked` + a per-batch id set) | An entry already **on the board**, and a repeat within the batch being placed this tick |

The page supplies `isBlocked` as `(pair) => onBoardIdsRef.current.has(pair.entry.id)`
— read from the ref *inside* the predicate, so it tests the board as it stands at
draw time. `takePairs` gates the batch itself separately, because the board has
not been handed the batch yet and no external set can know about it.

A rejected pair is **discarded, not re-queued**. It was already shifted off its
bucket, and putting it back would spin the draw loop forever on a buffer of
duplicates; dropping it also self-heals, since the now-shorter bucket is what the
next `topUpRequest` asks to refill.

### Entry gate — REMOVED

Match Speed has **no card-count gate**. It previously required 20 Learn Now cards
overall, plus (for Review/Challenge) at least one card inside the mode's own buckets. Both
blocks are gone — see [PROVISIONAL_CARDS.md](./PROVISIONAL_CARDS.md).

What happens instead:

1. **Overall shortfall** → the pool request carries `surface=match-speed`, so the server
   lends the player enough temporary cards to reach the baseline
   (`CARD_BASELINES['match-speed']`) before building the pool. `sufficient === false` is
   no longer a block; it only means the dictionary itself ran dry, and a shorter buffer
   still deals a playable run.

2. **Nothing inside the mode's buckets** → the run switches to **relaxed mode**
   (`relaxed` in `MatchSpeedPage.tsx`): its `fallbackOrder` widens to all four buckets
   for that run only, so the server's cross-bucket top-up actually reaches the board.
   The mode's WEIGHTS are untouched, so once the player has real on-mode cards the
   widened fallback stops being reached and the mode plays exactly as designed.

   This matters for **Review**, not Challenge. The split is Review = Comfortable + Mastered,
   Challenge = Unfamiliar + Target (§ MODE_CONFIGS). A lent card starts with an empty mark
   history and is therefore **Unfamiliar**, so provisioning fills Challenge's buckets for
   free — but Comfortable and Mastered are earned, not granted, so Review stays empty for
   a learner with no real progress until the widened fallback kicks in.

Match Speed's notice is the **generic** (non-itemized) form — it deals from a rolling
buffer, so the played set isn't known when the run starts. The end-of-run "keep these
cards" offer names the lent words the player actually **reviewed**
(`useMarkedLentWords`, recorded in `markCard`) — not the ones the buffer fetched, which
is what it used to do and which included cards that never reached the board at all. See
docs/PROVISIONAL_CARDS.md § 5.

**The notice fires ONCE, before the run, and never again.** `beginRun` is the only caller
of `setNoticeOpen`; the mid-run `topUpBuffer` path records lent words but deliberately
opens nothing. This is a rule for a reaction-time game, not an accident of the code: a
modal mid-run costs the player clock and lands over a board they are mid-tap on. Hydra
Bubbles can afford its mid-run `HydraLendNotice` because it has no clock; Match Speed
cannot, and a top-up that lends mid-run must stay silent.

What replaces it is the **lent badge** — the icons8 hourglass in the top-right corner of
every borrowed card (`LentCardBadge`, docs/PROVISIONAL_CARDS.md § 5). Mid-run lending is
therefore visible without ever interrupting: a badged card simply appears in the next
deal. The badge is on the **foreign side only**; badging both faces would mark a pair as
belonging together and let the player match by badge rather than by reading, which is the
same leak the fixed card size prevents (§ Rendering a card). The notice teaches the mark
via its `badgedInRound` prop, which only Match Speed passes.

Both checks read `available`, which `getGameVocabPool` reports for **all four**
buckets regardless of which ones the mode requested
(`server/services/OnDeckVocabService.ts`), so the mode never narrows the counts
the gate sees.

---

## Study Challenge rounds: the alternation rule

**Built 2026-08-22.** Match Speed is challenge-eligible (recognition), so it can be
drawn as one of a test's three rounds — see
[STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md) § 5.3 for the rule's rationale and § 5.2a for
the shared plumbing. What is specific to THIS game:

**Why it needs a rule at all.** Every other eligible game has a fixed board, so "all
twelve contested words appear in the round" is a fact about board composition. Match
Speed deals from a rolling buffer into ten slots against a 30-second clock, so the same
guarantee has to become a rule about the DEAL:

> **Every other pair filled is a contested one, while any contested word is left
> undealt.**

**How the pieces fit the existing ones.**

| Piece | What happens |
|---|---|
| The opening fetch | carries `?challengeId=` and comes back as one SHUFFLED set of contested + filler. `beginRun` splits it against the challenge's own word list — contested into the deal state's queue, the rest into the ordinary `CardBuffer` via `fillBuffer` |
| `drawPairs` | in a challenge round, delegates to `dealChallengePairs` (`challengeDeal.ts`, pure + tested) with the buffered draw as its filler source; otherwise unchanged |
| Buffer top-ups | send `&contested=exclude`, so a refill is pure filler. The twelve are dealt ONCE and never recycled — a re-served contested word would be a second bite at a word the round has already scored |
| Mode | a challenge round always launches as **Study Mix**. Review and Challenge are hard bucket restrictions, and `fillBuffer` drops off-mode cards — under either of them half a challenge board would be thrown away on arrival |

**Parity is counted over the RUN, not per call.** The board refills a few holes at a
time; an alternation that reset per call would put a contested pair in every refill's
first slot and burn the set in the first seconds. That case, and three other awkward ones
(both sources dry, one source dry, a drained set never returning), are pinned by
`src/games/__tests__/challengeDeal.test.ts`.

**The board still looks completely normal.** Nothing marks a contested pair — no accent,
no ordering, no pre-round list (STUDY_CHALLENGE.md § 5.7, Q74). The scoring split is
invisible until the between-games scoreboard.

---

## Backend change: per-card `gameCategory`

**Implemented.** `server/services/OnDeckVocabService.ts` — `fetchGameCandidates`
stamps `row.gameCategory = category` as it partitions each bucket's rows into
fresh/cooled; the `drain()` helper in `getGameVocabPool` then preserves it for
free. The field is declared on `VocabEntryBase` in `server/contracts/wire.ts`, so
both the server and client types carry it from one definition.

The buffer is keyed by category, but `GET /api/onDeck/gamePool` returns a **flat
`cards[]` with no per-card game-category label**
(`server/services/OnDeckVocabService.ts`). The `category` field the rows do
carry comes from `CORE_CATEGORY_SELECT` — the **core** mastery bar's band
(recognition + production; see [MASTERY_REWORK.md](./MASTERY_REWORK.md) § Three
bars), *not* the per-mark-type category the buckets were selected by. So today
a client cannot sort a response back into four buffers.

**The change:** stamp each returned card with the category bucket it was drawn
from. The value already exists inside `fetchGameCandidates` — it is the loop key
(`server/services/OnDeckVocabService.ts`) — it is simply not carried onto the
row. Tag the rows as they're bucketed, then the `drain()` helper in
`getGameVocabPool` preserves it automatically.

```
GET /api/onDeck/gamePool?Unfamiliar=5&Target=5&Comfortable=5&Mastered=5
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

| Medal | Threshold (pairs in 30s) | ≈ pace |
|---|---|---|
| 🥇 Gold | 9+ | ~3.3s/pair |
| 🥈 Silver | 6+ | ~5.0s/pair |
| 🥉 Bronze | 3+ | ~10s/pair |
| — none | 0–2 | |

Thresholds are stated **against the run clock** and were halved with it when the
run went 60s → 30s, so the required pace is unchanged. Re-tune them together or
not at all.

There is a genuine **no-medal tier** — unlike Word Search's `medalForTime`, whose
bronze row is `maxSeconds: Infinity` and therefore always awarded
(`src/games/word-search/constants.ts`). Structure the resolver the same
way (an ordered threshold table + a `medalForScore(score)` helper) but let it
return `null`.

The end card also shows **accuracy** — correct attempts / total attempts — as
information only. It does not gate a medal.

### Win badge

`recordWin(modeConfig.winLevel)` fires **only on a gold-medal run** (`useGameWins`,
`src/hooks/useGameWins.ts`, `GAME_KEY = "matchSpeed"`). The level key is the
**mode's** (Study Mix 1, Review 2, Challenge 3 — see
[§ Difficulty modes](#difficulty-modes-study-mix--review--challenge)); Study Mix keeps
key `1`, the game's original single-difficulty key, and is the only key reachable
now that the hub launches Study Mix only. The hub row shows the **game-wide `×N`**
as its corner badge (there is no per-mode ⭐ left — that lived on the removed mode
sub-cards). Gold-only keeps the badge an achievement rather than a play counter.

Medal thresholds are deliberately **not** re-tuned per mode: a 9-pair gold on
Challenge is a real achievement and on Review it is an easier one, which is the point of
having modes at all.

---

## End popup and cleanup phase

Reuses `GameEndPopup` (`src/games/runtime/GameEndPopup.tsx`) with
`classPrefix="match-speed"` — the shared scrim + card + × button + FLIP-style
collapse into a corner puck. Bubble Match wraps it in `BubbleMatchEndPopup` to
pin its prefix; Match Speed should do the same (`MatchSpeedEndPopup`).

Card content: score, medal, accuracy, and two actions —

- **Play Again** (primary) — new run, fresh board. Unlike Bubble Match there is no
  partial-refresh logic to carry over: Match Speed's board is fully transient, so
  a replay simply re-primes the buffer and starts a new 30s run.
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
| **Minute-points fire badge** | `MinutePointsFireBadge` — appended by `PageHeader` itself (flush right, after these controls); `MatchSpeedHeader` does not render it. |

Everything else that used to live in the header moved out, because inline toggles
plus a clock consumed roughly half the bar:

| Moved | To | Why |
|---|---|---|
| **pinyin / color / autoplay toggles** | `MatchSpeedSettingsDialog` (behind the cog) | They are set-once-and-forget, not per-tap controls. Same "quick controls in the header, everything else behind the cog" split flp and Word Search use. |
| **Countdown timer** | `MatchSpeedTimerBar`, pinned to the top of the **play area** | The clock is game state, not page chrome. A countdown the player has to look away from the board to read is a countdown they stop reading. |

### The HUD strip and the hint line

Inside the play panel, under the clock (shelf redesign entry 14):

| Element | Content | Notes |
|---|---|---|
| `GameHud` (`divider={false}`) | `Study Mix · All cards` — `9 matched` | Both facts are otherwise invisible once a run starts: the mode is chosen on the Games hub, the collection on `/decks`. Without the strip, a player who launched the wrong mode only found out from the cards. The divider is suppressed because `GameTimer` directly above already draws one. |
| `GameHint` | "tap a word, then its meaning" | Mono/uppercase/faint at the foot of the panel. |

The collection name comes from `collectionTitle` (`src/features/flashcards/collectionRef.ts`),
falling back to "All cards" for a launch with no collection.

### `MatchSpeedSettingsDialog`

A `Dialog` sheet mirroring `WordSearchSettingsDialog` (same switch-row shape).
Three rows — **Show pinyin**, **Tone colors**, **Speak the word on tap**
(`autoplayChinese` — pool cards are pre-warmed with `tts.prefetch(card)` as Bubble
Match does). The two pinyin rows are **language-gated** — see below.

⚠️ **All three are currently backed by the SHARED `useFlashcardLearnSettings`**, i.e.
the flp's own preferences, so toggling pinyin here also changes Bubble Match, Hydra
Bubbles, the cdp and the scp. That is being undone: pinyin becomes **per-game**
([GAMES_FEATURE.md § "Pinyin is a per-game setting"](./GAMES_FEATURE.md), decided
2026-08-23, not built), following the `useWordSearchSettings` pattern. For Match Speed
the toggle is **display only** — it keeps marking `recognition` either way; only Bubble
Match and (next) Hydra let pinyin pick the track.

### `MatchSpeedTimerBar`

`m:ss` counting down from 0:30 via the shared `formatTimeMs`
(`src/utils/timeUtils.ts`) — hoisted there out of
`src/games/word-search/constants.ts` as part of this work, since a game-agnostic
formatter had no business living in one game's tunables. Under `URGENT_MS` (10s)
both the digits and the drain bar turn red and the digits pulse. A **drain bar**
sits under the digits so the run's end is legible peripherally, without parsing
digits.

**The resting bar is `RAMP[GAME_HUE].ink` — this game's green** — as of 2026-08-23
([SHELF_REDESIGN.md](./SHELF_REDESIGN.md) § A6b). It was `COLORS.infoInk`, the palette's
neutral blue, which stopped working once the clock came to sit on a strip tinted with the
game's own hue: a blue bar on a green strip read as a widget borrowed from another screen.
It cannot be confused with the board's green "matched" fill — that is a card body, this is
a 4px rule in the chrome. The urgent state is still `dangerInk`.

The bar is mounted from the **countdown phase onward**, at a full bar — so the
board never shifts down when the run starts — and is **dimmed rather than
removed** once the run ends, for the same reason (the end card owns the result;
a frozen `0:00` would otherwise read as broken).

Minute points: add `/games/match-speed` to `MINUTE_POINTS_ELIGIBLE_PAGES`
(`src/constants.ts`). The start-on-entry subset is already the path prefix
`/games` (`MINUTE_POINTS_AUTO_ACTIVE_PAGES`, `src/constants.ts`), so it is
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

Card size stays **fixed at 2.4:1 and equal across all ten cards** throughout — see
[Card sizing](#card-sizing-locked-to-241) for why this is a correctness
constraint.

### The two columns are told apart by TYPE, not colour

*(Shelf redesign entry 14, class `.msc` — `docs/SHELF_REDESIGN.md`.)*

The columns used to be colour-coded: pale blue for the foreign word, cream for its
meaning. That spent the board's strongest signal on a distinction the player can already
see — one column is Chinese, the other is English. The design separates them
typographically instead:

| Column | Face | Ground |
|---|---|---|
| foreign (`.msc.zh`) | cjk, 19px, 700 | `COLORS.background` (paper) |
| english (`.msc`) | sans, length-scaled, 500, `iconColor` | `COLORS.white` |

Which frees every fill to mean **state and only state**. That is what makes the feedback
colours unambiguous — a filled card is always saying something about what just happened.

### Card visual states

| State | Treatment |
|---|---|
| idle | paper (foreign) or white (english), hairline border |
| selected | `COLORS.blu` fill, border blended into it (`.msc.pick`) |
| wrong | `COLORS.red` fill + `dangerInk` text, ~400ms, **board stays live** |
| partner-hint (cleanup only) | `COLORS.grn` — the same green a correct match pops |

Every fill is a **pastel carrying ink text**, per the redesign's fill rule
(`docs/SHELF_REDESIGN.md` § A1) — never saturated ink behind white letters. The wrong
flash in particular used to be white on `#F44336`, which read as an error dialog dropped
onto the board rather than as part of the game.

Selection **fills** rather than outlines, and the blue glow shadow that used to
accompany the outline is gone with it: a filled card does not need help being noticed.

The first four are the `CardVisualState` union the board resolves and passes in.
The remaining two are **not** union members, because they aren't mutually exclusive
with a selection — they ride on the card itself:

| State | Driven by | Treatment |
|---|---|---|
| correct | `BoardCard.exiting` | green pop (`POP_DURATION_MS`), then the board removes it |
| entering | `BoardCard.fadeDelayMs` | CSS fade-in on a **wrapper** element, keyed by card id, `fadeDelayMs` stagger up to 500ms |

Border width is deliberately constant across every state (1px): a width swap on selection
would re-wrap a 3-line gloss mid-tap. This is why a state that FILLS the card blends its
border into the fill rather than removing it.

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
   └─────► playing ──(30s)──► ended ──► (popup minimized) ──► cleanup
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
  MatchSpeedBoard.tsx      the 5×2 slot grid (ROWS=5 × 2 columns), tap handling, refill tick
  MatchSpeedCard.tsx       one card (foreign or english) + its visual states
  MatchSpeedHeader.tsx     right-slot controls: settings cog (the fire badge is PageHeader's)
  MatchSpeedSettingsDialog.tsx  settings sheet: pinyin / tone colors / autoplay
  MatchSpeedTimerBar.tsx   run clock + drain bar, top of the play area
  MatchSpeedEndPopup.tsx   GameEndPopup wrapper pinning classPrefix
  cardBuffer.ts            weighted category roll + per-category buffer + fallback
                           (every function is mode-aware, defaulting to Mix)
  constants.ts             tunables, medal table, GAME_KEY, MODE_CONFIGS
  types.ts                 BoardCard, Slot, Phase, Medal, MatchSpeedMode, ModeConfig
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
| `src/games/GamesPage.tsx` | the hub entry: a plain single `HubMenuRow` (registry-driven), special-cased only to hang the game-wide `×N` win badge on its `cornerBadge`. The former difficulty-mode strip and its `MATCH_SPEED_MODE_COLORS` palette are gone. |
| `src/constants.ts` | add `/games/match-speed` to `MINUTE_POINTS_ELIGIBLE_PAGES` |
| `server/services/OnDeckVocabService.ts` | stamp `gameCategory` on pool cards |
| `server/contracts/wire.ts` | `gameCategory?: FlashcardCategory` on `VocabEntryBase` — one declaration serves both sides |
| `docs/GAMES_FEATURE.md` | register the game in its game list |
| `src/utils/timeUtils.ts` | `formatTimeMs` hoisted here out of word-search constants; both word-search importers re-pointed |
| `src/games/bubble-match/BubbleMatchHeader.tsx` | takes `language`, hides the pinyin toggle for Latin-script languages (same latent bug, fixed in this pass) |
| `src/games/match-speed/MatchSpeedClearBanner.tsx` | the "Board Cleared!" pop-and-fade banner (decorative; no scoring) |
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
| Board cleared celebration | `src/games/match-speed/MatchSpeedClearBanner.tsx`; `MatchSpeedBoard.tsx` (`clearId`, `removePair`); `constants.ts` (`CLEAR_BANNER_MS`) |
| Study Challenge rounds | `src/games/match-speed/challengeDeal.ts`; `MatchSpeedPage.tsx` (`dealStateRef`, `drawPairs`, the `beginRun` split, `&contested=exclude`); `src/games/runtime/useChallengeRound.ts`; `src/games/__tests__/challengeDeal.test.ts`; server side → `OnDeckVocabService.getChallengeGamePool` |
| Duplicate gate | `src/games/match-speed/cardBuffer.ts` (`takePairs`'s `isBlocked` + batch id set, `fillBuffer`'s dedupe); `src/games/match-speed/MatchSpeedPage.tsx` (`drawPairs`, `onBoardIdsRef`); `src/__tests__/matchSpeedCardBuffer.test.ts` |
| Card selection, buffer, `exclude` | `server/services/OnDeckVocabService.ts` — `getGameVocabPool` (856-976), `fetchGameCandidates` (252-293), `GAME_FALLBACK_ORDER` (803) |
| Difficulty modes | `src/games/match-speed/constants.ts` (`MODE_CONFIGS`, `defineMode`, `modeConfigFor`), `types.ts` (`ModeConfig`), `cardBuffer.ts` (all functions), `MatchSpeedPage.tsx`, `src/games/GamesPage.tsx`; bucket rule mirrored from `src/features/flashcards/FlashcardsDecksPage.tsx` |
| Backend change | same, plus `server/routes/onDeckRoutes.ts`, `server/dal/shared/dictJoin.ts` (`DICT_COLS`) |
| Marks | `POST /api/flashcards/mark`; per-type categories → [MASTERY_REWORK.md](./MASTERY_REWORK.md) |
| Rendering a card | `src/components/ForeignText.tsx`; `src/utils/definitionUtils.ts` (`resolveDisplayDefinition`) |
| Lent-card badge | `src/components/LentCardBadge.tsx` (`LentCardBadge`, `LENT_ICON_ID`) |
| Lent words the run reviewed | `src/hooks/useMarkedLentWords.ts` |
| Medals | `src/games/match-speed/constants.ts` (`MEDAL_THRESHOLDS`, `medalForScore`); shape modeled on `src/games/word-search/constants.ts` (`medalForTime`) |
| Timer format | `src/utils/timeUtils.ts` (`formatTimeMs`) — shared with Word Search |
| End popup, cleanup | `src/games/runtime/GameEndPopup.tsx`; `src/games/bubble-match/BubbleStage.tsx` (`cleanupMode`, `revealed`) |
| Page shell, header | `src/components/LeafPage.tsx`; `src/games/word-search/WordSearchHeader.tsx` + `WordSearchSettingsDialog.tsx` (the cog-sheet pattern this header follows); `src/hooks/useBlockEdgeSwipe.ts` |
| Two-finger (multi-touch) taps | `src/games/match-speed/MatchSpeedCard.tsx` (the card `Box`'s `onPointerDown`); `src/games/match-speed/MatchSpeedBoard.tsx` (`selectedIdRef` / `setSelected`, `findCard`, `handleTap`) |
| Card sizing (2.4:1) | `src/games/match-speed/MatchSpeedBoard.tsx` (`gridElRef` / `cardHeight` measurement block); `constants.ts` (`CARD_ASPECT`, `ROW_GAP_PX`, `COL_GAP_PX`) |
| Registry, minute points | `src/games/registry.ts`; `src/constants.ts` |
| Win badge | `src/hooks/useGameWins.ts` |
| Pure-selection precedent | `src/games/bubble-match/spawnSelection.ts` |

Docs updated when this shipped:

- [GAMES_FEATURE.md](./GAMES_FEATURE.md) — ✅ game list (three shipped), registry
  example, and the `gameCategory` field on the `gamePool` response under § Backend.
- [MASTERY_REWORK.md](./MASTERY_REWORK.md) — ✅ Match Speed added to the
  which-type-each-surface table, plus a note that the bucket is now on the wire as
  `gameCategory`.
- [BENTO_SYSTEM.md](./BENTO_SYSTEM.md) — ✅ Match Speed's mode strip was
  later **removed**: it is a single `HubMenuRow` again, carrying the game-wide
  `×N` as its own corner badge. That doc's § Array items records why it is not a
  fan-out game.
