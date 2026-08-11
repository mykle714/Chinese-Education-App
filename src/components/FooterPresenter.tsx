import { useRef } from "react";
import { useLocation } from "react-router-dom";
import MobileFooter, {
    FLOATING_FOOTER_HEIGHT,
    FLOATING_FOOTER_INSET,
    type FooterTab,
} from "./MobileFooter";
import { routeFooterTab } from "../routes/routeMeta";
import { useFooterSuppressed } from "../hooks/useHideFooter";

// Persistent footer layer. The floating footer pill is rendered ONCE here (inside
// MobileDemoFrame) rather than inside each page, so it is **omitted from the
// per-page slide transitions** (leaf = vertical, node = horizontal). Instead it
// animates on its own axis: it slides up from / down past the bottom of the phone
// card as you move between footer-bearing and footerless routes. See
// docs/LEAF_NODE_PAGES.md.
//
// Which routes show the footer, and which tab is active, comes from the `footerTab`
// field in src/routes/registry.ts — the same row that decides the route's component,
// shell and page transition. A route with no `footerTab` is footerless (every leaf
// page, /reader/:id, login, the games) → the footer slides out.
//
// This file used to own two hand-maintained tables (FOOTER_ROUTES and a
// FOOTER_ROUTE_PREFIXES prefix list) carrying an explicit "Keep in sync with
// NODE_PREFIXES in utils/pageTransition.ts" comment. Parameterized routes are now
// matched with React Router's own matchPath rather than by `startsWith`.
// See docs/ARCHITECTURE_REVIEW.md finding 4.

// Match the page-slide feel so the footer and pages decelerate together.
const DURATION_MS = 340;
const EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

// Distance to push the pill fully below the frame's bottom edge (its own inset +
// height + a little for the drop shadow).
const HIDDEN_OFFSET = FLOATING_FOOTER_INSET + FLOATING_FOOTER_HEIGHT + 16;

const FooterPresenter: React.FC = () => {
    const { pathname } = useLocation();
    const activePage = routeFooterTab(pathname);
    // Two independent reasons to be hidden, sharing ONE slide-down animation:
    //   • the route is footerless (`activePage === undefined`) — permanent, navigational
    //   • a page is holding it suppressed — transient, e.g. a modal sheet is open
    //     (see FooterVisibilityContext / useHideFooter)
    const suppressed = useFooterSuppressed();
    const visible = activePage !== undefined && !suppressed;

    // Keep showing the last active tab while sliding OUT, so the pill doesn't
    // blank or flip its highlight as it leaves.
    const lastActive = useRef<FooterTab>("home");
    if (activePage) lastActive.current = activePage;

    return (
        <MobileFooter
            activePage={lastActive.current}
            style={{
                transform: visible ? "translateY(0)" : `translateY(${HIDDEN_OFFSET}px)`,
                transition: `transform ${DURATION_MS}ms ${EASING}`,
                // Above the page surfaces and the exit clone (z-index 50) so the
                // pill is always visible while it (and the pages) animate.
                zIndex: 100,
                // Don't intercept taps while hidden / sliding away.
                pointerEvents: visible ? "auto" : "none",
            }}
        />
    );
};

export default FooterPresenter;
