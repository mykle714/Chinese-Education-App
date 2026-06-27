import { useRef } from "react";
import { useLocation } from "react-router-dom";
import MobileFooter, {
    FLOATING_FOOTER_HEIGHT,
    FLOATING_FOOTER_INSET,
    type FooterTab,
} from "./MobileFooter";

// Persistent footer layer. The floating footer pill is rendered ONCE here (inside
// MobileDemoFrame) rather than inside each page, so it is **omitted from the
// per-page slide transitions** (leaf = vertical, node = horizontal). Instead it
// animates on its own axis: it slides up from / down past the bottom of the phone
// card as you move between footer-bearing and footerless routes. See
// docs/LEAF_NODE_PAGES.md.
//
// Which routes show the footer (and which tab is active) is the single source of
// truth below. Footerless routes (every leaf page, login, games, etc.) are absent
// from the map → the footer slides out.

const FOOTER_ROUTES: Record<string, FooterTab> = {
    "/": "home",
    "/flashcards/decks": "flashcards",
    "/discover": "discover",
    "/account": "account",
    "/games": "home",
    "/community": "home",
    "/flashcards/mastered": "flashcards",
};

// Match the page-slide feel so the footer and pages decelerate together.
const DURATION_MS = 340;
const EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

// Distance to push the pill fully below the frame's bottom edge (its own inset +
// height + a little for the drop shadow).
const HIDDEN_OFFSET = FLOATING_FOOTER_INSET + FLOATING_FOOTER_HEIGHT + 16;

const FooterPresenter: React.FC = () => {
    const { pathname } = useLocation();
    const activePage = FOOTER_ROUTES[pathname];
    const visible = activePage !== undefined;

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
