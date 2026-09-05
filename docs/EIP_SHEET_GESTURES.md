# EIP Sheet Gestures (SheetPanel)

How the eip bottom sheet is sized, dragged, flung, and dismissed. One component owns
all of it: `src/components/sheet/SheetPanel.tsx` (**moved** 2026-09-04 out of
`src/features/flashcards/FlashcardsLearnPage/`, with its four styled surfaces, when the
compare sheet made it a cross-feature dependency — see
[FRONTEND_LAYERING.md](./FRONTEND_LAYERING.md)).

`SheetPanel` is the generic sheet chrome (scrim + rounded container + grabber +
optional tab strip). It hosts a *body* that exposes `{root, scroll}` through a
`SheetPanelBodyHandle` ref: `root` is the element the raw touch listeners bind to,
`scroll` is the element whose `scrollTop` decides resize-vs-scroll, and which the
browser pans natively in `scroll` mode (so it needs `touch-action: pan-y` +
`overscroll-behavior: contain` — see "Gesture mode lock"). Current bodies:
`InfoCardPanelBody` (eip), `CompareWorkspace` (the eip Compare tab AND the standalone
compare sheet, `src/components/CompareSheet.tsx`) and `DecksPanelBody`
(the /decks sets sheet — see **Persistent mode** below). A fourth,
`SettingsPanelBody` (the flp settings sheet), was deleted on 2026-08-28 when the
last of its rows moved out — see [AUDIO_PLAYBACK.md](./AUDIO_PLAYBACK.md).

**Mount sites.** The eip sheet is not flp-private: the sort cards page (scp) and the
saved-card cdp mount the same `InfoCardSection`, and scp brings the `EipTabStrip` +
`useEipTabs` trio with it from each on-deck card's info button
([SORT_CARDS_REQUIREMENTS.md §4.7](./SORT_CARDS_REQUIREMENTS.md)). Everything on this
page applies to all of them, and to the compare sheet, which is a plain `SheetPanel`
host of its own ([WORD_COMPARE_FEATURE.md](./WORD_COMPARE_FEATURE.md)) — the first one
to use `depth` for real, stacking over the cdp's eip.

**A host no longer supplies a positioned parent (2026-08-30).** Both the scrim *and* the
sheet are portaled to the frame-level host (see "The scrim covers the screen"), so
`absolute; inset: 0` and `absolute; bottom: 0` resolve against the whole screen and
`parentElement.clientHeight` — the number the height model caps on — is the frame's.
That is what makes `MAX_HEIGHT_RATIO = 1` mean *the whole screen*: rendered in place the
sheet sat inside the page's content area, which starts **below** the page header and is
clipped by `MobileTabScreen`'s `ScrollArea`, so it could never have covered the header no
matter what ratio it was given.

Two host obligations disappeared with it: stretching the host down through
`FOOTER_CLEARANCE` (scp's `EipHost` negative bottom — now vestigial for the sheet), and
giving the host a z-index above anything the page lifts. What replaces the latter is
`SCRIM_BASE_Z_INDEX` / `SHEET_BASE_Z_INDEX` (**1200 / 1201**, `+ depth·2` per stack
level): the two layers now sort against the page's *top-level* layers, and those go high
— scp lifts its draggable cards to 1000 and its eip host to 1100. 1200 sits below MUI's
modal layer (1300), so a real `Dialog` still covers the sheet.

Because the sheet is portaled, nothing of `SheetPanel` is left in the page's DOM to walk
up from — so it renders an unpainted **anchor** (`display: none`) in place purely to give
`nearestScrimHost` a starting node, resolves the host in a layout effect (flushed before
paint, so there is no frame in which the sheet is unportaled), and mounts the sheet only
once the host is known. The mount/open-animation effect is keyed on `scrimHost` rather
than `[]` for exactly that reason.

---

## Two modes: modal (every host) and persistent (currently unused)

Everything below describes the **modal** sheet — the eip — which opens with an
animation, dims the page behind a scrim, and is dismissed by dragging it down. **Every
host is modal today**, including the /decks sets sheet (`FlashcardsDecksPage` →
`DecksPanelBody`, `variant="sheet"`), which was converted from persistent mode on
2026-08-24 so its stops and its button-to-open entry point match the eip's.

Passing **`minHeight` > 0** switches the same component into **persistent** mode. The
mode is still implemented and still correct, but **no caller passes `minHeight` any
more** — treat the column below as a spec for the next persistent sheet, not as a
description of something on screen:

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

**Choosing the resting height.** /decks used to derive it from the floating footer's own
geometry — `FOOTER_HEIGHT + FOOTER_EXTRA_GAP
+ SHEET_LIP` — so the lip that showed above the pill (grabber + first caption) survived
any change to the footer. A future persistent sheet should do the same. The footer is rendered at frame level with `zIndex: 100`
(`FooterPresenter`), well above the sheet's internal `11`, so the pill floats **over**
the sheet at every height; a persistent sheet's body must therefore reserve
`FOOTER_CLEARANCE` of bottom padding exactly as a page's scroll area does,
and wear its bottom edge-fade (`EDGE_FADE_MASK_NO_TOP` from `MobileTabScreen`) so the
content dissolves under the pill rather than being cut by it.

A **modal** panel is the other case, and it is the common one: the footer is gone, so the
scroller wears the short sheet band (`sheetEdgeFadeSx`, `src/components/sheet/sheetStyled.ts`)
ending at its own bottom edge. The eip's tab panes take it per pane — each pane in
`InfoCardPanelBody` is its own scroller — as does the generic `SheetBody`. The same mask
fades the scroller's TOP edge over 20px, so a pane's first rows dissolve under the tab
strip as they scroll up. See docs/UX_AND_NAVIGATION.md § Edge fade.

---

## Height model — three stops, one floor

| Stop | Value | Meaning |
|---|---|---|
| `0` | — | dismissed (panel unmounts after the shrink animation) |
| **default** | `parentHeight * DEFAULT_HEIGHT_RATIO` (0.6), or `initialHeight` for a stacked child panel | the open height; **also the floor** |
| **max** | `parentHeight * MAX_HEIGHT_RATIO` (**1**) | fully expanded — the sheet IS the screen |

There is **no resting stop between 0 and default**. `computeSnapTarget(h, default,
max, min, collapseRatio)` is the single rule every release path uses: below default →
`0` (dismiss); at or above → collapse back to `default` while the sheet sits below
`default + (max - default) * collapseRatio`, otherwise grow to `max`. A persistent
sheet passes `min > 0`, which suppresses the dismiss stop (see above).

`collapseRatio` comes from the **`collapseThresholdRatio`** prop and defaults to
**0.5**, which is exactly the plain "nearest stop wins" midpoint rule. A smaller value
moves the collapse point **down**, so the sheet springs back open from heights that
used to close it — a partial pull-down no longer counts as "close it". The /decks collections sheet used to pass **0.3** while it was persistent — it had to be
dragged below 30% of the closed→max travel before a release collapsed it — and now takes
the default 0.5 along with the rest of the eip's model. Note this only decides between the two upper stops; a
modal panel's dismiss floor is still its default height, untouched by the ratio.

The open height is a fixed fraction of the screen, deliberately *not* measured from
content, so every eip tab opens to the same extent.

### The cap is 1, and the top stop MERGES the sheet into the page (2026-08-30)

`MAX_HEIGHT_RATIO` used to be **0.92**, and that 8% strip of visible scrim was doing two
jobs at once: it said "there is a page behind this", and it was the tap-to-dismiss
target. Raising the cap to **1** removes both, so the top stop had to grow chrome that
replaces them. `writeMergeChrome` (`SheetPanel.tsx`) interpolates a ratio `t` from 0 → 1
across the last **`MERGE_ZONE_PX` (64)** of travel below the cap and paints, all of it as
direct style writes on the sheet element:

| at `t = 0` (a sheet) | at `t = 1` (a page) |
|---|---|
| `border-radius: 20px 20px 0 0` | square corners |
| `flashcard.sheetShadow` | no shadow — a merged sheet is not a surface *on* anything |
| `padding-top: 10px` above the grabber | the status-bar inset, so the grabber clears the clock |

The header is **not** in that table: it is permanent chrome, identical at both ends of the
ramp. It was the fourth row until 2026-09-05 (clipped to zero at `t = 0`, full-height and
opaque at `t = 1`).

Because it is a linear function of the sheet's height, the merge is continuous under the
finger — there is no state flip at a threshold to pop mid-drag — and on an *animated*
write it inherits the same `SNAP_DURATION_MS` transition as the height, so the corners,
the shadow and the header all arrive exactly when the sheet reaches its stop. It writes
nothing on a frame where `t` has not moved, which is every frame of a drag below the
merge zone. Like the height, **none of it is React state** — same reason (see "Height is
imperative").

### The panel header

The **`title`** prop supplies it; it is a real `PageHeader` (`size="node"`), not a
lookalike, so the header a panel wears is the app's one header. It lives in
`SheetHeaderSlot` (`sheetStyled.ts`) as the sheet's **second flex child**, directly under
the grabber row.

**The slot re-pads it.** `PageHeader`'s node spec is 23px above the row and **0 below**
(`SIZE_SPEC.node`) — right on a page, where that padding is the gap under the status bar
and nothing sits below the header but the page itself. A panel header is a *band*, with the
grabber above it and the body below, so the same asymmetry reads as the title and the ✕
shoved against the band's bottom edge. `SheetHeaderSlot` overrides both to
`SHEET_HEADER_PAD_Y` (12px), which centres the row at about the height the 23/0 version
had.

**It is present at every height (2026-09-05).** It used to be *merge* chrome — clipped to
zero by the slot and interpolated in over the last `MERGE_ZONE_PX`, so a panel only said
what it was once it had become the whole screen — with a `headerMode="always"` opt-out for
sheets whose body had no title row of its own (the compare sheet). Every call site wanted
the header at every height in the end, so the opt-out became the only mode and the prop is
gone. What this bought, beyond a panel that names itself at 60% height: the ✕ **stops
moving**. Three things went with the change —

- `SheetHeaderSlot` is a plain `flex-shrink: 0` wrapper (it was `height: 0;
  overflow: hidden; opacity: 0`), renamed from `SheetMergeHeaderSlot`;
- the mount-time measurement of the header's natural height is gone, along with
  `MERGE_HEADER_FALLBACK_PX` — nothing interpolates that height any more;
- `writeCloseOffset` is gone entirely (see the close cluster below).

**It carries the close cluster, not a chevron or a flame of its own.** `showBack={false}`
and `showFlame={false}`; the ✕ and, on study surfaces, `MinutePointsFireBadge` are passed
as `rightContent` instead. A chevron beside a permanent ✕ would be a second close button
doing the same thing, and `PageHeader` puts its own flame *last* — outboard of
`rightContent` — which would leave the flame in the corner rather than the ✕. `showFlame`
now has no caller at all in the sheet path; pages must never pass it.

**The whole header resizes the panel.** It is wrapped in `bindHeaderDrag` like the grabber
and the tab strip: the top edge is where a hand reaches to pull a sheet back down, and
before that binding only the 44px pill above it responded. `useDrag`'s `filterTaps` is
what keeps the ✕ inside it tappable.

Titles, one per host: `InfoCardSection` passes **"More Info"** (or **"Compare"** on the
compare tab) and thereby covers flp, scp and cdp at once; `FlashcardsDecksPage` passes
**"Cards"** / **"Decks"**, matching the pill that opened the sheet; `CompareSheet` passes
**"Compare"**. A panel with no `title` has no header and therefore no ✕ — it still grows to
full height, it just has no way out but a downward drag. Nothing ships in that state.

### The close cluster (✕ + flame)

One cluster per panel, in the header's right slot: `MinutePointsFireBadge` (study surfaces
only) then `SheetCloseX`, so the **✕ is the corner control** on every panel. `showClose`
overrides its presence; the default is "every modal panel has one, a persistent one does
not".

**Why study surfaces get the flame.** A panel covers its page's header, flame included,
and it does that precisely while the learner is reading a definition — which *is* study
time. So flp, scp, the cdp and the compare sheet pass `showMinutePoints`, and the
indicator survives at every panel height. Only the **root** panel draws it (`depth === 0`):
a stacked child covers its parent completely, so a second flame would be one indicator
behind another, and a third `useMinutePoints` tick.

**It does not move (2026-09-05).** The cluster used to live in the grabber row and slide
between rows as the panel grew — down into the tab strip's row when the word trail
appeared, and (briefly) onto the merge header's title line once there was one.
`writeCloseOffset` measured the target row's centre against the chrome row's on every
frame of a drag, `EipTabStrip` reserved a 41px `CLOSE_COLUMN_PX` for the cluster to land
in, and `writeMergeChrome` re-ran the measurement whenever the merge ratio moved. All of
that is deleted. The header is permanent, so the cluster simply lives in it, and the panel's
one always-available control is in the same place at every height — which is the property a
thumb actually needs. The trail gets its reserved column back as usable width.

What the ✕ *does* on the eip is still the trail's rule (close the showing word; the last
one closes the panel), passed in by the host as `onCloseX`; returning `true` from it means
"handled, stay open".

### The sheet grows for its tab strip — it does not squeeze

When the word trail appears, the strip is ~40px of new chrome. Laid out normally it takes
that space from the **body**: every line the learner is reading shifts down by a row,
which reads as the content jumping away from the tap that opened it. So `SheetPanel`
watches its tab-strip wrapper with a `ResizeObserver` and grows the sheet by exactly the
strip's height instead, taking the row from the screen. The **resting stop**
(`defaultHeightRef`) grows with it, or the next drag-release would snap back to a height
that no longer has room for the strip. The first measurement is a baseline only.

At the cap there is nothing left to take: a sheet already at full height cannot grow, and
the body does shift down by a row. That is the only case where it does.

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

### Only `resize` is driven by JS; `scroll` is native

The mode decides *who moves the pixels*, and this is the load-bearing part:

| Mode | Driver | `preventDefault()`? |
|---|---|---|
| `resize` | `applyResize` → a direct write to `element.style.height` | **yes** |
| `scroll` | the **browser**, panning the body's scroller | **no** — the handler returns |

A body's scroller therefore MUST carry `touch-action: pan-y` (plus
`overscroll-behavior: contain`, since the browser now owns the pan and would
otherwise chain it into the page behind the sheet). `SheetPanel` cancels only the
touchmoves it converts into a resize, and the mode is locked on the gesture's
**first** committed move — the one touchmove that is still cancelable — so a resize
is never lost to a scroll the browser already started.

> **Why (2026-08-24).** `scroll` mode used to do `scrollEl.scrollTop += dy` inside
> this non-passive handler, with the scroller pinned to `touch-action: none`. That
> put the scroll on the **main thread**, so every frame of it waited on whatever
> React/layout work the body was doing. On a light body (the eip) it was invisible;
> on the decks panel — ~470 mini cards, each with a cpcd row that re-measures itself
> — it stuttered badly. The tell was that the *identical* card grid on
> `CollectionViewPage` scrolled fine, because that page has always scrolled
> natively. Handing `scroll` back to the compositor closed the gap.

> **The eip's own panes were missed by that change (fixed 2026-08-28).**
> `InfoCardSection` kept passing `scrollTouchAction="none"` down to
> `InfoCardPanelBody`'s three tab panes, so in the eip `scroll` mode did nothing at
> all: `SheetPanel` correctly stopped writing `scrollTop`, and the browser refused
> to pan a `touch-action: none` element. The symptom was that a drag grew the sheet
> normally but the content stayed frozen once the sheet hit max height — visible
> only on the est tab, the one pane whose content routinely overflows. The panes now
> pass `pan-y`, which also leaves the tab-swipe free to `preventDefault` horizontal
> moves (the browser never owns those under `pan-y`).

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
3. otherwise → **momentum** — `resize` mode only. A `scroll` gesture is the
   browser's, fling included; running our rAF momentum on top of a native fling
   would double-scroll, so `touchend` returns early for it.

### Momentum floors at the default height

Momentum in `resize` mode is clamped to `[default, max]` — **not** `[0, max]`. So a
downward fling coasts to the default height and **stops there; momentum never
dismisses.** An upward fling stops dead at max. Inertia still cannot cross between
the two modes — not because momentum is mode-locked (it no longer has a `scroll`
arm at all), but because the gesture's mode is locked before either kind of inertia
can start.

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
interrupted or never fires. **Tapping the scrim goes through `dismiss()` too**; it used
to call `onClose` directly, so the sheet and its dim vanished in a single frame while
every other close path shrank.

`dismiss()` also **fades the scrim out** over `SCRIM_FADE_OUT_MS` (= `SNAP_DURATION_MS`),
so the dim leaves with the sheet instead of staying fully lit for the whole shrink and
then popping off. The fade IN is the other half and lives elsewhere: a mount-time
keyframe on `EicScrim` (`eicScrimIn`, 0.18s), because mounting is the whole trigger.
The fade OUT cannot work that way — only `SheetPanel` knows a dismiss has begun — so it
is written imperatively (`scrimRef`), for the same reason the height is: a state flag
would re-render the entire sheet body through the `children` render function on the way
out. It sets `animation: none` first and flushes, so the transition starts from a real
computed opacity of 1 rather than from the finished keyframe.

A host that unmounts the panel WITHOUT going through `dismiss()` (a route change, say)
still gets no fade — there is no animation frame left to play it in.

---

## The scrim covers the screen — and must share the sheet's stacking context

`EicScrim` is `position: absolute; inset: 0`, which dims exactly its nearest positioned
ancestor. Rendered in place that ancestor was the host page's content area (flp's
`ContentArea`), so the page's own header stayed bright and the dim read as covering only
part of the screen. `SheetPanel` therefore **portals** the scrim out, in a layout effect
that walks up from the panel's in-place anchor (`nearestScrimHost`, `SheetPanel.tsx`).
Since 2026-08-30 the **sheet is portaled to the same host**, for the height reason in
"Mount sites" above; everything below about choosing that host applies to both layers.

The host is **not** unconditionally the phone frame. It is the nearest ancestor that
satisfies BOTH of:

1. **It creates a stacking context** (`transform` / `filter` / `perspective` /
   `backdrop-filter` / `contain` / `will-change: transform`) — or it IS the frame
   (`.mobile-demo-frame` / `FrameRoot`), which is where the walk stops.
2. **It covers the frame** (rect check). An animated inner box could satisfy (1) without
   filling the screen; hosting there would dim a box instead of the page, so the walk
   falls back to the frame.

`document.body` is the last-resort fallback.

**Why (1) matters — the cdp bug (fixed 2026-08-24).** z-indexes only compare inside a
shared stacking context. `NodePage`'s `Surface` carries the page-slide `transform`
(`usePageSlide`), which both creates a stacking context and becomes the containing block
for absolute descendants. The sheet's `11 + depth·2` was sealed inside `Surface`, `Surface`
itself competed at `auto`, and a frame-hosted scrim at `10 + depth·2` painted over the
entire page **including the sheet** — the cdp's eip looked greyed out the whole time it
was open. Hosting the scrim inside `Surface` puts the two back in one context. Any new
page archetype that transforms its surface inherits the fix automatically.

- **Not `position: fixed`** — on desktop that resolves against the viewport and would dim
  the browser window around the phone card.
- **Plain pages are unchanged.** flp's content area is `position: relative` with
  `z-index: auto` and creates no stacking context, so the walk still reaches the frame.
- **The footer is hidden for every modal sheet, by the sheet itself** (2026-08-30).
  `SheetPanel` calls `useHideFooter(minHeight <= 0)`, so the hold covers its whole
  lifetime on every host and is released on unmount. It used to be each page's job —
  `useHideFooter(eipOpen)` in `SortCardsPage`, `useHideFooter(infoOpen)` in
  `VocabCardDetailPage`, **both now deleted** — which left flp and fdp's modal sheets
  without one. A **persistent** sheet keeps the footer: it is page furniture whose
  resting height is chosen to clear the bar, not a modal that takes over the screen.

  Hiding the bar is not cosmetic. It is opaque, rendered at frame level
  (`FooterPresenter`, z-index 100) and outside every page's DOM, so it covered the
  sheet's bottom ~`FOOTER_CLEARANCE`px — including the end of whichever tab pane was
  showing. The pane still scrolled (its content had already reached the end); the end
  was simply underneath the bar, which read as "this tab refuses to scroll". That was
  the cdp definition-tab report (fixed 2026-08-28). Note the sheet's z-index now clears
  the bar on its own (1201 > 100); the hold is what keeps the bar from sitting *beside*
  a full-height sheet with nothing to do.

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

## Word-trail transitions (entry pager)

Two horizontal motions live in this panel and they must not fight:

| Motion | Scale | Owner |
|---|---|---|
| Sub-tab track (definition / examples / breakdown) | one pane | `InfoCardPanelBody` — declarative transform + `TAB_SWIPE_TRANSITION`, plus the drag path above |
| **Entry pager** (word ↔ word in the trail) | whole panel body | `InfoCardSection` |

A drill-in (breakdown character, example segment, "used in" row) pushes a **new pill**
onto the trail whose sub-tab starts at Definitions. Because the body is a single
persistent instance serving every entry tab, that used to show up as the sub-tab track
sliding **backwards** to Definitions — motion that read as "you went back" while the
trail had in fact grown forwards.

Now:

1. **The sub-tab track jumps silently on an entry change.** `InfoCardPanelBody`'s
   entry-jump `useLayoutEffect` pins the track inline with `transition: none` at the new
   entry's resting transform, flushes, and hands the position back to the declarative
   style on the next frame. Its `entryJumpRef` also suppresses the `selectedTab` effect's
   inline-clear for that one frame (which would otherwise restore the transition and let
   the suppressed slide play). Both the rAF and the effect cleanup clear the pin, so a
   second drill-in in the same frame cannot leave the track frozen. The effect depends on
   `selectedTab` as well as the entry key and gates on the key having actually changed —
   a plain sub-tab tap keeps its normal slide.
2. **The panel body slides in from the side the trail moved.** `InfoCardSection` runs a
   WAAPI enter animation (`ENTRY_SLIDE_TRAVEL_PCT` 34%, `ENTRY_SLIDE_MS` 280ms, easing
   matched to `TAB_SWIPE_TRANSITION`) on a wrapper around the body whenever the active
   tab's **id** changes; the direction is the sign of the `activeIndex` delta, so a pushed
   tab (always appended) enters from the right and tapping a pill to the left enters from
   the left. Hosts opt in by passing `entryTabId` / `entryTabIndex` (flp and scp do; the
   cdp has no trail and passes neither, disabling the animation).
   - It is **enter-only** — the outgoing word's DOM is already gone — which is why the
     travel is a fraction of the panel width rather than a full page.
   - It is **imperative, not a keyed remount**: remounting would tear down the three
     always-mounted panes, re-bind `bodyKey`'s scroll coupling, and drop per-pane scroll.
   - The wrapper sets `overflow: hidden` only for the animation's duration, so nothing
     the panel legitimately overhangs with (menus/popovers) is clipped at rest.
3. **The new pill grows into the strip.** `EipEntryTab` carries a mount-time keyframe
   (`eipPillIn`, `styled.ts`) animating max-width + horizontal padding + opacity, so the
   pills already on the strip are pushed aside rather than jumped aside. A pill only ever
   mounts when a word is added to the trail, so the mount *is* the trigger — no state.

---

## Referenced code

- `src/components/sheet/SheetPanel.tsx` — everything above
  (the scrim portal host, constants block, `computeSnapTarget`, `writeHeight`/`freezeHeight`/`applyResize`,
  `settle`/`dismiss`, `bindHeaderDrag`, the wheel + touch effect, `startMomentum`,
  the tab-strip `ResizeObserver`)
- `src/components/sheet/SheetCloseX.tsx` — the shared ✕, also worn by the challenge
  sheet (`src/features/studyChallenge/ChallengeSheet.tsx`, docs/STUDY_CHALLENGE.md § 3.2)
- `src/components/PageHeader.tsx` — `rightContent`, which is how the panel header carries
  the close cluster
- `src/features/flashcards/FlashcardsLearnPage/InfoCardSection.tsx` — eip wiring,
  `bodyKey` (re-binds the coupling when the active tab's scroller changes), the entry
  pager slide (`entryTabId` / `entryTabIndex`)
- `src/features/flashcards/FlashcardsLearnPage/InfoCardPanelBody.tsx` — body handle,
  per-pane scrollers, horizontal tab-swipe axis lock, end-of-strip rubber-band, the
  entry-jump layout effect (`entryJumpRef`)
- `src/features/flashcards/FlashcardsLearnPage/styled.ts` — `EipEntryTab` + the
  `eipPillIn` entrance keyframes
- `src/features/flashcards/FlashcardsLearnPage/EipTabStrip.tsx` — the trail pills (it no
  longer reserves a column for the ✕; see § The close cluster)
- `src/features/flashcards/constants.ts` — `TAB_SWIPE_*` gesture constants
  (axis lock, commit ratio, transition, edge rubber-band)
- `src/components/CompareWorkspace.tsx` — the other sheet body;
  `src/components/CompareSheet.tsx` — the host that pairs it with a `SheetPanel` off the flp
- `src/features/flashcards/DecksPanelBody.tsx` + `FlashcardsDecksPage.tsx` — a second
  MODAL host (`openSheet`, the `.flashcards-decks__cards-pill` /
  `.flashcards-decks__decks-pill` pair). It was persistent mode's only caller until
  2026-08-24; that mode now has no callers
- `src/features/flashcards/FlashcardsLearnPage/useEipTabs.ts` — tab state + drill-in
  lookups (`openForRoot`, `openForEntryKey`, `clear`); takes an optional `language` that
  scopes those lookups
- `src/api/dictionary.ts` — `lookupVocabEntry(entryKey, language?)`, the single
  det-lookup-and-adapt every eip host goes through
- `src/features/discover/SortCardsPage.tsx` — the non-flp mount (`EipHost`,
  `handleOpenCardInfo`)
