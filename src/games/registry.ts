import { lazy } from "react";
import type { GameDef } from "./types";
import { COLORS } from "../theme/colors";
// Each game's own mark-type constant, re-stated here as `GameDef.markType` so the
// hub can label its cards with the mastery track it feeds. Importing the games'
// `constants` modules (not their pages) keeps this cycle-free — a constants file
// never imports the registry. Word Search is absent on purpose: its mark type is
// per-mode, so its hub strip reads it from MODE_CONFIGS instead.
import { MARK_TYPE as BUBBLE_MATCH_MARK_TYPE } from "./bubble-match/constants";
import { MARK_TYPE as MATCH_SPEED_MARK_TYPE } from "./match-speed/constants";
import { MARK_TYPE as SPEED_READING_MARK_TYPE } from "./speed-reading/constants";

/**
 * Central registry of all games available in the Games hub.
 *
 * To add a new game:
 *   1. Create the page component under `src/games/<gameId>/<GameId>Page.tsx`.
 *   2. Add one `GameDef` entry here with a `React.lazy(...)` import.
 *
 * The hub (`src/games/GamesPage.tsx`), the route registry + metadata
 * (`src/routes/registry.ts`, `src/routes/routeMeta.ts` — where `GAME_ROUTE_META`
 * derives one `chrome: "leaf"` row per entry), and the mobile-demo frame
 * allowlist (`src/components/Layout.tsx`) all derive from this array — adding a
 * game requires no edits to those files.
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
        markType: BUBBLE_MATCH_MARK_TYPE,
    },
    {
        gameId: "word-search",
        title: "Word Search",
        subtitle: "Hunt your vocab words hidden in a grid of characters",
        route: "/games/word-search",
        Component: lazy(() => import("./word-search/WordSearchPage")),
        bgColor: COLORS.purpleAccent,
        // No `markType`: Pinyin marks production, No Pinyin marks reading, so the
        // label belongs on each mode sub-card (see WordSearchModeConfig.markType).
    },
    {
        gameId: "match-speed",
        title: "Match Speed",
        subtitle: "Match words to meanings against a 30-second clock",
        route: "/games/match-speed",
        Component: lazy(() => import("./match-speed/MatchSpeedPage")),
        bgColor: COLORS.greenAccent,
        markType: MATCH_SPEED_MARK_TYPE,
    },
    {
        gameId: "speed-reading",
        title: "Speed Reading",
        subtitle: "Read the clue and tap the matching word — 20 rounds against the clock",
        route: "/games/speed-reading",
        Component: lazy(() => import("./speed-reading/SpeedReadingPage")),
        bgColor: COLORS.blueAccent,
        markType: SPEED_READING_MARK_TYPE,
        // zh-only: a round is built by substituting ONE character of the
        // headword, which presupposes a character-based script. See
        // GameDef.languages.
        languages: ["zh"],
    },
];

/** Routes for every registered game; consumed by `MOBILE_DEMO_PATHS`. */
export const GAME_ROUTES: string[] = GAME_REGISTRY.map((g) => g.route);
