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
    {
        gameId: "match-speed",
        title: "Match Speed",
        subtitle: "Match words to meanings against a 60-second clock",
        route: "/games/match-speed",
        Component: lazy(() => import("./match-speed/MatchSpeedPage")),
        bgColor: COLORS.greenAccent,
    },
    {
        gameId: "speed-reading",
        title: "Speed Reading",
        subtitle: "Read the clue and tap the matching word — 20 rounds against the clock",
        route: "/games/speed-reading",
        Component: lazy(() => import("./speed-reading/SpeedReadingPage")),
        bgColor: COLORS.blueAccent,
        // zh-only: a round is built by substituting ONE character of the
        // headword, which presupposes a character-based script. See
        // GameDef.languages.
        languages: ["zh"],
    },
];

/** Routes for every registered game; consumed by `MOBILE_DEMO_PATHS`. */
export const GAME_ROUTES: string[] = GAME_REGISTRY.map((g) => g.route);
