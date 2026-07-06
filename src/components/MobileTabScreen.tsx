import { type ReactNode } from "react";
import { Box } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { SxProps, Theme } from "@mui/material/styles";
import MobileDemoHeader from "./MobileDemoHeader";
import { FLOATING_FOOTER_CLEARANCE, FLOATING_FOOTER_INSET, type FooterTab } from "./MobileFooter";
import { COLORS } from "../theme/colors";

// Shared layout shell for every SCROLLABLE footer-tab hub page (Flashcards/Decks,
// Discover, Home, Account). It encodes two design rules so individual pages don't
// have to re-implement them:
//
//   1. Scroll-away header — the page header lives INSIDE the scroll area (as its
//      first child), so it scrolls up and out of view with the content instead
//      of staying pinned. Every scrollable content page should use this shell so
//      the behavior stays consistent.
//   2. Floating footer — the bottom nav (MobileFooter) is always a detached
//      rounded pill hovering over the content (the app's only footer style). The
//      scroll area reserves matching bottom padding (FLOATING_FOOTER_CLEARANCE)
//      so the last row never hides behind the pill.
//
// Footer-bearing back-button screens (node pages: card detail, mastered cards,
// dictionary + the dictionary cdp) reuse this shell THROUGH `NodePage`, so they
// inherit the scroll-away header + floating-footer clearance here rather than
// reserving their own. Focused drill-in screens with no footer (the drag-to-sort
// page, in-game canvases) just render a back-button PageHeader. See
// docs/MOBILE_TAB_SCREEN_LAYOUT.md and docs/DISCOVER_FLOW.md.

type ActivePage = FooterTab;

// Edge-fade geometry. Content fades to transparent at the top/bottom of the
// VISIBLE scroll viewport (revealing the surfaceColor painted on ScreenRoot
// behind it), so rows lighten out as they scroll past the edges — matching the
// NYT-Games style soft fade. The mask is anchored to the viewport box, not the
// scrolled content, so the fade bands stay fixed at the screen edges.
//   • top  — a small band so the header / first rows dissolve as they scroll up.
//   • bottom — sized to roughly the floating-footer zone so the last rows fade
//     out right where they pass behind the pill.
const EDGE_FADE_TOP = 28;
const EDGE_FADE_BOTTOM = FLOATING_FOOTER_CLEARANCE - FLOATING_FOOTER_INSET;
// Full mask fades both edges; when a page opts out of the top fade (topFade=false)
// the top band is dropped so the first rows stay fully opaque (only the bottom
// fades out behind the floating footer).
const EDGE_FADE_MASK = `linear-gradient(to bottom, transparent 0, #000 ${EDGE_FADE_TOP}px, #000 calc(100% - ${EDGE_FADE_BOTTOM}px), transparent 100%)`;
const EDGE_FADE_MASK_NO_TOP = `linear-gradient(to bottom, #000 0, #000 calc(100% - ${EDGE_FADE_BOTTOM}px), transparent 100%)`;

// Positioning context for the floating footer pill + full-height flex column.
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
    shouldForwardProp: (prop) => prop !== "scrollable" && prop !== "topFade",
})<{ scrollable: boolean; topFade: boolean }>(({ scrollable, topFade }) => ({
    flex: 1,
    minHeight: 0,
    overflowY: scrollable ? "auto" : "hidden",
    overflowX: "hidden",
    display: "flex",
    flexDirection: "column",
    // Scrollable pages allow vertical pan but contain the scroll so it never chains to
    // the phone frame / browser (no rubber-banding); fixed pages take no scroll.
    touchAction: scrollable ? "pan-y" : "none",
    overscrollBehavior: "contain",
    WebkitOverflowScrolling: "touch",
    paddingBottom: FLOATING_FOOTER_CLEARANCE,
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
    activePage: ActivePage;
    // When set, the header shows a back arrow instead of the activePage badge.
    // Used by hub pages that are also drill-ins from the Home menu (e.g. Games).
    showBack?: boolean;
    onBack?: () => void;
    // Back-chevron direction when showBack is set. "down" (default) for leaf-style
    // drill-ins; "left" for node pages (footer-bearing hubs). See NodePage and
    // docs/LEAF_NODE_PAGES.md.
    arrowDirection?: "down" | "left";
    // Extra header actions rendered flush-right in the header.
    headerExtraActions?: ReactNode;
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
    children: ReactNode;
}

const MobileTabScreen: React.FC<MobileTabScreenProps> = ({
    title,
    activePage,
    showBack = false,
    onBack,
    arrowDirection = "down",
    headerExtraActions,
    surfaceColor = COLORS.background,
    contentSx,
    contentClassName,
    className,
    scrollable = true,
    topFade = true,
    children,
}) => (
    <ScreenRoot className={className ?? "mobile-tab-screen"} sx={{ backgroundColor: surfaceColor }}>
        <ScrollArea className="mobile-tab-screen__scroll" scrollable={scrollable} topFade={topFade}>
            <MobileDemoHeader
                title={title}
                activePage={activePage}
                showBack={showBack}
                onBack={onBack}
                arrowDirection={arrowDirection}
                extraActions={headerExtraActions}
            />
            <ContentInner className={contentClassName} sx={contentSx}>
                {children}
            </ContentInner>
        </ScrollArea>
        {/* The floating footer is rendered once at the frame level by
            FooterPresenter (so it animates independently of the page slides), not
            here. `activePage` still drives the header badge + the footer route map.
            The ScrollArea keeps reserving FLOATING_FOOTER_CLEARANCE for the pill. */}
    </ScreenRoot>
);

export default MobileTabScreen;
