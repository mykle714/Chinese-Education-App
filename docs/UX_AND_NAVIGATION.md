# UX & Navigation

Umbrella reference for how users move through the app and how the mobile shell
behaves. This is the index for the navigation archetypes, the scrollable-page
layout, and the global touch/scroll/selection rules. Start here, then drill into the
specific doc.

## Sub-documents

| Concept | Doc | One-liner |
|---|---|---|
| **App navigation structure** | [NAVIGATION.md](./NAVIGATION.md) | No hamburger/sidebar; nav is the footer tabs (Flashcards / Discover / Home / Account) + the `/` Home menu + back-arrow drill-ins. Settings + Logout live on the Account page. |
| **Scrollable footer-tab layout** | [MOBILE_TAB_SCREEN_LAYOUT.md](./MOBILE_TAB_SCREEN_LAYOUT.md) | Every scrollable footer-tab page uses `MobileTabScreen` (header scrolls away inside the scroll area; bottom nav is a flat full-width bar). Home, Decks, Discover, Games hub, Account use it. |
| **Drill-in page archetypes** | [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md) | Two back-arrow archetypes. **Leaf** (`LeafPage`): down arrow, no footer, back-arrow-only exit, slides up/down. **Node** (`NodePage`): left arrow, keeps footer, slides in/out to the right. Rule of thumb: no footer ⇒ leaf, has footer ⇒ node. |
| **eip bottom-sheet gestures** | [EIP_SHEET_GESTURES.md](./EIP_SHEET_GESTURES.md) | `SheetPanel`'s height model: three stops (0 / default / max) with the default height as the floor, one snap rule, the resize-vs-scroll mode lock, and release momentum that stops at the default height instead of dismissing. |
| **Discover surface** | [DISCOVER_FLOW.md](./DISCOVER_FLOW.md) | Two-level Discover surface: the `/discover` hub menu (footer tab) → `/discover/sort/:language` drag-to-sort page (back-arrow header, no footer). |

---

## Touch & Scroll (mobile)

This is a mobile-first app built around drag gestures. Components you create should
default to `touchAction: "none"` so background/empty-area touches don't trigger the
browser's native pan/scroll (which fights the drag interactions). Only set a
scroll-permitting value (`auto`, `pan-y`, etc.) on a component when explicitly told
it should be scrollable.

⚠️ **But a container that IS scrollable must scroll natively.** `touch-action: none`
on a scroller means something has to move it from JS, and a `scrollTop += dy` inside a
non-passive `touchmove` runs on the **main thread** — so the scroll advances only as
fast as the main thread finishes each frame, and any render/layout work in the content
becomes visible stutter. Use `pan-y` (+ `overscroll-behavior: contain`) and let the
compositor pan it; if a gesture handler must also claim some of those touches, have it
`preventDefault()` only the ones it actually takes, on the gesture's first (cancelable)
move. Learned from the decks sheet, 2026-08-24 — see
[EIP_SHEET_GESTURES.md](./EIP_SHEET_GESTURES.md) § "Only `resize` is driven by JS".

**The app shell is non-scrollable by default — scrolling is opt-in per page.**
`html`/`body` are pinned to the visible viewport with `overflow: hidden` (see
`src/index.css`), and `#root` is the only shell-level scroller (`100dvh`,
`overflow-y: auto`, in `src/App.css`) — it exists solely to reveal the desktop
phone card and never scrolls on mobile. A page that needs to scroll must provide
its **own inner scroll container**; nothing should make the whole page (header +
footer) scroll. For footer-tab hub pages this container is `MobileTabScreen`'s
`ScrollArea`. Never reintroduce `overflow-y: auto` / `min-height: 100vh` on
`html`/`body` — that lets the entire app scroll and drags the scroll-away header
and the footer bar with it.

> ⚠️ **A scroll container needs a DEFINITE height, and on the `plain` shell that means
> `100dvh`, not `100%`.** `Layout`'s non-frame branch (`src/components/Layout.tsx`)
> wraps the page in a column flex box with **`minHeight: 100dvh` and an auto height**,
> so a child's percentage height has no definite parent to resolve against: the box
> silently grows to its content, `overflowY: auto` never engages, and the pinned
> `html`/`body` clip the overflow instead. The symptom is a page that renders correctly
> but simply will not scroll. Frame-shell pages don't hit this — `MobileTabScreen` /
> `LeafPage` already bound the height, so their scroll areas use `flex: 1`. Worked
> example: `src/pages/fontLab/FontLabPage.tsx`.

Text is **non-selectable by default app-wide** — `src/index.css` sets `user-select:
none` on `body` (it cascades to everything). Form fields (`input`/`textarea`/
`contenteditable`) are re-enabled there. The **only** selectable content exception is
**cpcd** (`.cpcd-row__chars` / `.cpcd-row__pinyin-cell`), and only on non-touch
devices — the `@media (hover: hover) and (pointer: fine)` block in `index.css` makes
cpcd selectable on desktop but keeps it non-selectable on mobile. Don't sprinkle
per-component `userSelect: "none"`; rely on the global default and only opt specific
content into `userSelect: "text"` (desktop-gated) when called out.

### Pan/zoom surfaces

Two surfaces let the user move a camera over a world larger than the screen, and they
are built differently on purpose:

* **Night market** (`src/features/nightmarket/`) — Pixi, isometric, hundreds of sprites
  with per-frame animation. It needs a scene graph.
* **Memory Map** (`src/games/memory-map/MemoryMapWorld.tsx`) — plain DOM, one CSS
  `transform` on a world div, no rAF loop. It is capped at 100 absolutely-positioned
  word nodes (`MEMORY_MAP_CAPACITY`), which is what makes that safe: nothing to cull,
  no scene graph to justify. Its camera is stored as **the world coordinate at the
  centre of the viewport, plus a zoom** rather than as a pixel offset, so a run saved on
  one screen size resumes looking at the same place on another.

A future pan/zoom surface should follow whichever of these its content resembles — and
should not grow a *second* Pixi host if it needs one; borrow the night market's
(`pixiRuntime.ts`).

> ⚠️ **`@use-gesture` drag + pinch on touch — two traps, same symptom.** Both present as
> "panning is broken on mobile" (see MEMORY_MAP_GAME.md § 14.5):
>
> 1. Binding `drag` and `pinch` together requires `drag: { pointer: { touch: true } }`.
>    Otherwise the pointer-event stream is cancelled on touch devices once the browser
>    arbitrates between the two gestures, and the pan **works with a mouse and does
>    nothing on a phone**. A plain `useDrag` with nothing competing (SortCardsPage) does
>    not need it — it is the combination that breaks.
> 2. If you need `eventOptions: { passive: false }` (to preventDefault the browser's own
>    pinch-zoom), you **must** bind with the `target` option and must **not** spread
>    `bind()`. React's synthetic listeners are always passive, so asking for both yields
>    a half-bound gesture rather than an error — and because spread handlers are rebuilt
>    on every render, the gesture dies the first time the surface re-renders during play.
>
> Relatedly: on a surface where draggable content covers most of the screen, child
> elements with their own tap handlers must distinguish a tap from a pan themselves
> (a press-position + slop check), or every pan that begins on a child fires that
> child's tap (§ 14.6).

**Games must block the mobile edge-swipe-back gesture by default.** Every game page
should call `useBlockEdgeSwipe(true)` (`src/hooks/useBlockEdgeSwipe.ts`) so a swipe
from the left/right screen edge doesn't navigate away mid-drag. `touch-action: none`
does NOT stop this — the browser claims the history-navigation gesture before the
element sees the touch, so it must be cancelled at the touch-event layer. Reference
implementation: `src/games/bubble-match/BubbleMatchPage.tsx`.

---

## Scroll stretch (elastic card spacing)

Every list of **preview cards** behaves as though it were laid on a sheet of **elastic
fabric** being dragged by the scroll. The sheet is **pinned at the trailing edge** of
travel (the edge cards are leaving by) and the scroll draws the rest of it away from
that pin, further the further from it a card sits — so the visible cards lag behind the
scroll rather than running ahead of it, every neighbouring pair moves apart, and the gaps
**open out** while the list moves and close again when it stops. Card sizes never change;
only the space between them does.

The shape is two independent pieces, and keeping them independent is what makes scrolling
up behave identically to scrolling down: `rubberBand(|drag|)` gives **how much** the sheet
is open in total, and `spreadProfile(distance from the pin)` gives **how that spreads**
along it. The magnitude is direction-free; the profile carries the sign. The profile must
be strictly *increasing* in distance — a gap is the difference between two neighbouring
shifts, so an increasing profile opens gaps and a decreasing one closes them. Taking an
absolute value anywhere in the profile turns one side of the pin back into a squeeze —
which is exactly the bug that shipped for a day.

The model is **UIScrollView's**, deliberately, and three of its properties are what make
it read as native rather than as an animation:

| Property | What it means here |
|---|---|
| **Displacement-driven, never velocity-driven** | The stretch is a function of how far the content has actually been dragged (`drag`, integrated from real per-frame scroll deltas), not of an estimated speed. The fabric tracks the finger instead of reacting to it — and there is no velocity estimate, so there is nothing spiky to filter. |
| **Resistance saturates, never clamps** | Apple's rubber band `b(x) = (1 − 1/(x·c/d + 1))·d/c` reduces to `A·x/(x + A)` for asymptote `A = d/c`, easing onto a ceiling it never reaches. A hard cap instead puts a visible crease in the fabric — every card past the cap moving as one rigid block — and the crease travels through the list as you scroll. We split Apple's single `A` into `A·x/(x + half)`, because the original form makes the asymptote double as the curve's half-way point — raising it also pushes the curve out, the two cancel, and the knob does almost nothing. |
| **The return never overshoots** | `drag` decays exponentially, which is monotone by construction, so the spacing eases shut and stops. Nothing in iOS scroll physics springs back past its resting value. |

**To put more air between two cards**, `maxStretchPx` is the whole sheet's opening, not a
per-gap distance. The widest a single gap gets is `maxStretchPx / (SPREAD_ROWS + 1)`, so
raise the first or lower the second — measured at a firm fling (drag ≈ 60px):

| `maxStretchPx` | widest gap | | `SPREAD_ROWS` (at 200) | widest gap |
|---|---|---|---|---|
| 80 | 9.7px | | 1 | 60.5px |
| 120 | 14.5px | | 2 | 40.3px |
| 200 | 24.2px | | 3 | 30.2px |
| 300 | 36.3px | | 4 | 24.2px |

Lowering `SPREAD_ROWS` concentrates the same total into the gaps nearest the pin, so it
buys distance at the cost of the gradient — at 1 the sheet reads as one tear with a rigid
block behind it rather than as fabric.

**Speed and depth are coupled**: the equilibrium stretch at a given scroll speed is
`DRAG_GAIN · r/(1−r)`, where `r` is `DRAG_RELAX_PER_STEP`. Changing the relax alone
changes how far the sheet opens as well as how fast it shuts — hold that product fixed
(≈1.5) to move one without the other. `DRAG_AT_HALF_STRETCH_PX` should stay near the drag
a firm fling produces (≈60), so a real fling lands mid-curve rather than on a flat end.

A card's lag is computed from its distance to the anchor **in pixels**, not from its
index in the track array. That is what keeps the relax smooth: an index is an integer,
so the anchor advancing by one row — or the windowed grid rebuilding its rows so index
`i` means a different row — moved every card by a whole step in a single frame. A pixel
distance slides continuously and survives a rebuild. The anchor sits at the top edge
of the viewport scrolling forward and the bottom edge scrolling back; it still jumps by a
whole viewport when travel reverses, which is safe only because that switch is keyed on
`sign(drag)`, and `drag` can only change sign by passing through zero — where every
shift is zero regardless of where the anchor is.

One hook owns it: `src/hooks/useScrollStretch.ts`.

```ts
useScrollStretch(listRef, { axis: "y" });          // wrapping grid on a scrolling page
useScrollStretch(rowRef,  { axis: "x", enabled }); // horizontal strip
```

### Where it is applied

| Surface | Component | Axis |
|---|---|---|
| Card preview grids (decks Learn Now, collection view, mastered, skipped, Quick Mark, challenge review) | `MiniVocabCardGrid` | y |
| Lent-card previews (pre-round notice, end-of-round sort offer) | `ProvisionalCardGrid` | y |
| The `/entries` card grid | `VocabEntryCards` | y |
| Scrollable shelf rows (Decks, Discover, Reader, Card Detail) | `shelf/Shelf.tsx` → `ShelfRow scrollable` | x |
| Community design strip | `community/CommunityFeedRow` | x |

A **non**-scrollable `ShelfRow` opts out (`enabled: scrollable`) — a wrapping row never
scrolls, so the listener could never fire.

`MiniVocabCardGrid` carries a `scrollStretch` prop (default `true`) for the other kind of
opt-out: a grid that is not the thing the reader is travelling through. **View Challenge
passes `scrollStretch={false}`** — its nine word cards are a settled reference list under
a horizontally-swipeable test (§ 5.4b of [STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md)), so
rows springing apart there read as the page coming loose rather than as the list having
weight. The rule: stretch the list the scroll is ABOUT, not every list the scroll passes.

### Why it moves transforms and not `gap`

Animating the container's `gap` is the obvious implementation and is wrong here on
three counts, all of which the hook's header comment states in full:

1. `MiniVocabCardGrid` is **windowed** (`useWindowedRows`), and the window's spacer
   arithmetic is done against a **constant** `rowGap`. A live gap would make the spacers
   lie by (rows above × stretch) px and the scroll would jump.
2. A changing gap on a wrapping grid changes the container's height, moving every
   sibling below it mid-scroll.
3. `gap` is a layout property — every frame would cost a relayout of the list, during a
   scroll.

Opening the gaps is exactly "translate each card along by its lag", so a
compositor-only `translate3d` is visually identical and the only affordable one.
**Do not "simplify" this into a `gap` animation.**

### Cards must not move on hover

A card in one of these lists highlights on hover by **elevation only** — `SHADOW.raised`
→ `SHADOW.float`, no `translateY`. This is a hard rule, not a taste call: these cards are
the hook's own track elements, so a hover `transform` and the hook's per-frame inline
`transform` are the same property on the same node and simply overwrite each other.

For the same reason **`transform` must never appear in a card's CSS `transition`**. A
transition on transform re-filters every frame the hook writes through a 200ms ease,
which turns the elastic stretch into lag. Transition `box-shadow` alone. The entrance
`cardPopIn` is a keyframe *animation* rather than a transition and is unaffected — it
runs at mount, when the list is not scrolling and the hook writes nothing.

Applies to `MiniVocabCard` and `VocabEntryCards`. `QuickMarkCard` opts out of hover
feedback entirely (deliberate — see its own note).

### Contract for new card lists

- The hook groups the container's children into **tracks** by their cross-axis offset
  (a grid row moves as one; a horizontal strip is one card per track), measured from
  the DOM — a caller never declares its column count.
- Children marked `aria-hidden` are skipped, which is what keeps the windowing spacers
  from counting as tracks. Mark any decorative filler child `aria-hidden`.
- It writes `style.transform` on children **directly** (a fling costs zero re-renders)
  and removes it the moment the fabric settles. While active it overrides a child's own
  transform, which in practice only overlaps a card's entrance pop-in — and that runs at
  mount, when the list is not moving and the hook writes nothing.
- Offsets are cached per scroll burst and invalidated by a childList mutation or a
  resize, since transforms never move a layout box.
- `prefers-reduced-motion: reduce` disables it.

### The frame budget (why the hook reads almost nothing)

The effect runs **during** a scroll, so any forced synchronous layout it causes is a
dropped frame the user feels as scroll lag. Four rules keep it compositor-only. They
are the answer to "the stretch makes scrolling stutter" — do not relax one without
re-measuring:

| Rule | What it means | What breaking it cost |
|---|---|---|
| **A. No DOM reads in the rAF loop** | Scroll position comes from the scroll event (`lastPos`); the viewport size is cached and refreshed only on resize / scroller re-resolve | Reading `scrollTop`/`clientHeight` *after* the previous frame wrote transforms forces a full layout flush, once per frame, for the whole list |
| **B. Write only the visible band** | Tracks within `BAND_OVERSCAN_PX` of the viewport are transformed; the rest are left alone and evicted when the band moves | Writing every track made the per-frame paint scale with the **library size** instead of the screen — the 470-card account paid for ~150 off-screen rows per frame |
| **C. Skip unchanged writes** | A track whose shift moved less than `WRITE_EPS_PX` is not written, and a frame in which the spring moved less than that is skipped entirely | Every capped track (`SPAN_CAP`) re-wrote an identical transform each frame |
| **D. Re-measure at most once per frame, never in an observer** | `MutationObserver`/`ResizeObserver` only set a `tracksDirty` flag; `buildTracks` runs in the frame's read phase, before any write | A **windowed** grid mutates its children on nearly every scroll frame, so measuring (and `getComputedStyle`-walking for the scroller) from the observer put a forced style+layout flush directly in the browser's scroll path |

Two supporting details: the anchor and band edges are found by **binary search** over the
sorted track offsets (recomputed only when the scroll actually moved, not per frame), and
`will-change: transform` is set only while an element is inside the band and removed on
eviction/settle — a bounded handful of layers rather than one per card.

`findScroller` is the one expensive call (a `getComputedStyle` walk). It runs at mount, on
a window `resize`, and once **after** the spring settles — which is also where a list that
was re-parented between scrollers (the decks body renders as both a page and a sheet)
picks up its new one.

---

## Safe areas and the iOS status bar

**The band behind the clock is PAGE PIXELS.** `index.html` ships
`viewport-fit=cover`, so the web view paints edge to edge — under the status bar at
the top and under the home indicator at the bottom — and whatever surface is on
screen colours those strips. A game's accent ground runs all the way up behind the
clock; a paper page keeps the strip paper.

### Why it had to work this way

It is tempting to think `<meta name="theme-color">` covers this. It does not, in the
one place that matters:

| Context | Who paints the strip | Does `useThemeColor` reach it? |
|---|---|---|
| Android Chrome | The browser toolbar, from `theme-color` | ✅ |
| iOS Safari tab | The browser, from `theme-color` | ✅ |
| **iOS home-screen web app** | **Nobody, now — it is page pixels** | ❌ and never did |

Before `viewport-fit=cover` the standalone web view was **letterboxed inside the safe
area**, and iOS filled the letterbox itself using the document background it captured
**when the app launched**. Every runtime write — the meta tag, `documentElement`'s
background — was ignored, so the strip stayed paper-white forever, on games and on
ordinary pages alike. `src/hooks/useThemeColor.ts` is not wrong; it was aimed at a
surface the standalone app does not have.

Two consequences worth knowing:

- **iOS snapshots `index.html`'s `apple-mobile-web-app-*` tags when the icon is
  added to the Home Screen.** Changing them does nothing to an already-installed
  icon — it has to be deleted and re-added. A fix here that "didn't work" is usually
  this.
- `apple-mobile-web-app-status-bar-style` stays **`default`** (dark system glyphs).
  `black-translucent` forces light glyphs, which disappear on every paper-white page
  — the app has one light palette (shelf redesign D4), so there is no style that
  suits both a dark game ground and paper. Dark glyphs are the safe half.

### Who absorbs the insets

`SAFE_TOP` / `SAFE_BOTTOM` (`src/theme/safeArea.ts`) are CSS **strings**
(`env(safe-area-inset-*, 0px)`), not numbers — `env()` is resolvable only by the
browser, so any geometry that mixes them with the design's px is a `calc()`. Both
fall back to `0px`, so desktop, the phone-card frame and every non-notched device
compute exactly the design's original geometry.

| Surface | What it does | Where |
|---|---|---|
| Page header | Adds `SAFE_TOP` to its own top padding | `PageHeader` (`Header`) — every hub / node / dense / leaf header funnels through it, so this is stated once for the whole app |
| Footer bar | Grows by `SAFE_BOTTOM` and pads its labels off the home indicator | `MobileFooter` → `FOOTER_TOTAL_HEIGHT` |
| Footer hide travel | Translates by the bar's **total** height, or the inset's worth of bar peeks back | `FooterPresenter` |
| Scroll clearance + bottom edge-fade | Reserve and fade against the bar's total height | `MobileTabScreen`, `FOOTER_TOTAL_CLEARANCE` |
| Sheet pills, the scp platform, sheet bodies | Offset by `FOOTER_TOTAL_CLEARANCE` instead of the bare 90px | `SheetPill` (its `bottom` prop is a CSS string now), `FlashcardsDecksPage`, `VocabCardDetailPage`, `SortCardsPage`, `DecksPanelBody`, `SheetBody` |
| flp merge sheet | Its own top padding ramps to `SAFE_TOP` as the sheet merges into a full-screen page, so its header passes `safeAreaTop={false}` and does not add the inset twice | `SheetPanel` → `writeMergeChrome` |

**The header, not the frame, carries the top inset.** Padding the frame would stop the
ground short of the top of the screen again — which is the whole bug. The surface stays
full-bleed and only the header's *text* moves down.

**A header that is not at the top of the screen must pass `safeAreaTop={false}`.**
Today that is only the flp merge sheet's header.

---

## Referenced code

- `src/index.css` — shell `overflow: hidden`, global `user-select: none`, cpcd desktop-selectable exception
- `src/theme/safeArea.ts` — `SAFE_TOP` / `SAFE_BOTTOM`, and `index.html`'s `viewport-fit=cover` + `apple-mobile-web-app-*` tags (see above)
- `src/hooks/useThemeColor.ts` — `theme-color` claims for Safari tabs / Android Chrome only
- `src/App.css` — `#root` shell scroller
- `src/hooks/useBlockEdgeSwipe.ts` — edge-swipe-back blocker
- `src/hooks/useScrollStretch.ts` — displacement-driven elastic card spacing (see above)
- `src/games/bubble-match/BubbleMatchPage.tsx` — edge-swipe reference implementation
- `MobileTabScreen`, `LeafPage`, `NodePage` components — see the sub-docs above

### Collection pages (Flashcards tab drill-ins)

Several **node** routes share one component, `CollectionViewPage`
([DECKS_FEATURE.md](./DECKS_FEATURE.md)):

| Path | Shows |
| --- | --- |
| `/flashcards/collection/learn-now` | The sorted Learn Now cards (moved off `/decks`) — `-reading` / `-writing` variants show the same idea for those bars |
| `/flashcards/collection/mastered` | The Mastered cards (replaces the old `/flashcards/mastered` page) — likewise `-reading` / `-writing` |
| `/flashcards/collection/all` | Every sorted card |
| `/flashcards/deck/:id` | One user-authored deck |

`/flashcards/mastered` still exists as a **redirect** to the second of these, so
older links keep working.

Two more Flashcards-tab node pages sit beside them — the **Mastery Centers**,
`/flashcards/reading` and `/flashcards/writing` (`MasteryCenterPage`). Each is the
`/decks` panel rendered as a page and read through one skill bar; they are reached from
two buttons under the Study Mix slab, present only when that account goal is set. See
[DECKS_FEATURE.md § Mastery Centers](./DECKS_FEATURE.md).

Two route shapes rather than one `:collectionId` on purpose: a deck is addressed by
its numeric id under its own segment, so a deck a user names "mastered" can never
shadow the built-in route.

All of them keep the Flashcards footer tab lit and are reached from `/decks`, which is
now a **deck list** (two built-in collection rows + the user's decks) rather than an
inline card grid.
