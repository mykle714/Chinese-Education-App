# flp card stack & gestures

How the flp's card stack is laid out, and how a press on its front card becomes a flip, a
tap, a swipe or a snap-back. Linked from [DECK_TOWER.md](./DECK_TOWER.md) § "Studying the
tower" → "The session".

## Layers / components

| Layer | File → symbol | Responsibility |
|---|---|---|
| Gesture hook | `src/features/flashcards/FlashcardsLearnPage/useCardDrag.ts` → `useCardDrag`, `classifyRelease` | Tracks a press in refs and document listeners, classifies the lift-off, runs the flip and the locks |
| Thresholds | `src/features/flashcards/constants.ts` → `CARD_TAP_SLOP`, `CARD_FLICK_MIN_VELOCITY`, `CARD_FLICK_MIN_DISTANCE`, `CARD_FLICK_WINDOW_MS`, `CARD_DISMISS_THRESHOLD_VW`, `CARD_DRAG_SENSITIVITY`, `CARD_FLY_OUT_MS`, `LAST_CARD_RETURN_MS` | The numbers |
| Loop state | `src/features/flashcards/FlashcardsLearnPage/useWorkingLoop.ts` → `CardSlot`, `FlyOut` (`returnsAlone`), `handleCardDismiss`, `deepEntry` | Slot rotation, fly-out arming and timing |
| Undo | `useWorkingLoop.ts` → `runUndo`, `handleUndoLastMark`, `serverUndoChainRef`; `src/features/flashcards/types.ts` → `LastMarkUndoSnapshot`; `TowerStudyHeader.tsx` | Undo lights up at the swipe; local restore, then server revert (§ "Undo") |
| Render | `src/features/flashcards/FlashcardsLearnPage/FlashCardSection.tsx` → `roleOf`, `flyArmed`, `TOWER_FLY_RIGHT_KEYFRAMES`, `TOWER_TUCK_KEYFRAMES`, `LAST_CARD_RETURN_KEYFRAMES`, `LAST_CARD_TURN_AT`, `LAST_CARD_LEAVING_KEYFRAMES` / `LAST_CARD_ARRIVING_KEYFRAMES`; `styled.ts` → `LastCardLabel` | The three slots, the fly-out animations, the last card's return |
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

Each slot's React key carries its slot number (`slot-X`, and `slot-X-front-N` while it is
the front, N = `shakeNonce`). So a dismiss remounts both the flying slot and the promoted
one, and each mounts already on its face. Do not key the front by role alone (`front-N`):
React then hands the old front's component, still rotated 180° from its flip, to the
promoted card, and the new card visibly flips back to Side 1 as the old one leaves.

At rest, then, two cards sit behind the front. During a fly-out the new front still has
one card behind it, so a learner who flips or swipes it straight away never sees the empty
frame through it. With two slots, the only other slot was the one flying away.

`deepSideOneLanguage` is derived with `sideOneForCard` rather than kept as state: that
function is a pure rule. While the front card flips, every non-front slot blanks its
content (`contentHidden`), so neither card behind it leaks its word.

With fewer than three cards the missing roles are empty: an empty slot draws nothing,
so behind the loop's only card there is no word card. The out-of-ready-cards card that
comes next is drawn there instead (`readyOutBacking`, DECK_TOWER.md § "Running out of
ready cards").

## The last card

`useWorkingLoop.ts` → `FlyOut.returnsAlone`, `frontVacated`, `handleCardDismiss`;
`FlashCardSection.tsx` → `LAST_CARD_RETURN_KEYFRAMES`, `LAST_CARD_TURN_AT`,
`LAST_CARD_LEAVING_KEYFRAMES`, `LAST_CARD_ARRIVING_KEYFRAMES`, `lastCardLabelFor`, `returnInFlightFor`; `styled.ts` → `LastCardLabel`; `constants.ts` → `LAST_CARD_RETURN_MS`;
`FlashcardsLearnPage.tsx` → the `cardDragRef` bridge.

An incorrect mark on the loop's only card (`returnsAlone = !isCorrect && loop.length === 1`)
has nothing to promote: the stack advances onto the same card. With the plain tuck, that
card was already sitting in the front slot while the old one flew off, so the swipe looked
like it had done nothing. Instead:

1. The card flies fully off the left from where the finger let go, on the tuck's ease-in.
2. It holds off-screen. At `LAST_CARD_TURN_AT` (0.4) of the move it swaps from the face it was
   sent off on to the card's Side 1 (drawn as the "peek" role, the front's reset state)
   and gains **"Last card!"** across its top band (`LastCardLabel`, ink, bold).
   The swap is a cut between two layers in the flying slot (leaving, then arriving), driven
   by `step-end` keyframes on the same clock as the motion. Do not move it to a JS timer.
   Right after a swipe the main thread is busy (the mark request, narration), a timer fires
   late, and the card starts sliding back in on its answer face.
3. It slides back in on top at full size and decelerates into the resting pose.

The whole move takes `LAST_CARD_RETURN_MS` (800). The loop's fly-out timer waits that long
instead of `CARD_FLY_OUT_MS`. The front slot is hidden and takes no taps for the whole
move, so the flying copy is the only card on screen; when the fly-out ends the front takes
over at the same pose. The front card's id does not change (it is the same card), so
useCardDrag's per-card reset never fires: the loop calls `cardDragRef.resetCard()` once the fly-out is
armed, and the page's bridge also wipes a writing card's graded attempt.

A **correct** mark on the loop's only card also advances onto the same card, and whether
it goes for good is not known until the mark's reply: a replacement card, or nothing (the
loop is empty and the out-of-ready-cards card comes up). Until the reply,
`useWorkingLoop.ts` → `frontVacated` is set and the front is not drawn
(`FlashCardSection.tsx` → `hiddenForVacated`), so the card behind it, the
out-of-ready-cards backing card, shows while the swiped card flies off. A replacement
lands in the same front slot (index 0); its new id resets the flip (see "Per-card reset"
below), and `handleCardDismiss` (`replacesFront`) gives it its own Side 1 language rather
than the passed card's. A failed request
puts the same card back; a suppressed mark (the server refused it, e.g. the card is
cooling) takes the card out of the loop, like a pass with no replacement
(`useWorkingLoop.ts` → `handleCardDismiss`). The stack also stays mounted while a fly-out runs
with an empty loop (`currentEntry || flyOut`), and the flying slot lifts above the
out-of-ready-cards card (z-index 5) if that card comes up mid-flight, so the card is
never cut off mid-flight.

The label stays on the front while that card is alone (`nextEntry === null`). It goes with
the next dismiss, or as soon as a refill puts a card behind it. It is hidden while
"Tap to flip" holds the same spot in the top band. When a game break is due, the plain tuck
plays instead, because the break's card comes up on top.

## Per-card reset

`useCardDrag.ts` → `useCardDrag` (`resetKey`, `resetCard`, `restoreFlipped`);
`FlashcardsLearnPage.tsx` → `frontCardId`; `useWorkingLoop.ts` → `CardDragControls`.

Every per-card reset keys on the **front card's id** (`frontCardId`), never on its position
in the loop (`currentIndex`): the flip, the "has flipped" swipe gate, the hints, an
in-progress press, the eip (closed, tabs dropped) and the writing-practice draft. A position
can stay put while the card under it is swapped — a one-card loop's correct swipe puts the
replacement at index 0 again, and it arrived flipped (2026-11-22) — and it can move while
the card stays: a removal behind the front (a suppressed mark winding its card out)
re-anchors the index, which un-flipped the card being studied and closed its eip.

The flip itself is scoped to the id it was made on (`isFlipped` reads false for any other
card), so even the one render between a card change and the reset effect never shows a
stale flip. Two cases bring the SAME id back and so call `resetCard` explicitly: the last
card's incorrect return (`FlyOut.returnsAlone`) and a re-deal (`dealLoop`), which may open on
the card already showing. Undo calls `restoreFlipped(cardId)`, which survives the reset
effect for that one card; when the restored card is already the one showing, no effect is
coming, so `restoreFlipped` clears its marker itself.

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

## Undo

The header's undo button (`TowerStudyHeader`) reverts the last swipe. It lights up **the
moment the card is swiped**, not when the mark's reply arrives.

- **Snapshot at the swipe.** `handleCardDismiss` stores a `LastMarkUndoSnapshot`
  (`src/features/flashcards/types.ts`) at once: the pre-swipe loop, index and Side 1
  languages, plus `markWritten`, a promise of the server's mark key
  (`markTimestamp` + `displacedMarks`). That promise resolves to null when the server wrote
  nothing (a suppressed mark, or a request that failed after its retries).
- **Local restore first, server revert second.** `runUndo` puts the card back on screen
  straight away (on Side 2, via `restoreFlipped`) and calls `onUndone`. Once
  `markWritten` resolves, it posts `POST /api/flashcards/undoLastMark`, or sends nothing
  if the key is null. A failed revert shows the error banner, and the card stays restored.
- **A tap mid-fly-out is queued** (`undoQueued`). It runs the moment `isAnimating` drops,
  because restoring mid-flight would fight the slot animation. The button is never
  disabled for the fly-out. It is disabled only when there is no snapshot, in edit mode,
  or while a game break / the out-of-ready-cards card locks it (`breakLocksUndo`).
- **A late reply keeps its hands off.** A swipe undone before its reply lands has its
  snapshot's `undone` flag set. The reply then skips every loop patch: no refill over the
  restored card, no wind-down. In a one-card loop, `runUndo` also clears
  `soleCardLeavingId`, so the restored card is not hidden as `frontVacated`.
- **Marks wait for the revert** (`serverUndoChainRef`). The server reverts only a card's
  newest mark on that track (`FlashcardMarkService` → `undoMark`,
  `ERR_UNDO_TARGET_MISMATCH`), so a quick re-swipe of the restored card is held until the
  revert lands.
- **One level, and none for writing.** A new swipe replaces the snapshot. A writing mark
  clears it, because writing results fan out onto other cards and cannot be undone.

Code: `src/features/flashcards/FlashcardsLearnPage/useWorkingLoop.ts` → `handleCardDismiss`,
`runUndo`, `handleUndoLastMark`; `TowerStudyHeader.tsx`.

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
