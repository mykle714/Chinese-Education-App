import type { GameDef } from "./types";

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
export const GAME_REGISTRY: GameDef[] = [];

/** Routes for every registered game; consumed by `MOBILE_DEMO_PATHS`. */
export const GAME_ROUTES: string[] = GAME_REGISTRY.map((g) => g.route);
