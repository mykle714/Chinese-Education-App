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
     consistent. Today that is `/` (Home hub), `/flashcards/decks` (Decks),
     `/discover` (Discover hub), `/games` (Games hub), and `/account` (Account).
     The four footer tabs are Flashcards / Discover / Home / Account; Games is a
     drill-in from the Home menu. Games (and the Mastered page) are **node pages** —
     they wrap `MobileTabScreen` in `NodePage`, which sets `showBack` +
     `arrowDirection="left"` and adds the horizontal slide. See
     [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md).
2. **Footer bar.** The bottom nav (`MobileFooter`) renders as a flat, **full-width
   bar** flush to the bottom edge, overlaying the content rather than sitting in
   normal flow. The scroll area reserves `FOOTER_CLEARANCE` of bottom
   padding so the last row never hides behind the bar. **`MobileTabScreen` no longer
   renders the footer itself** — a single persistent bar is rendered at the frame
   level by `FooterPresenter` (so it animates independently of the page slides;
   see [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md)). `MobileTabScreen` still reserves
   the clearance; the footer resolves its own active tab from the route.

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
- `surfaceColor` paints `ScreenRoot` behind everything (header + content + the
  footer-clearance padding) so short pages have no color seams.

  > ⚠️ **`surfaceColor` must stay within a hair of the paper ground.** The footer bar
  > is rendered at FRAME level by `FooterPresenter`, not inside the page, and it is
  > always painted `COLORS.background` (`--paper`) — the design gives `.fbar` no other
  > ground. A page that sets a distinctly different `surfaceColor` therefore gets a
  > visible colour step across the bottom 74px of the frame. `/decks` and the Mastery
  > Centers used to pass the grey `COLORS.header` and did exactly that; both now use
  > the default. If a page needs to feel tinted, tint an INNER surface — a card, a
  > sheet, a section — not the page ground. The two card-detail pages used to pass
  > `COLORS.yellowAccent` (harmless — within ~1% of paper) and now pass nothing at all:
  > **no page sets `surfaceColor` today.**
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
  gradient sitting **on the footer bar's top edge**, starting
  `EDGE_FADE_BOTTOM_START` (`FOOTER_HEIGHT + 34 + SAFE_BOTTOM`) up from the bottom and
  reaching transparent exactly at the bar. Content is fully opaque until 34px above
  the bar. (Before A2a this was one band running all the way to the frame's bottom,
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

The fix is not to weaken the mask. An overlay portals to
`nearestOverlayHost(el)` (`src/components/overlayHost.ts`) — the nearest ancestor that
both covers the frame and can host it without inverting paint order, which is
`NodePage`'s transformed `Surface` on a node page and `.mobile-demo-frame` otherwise —
and, because the footer bar paints above any such host, also calls
`useHideFooter(open)` for its lifetime. Callers: `SheetPanel`, `ChallengeSheet`,
`ChallengeHelpPopup`, `ChallengeRoundScoreboard` (the last needs no `useHideFooter` —
it lives on a leaf page, which has no footer).

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
`ShelfRow scrollable`, a horizontally-scrolling toolbar, a filmstrip. Current opt-in:
`ChallengeDetailPage`.

## Footer geometry (single source of truth)

`MobileFooter.tsx` exports the bar geometry so callers stay in sync:

| Constant                    | Value | Meaning                                       |
| --------------------------- | ----- | --------------------------------------------- |
| `FOOTER_HEIGHT`    | 74    | Bar height (px).                              |
| `FOOTER_EXTRA_GAP` | 16    | Breathing gap above the bar. Tune bottom room here, not via HEIGHT/INSET. |
| `FOOTER_CLEARANCE` | 90    | Vertical space to reserve below scrollable content. Equals the design's `.clear`. |
| `FOOTER_TOTAL_HEIGHT` | `calc(74px + SAFE_BOTTOM)` | The bar's REAL footprint. A CSS **string**, because the home-indicator inset is an `env()` only the browser can resolve. |
| `FOOTER_TOTAL_CLEARANCE` | `calc(90px + SAFE_BOTTOM)` | The reservation, likewise. |

**Use the `_TOTAL_` pair for anything measured against the bar on screen** — its hide
travel, scroll clearance, the bottom fade, a `SheetPill`'s `bottom`. Since
`viewport-fit=cover` the page paints under the home indicator, so `bottom: 0` is the
physical bottom edge and the bar grows by `SAFE_BOTTOM` (`src/theme/safeArea.ts`); the
bare 74/90 numbers are the design's geometry, not the on-screen one. Both fall back to
the bare numbers where there is no inset. See
[UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md) § Safe areas and the iOS status bar.

**The flat bar is the only footer style** — there is no pill or in-flow variant.
`MobileFooter` always renders the bar and anchors it to the nearest positioned
ancestor, the phone frame (`MobileDemoFrame`'s `FrameRoot`, `position: relative`).

**Tabs are text-only** (decision D5): four labels, the active one in ink at weight
600 with a 14×2 underline. The `HomeIcon` / `StyleIcon` / `LanguageIcon` /
`AccountCircleIcon` imports are gone, and the active state is no longer an opacity
change. The four tab rows are data (`TABS` in `MobileFooter.tsx`), not four
copy-pasted JSX blocks.

**No page renders `<MobileFooter>` itself.** It is rendered exactly once, by
`FooterPresenter` (mounted in `MobileDemoFrame`), which decides visibility from the
route's `chrome` in `src/routes/routeMeta.ts` plus any active `useHideFooter` hold.
Pages that import `MobileFooter` import only its geometry constants. So the
clearance contract is: **a scrollable surface reserves
`FOOTER_TOTAL_CLEARANCE` at the bottom** — `MobileTabScreen` does this for every
node page automatically, and a page laying out its own scroller must do it by hand.

> Related: the Mastered page was generalized into `CollectionViewPage` (node page;
> `/flashcards/mastered` is now a redirect — see [DECKS_FEATURE.md](./DECKS_FEATURE.md)).
> `VocabCardDetailPage` is a node page; the four game pages are **leaf pages**
> (`LeafPage`) with **no footer** at all. See [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md).

## Game info screens

The **generic** game shell (`GamePage`, for future registry games that don't ship
their own page) shows the floating footer on its info / loading screens so players
can jump to another tab without backing out, and hides it during the live stage
(`!showStage`). Bubble Match no longer follows this pattern — it is a leaf page
(`BubbleMatchPage` wrapped in `LeafPage`) with **no footer** on any screen; its
only exit is the down-arrow back button. See [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md).
