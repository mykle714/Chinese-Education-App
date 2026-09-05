import { type ReactNode } from "react";
import { Box } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { SxProps, Theme } from "@mui/material/styles";
import MobileDemoHeader from "./MobileDemoHeader";
import { type PageHeaderSize } from "./PageHeader";
import { FOOTER_HEIGHT, FOOTER_TOTAL_HEIGHT, FOOTER_TOTAL_CLEARANCE } from "./MobileFooter";
import { COLORS } from "../theme/colors";
import { SAFE_BOTTOM } from "../theme/safeArea";

// Shared layout shell for every SCROLLABLE footer-tab hub page (Flashcards/Decks,
// Discover, Home, Account). It encodes two design rules so individual pages don't
// have to re-implement them:
//
//   1. Scroll-away header — the page header lives INSIDE the scroll area (as its
//      first child), so it scrolls up and out of view with the content instead
//      of staying pinned. Every scrollable content page should use this shell so
//      the behavior stays consistent.
//   2. Footer bar — the bottom nav (MobileFooter) is always a flat, full-width bar
//      flush to the bottom edge, overlaying the content (the app's only footer
//      style). The scroll area reserves matching bottom padding
//      (FOOTER_CLEARANCE) so the last row never hides behind the bar.
//
// Footer-bearing back-button screens (node pages: card detail, mastered cards,
// dictionary + the dictionary cdp) reuse this shell THROUGH `NodePage`, so they
// inherit the scroll-away header + floating-footer clearance here rather than
// reserving their own. Focused drill-in screens with no footer (the drag-to-sort
// page, in-game canvases) just render a back-button PageHeader. See
// docs/MOBILE_TAB_SCREEN_LAYOUT.md and docs/DISCOVER_FLOW.md.

// Edge-fade geometry. Content fades to transparent at the top/bottom of the
// VISIBLE scroll viewport (revealing the surfaceColor painted on ScreenRoot
// behind it), so rows lighten out as they scroll past the edges — matching the
// NYT-Games style soft fade. The mask is anchored to the viewport box, not the
// scrolled content, so the fade bands stay fixed at the screen edges.
//   • top  — a small band so the header / first rows dissolve as they scroll up.
//   • bottom — a short band sitting on the footer bar, so the last rows fade
//     out right where they meet the top edge of the footer bar.
const EDGE_FADE_TOP = 28;
// Bottom band, from the design's `.fade`: a 34px gradient sitting exactly ON the
// footer bar's top edge (`bottom: 74px` in `shelf-system.css`), not a fade that runs
// all the way to the frame's bottom. So content is fully opaque until 34px above the
// bar, dissolves across that band, and is gone by the time it reaches the bar.
//
// The design paints this as its own gradient ELEMENT; we keep the app's existing MASK
// mechanism and just move its stops, because the mask is anchored to the scroll
// viewport and therefore works on every page for free — a painted element would have
// to be added per surface. Do not ship both (docs/SHELF_REDESIGN.md A2a).
const EDGE_FADE_BOTTOM_BAND = 34;
// Where the fade STARTS, measured up from the bottom of the viewport.
// Measured off the bar's TOTAL height (74px + the home-indicator inset), not the bare
// 74: since `viewport-fit=cover` the bar is taller than nominal, and a fade anchored to
// 74 would finish the inset's worth of pixels ABOVE the bar's real top edge, leaving a
// visible sliver of un-faded content there. A CSS string, so the masks below are
// template calcs rather than arithmetic. See src/theme/safeArea.ts.
const EDGE_FADE_BOTTOM_START = `calc(${FOOTER_HEIGHT + EDGE_FADE_BOTTOM_BAND}px + ${SAFE_BOTTOM})`;
// Full mask fades both edges; when a page opts out of the top fade (topFade=false)
// the top band is dropped so the first rows stay fully opaque (only the bottom
// fades out behind the floating footer).
const EDGE_FADE_MASK = `linear-gradient(to bottom, transparent 0, #000 ${EDGE_FADE_TOP}px, #000 calc(100% - ${EDGE_FADE_BOTTOM_START}), transparent calc(100% - ${FOOTER_TOTAL_HEIGHT}))`;
// Bottom band only — no top fade. Also used by the /decks sheet, whose top edge is
// its own grabber (nothing there should dissolve).
export const EDGE_FADE_MASK_NO_TOP = `linear-gradient(to bottom, #000 0, #000 calc(100% - ${EDGE_FADE_BOTTOM_START}), transparent calc(100% - ${FOOTER_TOTAL_HEIGHT}))`;

// Positioning context for the footer bar + full-height flex column.
const ScreenRoot = styled(Box)(() => ({
    position: "relative",
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
}));

// The main content region. Normally it scrolls (`scrollable`, the default). A fixed,
// non-scrolling page (e.g. the drag-to-sort screen) sets `scrollable={false}`, which
// switches it to `overflow: hidden` — critical because it lets the inner flex column
// SHRINK to fit the viewport (an `overflow: auto` box would instead scroll, so its
// flex children keep their intrinsic size and overflow under the floating footer).
// Non-scrolling pages also drop the edge-fade mask (it would clip their edge rows).
const ScrollArea = styled(Box, {
    shouldForwardProp: (prop) =>
        prop !== "scrollable" && prop !== "topFade" && prop !== "horizontalPan",
})<{ scrollable: boolean; topFade: boolean; horizontalPan: boolean }>(({ scrollable, topFade, horizontalPan }) => ({
    flex: 1,
    minHeight: 0,
    overflowY: scrollable ? "auto" : "hidden",
    overflowX: "hidden",
    display: "flex",
    flexDirection: "column",
    // Scrollable pages allow vertical pan but contain the scroll so it never chains to
    // the phone frame / browser (no rubber-banding); fixed pages take no scroll.
    //
    // ⚠️ `touch-action` IS INTERSECTED DOWN THE ANCESTOR CHAIN, so this value is not
    // just this element's own behaviour — it is a CEILING on every scroller inside the
    // page. A descendant that sets `touch-action: pan-x` on its own horizontal scroller
    // still cannot be panned by touch while an ancestor says `pan-y`: the browser
    // resolves the permitted directions by walking UP from the touched element, and the
    // narrower value wins. That is why a horizontal pager inside a page has to be
    // announced HERE (`horizontalPan`) rather than solved locally, and why one looked
    // correct in the DOM while being completely inert to a swipe (View Challenge's
    // two-page pager, found 2026-09-01).
    //
    // It stays OPT-IN rather than becoming the default because permitting a pan the
    // page has no scroller for changes how cancelable a horizontal touchmove is, and
    // some pages block horizontal drags with a non-passive listener
    // (`useBlockEdgeSwipe`). Pages that own a sideways scroller ask for it.
    touchAction: scrollable ? (horizontalPan ? "pan-x pan-y" : "pan-y") : "none",
    overscrollBehavior: "contain",
    WebkitOverflowScrolling: "touch",
    paddingBottom: FOOTER_TOTAL_CLEARANCE,
    // Soft fade at the top/bottom edges (see EDGE_FADE_MASK above), scrollable pages only.
    // Pages that opt out of the top fade (topFade=false) drop the top band.
    ...(scrollable
        ? (() => {
              const mask = topFade ? EDGE_FADE_MASK : EDGE_FADE_MASK_NO_TOP;
              return { maskImage: mask, WebkitMaskImage: mask };
          })()
        : {}),
}));

// Page content column. `flex: 1` makes it fill the viewport on short pages so the
// surface color covers the full height; per-page styling comes via `contentSx`.
// `minHeight: 0` lets a non-scrolling page's inner flex column shrink to fit the
// viewport (without it the flex-shrink chain breaks here and children overflow).
const ContentInner = styled(Box)(() => ({
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    width: "100%",
}));

interface MobileTabScreenProps {
    title: string;
    // When set, the header shows a back arrow (and drops to the smaller "node"/"leaf"
    // title size). Used by hub pages that are also drill-ins from the Home menu (e.g. Games).
    showBack?: boolean;
    onBack?: () => void;
    // Back-chevron direction when showBack is set. "down" (default) for leaf-style
    // drill-ins; "left" for node pages (footer-bearing hubs). See NodePage and
    // docs/LEAF_NODE_PAGES.md.
    arrowDirection?: "down" | "left";
    // Extra header actions rendered flush-right in the header.
    headerExtraActions?: ReactNode;
    // Title scale override, forwarded to PageHeader. Pass "dense" when
    // `headerExtraActions` carries three or more controls — the title drops to 18px
    // so it stops colliding with them. See PageHeader's SIZE_SPEC.
    headerSize?: PageHeaderSize;
    // Painted behind the whole scroll surface (header + content + the padding
    // that clears the floating footer), so short pages have no color seams.
    surfaceColor?: string;
    // Per-page styling for the content column (padding, alignItems, nested
    // selectors). The header is excluded so it always stays flush + full-width.
    contentSx?: SxProps<Theme>;
    contentClassName?: string;
    className?: string;
    // Fixed, non-scrolling pages set this false: content is clipped (not scrolled) so
    // the inner flex column shrinks to fit, and the edge-fade mask is dropped.
    scrollable?: boolean;
    // Drop the soft fade at the TOP edge (keeps the bottom fade). Pages whose first
    // element shouldn't dissolve as it scrolls (e.g. the card detail cdp) set false.
    topFade?: boolean;
    // The page contains a horizontal scroller (a pager, a sideways shelf) that must be
    // pannable by touch. See the touch-action note on ScrollArea: without this the
    // scroller's own `touch-action` is overruled by this ancestor and the swipe does
    // nothing at all, silently.
    horizontalPan?: boolean;
    children: ReactNode;
}

const MobileTabScreen: React.FC<MobileTabScreenProps> = ({
    title,
    showBack = false,
    onBack,
    arrowDirection = "down",
    headerExtraActions,
    headerSize,
    surfaceColor = COLORS.background,
    contentSx,
    contentClassName,
    className,
    scrollable = true,
    topFade = true,
    horizontalPan = false,
    children,
}) => (
    <ScreenRoot className={className ?? "mobile-tab-screen"} sx={{ backgroundColor: surfaceColor }}>
        <ScrollArea
            className="mobile-tab-screen__scroll"
            scrollable={scrollable}
            topFade={topFade}
            horizontalPan={horizontalPan}
        >
            <MobileDemoHeader
                title={title}
                showBack={showBack}
                onBack={onBack}
                arrowDirection={arrowDirection}
                size={headerSize}
                extraActions={headerExtraActions}
            />
            <ContentInner className={contentClassName} sx={contentSx}>
                {children}
            </ContentInner>
        </ScrollArea>
        {/* The footer bar is rendered once at the frame level by FooterPresenter (so
            it animates independently of the page slides), not here, and it resolves
            the ACTIVE TAB from the route via routeMeta — which is why this component
            no longer takes an `activePage`. That prop existed to feed the header's
            tab-identity badge; A2b removed the badge, leaving ~35 pages declaring a
            value nothing read. The ScrollArea keeps reserving FOOTER_CLEARANCE. */}
    </ScreenRoot>
);

export default MobileTabScreen;
