import { type ReactNode } from "react";
import { Box } from "@mui/material";
import { useLocation } from "react-router-dom";
import MobileDemoFrame from "./MobileDemoFrame";
import { GAME_ROUTES } from "../games/registry";

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

    // Routes that live inside the shared phone-frame surface (MobileDemoFrame).
    // Adding a page here is all that's needed to opt it into the frame. Game
    // routes are derived from the registry so new games need no edits.
    const MOBILE_DEMO_PATHS = [
        "/",
        "/flashcards/decks",
        "/flashcards/mastered",
        "/account",
        "/flashcards/learn",
        "/discover",
        "/games",
        // Home-menu child pages also render inside the phone frame.
        "/night-market",
        "/reader",
        "/dictionary",
        "/tester-dashboard",
        ...GAME_ROUTES,
    ];
    const isMobileDemoPage =
        MOBILE_DEMO_PATHS.includes(location.pathname) ||
        location.pathname.startsWith("/discover/sort/") ||
        location.pathname.startsWith("/flashcards/card/");

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
