# Mobile Tab Screen Layout (scroll-away header + floating footer)

> ↑ Part of [UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md).

The mobile-demo footer-tab surfaces share one layout shell,
`src/components/MobileTabScreen.tsx`. It encodes two design rules so individual
pages don't re-implement (or drift from) them.

## The two rules

1. **Scroll-away header.** The page header (`MobileDemoHeader`) lives *inside*
   the scroll area as its first child, so it scrolls up and out of view with the
   content instead of staying pinned to the top.
   - **Every scrollable content page must use `MobileTabScreen`** so this stays
     consistent. Today that is `/` (Home hub), `/flashcards/decks` (Decks),
     `/discover` (Discover hub), `/games` (Games hub), and `/account` (Account).
     The four footer tabs are Flashcards / Discover / Home / Account; Games is a
     drill-in from the Home menu. Games (and Mastered Cards) are **node pages** —
     they wrap `MobileTabScreen` in `NodePage`, which sets `showBack` +
     `arrowDirection="left"` and adds the horizontal slide. See
     [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md).
2. **Floating footer.** The bottom nav (`MobileFooter`) renders as a detached,
   rounded **pill** that hovers over the content rather than sitting in normal
   flow. The scroll area reserves `FLOATING_FOOTER_CLEARANCE` of bottom padding
   so the last row never hides behind the pill. **`MobileTabScreen` no longer
   renders the footer itself** — a single persistent pill is rendered at the frame
   level by `FooterPresenter` (so it animates independently of the page slides;
   see [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md)). `MobileTabScreen` still reserves
   the clearance and passes `activePage` (header badge + footer route map).

## Anatomy

```
ScreenRoot            position: relative
└─ ScrollArea         flex:1, overflow:auto, pan-y, paddingBottom: clearance
   ├─ MobileDemoHeader            ← scrolls away with content
   └─ ContentInner    flex:1      ← page content (styled via `contentSx`)

(the floating pill is rendered once by FooterPresenter in MobileDemoFrame, not here)
```

- `surfaceColor` paints `ScreenRoot` behind everything (header + content + the
  footer-clearance padding) so short pages have no color seams. Decks passes the
  grey `COLORS.header`; Games/Account use the default `COLORS.background`.
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
- `EDGE_FADE_BOTTOM` (`FLOATING_FOOTER_CLEARANCE − FLOATING_FOOTER_INSET`) sizes
  the bottom band to the floating-footer zone, so the last rows fade out right
  where they pass behind the pill.
- The footer is a **sibling** of `ScrollArea` (not masked), so the pill stays
  fully opaque while content fades behind it.
- **Opt-out (`edgeFade` prop, default `true`).** The fade only makes sense when the
  content actually scrolls. A fixed, non-scrolling page (e.g. the drag-to-sort
  screen) passes `edgeFade={false}` — through `NodePage` → `MobileTabScreen` — so the
  mask is dropped and its top/bottom rows (buckets, card tray) aren't clipped.

## Footer geometry (single source of truth)

`MobileFooter.tsx` exports the pill geometry so callers stay in sync:

| Constant                    | Meaning                                            |
| --------------------------- | -------------------------------------------------- |
| `FLOATING_FOOTER_HEIGHT`    | Pill height (px).                                  |
| `FLOATING_FOOTER_INSET`     | Gap from the left/right/bottom edges (px).         |
| `FLOATING_FOOTER_CLEARANCE` | Vertical space to reserve below scrollable content.|

**The floating pill is the only footer style** — there is no flat / in-flow
variant. `MobileFooter` always renders the pill and anchors it to the nearest
positioned ancestor. `MobileTabScreen` provides that ancestor (its `ScreenRoot`);
for pages that render `MobileFooter` directly, the phone frame
(`MobileDemoFrame`'s `FrameRoot`, `position: relative`) is the anchor. Any such
surface must reserve `FLOATING_FOOTER_CLEARANCE` at the bottom so content isn't
covered:

| Surface (direct `MobileFooter`)        | How it reserves clearance                  |
| -------------------------------------- | ------------------------------------------ |
| `GamePage` (generic game shell)        | `paddingBottom` on its `ContentArea`       |

> Note: `MasteredCardsPage` is now a **node page** (wraps `MobileTabScreen` via
> `NodePage`), so it gets the footer + clearance from the shell rather than
> rendering `MobileFooter` directly. `VocabCardDetailPage` and `BubbleMatchPage`
> are **leaf pages** (`LeafPage`) and have **no footer** at all. See
> [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md).

## Game info screens

The **generic** game shell (`GamePage`, for future registry games that don't ship
their own page) shows the floating footer on its info / loading screens so players
can jump to another tab without backing out, and hides it during the live stage
(`!showStage`). Bubble Match no longer follows this pattern — it is a leaf page
(`BubbleMatchPage` wrapped in `LeafPage`) with **no footer** on any screen; its
only exit is the down-arrow back button. See [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md).
