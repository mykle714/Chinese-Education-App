# Mobile Tab Screen Layout (scroll-away header + floating footer)

> ↑ Part of [UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md).

The mobile-demo footer-tab surfaces share one layout shell,
`src/components/MobileTabScreen.tsx`. It encodes two design rules so individual
pages don't re-implement (or drift from) them.

## The two rules

1. **Scroll-away header.** The page header (`MobileDemoHeader`) lives *inside*
   the scroll area as its first child, so it scrolls up and out of view with the
   content instead of staying pinned to the top.
   - **It is not a bar.** Since the shelf redesign's A2b the header has no
     background, no border and no fixed height — just a title on the paper ground
     with the design's padding, and an optional right slot. It also no longer draws
     the active footer tab's icon beside the title. Sizes, glyphs and the
     `rightContent` primitives are documented in
     [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md) § Header component hierarchy.
   - **Every scrollable content page must use `MobileTabScreen`** so this stays
     consistent. Today that is `/arena` (Arena),
     and `/dictionary` (Dictionary); `/` (Deck — the Deck
     Tower) also mounts it, with `scrollable={false}`. The footer tabs are
     Deck / Arena (flag-gated) / Dictionary / Menu — Menu is not a page either: it raises
     `MenuPopover` (`src/components/menuPopover/MenuPopover.tsx`) over the current page (Account is not a page — it is
     `AccountSheet`, raised from td's header avatar); Games is a drill-in from the
     Menu. Games is a **node page** —
     they wrap `MobileTabScreen` in `NodePage`, which sets `showBack` +
     `arrowDirection="left"` and adds the horizontal slide. See
     [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md).
2. **Footer.** The bottom nav (`MobileFooter`) is the floating **slab** (td's footer —
   [DECK_TOWER.md](./DECK_TOWER.md) § Footer), overlaying the content rather than
   sitting in normal flow. The scroll area reserves `SLAB_FOOTER_TOTAL_CLEARANCE` of
   bottom padding so the last row never hides behind it. **`MobileTabScreen` does not
   render the footer itself** — a single persistent slab is rendered at the frame
   level by `FooterPresenter` (so it animates independently of the page slides;
   see [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md)). `MobileTabScreen` still reserves
   the clearance; the footer resolves its own active tab from the route.

   > Until 2026-11-16 most routes wore a flat, full-width **bar** and only the routes
   > whose `routeMeta` row set `footerStyle: "slab"` (td, `/lessons`, `/dictionary`, the
   > cdp, acp) wore the slab. The bar, the `footerStyle` field, `routeFooterStyle` and
   > the `FOOTER_HEIGHT` / `FOOTER_CLEARANCE` / `FOOTER_TOTAL_*` constants were deleted
   > when the Reader moved onto the slab; Arena and the flagged-off Community / Study
   > Challenge pages switched with it.

   > It was a detached rounded **pill** (64px tall, inset 16px on every side, drop
   > shadow, icon + label per tab) until the shelf redesign's A2a
   > ([SHELF_REDESIGN.md](./SHELF_REDESIGN.md)). The constants were renamed
   > `FLOATING_FOOTER_*` → `FOOTER_*` at the same time, and the pill's `INSET` was
   > deleted rather than renamed.

## The phone frame around it

Everything below is laid out inside `MobileDemoFrame` (`src/components/MobileDemoFrame.tsx`),
the only thing that renders the phone surface; its geometry lives in
`src/components/phoneGeometry.ts`. On mobile the frame is full-bleed; above the `md`
breakpoint it is a centred card matching the design's `.phone`:

| Constant | Value | Meaning |
| --- | --- | --- |
| `PHONE_WIDTH` | 402 | Desktop `maxWidth`. **Every artboard is drawn at this width**, so page gutters and column arithmetic only match the design here. |
| `PHONE_HEIGHT` | 874 | Desktop `maxHeight`, so a tall monitor shows true proportions rather than an elongated phone. |
| `PHONE_RADIUS` | 44 | Desktop corner radius. |
| `PHONE_OVERLAY_SX` | — | The same box as an `sx` for a full-screen MUI Dialog that must pin to the phone's corners (Practice Writing, community design zoom). Spread it; do not re-type the numbers. |

`FrameRoot` is `position: relative`, which is what the frame-level footer bar
anchors to, and it is painted `COLORS.background` (`--paper`). It was 393 × (up to
932) at radius 20 until the shelf redesign's A2c.

## Anatomy

```
ScreenRoot            position: relative
└─ ScrollArea         flex:1, overflow:auto, pan-y, paddingBottom: clearance
   ├─ MobileDemoHeader            ← scrolls away with content
   └─ ContentInner    flex:1      ← page content (styled via `contentSx`)

(the footer bar is rendered once by FooterPresenter in MobileDemoFrame, not here)
```

- **`activePage` is gone** (A2b). It existed to feed the header's tab-identity badge;
  when the badge was removed, ~35 pages were left declaring a value nothing read. The
  footer resolves the active tab from the route via `routeMeta`, so nothing replaced
  it.
- `headerSize` forwards a title-size override to `PageHeader`. In practice the only
  value worth passing is `"dense"` — see
  [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md) § Header sizes.
- `backdrop` (also on `NodePage`) is non-interactive decoration painted over `surfaceColor`
  and behind the header and content; acp's night sky is the only user. Passing it makes the
  scroll area `position: relative`, which is why it is opt-in rather than always on.
- `surfaceColor` paints `ScreenRoot` behind everything (header + content + the
  footer-clearance padding) so short pages have no color seams.

  > `surfaceColor` is free to differ from the paper ground: the footer is the floating
  > slab, which casts onto whatever ground is behind it rather than meeting it edge to
  > edge. (While the flat bar existed — painted `--paper`, flush to the bottom — a
  > tinted ground left a colour step across the bottom 74px; that rule died with the
  > bar on 2026-11-16.)
- `contentSx` styles only the content column (padding, `alignItems`, nested
  selectors). The header is intentionally excluded so it always stays flush and
  full-width regardless of content centering.

## Edge fade (scroll lighten-out)

The `ScrollArea` carries a `mask-image` linear-gradient that fades its content to
transparent at the top and bottom of the **visible viewport**, letting
`surfaceColor` (painted on `ScreenRoot` behind it) show through. Rows therefore
soften/lighten out as they scroll past the screen edges (NYT-Games style).

- The mask is anchored to the scroll **viewport box**, not the scrolled content,
  so the two fade bands stay pinned at the top/bottom edges as you scroll.
- `EDGE_FADE_TOP` (28px) dissolves the header / first rows as they scroll up.
- The bottom band is the design's `.fade`: `EDGE_FADE_BOTTOM_BAND` (34px) of
  gradient sitting **on the footer slab's top edge**, starting
  `SLAB_FOOTER_TOTAL_HEIGHT + 34px` up from the bottom (`edgeFadeBottomStart`) and
  reaching transparent exactly at the slab. Content is fully opaque until 34px above
  the slab. (Before A2a this was one band running all the way to the frame's bottom,
  sized to the whole floating-footer zone.)
- The design paints that band as its own gradient **element**; the app keeps the
  **mask** and just moves its stops, because the mask is anchored to the scroll
  viewport and so covers every page for free. Do not ship both mechanisms.
- The footer is a **sibling** of `ScrollArea` (not masked), so the bar stays
  fully opaque while content fades behind it.
- **Opt-out (`edgeFade` prop, default `true`).** The fade only makes sense when the
  content actually scrolls. A fixed, non-scrolling page (e.g. the drag-to-sort
  screen) passes `edgeFade={false}` — through `NodePage` → `MobileTabScreen` — so the
  mask is dropped and its top/bottom rows (buckets, card tray) aren't clipped.

### ⚠️ The mask clips `position: fixed` descendants — overlays must portal out

A CSS mask applies to the element's **whole rendered subtree**, and `position: fixed`
does not escape it the way it escapes the scrolling. So an overlay written inside a
page's content — a modal sheet, a scrim + panel, a stepped popup — is masked by
`ScrollArea` like everything else, and the bottom band of that mask is **fully
transparent for the footer's height**. The overlay's pinned action bar is then simply
not painted: the panel looks correct and its buttons are missing, with no error and
nothing in the DOM to suggest a problem. This is what hid the Study Challenge sheet's
**Send** button (found 2026-09-01).

The fix is not to weaken the mask. An overlay portals OUT of the page, to the phone
frame itself (`.mobile-demo-frame`, positioned) via `useScreenOverlayHost`
(`src/hooks/useScreenOverlayHost.ts` → `src/components/overlayHost.ts` →
`frameOverlayHost`), pinned `absolute; inset: 0` at a z-index above the footer bar's
100 — so its dim covers the whole screen, footer included, and nothing in the page can
mask it. Callers: `SheetPanel` (modal), `ChallengeSheet`, `SteppedHelpPopup`,
`MinimizablePopup`. (Until 2026-10-06 overlays used
`nearestOverlayHost` — `NodePage`'s transformed `Surface` — plus a `useHideFooter` hold;
`ChallengeRoundScoreboard` still uses it, which is correct on a footerless leaf page.)
Full rule: docs/UX_AND_NAVIGATION.md § Dimming the background.

### ⚠️ `touch-action: pan-y` is a CEILING on every scroller inside the page

`ScrollArea` sets `touch-action: pan-y` on scrollable pages. That is not only a
statement about itself: when a touch lands, the browser resolves the permitted pan
directions by walking **up** the ancestor chain and taking the narrower value at each
step. So a descendant that sets `touch-action: pan-x` on its own horizontal scroller
**still cannot be panned by touch** — the ancestor has already ruled that direction
out.

The failure is silent and looks like nothing at all: the scroller is in the DOM, it
has real overflow, `scrollLeft` can be set from JS and a trackpad still works — only
the finger does nothing. This is what made View Challenge's two-page pager inert
(found 2026-09-01) despite the pager carrying the correct `touch-action` itself.

**A page that owns a horizontal scroller must say so at the shell**:
`<NodePage horizontalPan>` / `<MobileTabScreen horizontalPan>`, which widens the
scroll area to `pan-x pan-y`. It is opt-in rather than the default because permitting
a pan the page has no scroller for changes how cancelable a horizontal `touchmove` is,
and some pages cancel exactly those with a non-passive listener (`useBlockEdgeSwipe`).

⚠️ **Every sideways scroller under this shell needs the flag**, not just pagers — a
`ShelfRow scrollable`, a horizontally-scrolling toolbar, a filmstrip. Current opt-ins:
`ChallengeDetailPage` (its pager) and `DictionaryPage` (the swipeable result glosses, `DictionaryEntryRow` → `swipeGloss`).

### `wrapHeader` — a page that draws its own chrome AROUND the header

`<MobileTabScreen wrapHeader={fn}>` (forwarded by `NodePage`) hands the page the header
element and renders whatever comes back, **in the header's own slot inside the scroll
area**. Defaults to identity, so it costs existing callers nothing.

It exists for a header that is not a bar ON a surface but part OF one. `/arena` draws a
full-bleed division banner with the back arrow, title and actions sitting inside the
plate (`src/features/arena/DivisionBanner.tsx`, docs/ARENA_FEATURE.md § 2). The obvious
alternative — letting the page render the banner as its first content child — puts it
*below* the header and reads as two unrelated bands.

Why a wrapper rather than moving the header out of the scroll area: staying inside is the
whole point. The banner must **scroll away with the header**, exactly as an unwrapped one
does, and the arena's own artboards draw that scrolled state as plain paper with no plate.
A frame-level header would stay pinned.

A wrapper owns its own horizontal padding — `.page-header` already pads to `padX` (22px at
`hub`/`node`/`dense`), so a wrapper that pads again will indent the back arrow relative to
its own content. The arena's banner cancels the header's `padding-left/right` for this
reason.

Current opt-in: `ArenaPage`.

## Footer geometry (single source of truth)

`MobileFooter.tsx` exports the slab geometry so callers stay in sync:

| Constant | Meaning |
| --- | --- |
| `FOOTER_EXTRA_GAP` (16) | Breathing gap above the slab. Tune bottom room here. |
| `SLAB_FOOTER_BOTTOM` | The slab's gap to the screen's bottom edge: `max(26px, SAFE_BOTTOM)`. |
| `SLAB_FOOTER_TOTAL_HEIGHT` | The slab's REAL footprint (bottom gap + 64px face + 6px lip). A CSS **string**, because the home-indicator inset is an `env()` only the browser can resolve. |
| `SLAB_FOOTER_TOTAL_CLEARANCE` | The scroll reservation: footprint + `FOOTER_EXTRA_GAP`. |
| `SLAB_FOOTER_HIDDEN_OFFSET` | `FooterPresenter`'s slide-out distance: footprint + the cast shadow. |

**Use these for anything measured against the footer on screen** — scroll clearance,
the bottom fade, a `SheetPill`'s `bottom`, the Menu popover's anchor. Since
`viewport-fit=cover` the page paints under the home indicator; see
[UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md) § Safe areas and the iOS status bar.

**The slab is the app's only footer style** (since 2026-11-16 — see the note under
rule 2). `MobileTabScreen` (`FOOTER_FOOTPRINT` / `FOOTER_CLEARANCE`) and `FooterSpacer`
reserve `SLAB_FOOTER_TOTAL_CLEARANCE` and end the bottom fade at the slab's top edge.
`MobileFooter` anchors the slab to the nearest positioned ancestor, the phone frame
(`MobileDemoFrame`'s `FrameRoot`, `position: relative`).

**Tabs are icon over label**: a filled Material Symbol over an 11px/600 label, with ONE
sliding selector (`SlabFooterSelector`) behind the active tab. The four tab rows are
data (`TABS` in `MobileFooter.tsx`), not four copy-pasted JSX blocks.

**No page renders `<MobileFooter>` itself.** It is rendered exactly once, by
`FooterPresenter` (mounted in `MobileDemoFrame`), which decides visibility from the
route's `chrome` in `src/routes/routeMeta.ts` plus any active `useHideFooter` hold.
Pages that import `MobileFooter` import only its geometry constants. So the
clearance contract is: **a scrollable surface reserves
`SLAB_FOOTER_TOTAL_CLEARANCE` at the bottom** — `MobileTabScreen` does this for every
node page automatically, and a page laying out its own scroller must do it by hand.

> Related: the routed game pages are **leaf pages**
> (`LeafPage`) with **no footer** at all. See [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md).

## Game info screens

Game pages do not use this pattern: every routed game is a leaf page (`GameLeafPage`)
with **no footer** on any screen; its only exit is the down-arrow back button. (The
generic `GamePage` shell that showed the footer off-stage was deleted unused.) See [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md).
