# EIP Sheet Gestures (SheetPanel)

How the eip bottom sheet is sized, dragged, flung, and dismissed. One component owns
all of it: `src/features/flashcards/FlashcardsLearnPage/SheetPanel.tsx`.

`SheetPanel` is the generic sheet chrome (scrim + rounded container + grabber +
optional tab strip). It hosts a *body* that exposes `{root, scroll}` through a
`SheetPanelBodyHandle` ref: `root` is the element the raw touch listeners bind to,
`scroll` is the element whose `scrollTop` decides resize-vs-scroll. Current bodies:
`InfoCardPanelBody` (eip), `CompareWorkspace` (compare tab), `SettingsPanelBody`,
`DecksSheetBody` (the /decks sets sheet — see **Persistent mode** below).

**Mount sites.** Despite living under `FlashcardsLearnPage/`, the eip sheet is no longer
flp-private: the sort cards page (scp) mounts the same `InfoCardSection` + `EipTabStrip`
+ `useEipTabs` trio from each on-deck card's info button
([SORT_CARDS_REQUIREMENTS.md §4.7](./SORT_CARDS_REQUIREMENTS.md)). Everything on this
page applies to both. The one thing a host must supply is a **positioned parent**:
`SheetPanel`'s scrim (`absolute; inset: 0`) and container (`absolute; bottom: 0`) resolve
against it, and the height model below reads `parentElement.clientHeight` — so that
parent, not the viewport, is what caps the sheet. Two things that parent must also do on
a footer-bearing page (both learned the hard way on scp — see its `EipHost`): stretch
down through `FLOATING_FOOTER_CLEARANCE`, or the sheet floats above the screen edge; and
carry a z-index above anything the host page lifts, because the scrim/sheet z-indexes
below (10/11) are *internal* to `SheetPanel` and lose to any page element with a bigger
one (scp's draggable cards sit at 1000).

---

## Two modes: modal (eip) and persistent (/decks)

Everything below describes the **modal** sheet — the eip — which opens with an
animation, dims the page behind a scrim, and is dismissed by dragging it down.

Passing **`minHeight` > 0** switches the same component into **persistent** mode,
used by the /decks sets sheet (`FlashcardsDecksPage` → `DecksSheetBody`). A
persistent sheet is page furniture rather than a modal:

| | modal (`minHeight = 0`, default) | persistent (`minHeight > 0`) |
|---|---|---|
| stops | `{0, default, max}` | `{minHeight, max}` — `default` **is** `minHeight` |
| on mount | animates `0 → default` | painted **at** `minHeight`, no animation |
| drag to the bottom | dismisses (`onClose` after the shrink) | stops dead at `minHeight` |
| release below default | dismiss | snap back to `minHeight` |
| release between the stops | collapse below `collapseThresholdRatio` of the travel, else grow to max | same rule, from `minHeight` |
| fling down | floors at `default` (never dismisses) | floors at `minHeight` |
| scrim | yes | `showScrim={false}` — it is always on screen, so a permanent dim, and a scrim tap would have nothing to dismiss to |
| `onClose` | required in practice | **omitted** — nothing to report |

The three constants are the only branch points in the code (`persistent =
minHeight > 0`): `computeSnapTarget` drops its dismiss stop, the mount effect skips
the open animation, and every `applyResize` floor becomes `minHeightRef.current`
instead of `0`. There is no second implementation of the gesture model.

**Choosing the resting height.** /decks derives it from the floating footer's own
geometry — `FLOATING_FOOTER_INSET + FLOATING_FOOTER_HEIGHT + FLOATING_FOOTER_EXTRA_GAP
+ SHEET_LIP` — so the lip that shows above the pill (grabber + first caption) survives
any change to the footer. The footer is rendered at frame level with `zIndex: 100`
(`FooterPresenter`), well above the sheet's internal `11`, so the pill floats **over**
the sheet at every height; a persistent sheet's body must therefore reserve
`FLOATING_FOOTER_CLEARANCE` of bottom padding exactly as a page's scroll area does,
and wear its bottom edge-fade (`EDGE_FADE_MASK_NO_TOP` from `MobileTabScreen`) so the
content dissolves under the pill rather than being cut by it.

---

## Height model — three stops, one floor

| Stop | Value | Meaning |
|---|---|---|
| `0` | — | dismissed (panel unmounts after the shrink animation) |
| **default** | `parentHeight * DEFAULT_HEIGHT_RATIO` (0.6), or `initialHeight` for a stacked child panel | the open height; **also the floor** |
| **max** | `parentHeight * MAX_HEIGHT_RATIO` (0.92) | fully expanded |

There is **no resting stop between 0 and default**. `computeSnapTarget(h, default,
max, min, collapseRatio)` is the single rule every release path uses: below default →
`0` (dismiss); at or above → collapse back to `default` while the sheet sits below
`default + (max - default) * collapseRatio`, otherwise grow to `max`. A persistent
sheet passes `min > 0`, which suppresses the dismiss stop (see above).

`collapseRatio` comes from the **`collapseThresholdRatio`** prop and defaults to
**0.5**, which is exactly the plain "nearest stop wins" midpoint rule. A smaller value
moves the collapse point **down**, so the sheet springs back open from heights that
used to close it — a partial pull-down no longer counts as "close it". The /decks
collections sheet passes **0.3** (`SHEET_COLLAPSE_THRESHOLD_RATIO` in
`FlashcardsDecksPage.tsx`): it must be dragged below 30% of the closed→max travel
before a release collapses it. Note this only decides between the two upper stops; a
modal panel's dismiss floor is still its default height, untouched by the ratio.

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

### Rubber-band at the ends of the tab strip

Toward a neighboring tab the finger delta is clamped to one pane width. Toward an
**end** of the strip — left on the last tab (breakdown / "used in"), right on the first
(definition) — the track used to clamp to exactly **zero** travel, which is visually
indistinguishable from "this tab has no swipe at all". It now rubber-bands instead:
the track follows the finger at `TAB_SWIPE_EDGE_RUBBER_RATIO` (0.25) of its travel,
capped at `TAB_SWIPE_EDGE_RUBBER_MAX_PX` (40px), and springs back on release. The cap
sits far below the commit threshold (`paneWidth · TAB_SWIPE_COMMIT_RATIO`) and
`settleDrag` rejects out-of-range targets, so an overscroll can never land on a tab
change. See `InfoCardPanelBody.tsx`'s touchmove handler and the constants block in
`src/features/flashcards/constants.ts`.

---

## Referenced code

- `src/features/flashcards/FlashcardsLearnPage/SheetPanel.tsx` — everything above
  (constants block, `computeSnapTarget`, `writeHeight`/`freezeHeight`/`applyResize`,
  `settle`/`dismiss`, `bindHeaderDrag`, the wheel + touch effect, `startMomentum`)
- `src/features/flashcards/FlashcardsLearnPage/InfoCardSection.tsx` — eip wiring,
  `bodyKey` (re-binds the coupling when the active tab's scroller changes)
- `src/features/flashcards/FlashcardsLearnPage/InfoCardPanelBody.tsx` — body handle,
  per-pane scrollers, horizontal tab-swipe axis lock, end-of-strip rubber-band
- `src/features/flashcards/constants.ts` — `TAB_SWIPE_*` gesture constants
  (axis lock, commit ratio, transition, edge rubber-band)
- `src/components/CompareWorkspace.tsx`, `SettingsPanelBody.tsx` — other sheet bodies
- `src/features/flashcards/DecksSheetBody.tsx` + `FlashcardsDecksPage.tsx` — the
  persistent-mode host (`SHEET_LIP`/`SHEET_CLOSED_HEIGHT`, `SHEET_COLLAPSE_THRESHOLD_RATIO`,
  `minHeight`, `showScrim={false}`, `collapseThresholdRatio`)
- `src/features/flashcards/FlashcardsLearnPage/useEipTabs.ts` — tab state + drill-in
  lookups (`openForRoot`, `openForEntryKey`, `clear`); takes an optional `language` that
  scopes those lookups
- `src/api/dictionary.ts` — `lookupVocabEntry(entryKey, language?)`, the single
  det-lookup-and-adapt every eip host goes through
- `src/features/discover/SortCardsPage.tsx` — the non-flp mount (`EipHost`,
  `handleOpenCardInfo`)
