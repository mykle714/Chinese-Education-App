# Swipe Lab (flp gesture tuning data)

Captures REAL phone touch input for tuning the flp card's swipe/tap classifier
(`useCardDrag`) and for locating what clips the card while it is dragged or flies out.
Two open problems motivate it (as of 2026-11-17): quick flicks often fail to register as
swipes, and the swipe animation is visibly clipped. The thresholds in
`src/features/flashcards/constants.ts` (`CARD_DISMISS_THRESHOLD_VW`, `CARD_DRAG_SENSITIVITY`)
and the 10 px tap radius inside `useCardDrag` were chosen by feel and have never been
checked against recorded input.

Linked from [CLIENT_PERF_DIAGNOSTICS.md](./CLIENT_PERF_DIAGNOSTICS.md) (it shares that
doc's sink writer and PPE → dev transport).

## Layers / components

| Layer | File → symbol | Responsibility |
|---|---|---|
| Client capture (shared) | `src/utils/gestureRecorder.ts` → `watchGestures`, `sendGestureRecords`, `isFlpRecordingOn` / `setFlpRecording` | Passive capture-phase listeners. They record every touch event and every coalesced touch-pointer sample of one gesture (first finger down → last finger up). They never cancel an event. Also uploads a batch with a plain `fetch`, which allows `keepalive` under 60 kB. |
| Lab page | `src/pages/swipeLab/SwipeLabPage.tsx` → `SwipeLabPage` (`/swipe-lab`, `ROUTE_META` plain shell, URL only) | A guided, shuffled script of LABELED gestures on a lab card that is driven by the **production** `useCardDrag` (not a copy). Records intent, raw samples and the hook's verdict for each gesture. |
| Live-flp probe | `src/features/flashcards/FlashcardsLearnPage/flpGestureProbe.ts` → `useFlpGestureProbe`, mounted by `FlashCardSection` | Records unlabeled gestures in real study conditions and runs the fly-out clip probe. It finds cards by the slot's `data-card-role` (`front` / `flying` / `peek`). It does nothing unless the device opted in from the lab (localStorage `swipeLab.recordFlp`, read once per flp mount). |
| Server sink | `server/routes/diagnosticsRoutes.ts` → `POST /api/diagnostics/gestures` | Unauthenticated, `diagnosticsLimiter`, at most 20 records per POST. Stores no IP. Passes records through to `appendDiagnostic('client-gestures', …)`. |
| Storage | `client-gestures-YYYY-MM-DD.jsonl` under `DIAGNOSTICS_LOG_DIR` (PPE: `server/logs/` on the host) | Daily-rotated, 30-day retention (`server/utils/diagnosticsLog.ts`). |
| Transport | `server/scripts/export-diagnostics-bundle.ts` (`dateStampOf` accepts `client-gestures-*`) / `/diagnostics-pull` | PPE → dev. Reading the file directly over `/ssh-ppe` also works. |

## The lab script (`PROMPT_SPECS`)

Each prompt names an `intent`, the card state it starts in (face-down: a tap flips it;
flipped: swipeable) and the verdict production SHOULD give (`expect`). A run is about 44
prompts, Fisher–Yates shuffled: tap ×5 face-down, tap ×5 flipped, normal swipe ×4 each way,
fast flick ×6 each way, tiniest flick ×3 each way, drag-out-and-back ×4, slow nudge ×4.

How the verdict is read from the hook:

| Verdict | Source |
|---|---|
| `dismiss-right` / `dismiss-left` | `onDismiss` callback |
| `shake` | `shakeNonce` increment (on a flipped card = "tap"; on a face-down card = "swipe attempt") |
| `flip` | `isFlipped` false → true |
| `snap-back` | none of the above within `VERDICT_SETTLE_MS` |

An `armedRef` window (first touch → verdict read) keeps the lab's own state changes from
being misread as verdicts. For example, `goTo` → `restoreFlipped` sets up a flipped prompt.
**Redo last** sends a `lab-discard` record naming the fumbled gesture's `seq` and asks for
the same prompt again. Analysis must drop discarded seqs.

## Record shapes (one JSONL line = `{ receivedAt, session, device, records[] }`)

`device`: `userAgent`, `dpr`, `viewport`, `screen`, `maxTouchPoints`.

- **`lab-gesture`**: `seq`, `intent`, `expect`, `verdict`, `ok`, `cardStartedFlipped`,
  `verdictAt`, `classifier` {`dismissThresholdFrac`, `sensitivity`, `cardWidth`},
  `cardRect`, `gesture` {`startedAt`, `endedAt`, `touches[]` {type, t, x, y, n},
  `pointers[]` {type, t, x, y}}, and `commits[]`, which holds every committed
  `dragPosition` with a timestamp. Comparing the last commit before `touchend` with the
  final touch sample measures how stale the state the classifier reads at release is.
- **`lab-discard`**: `seq`.
- **`flp-gesture`**: the same as `lab-gesture` without the labels, plus `dragRects[]` (the
  front card's rect each frame of the gesture; `t0` = top, `t` = timestamp).
- **`flp-flyout`**: `seq` (the gesture that caused it), `direction`, `viewport`,
  `frameRect`, `clipChain[]` (every ancestor of the flying card with overflow ≠ visible, a
  clip-path or paint containment, innermost first: `cls`, `overflow`, `clipPath`,
  `contain`, `rect`), and `rects[]` (the flying card's rect each frame). A card rect that
  crosses a clipper's edge while it is still inside the viewport is a visible clip.

Timestamps (`t`, `startedAt`, `verdictAt`, commit `t`) all share the page's
`performance.now()` clock (event `timeStamp`), so they can be compared within one session.

## The classifier these records tune

`src/features/flashcards/FlashcardsLearnPage/useCardDrag.ts` → `classifyRelease` (a pure
function, replayable offline against these records). It reads the gesture from refs that
every touch sample updates synchronously, and its thresholds live in
`src/features/flashcards/constants.ts`:

| Order | Rule | Constant(s) |
|---|---|---|
| 1 | The furthest raw travel is under the slop → tap | `CARD_TAP_SLOP` (10 px) |
| 2 | The sideways release speed over the last 80 ms is at least 0.4 px/ms, the sideways travel is at least 12 px, and both point the same way → flick dismiss | `CARD_FLICK_MIN_VELOCITY`, `CARD_FLICK_MIN_DISTANCE`, `CARD_FLICK_WINDOW_MS` |
| 3 | The amplified sideways travel is over 15% of the card width → dismiss, at any speed | `CARD_DISMISS_THRESHOLD_VW`, `CARD_DRAG_SENSITIVITY` |
| 4 | Anything else → snap back | — |

A slow, long drag counts as a swipe by distance (owner decision, 2026-11-17). The
"nudge" lab prompt therefore now expects what the classifier does, even though its
`expect` field still says `stay`.

**History.** The first real-flp run (2026-11-17, 106 gestures) found 13 of 31 flicks lost.
The old hook kept the drag in React state and classified the release from the last
*rendered* `dragPosition`. Its touchmove listener held a stale `isDragging`, so a fast
flick's moves were dropped before the heavy flp re-rendered. Replaying the new rules over
that run recovers all 14 failed flicks and loses no swipe that had worked. The same run
found two locks eating input; both are now relaxed (see the hook's header, "Locks"):
- Taps were ignored during the previous card's 450 ms fly-out. A tap there now flips.
- Swipes were ignored during the 350 ms flip. A swipe there now counts; a tap there is
  still ignored.

## Lifecycle

A temporary dev tool. Once the classifier and the clip are fixed, decide with the owner
whether to delete the page, the probe, the sink and the `data-card-role` attribute, or keep
them (registry row: [ACTIVE_DUTY_PAGES.md](./ACTIVE_DUTY_PAGES.md)).
