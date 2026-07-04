import { lazy } from "react";
import type { GameDef } from "./types";
import { COLORS } from "../theme/colors";

/**
 * Central registry of all games available in the Games hub.
 *
 * To add a new game:
 *   1. Create the page component under `src/games/<gameId>/<GameId>Page.tsx`.
 *   2. Add one `GameDef` entry here with a `React.lazy(...)` import.
 *
 * The hub (`src/pages/GamesPage.tsx`), the router (`src/App.tsx`), and the
 * mobile-demo frame allowlist (`src/components/Layout.tsx`) all derive from
 * this array — adding a game requires no edits to those files.
 */
export const GAME_REGISTRY: GameDef[] = [
    {
        gameId: "bubble-match",
        title: "Bubble Match",
        subtitle: "Pop word & meaning pairs before the screen fills up",
        route: "/games/bubble-match",
        // Always shown in the hub. The game page itself handles the
        // unauthenticated case ("Sign in to play") and the not-enough-cards case
        // (shortfall message), so we don't gate it out of the menu with
        // requiresAuth — that just made the row invisible while debugging.
        Component: lazy(() => import("./bubble-match/BubbleMatchPage")),
        bgColor: COLORS.redAccent,
    },
    {
        gameId: "word-search",
        title: "Word Search",
        subtitle: "Hunt your vocab words hidden in a grid of characters",
        route: "/games/word-search",
        Component: lazy(() => import("./word-search/WordSearchPage")),
        bgColor: COLORS.purpleAccent,
    },
];

/** Routes for every registered game; consumed by `MOBILE_DEMO_PATHS`. */
export const GAME_ROUTES: string[] = GAME_REGISTRY.map((g) => g.route);
