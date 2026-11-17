# flp card stack & gestures

How the flp's card stack is laid out, and how a press on its front card becomes a flip, a
tap, a swipe or a snap-back. Linked from [DECK_TOWER.md](./DECK_TOWER.md) § "Studying the
tower" → "The session".

## Layers / components

| Layer | File → symbol | Responsibility |
|---|---|---|
| Gesture hook | `src/features/flashcards/FlashcardsLearnPage/useCardDrag.ts` → `useCardDrag`, `classifyRelease` | Tracks a press in refs and document listeners, classifies the lift-off, runs the flip and the locks |
| Thresholds | `src/features/flashcards/constants.ts` → `CARD_TAP_SLOP`, `CARD_FLICK_MIN_VELOCITY`, `CARD_FLICK_MIN_DISTANCE`, `CARD_FLICK_WINDOW_MS`, `CARD_DISMISS_THRESHOLD_VW`, `CARD_DRAG_SENSITIVITY`, `CARD_FLY_OUT_MS` | The numbers |
| Loop state | `src/features/flashcards/FlashcardsLearnPage/useWorkingLoop.ts` → `CardSlot`, `FlyOut`, `handleCardDismiss`, `deepEntry` | Slot rotation, fly-out arming and timing |
| Render | `src/features/flashcards/FlashcardsLearnPage/FlashCardSection.tsx` → `roleOf`, `flyArmed`, `TOWER_FLY_RIGHT_KEYFRAMES`, `TOWER_TUCK_KEYFRAMES` | The three slots, the fly-out animations |
| Page | `src/features/flashcards/FlashcardsLearnPage/FlashcardsLearnPage.tsx` → the "TTS narration" effects | Narration is not cancelled by a flip |

## The stack

The stack has three slots (`CardSlot` = 0 | 1 | 2). Each slot's role is its offset from
`activeFrontSlot` (`roleOf`):

| Role | Entry | z-index |
|---|---|---|
| front | `currentEntry` | 2 |
| back | `nextEntry` | 1 |
| deep | `deepEntry` (only in a loop of 3+ cards) | 0 |

The flying slot sits above all three at z-index 3. On a dismiss, `activeFrontSlot`
advances by one: the back card is promoted to the front, the deep card becomes the back
card, and the dismissed slot flies out and lands as the new deep card.

At rest, then, two cards sit behind the front. During a fly-out the new front still has
one card behind it, so a learner who flips or swipes it straight away never sees the empty
frame through it. With two slots, the only other slot was the one flying away.

`deepSideOneLanguage` is derived with `sideOneForCard` rather than kept as state: that
function is a pure rule. While the front card flips, every non-front slot blanks its
content (`contentHidden`), so neither card behind it leaks its word.

## Release classification

`classifyRelease` is pure: it reads only the gesture and the card width.

| Order | Rule | Constant(s) |
|---|---|---|
| 1 | The furthest raw travel is under the slop → tap | `CARD_TAP_SLOP` (10 px) |
| 2 | The sideways release speed over the last 80 ms is at least 0.4 px/ms, the sideways travel is at least 12 px, and both point the same way → flick dismiss | `CARD_FLICK_MIN_VELOCITY`, `CARD_FLICK_MIN_DISTANCE`, `CARD_FLICK_WINDOW_MS` |
| 3 | The amplified sideways travel is over 15% of the card width → dismiss, at any speed | `CARD_DISMISS_THRESHOLD_VW`, `CARD_DRAG_SENSITIVITY` |
| 4 | Anything else → snap back | — |

A slow, long drag counts as a swipe by distance (owner decision, 2026-11-17). The tap
test reads the furthest point reached, so a drag out and back to the start snaps back
instead of shaking the card. A `touchcancel` drops the press with no verdict.

## Locks

- **Flip lock** (`flipMs` after a flip). Taps are swallowed, so a second tap can't remount
  the card mid-flip into a shake. Swipes are allowed, so a learner can flip and then flick
  straight away.
- **Fly-out** (`isAnimating`). The new front card can be tapped to flip while the previous
  card is still flying, and its flip animates. A swipe classified during the fly-out is
  queued and fired the moment the fly-out ends, because the working loop refuses a dismiss
  mid-fly-out.

## Narration

A flip does not cancel narration (owner, 2026-11-17: flip during the audio without
interrupting it). Narration is cancelled only when the card changes, or when the card is
covered: parked, a break, or the out-of-ready-cards card. The cancel lives in its own
effect, keyed on those inputs.

## Fly-out

A dismiss first commits with `flyOut.armed = false`. In that state the flying slot holds
at the release point and runs no animation. After the next paint
(`utils/afterNextPaint.ts`), a light follow-up commit sets `armed = true`, which starts
the keyframes (`towerFlyRight`, `towerTuck`, `writingThrow`, `writingPromote`). The
`CARD_FLY_OUT_MS` timer counts from arming.

The reason is that the dismiss's own update (slot swap, next card, narration, counters)
runs synchronously before the first paint. An animation committed with it got its start
time at commit. On a phone its first visible frame landed 68–278 ms later, with the card
already mostly off-screen, and a fixed timer counted from the swipe then cut the rest
short. It was not clipping: every clipping container around the card spans the full
screen width.

## History (why the gesture lives in refs)

Tuned on 2026-11-17 against recorded iPhone input, from a temporary swipe lab that has
since been deleted. Its page, probe and `/api/diagnostics/gestures` sink are in git
history at `56724c6`.

- The old hook kept the drag in React state. It classified the release from the last
  *rendered* `dragPosition`, using a touchmove listener rebuilt on every `isDragging`
  change. On the flp's heavy render, a fast flick's moves were dropped and its release
  was read as nothing or as a tap: 13 of 31 real flicks were lost.
- In isolation, fast flicks released at 0.73–2.9 px/ms and travelled 38–210 px. Slow
  drags, holds and drag-out-and-back gestures released at |v| ≤ 0.17 px/ms. That gap is
  where the flick thresholds come from.
- Replaying the new rules over the recorded run recovered all 14 failed flicks and lost no
  swipe that had worked.
