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
// Other surfaces compose PageHeader / MobileFooter directly instead of using this
// shell: detail / back-button screens that still show the nav (e.g. card detail,
// mastered cards) anchor the same floating pill to the phone frame and reserve
// their own clearance; focused drill-in screens with no footer (the drag-to-sort
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
const EDGE_FADE_MASK = `linear-gradient(to bottom, transparent 0, #000 ${EDGE_FADE_TOP}px, #000 calc(100% - ${EDGE_FADE_BOTTOM}px), transparent 100%)`;

// Positioning context for the floating footer pill + full-height flex column.
const ScreenRoot = styled(Box)(() => ({
    position: "relative",
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
}));

// The one scrollable region. The header scrolls inside it; bottom padding keeps
// content clear of the floating footer.
const ScrollArea = styled(Box)(() => ({
    flex: 1,
    overflowY: "auto",
    overflowX: "hidden",
    display: "flex",
    flexDirection: "column",
    // Allow vertical pan but contain the scroll so it never chains to the phone
    // frame / browser (no rubber-banding at the boundaries).
    touchAction: "pan-y",
    overscrollBehavior: "contain",
    WebkitOverflowScrolling: "touch",
    paddingBottom: FLOATING_FOOTER_CLEARANCE,
    // Soft fade at the top/bottom edges (see EDGE_FADE_MASK above).
    maskImage: EDGE_FADE_MASK,
    WebkitMaskImage: EDGE_FADE_MASK,
}));

// Page content column. `flex: 1` makes it fill the viewport on short pages so the
// surface color covers the full height; per-page styling comes via `contentSx`.
const ContentInner = styled(Box)(() => ({
    flex: 1,
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
    children,
}) => (
    <ScreenRoot className={className ?? "mobile-tab-screen"} sx={{ backgroundColor: surfaceColor }}>
        <ScrollArea className="mobile-tab-screen__scroll">
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
