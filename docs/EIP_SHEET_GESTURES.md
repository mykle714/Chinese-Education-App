# EIP Sheet Gestures (SheetPanel)

How the eip bottom sheet is sized, dragged, flung, and dismissed. One component owns
all of it: `src/features/flashcards/FlashcardsLearnPage/SheetPanel.tsx`.

`SheetPanel` is the generic sheet chrome (scrim + rounded container + grabber +
optional tab strip). It hosts a *body* that exposes `{root, scroll}` through a
`SheetPanelBodyHandle` ref: `root` is the element the raw touch listeners bind to,
`scroll` is the element whose `scrollTop` decides resize-vs-scroll. Current bodies:
`InfoCardPanelBody` (eip), `CompareWorkspace` (compare tab), `SettingsPanelBody`.

---

## Height model — three stops, one floor

| Stop | Value | Meaning |
|---|---|---|
| `0` | — | dismissed (panel unmounts after the shrink animation) |
| **default** | `parentHeight * DEFAULT_HEIGHT_RATIO` (0.6), or `initialHeight` for a stacked child panel | the open height; **also the floor** |
| **max** | `parentHeight * MAX_HEIGHT_RATIO` (0.92) | fully expanded |

There is **no resting stop between 0 and default**. `computeSnapTarget(h, default, max)`
is the single rule every release path uses: below default → `0` (dismiss); at or
above → whichever of `{default, max}` is nearer.

The open height is a fixed fraction of the screen, deliberately *not* measured from
content, so every eip tab opens to the same extent.

### Height is imperative, not React state

`heightRef` + a direct write to `element.style.height` (`writeHeight`) are the only
owners of the sheet's height; `height` never appears in the JSX `style` prop, so
React has no record of it and can never overwrite it. This matters because callers
pass `children` as a **render function** (`InfoCardSection`), so any state update in
`SheetPanel` re-renders the whole eip body — which, at one update per touchmove and
per momentum frame, produced the long frames that made flings stutter and die early.

`writeHeight(h, animate)` also owns the CSS transition: it is set for exactly the one
write that wants it and cleared for every other. So grabbing a snapping sheet returns
to 1:1 finger tracking immediately instead of trailing by the snap duration.

`freezeHeight()` pins the sheet to its **on-screen** height (via
`getBoundingClientRect`) and kills the transition. It is called on a gesture's first
*real movement*, never at touch-down — so a tap can't interrupt the open animation,
but a drag always takes over from what the user sees rather than from an animation's
not-yet-reached target.

---

## Gesture mode lock

A touch gesture picks one mode on its **first committed move** and keeps it for the
rest of the gesture *and* for its release momentum. Modes never cross over: a resize
that reaches a boundary is a hard stop, and the user must lift and start a fresh
gesture to begin scrolling (or vice versa).

- swipe **up** (`dy > 0`) → `resize` while there is room to grow, else `scroll`
- swipe **down** (`dy < 0`) → `scroll` while the content is off its top, else `resize`

---

## Release: snap, dismiss, or fling

Release velocity is measured over the **last `VELOCITY_WINDOW_MS` (90ms)** of samples,
not smoothed over the whole gesture — so a quick flick at the end of a slow drag still
flings. A release landing more than that window after the last move counts as
stationary (velocity 0): the finger was parked when it lifted.

On `touchend` (only when the *last* finger lifts):

1. `resize` mode and height < default → **dismiss**. This is the only way a swipe
   closes the panel.
2. `|v| < FLING_MIN_VELOCITY` → **settle** (`computeSnapTarget`).
3. otherwise → **momentum**, locked to the gesture's mode.

### Momentum floors at the default height

Momentum in `resize` mode is clamped to `[default, max]` — **not** `[0, max]`. So a
downward fling coasts to the default height and **stops there; momentum never
dismisses.** An upward fling stops dead at max. In `scroll` mode momentum stops at the
content's own bounds and never spills into a panel resize.

Momentum integrates with a capped frame time (`MOMENTUM_MAX_FRAME_MS`, 32ms) so one
janky frame can't teleport the sheet or wipe out the fling through the
`decay^(dt/16)` term. Whenever momentum ends — decayed out or stopped at a boundary —
`resize` mode runs `settle()` so it always comes to rest on a stop.

The live-finger path uses floor `0` (that's the dismiss gesture); only momentum uses
the default-height floor. That's the whole difference, expressed as the `minH`
argument to `applyResize`.

### Wheel (desktop)

`deltaY > 0` grows the sheet; `deltaY < 0` shrinks it, but only from the top of the
content. A wheel gesture has no release, so crossing below the default height
dismisses immediately. Only the top-most mounted `depth` reacts (module-level
`mountedDepths` set); touch is already top-only via DOM hit-testing.

### Dismiss

`dismiss()` is idempotent (`dismissingRef`), stops momentum, animates to 0, and calls
`onClose` on a `SNAP_DURATION_MS + 20` timer — a timer rather than `transitionend`
because the duration is ours and a timer can't be missed if the transition is
interrupted or never fires. Tapping the scrim closes immediately without the shrink.

---

## Drag zones outside `root`

The grabber, the tab strip, and the eip entry header sit **outside** the body's
`root`, so the raw touch listeners never see them. They share `bindHeaderDrag`
(`useDrag`, `axis: "y"`, `filterTaps: true`) instead, which tracks absolutely from
the height captured on the drag's first real movement and calls the same `settle()`
on release. `filterTaps` keeps taps on header icons and tab chips working.

## Interaction with the body's own horizontal swipe

`InfoCardPanelBody` binds its own **raw** touch listeners on an inner clip box so its
`stopPropagation()` runs before `SheetPanel`'s ancestor listener (React synthetic
handlers would be too late — see the long comment at `InfoCardPanelBody.tsx`'s gesture
effect). It swallows every touchmove until its axis lock resolves; if it resolves `y`
it stops interfering and `SheetPanel` sees one correct larger delta covering the
gesture so far.

---

## Referenced code

- `src/features/flashcards/FlashcardsLearnPage/SheetPanel.tsx` — everything above
  (constants block, `computeSnapTarget`, `writeHeight`/`freezeHeight`/`applyResize`,
  `settle`/`dismiss`, `bindHeaderDrag`, the wheel + touch effect, `startMomentum`)
- `src/features/flashcards/FlashcardsLearnPage/InfoCardSection.tsx` — eip wiring,
  `bodyKey` (re-binds the coupling when the active tab's scroller changes)
- `src/features/flashcards/FlashcardsLearnPage/InfoCardPanelBody.tsx` — body handle,
  per-pane scrollers, horizontal tab-swipe axis lock
- `src/components/CompareWorkspace.tsx`, `SettingsPanelBody.tsx` — other sheet bodies
