# Speed Reading (flp break only)

> **STATUS: BUILT.** The game is registered in `GAME_REGISTRY` and playable. What
> remains is **tuning by eye**: the speed and accuracy tier cutoffs
> are placeholders until someone plays it — see [§ What still needs tuning](#what-still-needs-tuning).

Fourth game. The player is shown a word's pinyin, definition, and audio, plus
**two word options**: the real word and a wrong one that differs by exactly one
character. Tap the real one, twenty times, as fast as you can.

**The last round is a sentence.** For round 20 the two options are the same
**example sentence**, differing at one character *inside* the target word, and the
prompt switches to that sentence's pinyin, translation and audio — so the run ends
on reading in context. See
[§ The last round is a sentence](#the-last-round-is-a-sentence).

Because both options are real characters of the same length, the player cannot get
there by shape alone — they have to actually **read**. Where Bubble Match tests
meaning-recall and Word Search tests scanning, this tests **reading speed**: how
fast a known word is recognised under a clock. It emits **reading** marks.

**The run is a RACE, not a timed sprint.** The player answers a fixed
`TARGET_ROUNDS` (20) rounds, the clock counts **up**, and the score is the
finishing time — **lower is better**. There is no time cap. This replaced the
original one-minute / count-the-correct-picks format; see
[§ Scoring and tiers](#scoring-and-tiers) for what a wrong answer costs.

There are **no difficulty levels**. One mode.

**It is BREAK-ONLY**: the registry entry has no `route` / `Component`
(`src/games/registry.ts`, `GameDef` in `src/games/types.ts`), so there is no hub tile and
no standalone page. It is played only as an flp game break on the reading flp (zh) inside
the Deck Tower's study session: `SpeedReadingStage` runs under the break host, and the
break's card and results card turn sideways with it. See
[§ As an flp game break](#as-an-flp-game-break).

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
- [Answer feedback: half tint](#answer-feedback-half-tint)
- [The one-character invariant](#the-one-character-invariant)
- [The last round is a sentence](#the-last-round-is-a-sentence)
- [Choosing the wrong character](#choosing-the-wrong-character)
- [Rendering a glyph](#rendering-a-glyph) (historical)
- [Card selection: queue + top-up](#card-selection-queue--top-up)
- [`markType` on the game pool](#marktype-on-the-game-pool)
- [Marks](#marks)
- [Scoring and tiers](#scoring-and-tiers)
- [Shell and chrome](#shell-and-chrome)
- [As an flp game break](#as-an-flp-game-break)
- [Files](#files)
- [What still needs tuning](#what-still-needs-tuning)
- [Dependencies (docs ↔ code)](#dependencies-docs--code)

---

## Scope: Chinese only

`GameDef.languages = ["zh"]` (`src/games/registry.ts`). A round is built by
substituting **one character** of the headword, which presupposes a
character-based script; "a different character" has no Spanish analogue that isn't
just "a different word", which would be a different game.

`isGameAvailable` hides a game whose `languages` exclude the learner's selection, so the
flp break picker (`flpBreakCandidates`) never offers it to a non-zh learner.

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

It also means the desktop phone-card (`MobileDemoFrame`'s 402px surface) gets a
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
> anything positioned from a tap — must call `stage.toStageCoords(clientX,
> clientY)`, which applies the inverse using the **container's** rect (the
> container is never rotated, so its rect is a true rect). Nothing calls it today
> (the float indicator that did has been removed); the hook keeps it because the
> trap is real for anything tap-positioned added later.

### Leave moves inside the stage

An upright control on a sideways game is unreadable, so the break's header row turns with
the game: `GameBreakChrome` (the break area's row: Leave, title, audio chip, flame) wraps
itself in its own `useSidewaysStage` when the adapter is `sideways`, so Leave sits at the
game's top-left from the first frame of the grow (docs/FLP_GAME_BREAKS.md § 6).

### Known rough edge

`MobileDemoFrame` switches to the centered 402px desktop card above the `md`
breakpoint (900px). A large phone in landscape (e.g. 926px wide) crosses that
line, so the game renders in a small centered card rather than full-bleed. It is
laid out correctly — the card is wider than tall, so the stage does not rotate —
just smaller than it should be. Fixing it means teaching `MobileDemoFrame` about
short viewports, which is a shell-wide change.

---

## Screen layout

```
┌─────────────────────────────┐
│ ←  Speed Reading            │  GameFrame: Leave · title (no clock, no HUD)
├─────────────────────────────┤
│                             │  ← .speed-reading__board starts HERE
│         nǐ  hǎo             │  pinyin (large)
│      "hello; hi"            │  display definition
│            🔊               │  SpeakerButton
│                             │
│        你好  │  你妤        │  options A and B, side by side
│              │              │  (they differ by one character)
│   LEFT ZONE  │  RIGHT ZONE  │  the whole half is the tap target
│                             │
└─────────────────────────────┘
```

**Nothing about the run's progress is drawn** (changed 2026-11-04). There is no clock
(Match Speed, Word Search and Writing Grid show none either), no `Round n of 20` label and
no round-tick strip: the board is the prompt and the two halves, nothing else. The run is
still timed exactly as before (pauses, `endRun`); the finishing time, the accuracy and the
speed / accuracy tiers appear only on the break's results card.

> **History.** The panel used to open with a `GameHud` COLUMN: `Round n of 20` over
> `SpeedReadingRoundTicks`, one 8px pip per round (green right, red wrong, wood pending).
> The pips existed because a time score hides how the run is going — a slow clean run and
> a fast sloppy one read the same. Both were removed by request on 2026-11-04, together
> with the `results: RoundTick[]` state and the component file, and the red "past bronze"
> clock pill and the 200ms display interval went with the clock. `elapsedMs` is now written
> only when a pause ends and when the run ends. If a live read-out comes back, the miss is
> what it most needs to show (see § ~~The float indicator~~).

**In a break** the panel starts with a spacer the height of Leave's row
(`GAME_FRAME_EXIT_CLEARANCE_PX`, `SpeedReadingStage` → `exitClearance`), as Match Speed's
does, so the arrow and the title never sit over the prompt or a tap zone. On the page the
header above the panel already clears it.

> ⚠️ **The clearance is a SIBLING of `.speed-reading__board`, not a child.** The tap zones
> are `position: absolute; inset: 0` of their container, so anything sharing that container
> is UNDER them and every tap on it answers the round.

> **Two options is final; artboard 15's four is superseded (2026-08-24).** The Shelf
> Redesign's artboard for this game draws an upright 2×2 grid of FOUR options with an
> in-panel countdown. It is not being built. Going from two options to four is a
> difficulty change, not a layout change — it alters both the guess baseline and the time
> a round takes — and the game reads well on two. The shipped rotated two-half tap surface
> is the design of record; see `docs/SHELF_REDESIGN.md` § 15.

The prompt and the options are **one centred group** (`speed-reading__stack`),
centred in the play area — **the two options are the only controls on the
screen** (see [§ There is no Skip](#there-is-no-skip)). The prompt sits directly
above the buttons rather than at the top of the screen: the player reads the prompt and then compares the
options in one motion, and the eye should not have to travel the height of the
page between them.

**Options sit side by side**, so the pair reads as a single comparison — which is
what the game asks for, since they differ by exactly one character. The finale's
**sentence** rounds keep the same two halves and the same side-by-side pair; only
the cpcd size drops (see [§ The last round is a
sentence](#the-last-round-is-a-sentence)).

> ⚠️ **This was originally the opposite, deliberately.** The options used to stack
> vertically on the grounds that side-by-side halves the width, and a
> one-character-different pair is harder to tell apart at ~165px than at ~350px —
> i.e. the layout is a **difficulty knob**, not just cosmetics. It was changed by
> request. If the game turns out to be too easy, this is the first thing to look
> at, before the speed tier cutoffs.

### Tap your side of the screen

**The controls are the two HALVES of the play area, not the words.** The whole
left half picks option A, the whole right half picks option B. Under a clock
that is the entire ergonomic story: the target is half the play area rather
than a ~165px card, so the player answers with the thumb where it already rests
and never has to aim.

The play area is two layers:

| Layer | Element | Pointer events |
|---|---|---|
| back | `speed-reading__zones` — two `SpeedReadingTapZone`s, `position: absolute; inset: 0` | **the only tap targets** |
| front | `speed-reading__stack` — prompt + the two words | `pointer-events: none` |

> ⚠️ **The front layer is `pointer-events: none` in full**, which is what lets a
> tap anywhere on a half reach its zone regardless of what is drawn on top.
> Anything added to that layer that must be tappable has to re-enable pointer
> events for itself. Exactly one thing does today: the prompt's speaker button
> (`speed-reading__prompt-speaker`). Forget this and a new control looks live
> and silently does nothing.

**There is no line down the middle** (the `ZONE_DIVIDER` hairline was removed
2026-11-04). Each word sits centred on its half, which is what tells the two targets
apart before either has been tapped.

**The tint is the answer feedback.** The tapped half fills green when it was
correct and red when it was wrong, for `FEEDBACK_MS` — `ZONE_TINT_CORRECT` /
`ZONE_TINT_WRONG` — since v2 the green / red **MID tier** (`COLORS.grnM` / `redM`,
artboard 15 "Mid: picked word"; the tapped half is this app's picked word), the same
tokens the round ticks use. With the float indicator gone the tint is the only visual
cue, and only one half ever lights. As with the old buttons the
transition runs **into** feedback only; fading back to neutral would leave the
previous round's colour draining out while the next word is already up, which
reads as lag. **Only the TAPPED half is ever painted** — a wrong pick does not
light the correct side green (see
[§ Only the tapped half is painted](#only-the-tapped-half-is-painted)).

**Both halves are always the same box** — `flex: 1` each — and the words row
carries **no gap**, so each word sits centred on the zone behind it. A
difference in either would leak the answer.

> **History.** The options used to be rounded `ButtonBase` cards that both
> carried the word and took the tap, and the cards flashed the green/red. The
> card chrome went with the tap target: the words are bare now and the half
> paints the feedback.

### The option text is cpcd — `xl` for words, `sm` for sentences

The option is rendered by **`ForeignText`** (row layout → `CPCDRow`),
the app's public foreign-text container, at `OPTION_GLYPH_SIZE = "xl"` — the top
of the cpcd size ladder (~51px glyphs). The player reads the options in exactly
the typeface and scale the rest of the app uses.

A **sentence** round drops to `OPTION_SENTENCE_GLYPH_SIZE = "sm"` (32px columns,
~10 characters per line in a half). At `xl` a sentence would wrap to five or six
lines per half and the pair would stop being scannable side by side. **Both
halves of a round always get the same size** (`SpeedReadingStage` passes one value
to both) — a per-option size would leak the answer through layout.

`showPinyin` is **false** and must stay false: the prompt already shows the
pinyin, so a pinyin overlay on the options would name the answer without any
reading at all. `useToneColor` is off for the same reason of keeping the options
plain — the glyphs are the whole test.

**Fixed, not fitted.** Each word gets about half the screen (~165px on a 390px
phone) while a 4-character `xl` row wants ~290px. Rather than scale the glyphs
down, the cpcd row **wraps** (`flexWrap="wrap"`), so a long word becomes two
full-size lines. Legibility is the point of the
game, so size is the thing that must not give. Both options are the same length
(the one-character invariant), so they wrap identically and neither side hints
at the answer. The inner wrapper sets `width: 100%` / `min-width: 0` on the cpcd row
— without it the flex default `min-width: auto` refuses to shrink and the row
never wraps.

> **History.** The options used to be per-character `GlyphSvg` (stroke-corpus
> SVG) at a size **measured** off the options row via a `ResizeObserver`, with
> `MIN_GLYPH_PX`/`MAX_GLYPH_PX` clamps and an `OPTION_CHAR_GAP_PX` term in the
> arithmetic. All of that is gone: the size is a constant, the observer is
> removed, and `SpeedReadingStage` no longer prefetches the stroke corpus a round
> ahead (it still prefetches the round's **audio**). `GlyphSvg` itself is
> untouched but now has **no remaining call site**.

---

## Round state machine

```
        load ──► ready ──tap──► feedback ──(FEEDBACK_MS)──► ready(next)

  20th round answered ──► ended ──► results card (onRunEnded)
  queue drained       ──► ended (unfinished: no time, no tiers)
```

| Phase | Input | Notes |
|---|---|---|
| `loading` | blocked | Initial 20-card fetch + distractor fetch. **No card-count block** — the blocked screen is now only reachable when signed out or on a fetch failure (PROVISIONAL_CARDS.md). |
| `ready` | live | Both options and the speaker are tappable — there is no Skip. The word auto-narrates on entry — see § Auto-narration. |
| `feedback` | **blocked** | Frozen so a double-tap can't mark the next round. |
| `ended` | blocked | Results handed to the flp's card (`onRunEnded`); no end popup. |

**The clock does not pause during `feedback`.** Feedback time is charged to the
player; that's what makes `FEEDBACK_MS` a real cost. Note that at a fixed 20
rounds it is now charged an exactly predictable **20 times a run** (3.6s of every
score at 180ms), where under the old one-minute format it merely reduced how many
rounds fit. Cutting it now moves every score.

**Ending is decided in `advance`, from `answeredRef`, not from the clock.** The
count is held in a ref as well as in state because `onPick` must know in the same
tick whether that answer was the 20th — reading it from state there would see the
previous render and let a 21st round start.

**One run per mount.** There is no Play Again: a break is one run, and the next break
mounts a fresh Stage.

### Constants

`src/games/speed-reading/constants.ts`.

| Constant | Value | Meaning |
|---|---|---|
| `GAME_KEY` | `"speedReading"` | `wins` table key |
| `WIN_LEVEL` | 1 | the game has no levels; `wins` is keyed (game, level) |
| `TARGET_ROUNDS` | 20 | answered rounds per run; the run ends on the 20th |
| ~~`WRONG_PENALTY_MS`~~ | — | **Removed** 2026-11-10: a wrong answer costs no time; it lowers the accuracy tier |
| `SPEED_TIERS` | 35/45/55/65/80/100 s | speed tier cutoffs (raw time for 20 rounds), placeholders |
| `ACCURACY_TIERS` | 100/95/90/80/70/60 % | accuracy tier cutoffs (correct / 20), placeholders |
| `FEEDBACK_MS` | 180 | answer reveal before advancing (600 → 280 → 180 as the sound took over the job) |
| ~~`FLOAT_INDICATOR_MS`~~, ~~`PENALTY_INDICATOR_MS`~~, ~~`indicatorLifetime()`~~ | — | **Removed** with the float indicator |
| `INITIAL_BATCH` | 20 | cards fetched on load |
| `TOPUP_THRESHOLD` | 5 | queue length that triggers a top-up |
| `TOPUP_BATCH` | 5 | cards per top-up request |
| ~~`ENTRY_GATE_CARDS`~~ | — | **Removed.** The baseline lives in `CARD_BASELINES['speed-reading']` (`server/contracts/wire.ts`) and is topped up, not enforced. |
| `OPTION_GLYPH_SIZE` | `"xl"` | cpcd size the option word renders at; wraps rather than shrinking |
| `OPTION_WORD_PADDING_X_PX` | 12 | breathing room around one word, per side |
| `ZONE_TINT_CORRECT` / `ZONE_TINT_WRONG` | `COLORS.grnM` / `COLORS.redM` | fill of a half during feedback |
| ~~`OPTION_ROW_GAP_PX`~~, ~~`OPTION_PADDING_X_PX`~~, ~~`MIN_OPTION_HEIGHT_PX`~~ | — | **Removed** with the option cards |
| ~~`OPTION_CHAR_GAP_PX`~~, ~~`MIN_GLYPH_PX`~~, ~~`MAX_GLYPH_PX`~~ | — | **Removed** with the measured-`GlyphSvg` options; cpcd owns the intra-word spacing now |

The first four of those are **zone / word presentation**: they are imported by
`SpeedReadingTapZone.tsx` and `SpeedReadingOptionText.tsx` rather than restated
there.

---

## Answer feedback: half tint

A pick fires **one** cue, then the round advances after `FEEDBACK_MS` (180ms). There
is **no answer sound** — the app has no answer-feedback sound at all
(docs/AUDIO_PLAYBACK.md § 7).

⚠️ `FEEDBACK_MS` was shortened on the premise that the sound reached the player first
(the old reveal was 600ms, sized for colour only). With the tint now the sole cue, it
may be too short to register — re-evaluate on a device.

| Cue | Where it comes from | Why |
|---|---|---|
| **Half tint** | `SpeedReadingTapZone.tsx` (`OptionFeedback`), driven by `SpeedReadingStage.feedbackFor` | The tapped half fills green or red under the thumb that just tapped it — no saccade needed. |

### Only the tapped half is painted

A wrong pick reddens the half the player tapped and **leaves the correct half
neutral** — it deliberately does not flash the right answer green. The feedback
answers *"was I right?"*, which is the question the player asked by tapping;
revealing the word they failed to read turns a reading test into a flashcard,
and at 180ms there is no time to learn from it anyway.

> **History.** This used to be the opposite: the correct option always went
> green, on the grounds that the round should still teach. It was changed by
> request.

> **⚠️ Removed: the float indicator.** A ✓/✗ used to rise from the exact tap
> point (`SpeedReadingFloatIndicator.tsx`, `spawnFloatIndicator`,
> `FLOAT_INDICATOR_MS`, `PENALTY_INDICATOR_MS`, `indicatorLifetime`), carrying a
> red **+3s** on a wrong answer. The component and all of that machinery are
> deleted, and the +3s penalty itself was removed on 2026-11-10 — see
> [§ Scoring and tiers](#scoring-and-tiers).

### `FEEDBACK_MS` is not the whole gap the player feels

Two other things used to sit between the tap and a readable next card. Both are
fixed; **check them before shortening `FEEDBACK_MS` again**, because they were
each larger than the constant itself.

**1. The next round's assets loaded on mount.** `SpeedReadingStage` keeps a
`pendingRoundRef`: the moment a round goes on screen, the round AFTER it is
built and its **audio** prefetched, so advancing is a single synchronous
`setState`. It consumes one extra card off the queue (the top-up already covers
it) and drops the last prepared round when the run ends.

> This mattered far more when the options were `GlyphSvg`: stroke data was
> fetched per character (a dynamic import in dev, a **CDN round trip in
> production**), so a round of unseen characters rendered as *empty buttons* —
> up to 8 characters' worth — and the prefetch also warmed `loadGlyph`. The
> words are plain font text now, so only the audio is warmed.

**2. The option colour fade ran backwards too.** The 140ms `background-color`
transition applied in both directions, so the previous round's green/red was
still draining out while the next word was already on screen. It is now applied
**only when entering** feedback (`feedback === "none" ? "none" : ...`) — on the
tap zones today, on the option cards back then; the reset to neutral is
instant.

### No answer sound

`onPick` makes no sound call, and `markFlashcard` plays nothing for any surface
(docs/AUDIO_PLAYBACK.md § 7).

### Auto-narration

Every round speaks its word as it lands; the speaker button remains, for replays.

**Why autoplay here.** Under a running clock, a tap spent on the speaker is a
tap not spent answering — an opt-in speaker button means the audio channel is
effectively never used. Narrating on arrival makes the word's SOUND a third cue
alongside the pinyin and the definition, which is the point: the game is a
reading drill, and the reading includes the pronunciation.

**Where it lives** (`SpeedReadingStage.tsx`):

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

### ~~The float indicator~~ (removed)

The tap-anchored ✓/✗ is **gone**, along with `FloatIndicator`/`FloatKind`,
`spawnFloatIndicator`, the float timers, `FLOAT_INDICATOR_MS`,
`PENALTY_INDICATOR_MS` and `indicatorLifetime()`. `SpeedReadingTapZone`'s tint is
the only visual answer cue left.

Two consequences worth carrying forward:

- **A miss is only visible as the tapped half's red flash during play.** The round-tick
  strip whose red pip used to mark a miss is no longer drawn; a miss shows up again only
  on the results, in the accuracy line and the accuracy tier. If play-testing shows misses
  going unnoticed, a per-miss cue is the thing to re-add.
- **`stage.toStageCoords` now has no caller.** It was the one consumer of the
  rotated-stage inverse transform; the hook keeps the function (and its warning)
  for the next thing positioned from a tap.

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

## The last round is a sentence

The final `SENTENCE_ROUNDS` (**1**) round of a run — round 20 of 20 — escalates
from *read this word* to **read this word in context** (it was the last two rounds
until 2026-11-04). The card and the
mark are unchanged; what changes is what is drawn and what is spoken.

```
┌─────────────────────────────┐
│ ⌄  Speed Reading            │
├─────────────────────────────┤
│   wǒ jīntiān qù mǎi shū     │  the SENTENCE's pinyin (per segment)
│ "I'm going to buy books     │  the SENTENCE's English translation
│  today."          🔊        │  speaker narrates the SENTENCE
│                             │
│  我今天去买书。│我今天去卖书。│  both options are the same sentence,
│                │            │  differing at one character of 买书
│   LEFT ZONE    │ RIGHT ZONE │
└─────────────────────────────┘
```

| | Word round (1–19) | Sentence round (20) |
|---|---|---|
| Options | the headword, `xl` | the whole example sentence, `sm` |
| Prompt pinyin | `resolveDisplayPronunciation(entry)` | `buildSentencePronunciation(sentence)` — per-segment, space separated |
| Prompt English | the card's displayed definition (dd) | the sentence's `english` translation |
| Speaker / auto-narration | the headword | the sentence's `foreignText` (+ the same pinyin hint) |
| Mark | reading, on `entry.id` | **the same** — reading, on `entry.id` |

Which strings the prompt gets is decided by **`roundPrompt.ts`**, not by the
prompt component: `SpeedReadingPrompt` is purely presentational and only takes a
`compact` flag (a sentence's clue is a whole line of pinyin and a whole
translation, so both lines shrink one step).

### How a sentence round is built

`buildSentenceRound` (`buildRound.ts`), which shares the distractor ladder with
`buildRound` via `pickDistractor`:

1. Pick one of the entry's **usable** example sentences — usable means it
   literally *contains the headword* (`usableSentences`), since the round works by
   altering a character of the headword where it stands in the sentence.
2. Locate the headword inside the sentence's **character array**
   (`findWordStart` — never `String.indexOf`, whose UTF-16 offsets break on a
   surrogate pair).
3. Pick a position **inside the headword only**, so the round still tests the word
   the card is about rather than an incidental character of the sentence.
4. Draw the wrong character through the **same pool and the same fallback ladder**
   as a word round, excluding the headword's own characters. Characters that
   appear *elsewhere* in the sentence are fair game — repeating one is not a leak.

The one-character invariant holds exactly as before: the two sentences are the
same length, wrap identically, and differ at one position.

> The wrong option is a sentence containing a **mis-written word**; nothing else
> about it is claimed to be grammatical. That is the same bargain the word rounds
> strike with 你妤.

### The finale's card is reserved AT LOAD

The run's whole card set arrives on the **first** pool call, so the finale is
decided there and then rather than at round 20:
`useSpeedReadingQueue` splits the opening pool with `reserveFinaleCards`, holding
back the first `SENTENCE_ROUNDS` cards that pass `hasSentenceRound` (a det row
carrying an example sentence that contains the headword). `dequeue` never returns
them; `dequeueSentenceCard` is the only way out. Their ids also join `exclude` on
every mid-run top-up, so a refill can't hand back a word the run is going to end
on.

Consequences worth knowing:

- The finale **never depends on a mid-run top-up** returning a card that happens
  to have example sentences.
- If the opening pool has no eligible card, the queue logs a `console.warn` and
  the finale **degrades to an ordinary word round** rather than ending the run. This should not happen for a normal
  library — discoverable det rows are enriched with example sentences — but the
  path exists because a pool made mostly of provisional cards could in principle
  reach it.

### Which round is round 20

A round's kind follows from its **ordinal**, and the ordinal is
`answeredRef.current + 1` — computed in `nextRound` at the moment the round is
shown. That works because every round shown is answered exactly once (there is no
Skip).

> ⚠️ **Do not re-derive the ordinal from a count of rounds CONSTRUCTED.** It looks
> equivalent and isn't: the page prebuilds one round ahead, so a build counter
> runs ahead of the player and drifts further on every build that never reaches
> the screen — and React **StrictMode double-invokes the run-start effect in
> dev**, so such a counter starts ahead before the first tap. The first cut of
> this feature did exactly that and the finale landed in the middle of the run.
> Deriving from answers is self-correcting: however many rounds were built and
> thrown away, round 20 is still the one shown after 19 answers.

The prebuilt round is **tagged with the ordinal it was built for**
(`pendingRoundRef = { ordinal, round }`) and discarded if the run has moved under
it, so a round built as a word round can never be shown in a sentence slot (or
vice versa). Nothing is prebuilt past `TARGET_ROUNDS` — a 21st round would only
burn a card.

The run-start effect arms each run **exactly once** (`armedRunRef` vs `runId`),
which is what keeps StrictMode's second invocation from re-narrating, re-stamping
the clock origin, and burning the first round's cards.

---

## Choosing the wrong character

No authoring, no table, no backfill. The wrong character is a **real character the
player already has in their library**.

### Selection query

`SpeedReadingDAL.getLibraryDistractors` builds the pool once at game load:

1. Take the player's Learning (`library`) cards for `zh`.
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

> ⚠️ **HISTORICAL — this game no longer uses `GlyphSvg`.** The options are cpcd
> (`ForeignText` → `CPCDRow`) at a fixed `xl`; see
> [§ The option word is cpcd at a fixed `xl`](#the-option-word-is-cpcd-at-a-fixed-xl).
> `GlyphSvg` has no call site left in the tree. The section is kept because the
> component still exists and its CDN-fallback warning below is the reason the
> writing drill's grey guide works in PPE — delete the component and that
> lesson goes with it.

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
drill's grey guide works in PPE. `GlyphSvg` needs it for the same reason:
without it, Speed Reading renders **blank buttons in production builds while looking perfect in
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
stall — if the queue empties, the run ends UNFINISHED: the results card reports how far
the player got and records no time and no tiers (see § Scoring and tiers).

**One card is reserved out of the opening pool** for the sentence round (`SENTENCE_ROUNDS = 1`)
(`reserveFinaleCards`) and never enter the FIFO — see [§ The finale's cards are
reserved AT LOAD](#the-finales-cards-are-reserved-at-load).

`exclude` carries every id still queued **plus the reserved finale cards**. As
with Match Speed, this is **not** a repeat gate — repeats are prevented by the server's per-type reading cooldown — it
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

The mid-run top-up (`opts` set) sends `need`, which alone stops it lending: the server
runs `ensureBaseline` only for a request without `need` (`OnDeckVocabController.getGamePool`).
It still sends `surface` — dropping it, as this hook used to, changed nothing, since
`speed-reading` is not a rolling-supply surface. Built by `fetchGamePool`
(`src/api/gamePool.ts`).

⚠️ **Why this game over-lent, and the fix.** Speed Reading kept lending ~18 cards on
*every* load even to learners with hundreds of playable cards. Two facts combined: it
buckets by the READING track, on which a typical learner has almost no history and
therefore bands ~100% `Unfamiliar`; and it inherited Bubble Match's `GAME_DISTRIBUTION`
of 2/10/6/2, whose `Target`/`Comfortable`/`Mastered` quotas are then unfillable at any
library size. The pool's fill tier 2 lent that 18-card shortfall before the fresh
fallback tier could borrow from the learner's own (large) `Unfamiliar` pile — and since
a minted row is *itself* `Unfamiliar`, the shortfall could never close, so it recurred
forever.

Fixed in two passes. **2026-08-19:** tier 2 lent only what the fresh fallback tier could
not cover — which stopped the minting but left the accumulated rows competing for every
slot, because selection admitted provisional cards as ordinary candidates.
**2026-08-20:** lending moved to the **bottom** of the ladder (below cooling cards) and
selection became sorted-only, so a lent card enters a round only when it was lent *for
that round*. A learner with a real deck now plays 20/20 of their own cards, resting ones
included; the distribution was deliberately left alone, so the quotas simply degrade to
a best-effort fill. See [PROVISIONAL_CARDS.md § 4b](./PROVISIONAL_CARDS.md).

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

## Scoring and tiers

**Score = the raw time to answer 20 rounds. Lower is better.** A finished run is graded on
two axes, a **speed tier** and an **accuracy tier**, 1 (best) to 7 (lowest); the shared
model is [GAMES_FEATURE.md § Run tiers](./GAMES_FEATURE.md#run-tiers).

```
totalMs  = accumulated active time from the first round to the 20th answer
speed    = speedTierFor(totalMs, SPEED_TIERS)
accuracy = accuracyTierFor(correct, TARGET_ROUNDS, ACCURACY_TIERS)
```

| Event | Counts toward the 20? | Cost |
|---|---|---|
| Correct pick | yes | the time it took |
| Wrong pick | **yes** | the time it took; lowers the accuracy tier |

Those are the only two outcomes — every round must be answered. `FEEDBACK_MS` is 180ms
whether the answer was right or wrong.

**Why a wrong answer still counts as a round, at no time cost.** Under a count-up clock a
blind tap is the *fastest possible round*, so accuracy needs its own price. It used to be
`WRONG_PENALTY_MS` (+3s per miss, added to the final time); that was **removed 2026-11-10**
when accuracy became its own tier, so speed and accuracy are graded independently and a
guess-through run shows up as a fast speed tier next to a poor accuracy tier. Replaying
missed words was the other alternative; counting every answer keeps every run exactly 20
rounds long, which is what makes two runs comparable.

### Personal best

The fastest **finished** run (`totalMs` — raw active time, lower wins) is kept
under the single mode key `"default"` (the game has one difficulty). An effect in
`SpeedReadingStage` records it only when `phase === "ended"` **and** `finished`
(`answered >= TARGET_ROUNDS`) — the same guard the tiers rely on, because a run cut
short by a drained queue has a small time that would otherwise become an unbeatable best.
The line renders on the break's results card, and only on a finished run (the "Out of
cards" / "Run ended" branches show no time and no best).

> ⚠️ **Bests stored before 2026-11-10 include penalty seconds.** They were recorded as
> wall clock + 3s per miss, so each is slower than or equal to the raw-time run it came
> from; raw-time runs beat them more easily. No reset was done.

The shared plumbing is `src/games/shared/usePersonalBest.ts` → `usePersonalBest` (load, `record` once per run, `reset` on a new run) and `src/games/shared/PersonalBestLine.tsx` → `PersonalBestLine` (the "Personal best m:ss" row + gold "New best!" pill, hidden until a best exists); the direction/unit lives in `server/contracts/personalBests.ts` → `PERSONAL_BEST_GAMES`. Storage and API: [WRITING_PRACTICE_REWORK.md § 2a](./WRITING_PRACTICE_REWORK.md).

### There is no Skip

**Removed with the race format.** Under the one-minute clock, Skip was a real
choice: ducking a word you couldn't read cost you the seconds spent deciding to
duck it, and bought you a shot at an easier word inside the same minute. In a
race that logic inverts. Skipping would be the *cheapest* way past a hard word —
a free reroll — and pricing it (as a wrong answer was then priced, at 3s) only makes
it a **strictly worse version of guessing**: a guess pays the same and might be right.
That still holds now that a wrong answer costs accuracy instead of time.

A control the player should never rationally use is noise on the screen, so it is
gone rather than penalized. The knock-on effects are all simplifications: the
counter advances on every round shown, the float indicator's `kind` lost its
third case (before the indicator was removed outright), and the Marks table lost
its one unmarked path.

### Tiers

`src/games/speed-reading/constants.ts` → `SPEED_TIERS`, `ACCURACY_TIERS`, `runResultTiers`.
The speed cutoffs (35 / 45 / 55 / 65 / 80 / 100 s; past 100 s is tier 7) spread the old
medal lines (45 / 60 / 90 s, ~2.25 s/round at the top) over seven tiers. The accuracy
cutoffs are 100 / 95 / 90 / 80 / 70 / 60 % of the 20 answers. ⚠️ **All are placeholders**
and want re-tuning from real play.

**Tiers require a FINISHED run.** `runResultTiers` does not know the round count, so
`SpeedReadingStage` gates it on `finished` (`answered >= TARGET_ROUNDS`). Without that gate
a run cut short by a drained queue (three rounds in 8 seconds) would take speed tier 1.
An unfinished run reports `tiers: null` and no time.

Every finished run records one win via `useGameWins(GAME_KEY).recordWin(WIN_LEVEL)` (wins
are not gated on a tier), guarded by a ref so it fires once per run.

---

## Shell and chrome

- **Stage only.** `SpeedReadingStage` owns the run; its one host is the flp break adapter
  (`SPEED_READING_BREAK`, `src/games/flpBreak/speedReadingBreak.ts`), which mounts it
  inside `GameBreakFrame` ([FLP_GAME_BREAKS.md](./FLP_GAME_BREAKS.md) § 6). There is no
  route, no `LeafPage` and no end popup.
- **`touchAction: "none"`** on the whole surface; nothing here scrolls.
- **Minute points** are earned through the Deck Tower study session hosting the break
  (the studySurface claim), not through a route of this game's own.
- **Definitions:** the prompt's definition **must** resolve through
  `resolveDisplayDefinition(entry)` (`src/utils/definitionUtils.ts`) — `gamePool`
  ships `definitionClusters` + `selectedSense`, so resolve client-side as Bubble
  Match does. See `GAMES_FEATURE.md` § Sense correctness.
- **Audio:** `useTTS().speakSentence(entry.entryKey, entry.pronunciation)` behind
  the shared `SpeakerButton`, with `isLoading={tts.speakingKey === entry.entryKey}`.
  **Autoplays every round** — see § Auto-narration.

---

## As an flp game break

Speed Reading is in the reading flp's break rotation (zh only), adapter
`SPEED_READING_BREAK` (`src/games/flpBreak/speedReadingBreak.ts`). The general mechanism
is [FLP_GAME_BREAKS.md](./FLP_GAME_BREAKS.md); what is specific to this game:

| Concern | Behaviour |
|---|---|
| Run | The full 20 rounds with the sentence finale (round 20); tiers and the personal best under the one `"default"` mode key. |
| Prefetch | The seeded pool **and** the distractor list (`SpeedReadingOpening`), both fetched while card 15 is up. `isPlayable` rejects an empty pool or an empty distractor list, so the flp picks another game instead. |
| Pool | `speedReadingPoolRequest` (`poolRequest.ts`): `seedIds` on the opening batch only, `flpBreak` on every request. The game's own `GAME_DISTRIBUTION`. |
| Marks | Reading marks. A correct, recorded mark on an owned card fires `onCardCleared`, skipping lent cards and `outsideFocus` cards. |
| Chrome | No header and no panel. Leave + the title come from `GameFrame`, inside the rotated stage. No HUD; the board starts below Leave's row (see § Screen layout). |
| Leave | During a live round: the run ends as **Run ended**, with no time, tiers, win or personal best. In the 20th answer's feedback window the run just ends finished. After the run: dismisses the lent-card offer. Before a deal: closes the break. |
| Results | `onRunEnded`. A finished run: the "Finished!" heading and the run-tier panels (`FlpBreakResults.tiers`) — time + personal best in the speed panel, `n/20 · %` in the accuracy panel. An unfinished one: "Out of cards" / "Run ended", `n of 20 rounds` and `n/answered correct · no time recorded`. A lent-card sort offer holds the report until it is answered. |
| Sideways cards | `sideways: true` on the adapter turns the break's card (buttons included) and its results card 90° the game's way (`SidewaysCardFace`, FLP_GAME_BREAKS.md § 5). |

---

## Files

**Client** — `src/games/speed-reading/`

| File | Role |
|---|---|
| `SpeedReadingStage.tsx` | the run: phase machine, clock (not drawn), marks, scoring, run reset, host branches (chrome, results, Leave) |
| `poolRequest.ts` | `speedReadingPoolRequest` — every pool request, shared with the break's prefetch |
| `SpeedReadingPrompt.tsx` | pinyin + English + speaker; presentational only (takes strings, not a round) |
| `roundPrompt.ts` | derives the prompt's pinyin / English / narration from the round's KIND |
| `SpeedReadingTapZone.tsx` | one half of the screen as a tap target + its green/red feedback tint (hands the click event up for the tap coordinates) |
| `SpeedReadingOptionText.tsx` | one option's text (word or sentence), display-only, as a `ForeignText`/cpcd row at the size the page passes |
| `buildRound.ts` | the one-character invariant, the fallback ladder, and both round builders (pure) |
| `useSpeedReadingQueue.ts` | card queue, distractor pool, top-up, finale reservation |
| `constants.ts` | run constants, speed / accuracy tier ladders (`SPEED_TIERS`, `ACCURACY_TIERS`, `runResultTiers`) |
| `types.ts` | `Phase`, `RoundOption`, `WordRound` / `SentenceRound` / `Round` |

**Client, shared**

| File | Role |
|---|---|
| `src/games/runtime/useSidewaysStage.ts` | container-shape-driven 90° rotation + tap-coordinate inverse |
| `src/api/speedReading.ts` | `fetchSpeedReadingDistractors` |
| `src/games/flpBreak/speedReadingBreak.ts`, `SpeedReadingBreakStage.tsx` | the flp break adapter and its lazy Stage entry |
| `src/components/ForeignText.tsx` | the option text (row layout → `CPCDRow`), `showPinyin={false}` |
| `src/utils/sentencePronunciation.ts` | `buildSentencePronunciation` — per-segment pinyin for a sentence round's prompt and TTS hint (shared with the flp est list). Skips punctuation segments; see [EXAMPLE_SENTENCES.md § Punctuation is skipped](./EXAMPLE_SENTENCES.md#punctuation-is-skipped-not-a-missing-pronunciation) |
| ~~`src/components/handwriting/GlyphSvg.tsx`~~ | **no longer used here** — the options were per-character SVG glyphs until they moved to cpcd |
| `src/games/registry.ts` | `GameDef` entry (break-only: no route; colour, `languages`) |

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

**Tests** — `src/__tests__/speedReadingBuildRound.test.ts` (26 tests: the
one-character invariant, the ladder, and the sentence-round builder).

**The game owns no tables and no migrations.**

---

## What still needs tuning

| Constant | Current | How to tune |
|---|---|---|
| `SPEED_TIERS` | 35–100 s | Play a few runs. Spread from the old medal lines (~2.25s/round at the top), not measured at this format. |
| `ACCURACY_TIERS` | 100–60 % | Check that a guess-through run lands low here while still scoring a fast speed tier. |
| `TARGET_ROUNDS` | 20 | Long enough that one lucky guess doesn't decide the run, short enough to replay. Changing it invalidates both tier ladders. |
| `FEEDBACK_MS` | 180 | Long enough to see the answer, short enough not to feel like a tax. Cut from 600 once the sound carried the outcome. ⚠️ With the float indicator gone the tint is the only thing to *see*, and 180ms is short for a colour change — **lengthen** this if the reveal starts reading as nothing happening. |
| `ZONE_TINT_CORRECT` / `ZONE_TINT_WRONG` | green / red MID tier | The sole visual cue now. If the flash goes unnoticed on a bright screen, the next step is the MARK tier (`grnMk` / `redMk`). |
| `SENTENCE_ROUNDS` | 1 | How much of the run is the sentence finale (cut from 2 on 2026-11-04). Raising it needs more eligible cards in the opening pool (20 cards, so there is headroom) and makes the run meaningfully harder. |
| `OPTION_SENTENCE_GLYPH_SIZE` | `"sm"` | Fits ~10 characters per half-screen line. Drop to `"xs"` if long sentences wrap past two lines; raise to `"md"` if they read as too small next to the `xl` word rounds. |

---

## Dependencies (docs ↔ code)

| This doc's section | Code it describes |
|---|---|
| Scope: Chinese only | `src/games/registry.ts` (`languages`), `src/games/types.ts`, `SpeedReadingDAL.getLibraryDistractors` |
| Sideways rendering | `src/games/runtime/useSidewaysStage.ts`, `SpeedReadingStage.tsx` (`stage`, `speed-reading__frame`), `src/games/shared/GameFrame.tsx` |
| Screen layout, tap zones, option text | `SpeedReadingStage.tsx` (`speed-reading__play`, `speed-reading__zones`, `speed-reading__stack`), `SpeedReadingTapZone.tsx`, `SpeedReadingOptionText.tsx`, `SpeedReadingPrompt.tsx` (`speed-reading__prompt-speaker`), `constants.ts` (`OPTION_GLYPH_SIZE`, `OPTION_SENTENCE_GLYPH_SIZE`, `ZONE_TINT_*`), `types.ts` (`OptionFeedback`), `src/components/ForeignText.tsx`, `src/components/CPCDRow.tsx` |
| Round state machine | `SpeedReadingStage.tsx` (`Phase`, `advance`, `answeredRef`), `useSpeedReadingQueue.ts` |
| Answer feedback: half tint | `SpeedReadingStage.tsx` (`onPick`, `feedbackFor`), `SpeedReadingTapZone.tsx`, `constants.ts` (`FEEDBACK_MS`, `ZONE_TINT_CORRECT`, `ZONE_TINT_WRONG`) |
| One-character invariant, ladder | `buildRound.ts`, `src/__tests__/speedReadingBuildRound.test.ts` |
| The last round is a sentence | `buildRound.ts` (`buildSentenceRound`, `usableSentences`, `hasSentenceRound`, `findWordStart`), `roundPrompt.ts`, `useSpeedReadingQueue.ts` (`reserveFinaleCards`, `finaleRef`, `dequeueSentenceCard`), `SpeedReadingStage.tsx` (`nextRound` ordinals, `pendingRoundRef`, `armedRunRef`, `takeRound`), `constants.ts` (`SENTENCE_ROUNDS`, `OPTION_SENTENCE_GLYPH_SIZE`), `types.ts` (`SentenceRound`), `src/utils/sentencePronunciation.ts`; [EXAMPLE_SENTENCES.md](./EXAMPLE_SENTENCES.md) |
| Selection query, Endpoint | `SpeedReadingDAL.ts`, `SpeedReadingService.ts`, `SpeedReadingController.ts`, `speedReadingRoutes.ts` |
| Rendering a glyph (historical) | `src/components/handwriting/GlyphSvg.tsx` — no call site left; see also [HANDWRITING_RECOGNITION.md](./HANDWRITING_RECOGNITION.md) |
| Queue + top-up | `useSpeedReadingQueue.ts`, `OnDeckVocabController.getGamePool` |
| `markType` | `server/controllers/OnDeckVocabController.ts`; [MASTERY_REWORK.md](./MASTERY_REWORK.md) |
| Marks | `src/api/flashcards.ts`, [MASTERY_REWORK.md](./MASTERY_REWORK.md) |
| As an flp game break | `src/games/flpBreak/speedReadingBreak.ts` (`SPEED_READING_BREAK`), `SpeedReadingBreakStage.tsx`, `SpeedReadingStage.tsx` (`leaveBreak`, `hud`, the `onRunEnded` effect, `mark`), `poolRequest.ts`, `useSpeedReadingQueue.ts` (`SpeedReadingOpening`, `prefetched`), `src/features/flashcards/FlashcardsLearnPage/gameBreak/SidewaysCardFace.tsx` |
| Scoring and tiers | `constants.ts` (`TARGET_ROUNDS`, `SPEED_TIERS`, `ACCURACY_TIERS`, `runResultTiers`, `formatClock`), `SpeedReadingStage.tsx` (`totalMs`, `finished`, `endRun`), `src/games/shared/runTiers.ts`, `src/hooks/useGameWins.ts` |

Referenced by: [GAMES_FEATURE.md](./GAMES_FEATURE.md),
[FLP_GAME_BREAKS.md](./FLP_GAME_BREAKS.md),
[MASTERY_REWORK.md](./MASTERY_REWORK.md),
[HANDWRITING_RECOGNITION.md](./HANDWRITING_RECOGNITION.md).
