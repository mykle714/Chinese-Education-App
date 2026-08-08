# Speed Reading (`/games/speed-reading`)

> **STATUS: BUILT.** The game is registered in `GAME_REGISTRY` and playable. What
> remains is **tuning by eye**: the medal thresholds and the wrong-answer penalty
> are placeholders until someone plays it — see [§ What still needs tuning](#what-still-needs-tuning).

Fourth game. The player is shown a word's pinyin, definition, and audio, plus
**two word options**: the real word and a wrong one that differs by exactly one
character. Tap the real one, twenty times, as fast as you can.

Because both options are real characters of the same length, the player cannot get
there by shape alone — they have to actually **read**. Where Bubble Match tests
meaning-recall and Word Search tests scanning, this tests **reading speed**: how
fast a known word is recognised under a clock. It emits **reading** marks.

**The run is a RACE, not a timed sprint.** The player answers a fixed
`TARGET_ROUNDS` (20) rounds, the clock counts **up**, and the score is the
finishing time — **lower is better**. There is no time cap. This replaced the
original one-minute / count-the-correct-picks format; see
[§ Scoring and medals](#scoring-and-medals) for what a wrong answer costs.

There are **no difficulty levels**. One mode, one hub row.

> **History.** This game shipped as *Mandela*, with three levels: level 1 (a real
> different character, what survives here) plus levels 2 and 3, which corrupted
> the `hanzi-writer-data` stroke corpus offline to author *fake* glyphs — a
> component swapped, a stroke deleted. Those levels and their whole pipeline
> (`character_mutations` + `character_mutation_validations`, migration 133, the
> stroke taxonomy, the mutation generator, the backfill script, and the validator
> flagging surface) were **removed in full**. Nothing of them remains in the tree
> or the database; migration 133 was never deployed and was deleted rather than
> reverted. If you are looking for stroke-level glyph manipulation, it does not
> exist any more — see [HANDWRITING_RECOGNITION.md](./HANDWRITING_RECOGNITION.md)
> for what the stroke corpus is still used for.

---

## Table of contents

- [Scope: Chinese only](#scope-chinese-only)
- [Sideways (landscape) rendering](#sideways-landscape-rendering)
- [Screen layout](#screen-layout)
- [Round state machine](#round-state-machine)
- [Answer feedback: sound + float indicator](#answer-feedback-sound--float-indicator)
- [The one-character invariant](#the-one-character-invariant)
- [Choosing the wrong character](#choosing-the-wrong-character)
- [Rendering a glyph](#rendering-a-glyph)
- [Card selection: queue + top-up](#card-selection-queue--top-up)
- [`markType` on the game pool](#marktype-on-the-game-pool)
- [Marks](#marks)
- [Scoring and medals](#scoring-and-medals)
- [Page shell and chrome](#page-shell-and-chrome)
- [Files](#files)
- [What still needs tuning](#what-still-needs-tuning)
- [Dependencies (docs ↔ code)](#dependencies-docs--code)

---

## Scope: Chinese only

`GameDef.languages = ["zh"]` (`src/games/registry.ts`). A round is built by
substituting **one character** of the headword, which presupposes a
character-based script; "a different character" has no Spanish analogue that isn't
just "a different word", which would be a different game.

The hub **hides** a game whose `languages` exclude the learner's selection rather
than showing it and blocking on entry — a visible row that dead-ends reads as a
bug. This is the only game that declares `languages` today.

`SpeedReadingDAL.getLibraryDistractors` enforces the same rule server-side,
returning an empty pool for any non-`zh` caller rather than throwing: an empty pool
degrades to "skip the card", which is recoverable mid-game.

---

## Sideways (landscape) rendering

Speed Reading is the app's only **landscape** surface. It renders inside a
portrait app shell by rotating its own stage 90°.

### The rule: container shape, never device orientation

`useSidewaysStage` (`src/games/runtime/useSidewaysStage.ts`) asks the phone
nothing. It measures its own container and applies one rule:

| Container | Stage |
|---|---|
| taller than wide | rotated 90° |
| wider than tall | rendered straight |

**That is what makes device rotation a non-event**, and it is the whole reason
the hook exists. Both cases converge on an upright landscape game:

- **Rotation lock ON** — the phone turns, the browser does not. The container
  stays portrait, the stage stays rotated, and the player (who has physically
  turned the phone) sees an upright game.
- **Rotation lock OFF** — the phone turns and the browser turns with it. The
  container becomes wider than tall, the stage stops rotating, and the layout
  goes natural. Same result.

A rotation mid-run is therefore just a resize, handled by one `ResizeObserver`.

> **Why not `screen.orientation.lock()`?** It requires fullscreen, and iOS Safari
> does not support element fullscreen on iPhone at all. This app has no PWA
> manifest and no native wrapper, so there is **no way to force or forbid a
> rotation** — only to render correctly under either. Do not add an orientation
> API here expecting it to work on iOS.

It also means the desktop phone-card (`MobileDemoFrame`'s 393px surface) gets a
correctly rotated game for free: it is a tall container like any other, and no
orientation API would have reported anything useful about it.

### The transform, and why coordinates must go through the hook

Origin `top left`, so it composes predictably:

```
rotate(90deg):  (lx, ly) → (-ly, lx)   then translateX(W) → (W - ly, lx)
rotate(-90deg): (lx, ly) → (ly, -lx)   then translateY(H) → (ly, H - lx)
```

`ROTATION_DEG` (currently `90`) is the single place to flip which way the player
turns the phone. At `90` the game's top edge runs along the screen's **right**
edge.

> ⚠️ **`getBoundingClientRect()` on the rotated stage returns its AXIS-ALIGNED
> BOUNDING BOX in viewport space.** The usual `clientX - rect.left` is then wrong
> by a *rotation*, not by an offset. Anything positioned from a tap — today just
> the float indicator — must call `stage.toStageCoords(clientX, clientY)`, which
> applies the inverse using the **container's** rect (the container is never
> rotated, so its rect is a true rect).

### The header moves inside the stage

An upright header on a sideways game is unreadable, so `LeafPage` grew a
`hideHeader` prop and a **render-prop form of `children`** that hands back the
exit-aware back handler. The page then draws `LeafPageHeader` (title + clock)
itself, inside the rotated stage. The slide-in/out, the clone-on-exit and the
no-footer rule are untouched — see [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md).

**A `hideHeader` page MUST wire the render-prop `onBack` to its own back
control**, or there is no way off the page.

### Known rough edge

`MobileDemoFrame` switches to the centered 393px desktop card above the `md`
breakpoint (900px). A large phone in landscape (e.g. 926px wide) crosses that
line, so the game renders in a small centered card rather than full-bleed. It is
laid out correctly — the card is wider than tall, so the stage does not rotate —
just smaller than it should be. Fixing it means teaching `MobileDemoFrame` about
short viewports, which is a shell-wide change.

---

## Screen layout

```
┌─────────────────────────────┐
│ ⌄                7/20  0:14 │  header: back · progress · count-up clock
├─────────────────────────────┤
│                             │
│         nǐ  hǎo             │  pinyin (large)
│      "hello; hi"            │  display definition
│            🔊               │  SpeakerButton
│                             │
│   ┌─────────┐ ┌─────────┐   │
│   │   你好   │ │   你妤   │   │  options A and B, side by side
│   └─────────┘ └─────────┘   │  (they differ by one character)
│                             │
│                             │
└─────────────────────────────┘
```

**The header carries a round counter (`speed-reading__progress`) next to the
clock.** With the run ending on a count rather than on a countdown, the clock
alone no longer says how far along you are — a player could not tell round 3 from
round 19. The counter is secondary-coloured so the time stays the headline. The
clock itself turns red once `totalMs` passes the **bronze** threshold, i.e. once
the run can no longer medal; that is the count-up equivalent of the old "last ten
seconds" red.

The prompt and the options are **one centred group** (`speed-reading__stack`),
centred in the play area — **the two options are the only controls on the
screen** (see [§ There is no Skip](#there-is-no-skip)). The prompt sits directly
above the buttons rather than at the top of the screen: the player reads the prompt and then compares the
options in one motion, and the eye should not have to travel the height of the
page between them.

**Options sit side by side**, so the pair reads as a single comparison — which is
what the game asks for, since they differ by exactly one character.

> ⚠️ **This was originally the opposite, deliberately.** The options used to stack
> vertically on the grounds that side-by-side halves the width, and a
> one-character-different pair is harder to tell apart at ~165px than at ~350px —
> i.e. the layout is a **difficulty knob**, not just cosmetics. It was changed by
> request. If the game turns out to be too easy, this is the first thing to look
> at, before the medal thresholds.

**Both buttons are always exactly the same fixed height and width** — `flex: 1`
each, plus a shared glyph size. A difference in either would leak the answer.
`MIN_OPTION_HEIGHT_PX` floors the height so a 4-character word's small glyphs
can't collapse the button below a comfortable tap target.

### Glyph size is measured, not tabulated

`glyphSize` (`SpeedReadingPage.tsx`) is computed from the **measured width** of
the options row:

```
perButton = (rowWidth - OPTION_ROW_GAP_PX) / 2
drawable  = perButton - 2·OPTION_PADDING_X_PX - (charCount-1)·OPTION_CHAR_GAP_PX
glyphSize = clamp(MIN_GLYPH_PX, MAX_GLYPH_PX, floor(drawable / charCount))
```

It used to be a hardcoded ladder (`4 chars → 66px, 3 → 84, 2 → 108, 1 → 132`)
tuned for full-width stacked buttons. At half width that ladder **overflows** a
4-character word, which is why the row is measured instead.

The width comes from a `ResizeObserver` on `speed-reading__options`, not a
one-time read: a rotation or the iOS URL bar collapsing changes it mid-run, and a
stale width would either overflow the button or waste half of it. The geometry
constants live in `constants.ts` precisely because both the arithmetic here and
the CSS in `SpeedReadingOption.tsx` must read the same numbers.

---

## Round state machine

```
        load ──► ready ──tap──► feedback ──(FEEDBACK_MS)──► ready(next)

  20th round answered ──► ended ──Play Again──► load
  queue drained       ──► ended (unfinished: no time, no medal)
```

| Phase | Input | Notes |
|---|---|---|
| `loading` | blocked | Initial 20-card fetch + distractor fetch. **No card-count block** — the blocked screen is now only reachable when signed out or on a fetch failure (PROVISIONAL_CARDS.md). |
| `ready` | live | Both options and the speaker are tappable — there is no Skip. The word auto-narrates on entry — see § Auto-narration. |
| `feedback` | **blocked** | Frozen so a double-tap can't mark the next round. |
| `ended` | blocked | `GameEndPopup`. |

**The clock does not pause during `feedback`.** Feedback time is charged to the
player; that's what makes `FEEDBACK_MS` a real cost. Note that at a fixed 20
rounds it is now charged an exactly predictable **20 times a run** (3.6s of every
score at 180ms), where under the old one-minute format it merely reduced how many
rounds fit. Cutting it now moves every score.

**Ending is decided in `advance`, from `answeredRef`, not from the clock.** The
count is held in a ref as well as in state because `onPick` must know in the same
tick whether that answer was the 20th — reading it from state there would see the
previous render and let a 21st round start.

**Play Again resets in place; it does NOT navigate.** `navigate("/games/speed-reading")`
from the same route matches the same route, so React Router never unmounts the
page and no run state would clear. Instead `playAgain()` clears the state and
bumps a `runId` counter, which is a dependency of the queue hook's load effect and
so re-fetches a fresh card batch and distractor pool. (`runId` is a plain counter
by design — see the CLAUDE.md rule about never keying a load effect on `token`.)

### Constants

`src/games/speed-reading/constants.ts`.

| Constant | Value | Meaning |
|---|---|---|
| `GAME_KEY` | `"speedReading"` | `wins` table key |
| `WIN_LEVEL` | 1 | the game has no levels; `wins` is keyed (game, level) |
| `TARGET_ROUNDS` | 20 | answered rounds per run; the run ends on the 20th |
| `WRONG_PENALTY_MS` | 3_000 | added to the final time per wrong answer |
| `FEEDBACK_MS` | 180 | answer reveal before advancing (600 → 280 → 180 as the sound + float indicator took over the job) |
| `FLOAT_INDICATOR_MS` | 650 | lifetime of a plain floating ✓; deliberately longer than `FEEDBACK_MS` |
| `PENALTY_INDICATOR_MS` | 1_000 | lifetime of a float carrying the red **+3s** — a number has to be read, not glanced at |
| `INITIAL_BATCH` | 20 | cards fetched on load |
| `TOPUP_THRESHOLD` | 5 | queue length that triggers a top-up |
| `TOPUP_BATCH` | 5 | cards per top-up request |
| ~~`ENTRY_GATE_CARDS`~~ | — | **Removed.** The baseline lives in `CARD_BASELINES['speed-reading']` (`server/contracts/wire.ts`) and is topped up, not enforced. |
| `OPTION_ROW_GAP_PX` | 12 | gap between the two side-by-side buttons |
| `OPTION_PADDING_X_PX` | 8 | horizontal padding inside a button, per side |
| `OPTION_CHAR_GAP_PX` | 4 | gap between adjacent glyphs in a button |
| `MIN_GLYPH_PX` / `MAX_GLYPH_PX` | 30 / 120 | glyph size clamp |
| `MIN_OPTION_HEIGHT_PX` | 92 | button height floor (tap target) |

The last six are **option geometry**: they must match the `sx` values in
`SpeedReadingOption.tsx`, which imports them rather than restating them.

---

## Answer feedback: sound + float indicator

A pick fires **three** cues at once, then the round advances after
`FEEDBACK_MS` (180ms):

| Cue | Where it comes from | Why |
|---|---|---|
| **Sound** | `playCorrectSound()` / `playWrongSound()` in `src/games/runtime/gameSounds.ts` | Reaches the player fastest and needs no eye movement at all. |
| **Floating ✓ / ✗** | `SpeedReadingFloatIndicator.tsx`, positioned at the tap point | The eye is already at the tap point at the moment of the tap, so it is read without a saccade. |
| **Red `+3s`** (wrong only) | the same float, stacked under the ✗ | The penalty is arithmetic on the score, so it is otherwise INVISIBLE — see below. |
| **Button colour** | `SpeedReadingOption.tsx` (`OptionFeedback`) | Still the thing that TEACHES — on a wrong pick it shows both the red pick and the green right answer. |

The first two are why the reveal can be as short as it is: the outcome no longer
has to be learned by travelling to the button colours. The old 600ms was sized
for a colour-only reveal.

### `FEEDBACK_MS` is not the whole gap the player feels

Two other things used to sit between the tap and a readable next card. Both are
fixed; **check them before shortening `FEEDBACK_MS` again**, because they were
each larger than the constant itself.

**1. The next round's glyphs loaded on mount.** `GlyphSvg` fetches stroke data
per character — a dynamic import in dev, a **CDN round trip in production** — so
a round whose characters had never been seen rendered as *empty buttons* until
the data arrived, up to 8 characters' worth. Two fixes:

- `SpeedReadingPage` keeps a `pendingRoundRef`: the moment a round goes on
  screen, the round AFTER it is built and its glyphs are prefetched via
  `loadGlyph`. That cost now runs while the player is reading, so advancing is a
  single synchronous `setState`. It consumes one extra card off the queue (the
  top-up already covers it) and drops the last prepared round when the run
  ends.
- `GlyphSvg` reads `glyphCache` **during render**, not in its effect, so a
  cached glyph paints on the first frame. Going through the effect cost a paint
  with no strokes — a blank flash landing exactly at the round change.

**2. The option button's colour fade ran backwards too.** Its 140ms
`background-color` transition applied in both directions, so the previous
round's green/red was still draining out while the next word was already on
screen. The transition is now applied **only when entering** feedback
(`feedback === "none" ? "none" : ...`); the reset to neutral is instant.

### The sounds are synthesized, not audio files

`gameSounds.ts` builds both blips from WebAudio oscillators — no `.mp3` assets.
Two reasons: no binary files in the repo, and no fetch/decode, so the **first**
answer of a run is not the silent one.

- **Correct** — rising two-note chirp, E6 → A6, sine.
- **Wrong** — falling two-note buzz, A3 → E3, square. Lower and duller on
  purpose, so the two are told apart by ear alone.

Every tone has a 10ms attack and an exponential decay; a bare oscillator
start/stop clicks audibly at both ends.

**Autoplay policy.** One lazily-created shared `AudioContext`, constructed inside
the tap handler — which is a user gesture, the only context in which a browser
lets it produce sound. `resume()` is called on every play in case the OS
suspended it between rounds. If `AudioContext` is unavailable, the module latches
a flag and every call silently no-ops: sound is an enhancement, never a
requirement, and a failure must not break the round.

### Auto-narration

Every round speaks its word as it lands; the speaker button remains, for replays.

**Why autoplay here.** Under a running clock, a tap spent on the speaker is a
tap not spent answering — an opt-in speaker button means the audio channel is
effectively never used. Narrating on arrival makes the word's SOUND a third cue
alongside the pinyin and the definition, which is the point: the game is a
reading drill, and the reading includes the pronunciation.

**Where it lives** (`SpeedReadingPage.tsx`):

- **The effect** fires only in phase `ready` (never during `feedback`, never
  after `ended`) and is guarded on **round identity** via `spokenRoundRef`, not
  on a dep list. `useTTS()` returns a fresh object every render, so `speak`
  changes identity constantly and the effect re-runs constantly; the ref is what
  makes each round narrate exactly once.
- **No explicit cancel** on advance — `useTTS.speakText` cancels the in-flight
  utterance before starting the next one, so a fast answer simply cuts the
  previous word off.
- **Prefetch.** `prefetchRound(r)` (formerly `prefetchGlyphs`) warms BOTH the
  stroke corpus and `tts.prefetch(r.entry)` one round ahead, for the same reason
  glyphs are prefetched: an un-cached word costs a synthesis round-trip, and
  silence at the top of a round is time added to the score. Reached via a `ttsRef`
  so `tts`'s per-render identity doesn't churn `nextRound` → `advance` → `onPick`.
- **`tts.unlockAudio()`** runs in the run-start effect. The tap that opened the
  page happened on the previous screen, so no gesture is in flight when the
  queue resolves; without the unlock, mobile autoplay policy can leave the shared
  AudioContext suspended and swallow the first word.

Narration no-ops when the user has TTS disabled, and `prefetch` additionally
skips cards the server flagged `hasAudio === false`.

### The float indicator

`FloatIndicator = { x, y, kind, id }` where `kind` is `correct | wrong`.
The page reads `event.clientX/clientY` off the click and converts it through
`stage.toStageCoords` to get local coordinates. A CSS keyframe pops the glyph in
by 22% of its life, then drifts it to `-190%` while fading out.

| `kind` | Shows | Lifetime |
|---|---|---|
| `correct` | green ✓ | `FLOAT_INDICATOR_MS` (650ms) |
| `wrong` | red ✗ **+ `+3s`** | `PENALTY_INDICATOR_MS` (1000ms) |

**This float is the ONLY place the penalty is visible at the moment it is
charged.** ⚠️ The 3s is arithmetic on the final score — it is emphatically **NOT
a pause**. `FEEDBACK_MS` stays 180ms for every outcome and the round advances on
schedule whether or not the player was charged; the only thing the penalty
lengthens is how long this indicator lingers, and it finishes floating over the
next round. A cost the player cannot see is a cost they cannot learn from, hence
announcing it at the same place and instant as the ✗ rather than leaving them to
notice the clock jump.

Three more things worth knowing:

- **`id` is the React key.** Without it React would reuse the node and the CSS
  animation would not restart on a second tap at the same spot.
- **`pointerEvents: "none"`** — the indicator overlays the option buttons and
  must never swallow the next round's tap. It is also `aria-hidden`; the colour
  feedback already carries the meaning.
- **It outlives the round** (650/1000ms vs 180ms). The float keeps animating
  across the round change, so the feedback reads as continuous instead of being
  cut off mid-rise. Its removal timer — `indicatorLifetime(kind)`, the single
  source shared by the CSS duration and the unmount `setTimeout` — is cleared on
  unmount and on Play Again.

---

## The one-character invariant

**The two options differ in exactly one character position. Every other character
is identical.**

For 你好 the options are 你好 vs 你**妤** — never 你好 vs 明白. The wrong
character *replaces one character of the word*; it does not replace the whole word.

Why this is a correctness requirement, not a style choice:

- **Word length would otherwise leak the answer.** If the prompt's pinyin is two
  syllables and one option is a one-character word, the round is over before the
  player has read anything.
- **It makes the pinyin meaningful.** The player must map the pinyin onto a
  specific character position, which is exactly the reading skill being tested.

For one-character words (the majority of early-library cards) this collapses to
"the whole option is the wrong character", which is the same thing.

Enforced in `src/games/speed-reading/buildRound.ts`; pinned by
`src/__tests__/speedReadingBuildRound.test.ts`.

---

## Choosing the wrong character

No authoring, no table, no backfill. The wrong character is a **real character the
player already has in their library**.

### Selection query

`SpeedReadingDAL.getLibraryDistractors` builds the pool once at game load:

1. Take the player's Learn Now (`library`) cards for `zh`.
2. Explode them into their constituent characters (CJK only), and dedupe.
3. Annotate each with its **`difficultyBand`** and whether its **reading** track is
   mastered.

`difficultyBand` is `MAX(dictionaryentries_zh.difficulty)` over the character's
**standalone** det row.

> **The column is `dictionaryentries_zh.difficulty`, not `hskLevel`.** No
> `hskLevel` column exists — migration 79/92 renamed the band to `difficulty` when
> it was generalized across languages. It still holds 1–6 and it still *is* the
> HSK level for zh, so the intent is unchanged, but the query and the wire field
> are named `difficultyBand` to match the data. `NULL` for a character with no
> standalone det row (it only ever appears inside multi-character words), which
> the ladder treats as "no preference possible".

A character counts as reading-mastered only if **every** library word containing it
is (`bool_and`) — seeing it inside a still-weak word means the player has not
actually retired it.

### Fallback ladder

Implemented in `buildRound.ts`. Per round: pick a character position in the prompt
word, then draw a distractor that is **not** any character of the prompt word
(otherwise the "wrong" option could be a real rearrangement, or the same word).
Then drop constraints in this order until a candidate exists — they are
preferences, not hard filters:

1. same `difficultyBand` as the character being replaced, not reading-mastered
2. **any** `difficultyBand`, not reading-mastered
3. any library character at all (reading-mastered included)
4. no candidate → **skip this card**, pull the next from the queue, count it toward
   the top-up trigger

Only step 4 is a real failure, and it can only happen for a library so small that
the 20-card entry gate has already blocked entry. Note that mastery outranks the
band preference: rung 2 is reached before a same-band *mastered* character is
considered — a character whose reading the player has mastered makes a weak
distractor, because they reject it instantly.

> **The ladder runs CLIENT-side, and reading-mastered characters are returned
> FLAGGED rather than filtered out.** The server cannot execute rung 3, because
> only the client knows the prompt word currently on screen and therefore whether
> the earlier rungs produced anything. An earlier cut of the DAL dropped mastered
> characters server-side and returned only a count, which made rung 3 unreachable.

### Endpoint

```
GET /api/games/speedReading/distractors
  → { chars: [{ char: "妤", difficultyBand: 4, readingMastered: false }, ...],
      masteredReadingExcluded: 3 }
```

Authenticated, language-scoped, derived from the player's library — one request at
game load, no top-ups (the pool doesn't shrink).

Registered in `server/routes/speedReadingRoutes.ts`, **before** `gamesRoutes` in
`server.ts`: those routes are parameterized on `/api/games/:gameId/...`, and
ordering the specific namespace first keeps a future `:gameId` route from silently
shadowing this one.

**Why its own controller and not `GamesController`:** that controller is
deliberately game-agnostic — one controller for all games, each request scoped by
`:gameId` — and serves only framework-level assets/progress endpoints. This
endpoint is specific to one game's data model.

---

## Rendering a glyph

`src/components/handwriting/GlyphSvg.tsx` — a ~40-line static SVG renderer that
reads the same `hanzi-writer-data` corpus as the writing drill.

**Why not reuse `HanziGuide`:** that wraps a real Hanzi Writer instance —
animation, quiz state, and a DOM node it tears down and recreates whenever the
character changes. These options are static, need no animation, and there are two
on screen covering up to 8 characters at a time.

**Coordinate system.** Corpus glyphs live in a **y-UP** box of x ∈ [0, 1024],
y ∈ [−124, 900] (hanzi-writer's `CHARACTER_BOUNDS`). The wrapping
`<g transform="translate(0,900) scale(1,-1)">` is exactly `y_svg = 900 − y_font`.

**Caching.** A process-lifetime `Map` of parsed glyph files plus an in-flight
promise map, both module-level and shared across every instance: a run re-renders
the same handful of characters many times over a run, and without this each
remount would pay a dynamic-import round trip and flash empty.

### ⚠️ The CDN fallback is the PRODUCTION path, not a rare-miss path

`import('hanzi-writer-data/<char>.json')` is a **bare module specifier with a
dynamic segment**. Rollup cannot statically analyze it, so it survives the build
as a literal runtime `import()` of a bare specifier — something a browser cannot
resolve without an import map. It works in `vite dev` (which rewrites bare
specifiers) and **throws in every production build**.

`loadCharData.ts` has always carried this fallback, which is why the writing
drill's grey guide works in production. `GlyphSvg` needs it for the same reason:
without it, Speed Reading renders **blank buttons in prod while looking perfect in
dev**. Do not delete either fallback as dead code — verify against `dist/`, not
against a dev session.

`GlyphSvg`'s fallback is **pinned** to `hanzi-writer-data@2.0.1`, matching
package.json.

---

## Card selection: queue + top-up

A flat FIFO **queue** (`useSpeedReadingQueue.ts`). The game shows one word at a
time and has no board to balance, so per-category client buffering (Match Speed's
model) would buy nothing.

| Event | Action |
|---|---|
| Game load | `GET /api/onDeck/gamePool?markType=reading&Unfamiliar=2&Target=10&Comfortable=6&Mastered=2` (20 cards) |
| Queue length < `TOPUP_THRESHOLD` (5) | `GET …&markType=reading&need=5&exclude=<every id in queue>` |

Top-ups are **fire-and-forget with a `.catch()`**, triggered on dequeue, never
awaited in the tap handler. A failed top-up degrades to a shorter run, never a
stall — if the queue empties, the run ends UNFINISHED: the popup reports how far
the player got and records no time and no medal (see § Scoring and medals).

`exclude` carries every id still queued. As with Match Speed, this is **not** a
repeat gate — repeats are prevented by the server's per-type reading cooldown — it
exists solely so a top-up can't return a word already waiting in the queue.

**The queue lives in a ref, mirrored to state.** `dequeue()` is called from a tap
handler and must return the next card synchronously, in the same tick the round is
built. Reading it out of a `setQueue` updater would be both async and unsafe —
React may invoke an updater twice in StrictMode, consuming two cards per tap.

**Unplayable cards** (no CJK characters, or an exhausted distractor ladder) are
**dropped at dequeue**, and the drop counts toward the top-up trigger. The retry
loop is bounded (40 attempts) so a queue of unplayable cards cannot spin forever.

**Entry gate: REMOVED.** Speed Reading no longer blocks on card count. The opening
pool request carries `surface=speed-reading`, so the server lends the player enough
temporary cards to reach `CARD_BASELINES['speed-reading']` first; `sufficient === false`
is not a block, only a signal that the dictionary ran dry, and a shorter queue still
plays. Speed Reading plays a fixed known set, so its notice **names** the lent words.
See [PROVISIONAL_CARDS.md](./PROVISIONAL_CARDS.md).

Note the mid-run top-up (`opts` set) deliberately omits `surface`: a refill must not
keep lending cards.

---

## `markType` on the game pool

`getGamePool` used to **hardcode** `'recognition'` when calling
`getGameVocabPool`, back when Bubble Match was its only caller. This game emits
**reading** marks, so pooling through it unchanged would gate on the wrong
cooldown track and bucket by the wrong per-type category — a card just read
correctly here would come straight back, while a card weak in reading would be
treated as strong because recognition of it is good.

The endpoint now accepts `?markType=` (`server/controllers/OnDeckVocabController.ts`),
validated against `MARK_TYPES` with `'recognition'` as a safety net only.
**Bubble Match's call site passes `markType=recognition` explicitly**, so no caller
depends on the default and the endpoint reads as parameterized rather than
recognition-with-an-escape-hatch. This is the same parameterization Word Search
does via `?mode=`.

---

## Marks

`POST /api/flashcards/mark` with `{ cardId, isCorrect, type: "reading" }`.

| Event | Mark |
|---|---|
| Correct option tapped | `isCorrect: true` |
| Wrong option tapped | `isCorrect: false` |
| Any tap after the run ends | **none** |

Fire-and-forget with a `.catch()`; the game never blocks on a mark.

This is the app's first emitter of **negative reading marks** (Word Search is
positive-only in both modes). **This is intended.** A player who taps randomly
scores ~50% and earns negative marks at that rate — the marks are an honest record
of the answers given, and a player who guesses genuinely does not know the reading.
No accuracy floor, no mark suppression, no special-casing.

With Skip removed there is **no unmarked path through a round**: every round the
player is shown produces exactly one mark.

---

## Scoring and medals

**Score = the time to answer 20 rounds, plus penalties. Lower is better.**

```
totalMs = (Date.now() − startAt)  +  WRONG_PENALTY_MS × (wrong answers)
```

| Event | Counts toward the 20? | Time cost |
|---|---|---|
| Correct pick | yes | the time it took |
| Wrong pick | **yes** | the time it took **+ 3s** |

Those are the only two outcomes — every round must be answered. Each charge is
announced on the spot by a red **+3s** floating from the tap — see
[§ The float indicator](#the-float-indicator). The penalty never pauses the game;
`FEEDBACK_MS` is 180ms whether the answer was right or wrong.

**Why a wrong answer still counts as a round.** Under a count-up clock a blind tap
is the *fastest possible round* — no reading required — so the format has to price
accuracy explicitly rather than structurally. Replaying missed words instead was
the alternative; charging seconds keeps every run exactly 20 rounds long, which is
what makes two runs comparable. A coin-flip run takes ~10 misses, i.e. **+30s**,
which lands outside every medal.

### There is no Skip

**Removed with the race format.** Under the one-minute clock, Skip was a real
choice: ducking a word you couldn't read cost you the seconds spent deciding to
duck it, and bought you a shot at an easier word inside the same minute. In a
race that logic inverts. Skipping would be the *cheapest* way past a hard word —
a free reroll — and the obvious fix, pricing it at the same 3s, only makes it a
**strictly worse version of guessing**: a guess pays the same and might be right.

A control the player should never rationally use is noise on the screen, so it is
gone rather than penalized. The knock-on effects are all simplifications: the
counter advances on every round shown, `FloatKind` lost its third case, and the
Marks table lost its one unmarked path.

| Medal | Threshold (total time, ≤) |
|---|---|
| 🥇 Gold | 45s |
| 🥈 Silver | 60s |
| 🥉 Bronze | 90s |

Gold at 45s is 2.25s/round, roughly the pace the old format's gold demanded (24
correct in 60s). Note `medalFor` compares with **`<=`**, inverted from every other
game's score thresholds — the metric is time.

⚠️ **All three are still placeholders** and want re-tuning from real play at this
format.

**A medal requires a FINISHED run.** `medalFor` is a pure time→medal mapping and
does not know the round count, so `SpeedReadingPage` gates it on
`answered >= TARGET_ROUNDS`. Without that gate a run cut short by a drained queue
(three rounds in 8 seconds) would take gold. The unfinished end popup shows no
time at all.

A medal — any medal — records one win via `useGameWins(GAME_KEY).recordWin(WIN_LEVEL)`,
guarded by a ref so it fires once per run. The hub shows the lifetime `×N`.

---

## Page shell and chrome

- **Leaf page.** `LeafPage` — down arrow → `/games`, no footer, slides up on enter.
- **Hub entry:** a plain `HubMenuRow`, from the generic branch of `GamesPage.tsx`.
  No special-case, because there are no levels to fan out into a strip.
- **No per-page `IPhoneFrame`** — the frame comes from `MobileDemoFrame` via
  `Layout.tsx`, automatic once the route is in `GAME_ROUTES`.
- **`useBlockEdgeSwipe(true)`** — mandatory for every game page
  ([UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md)).
- **`touchAction: "none"`** on the whole surface; nothing here scrolls.
- **Minute points:** `/games/speed-reading` is in `MINUTE_POINTS_ELIGIBLE_PAGES`
  (`src/constants.ts`). The `/games` prefix already covers it in
  `MINUTE_POINTS_AUTO_ACTIVE_PAGES`, which is right — the player reads the prompt
  before their first tap.
- **Definitions:** the prompt's definition **must** resolve through
  `resolveDisplayDefinition(entry)` (`src/utils/definitionUtils.ts`) — `gamePool`
  ships `definitionClusters` + `selectedSense`, so resolve client-side as Bubble
  Match does. See `GAMES_FEATURE.md` § Sense correctness.
- **Audio:** `useTTS().speakSentence(entry.entryKey, entry.pronunciation)` behind
  the shared `SpeakerButton`, with `isLoading={tts.speakingKey === entry.entryKey}`.
  **Autoplays every round** — see § Auto-narration.
- **End popup:** `GameEndPopup` with `classPrefix="speed-reading"`.

---

## Files

**Client** — `src/games/speed-reading/`

| File | Role |
|---|---|
| `SpeedReadingPage.tsx` | phase machine, clock, marks, scoring, run reset |
| `SpeedReadingPrompt.tsx` | pinyin + definition + speaker |
| `SpeedReadingOption.tsx` | one tappable word button (hands the click event up for the tap coordinates) |
| `SpeedReadingFloatIndicator.tsx` | the ✓/✗ (and the red +3s) that floats up from the tap point |
| `buildRound.ts` | the one-character invariant + the fallback ladder (pure) |
| `useSpeedReadingQueue.ts` | card queue, distractor pool, top-up |
| `constants.ts` | run constants, medal thresholds |
| `types.ts` | `Phase`, `RoundOption`, `Round` |

**Client, shared**

| File | Role |
|---|---|
| `src/games/runtime/gameSounds.ts` | synthesized correct/wrong blips (WebAudio, no assets) |
| `src/games/runtime/useSidewaysStage.ts` | container-shape-driven 90° rotation + tap-coordinate inverse |
| `src/components/LeafPage.tsx` | `hideHeader` + render-prop children (added for this game) |
| `src/components/LeafPageHeader.tsx` | rendered by the page itself, inside the stage |
| `src/components/handwriting/GlyphSvg.tsx` | static glyph renderer + corpus loader |
| `src/games/registry.ts` | `GameDef` entry (route, colour, `languages`) |
| `src/games/GamesPage.tsx` | renders it via the generic `HubMenuRow` branch |
| `src/constants.ts` | `MINUTE_POINTS_ELIGIBLE_PAGES` |

**Server**

| File | Role |
|---|---|
| `server/routes/speedReadingRoutes.ts` | one route |
| `server/controllers/SpeedReadingController.ts` | request shape only |
| `server/services/SpeedReadingService.ts` | policy |
| `server/dal/interfaces/ISpeedReadingDAL.ts` | one method |
| `server/dal/implementations/SpeedReadingDAL.ts` | the library→characters query |
| `server/contracts/wire.ts` | `DistractorChar` |
| `server/dal/setup.ts` | DI wiring |
| `server/controllers/OnDeckVocabController.ts` | `?markType=` |

**Tests** — `src/__tests__/speedReadingBuildRound.test.ts` (16 tests).

**The game owns no tables and no migrations.**

---

## What still needs tuning

| Constant | Current | How to tune |
|---|---|---|
| `MEDAL_THRESHOLDS` | 45s / 60s / 90s | Play a few runs. Derived from ~2.25s/round, carried over from the old format's gold pace rather than measured at this one. |
| `WRONG_PENALTY_MS` | 3_000 | ~2 rounds of good play. Raise it if guessing through the 20 still medals; lower it if a single slip feels run-ending. |
| `TARGET_ROUNDS` | 20 | Long enough that one lucky guess doesn't decide the run, short enough to replay. Changing it invalidates the medal thresholds. |
| `FEEDBACK_MS` | 180 | Long enough to see the answer, short enough not to feel like a tax. Cut from 600 once sound + the float indicator carried the outcome. |
| `FLOAT_INDICATOR_MS` | 650 | Long enough to complete the rise, short enough not to overlap two rounds' worth of indicators. |
| `PENALTY_INDICATOR_MS` | 1_000 | Long enough to READ `+3s`, not just glimpse it. Raise it if play-testing shows the penalty going unnoticed. |

---

## Dependencies (docs ↔ code)

| This doc's section | Code it describes |
|---|---|
| Scope: Chinese only | `src/games/registry.ts` (`languages`), `src/games/types.ts`, `SpeedReadingDAL.getLibraryDistractors` |
| Sideways rendering | `src/games/runtime/useSidewaysStage.ts`, `SpeedReadingPage.tsx` (`stage`, `speed-reading__frame`), `src/components/LeafPage.tsx` (`hideHeader`) |
| Screen layout, Page shell | `SpeedReadingPage.tsx` (`speed-reading__stack`, `glyphSize`, the `ResizeObserver`), `SpeedReadingOption.tsx`, `SpeedReadingPrompt.tsx`, `constants.ts` (option geometry) |
| Round state machine | `SpeedReadingPage.tsx` (`Phase`, `playAgain`), `useSpeedReadingQueue.ts` (`runId`) |
| Answer feedback: sound + float indicator | `src/games/runtime/gameSounds.ts`, `SpeedReadingFloatIndicator.tsx`, `SpeedReadingPage.tsx` (`onPick`, `spawnFloatIndicator`), `SpeedReadingOption.tsx` (`onPick` event), `constants.ts` (`FEEDBACK_MS`, `FLOAT_INDICATOR_MS`, `PENALTY_INDICATOR_MS`, `indicatorLifetime`) |
| One-character invariant, ladder | `buildRound.ts`, `src/__tests__/speedReadingBuildRound.test.ts` |
| Selection query, Endpoint | `SpeedReadingDAL.ts`, `SpeedReadingService.ts`, `SpeedReadingController.ts`, `speedReadingRoutes.ts` |
| Rendering a glyph | `src/components/handwriting/GlyphSvg.tsx`; see also [HANDWRITING_RECOGNITION.md](./HANDWRITING_RECOGNITION.md) |
| Queue + top-up | `useSpeedReadingQueue.ts`, `OnDeckVocabController.getGamePool` |
| `markType` | `server/controllers/OnDeckVocabController.ts`; [MASTERY_REWORK.md](./MASTERY_REWORK.md) |
| Marks | `src/api/flashcards.ts`, [MASTERY_REWORK.md](./MASTERY_REWORK.md) |
| Scoring and medals | `constants.ts` (`TARGET_ROUNDS`, `WRONG_PENALTY_MS`, `MEDAL_THRESHOLDS`, `medalFor`, `formatClock`), `SpeedReadingPage.tsx` (`totalMs`, `finished`, `endRun`, `addPenalty`), `src/hooks/useGameWins.ts` |

Referenced by: [GAMES_FEATURE.md](./GAMES_FEATURE.md),
[MASTERY_REWORK.md](./MASTERY_REWORK.md),
[HANDWRITING_RECOGNITION.md](./HANDWRITING_RECOGNITION.md).
