import { type ReactNode, useEffect, useRef } from "react";
import { Box } from "@mui/material";
import { useLocation } from "react-router-dom";
import MobileDemoFrame from "./MobileDemoFrame";
import { routeShell } from "../routes/routeMeta";
import { clearSkipNextEnter } from "../hooks/usePageSlide";
import {
    isDictionarySpacePath,
    resetDictionaryBrowseState,
} from "../features/dictionary/dictionaryBrowseState";

interface LayoutProps {
    children: ReactNode;
}

// Global app shell. There is no navigation chrome here anymore — the hamburger
// drawer / desktop sidebar were removed in favor of the footer tabs
// (Flashcards / Discover / Home / Account) plus the Home menu. Every page now
// owns its own header (a back arrow for drill-ins, or MobileTabScreen's header
// for the footer-tab hubs).
//
// Two render modes:
//   • Mobile-demo surfaces (the phone-frame pages) → wrapped in MobileDemoFrame,
//     which is full-bleed on mobile and a centered phone card on desktop.
//   • Everything else (Reader / Dictionary / Night Market / Settings / dashboard
//     / auth pages, etc.) → rendered full-height with no chrome.
function Layout({ children }: LayoutProps) {
    const location = useLocation();

    // Reset the leaf/node "skip next enter" latch once per navigation. This runs
    // AFTER the destination page's render on the same navigation (parent effects
    // fire after child renders), so a leaf/node destination still reads the armed
    // latch and appears static, while a non-sliding destination clears it here so
    // it never bleeds into a later page. See usePageSlide.
    useEffect(() => {
        clearSkipNextEnter();
    }, [location.pathname]);

    // Clear the persisted dictionary browse state (query/page/scroll) the first
    // time the user navigates OUT of the Dictionary space. The state is meant to
    // survive the list ⇄ card-detail drill-in only, so we reset on the transition
    // from an in-space pathname to an out-of-space one. This covers every exit
    // uniformly: the back arrow to Home, a footer-tab tap, and browser back.
    const wasInDictionarySpace = useRef(isDictionarySpacePath(location.pathname));
    useEffect(() => {
        const nowInSpace = isDictionarySpacePath(location.pathname);
        if (wasInDictionarySpace.current && !nowInSpace) {
            resetDictionaryBrowseState();
        }
        wasInDictionarySpace.current = nowInSpace;
    }, [location.pathname]);

    // Which shell this route renders inside comes from the `shell` field in
    // src/routes/registry.ts — the same row that decides the route's component,
    // footer tab and page transition.
    //
    // This used to be a hand-maintained MOBILE_DEMO_PATHS array plus six
    // `startsWith` checks for the parameterized routes; parameterized patterns are
    // now matched with React Router's own matchPath.
    // See docs/ARCHITECTURE_REVIEW.md finding 4.
    const isMobileDemoPage = routeShell(location.pathname) === "frame";

    if (isMobileDemoPage) {
        return <MobileDemoFrame>{children}</MobileDemoFrame>;
    }

    return (
        <Box
            className="layout-main-content"
            component="main"
            sx={{
                minHeight: "100dvh",
                display: "flex",
                flexDirection: "column",
                alignItems: "stretch",
            }}
        >
            {children}
        </Box>
    );
}

export default Layout;
