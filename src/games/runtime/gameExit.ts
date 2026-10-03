import { useLocation } from "react-router-dom";

/**
 * Where a game's exits (Back, "Back to …", a blocked/invalid-launch bounce) lead.
 *
 * A game is entered from more than one surface — the Games hub, and the Reading
 * Center's games carousel (docs/READING_WRITING_CENTERS.md) — and every exit should
 * land back where the player came from. The launching surface states its own
 * return point in the launch's nav state (`state.exitTo`); a launch that carries
 * none (the hub, a deep link, a reload that lost state) falls back to the hub.
 *
 * The destination travels in nav state, not a URL param, so it costs nothing on a
 * shared link and the game never needs to import the surface that launched it
 * (src/games has no back-edge into src/features — docs/FRONTEND_LAYERING.md).
 *
 * A challenge round's Back still wins over this — see `useGameBack`.
 *
 * Referenced by: useGameBack, BubbleMatchPage, WordSearchPage, SpeedReadingPage;
 * launched with `exitTo` by ReadingGamesCarousel.
 * Referenced by docs: GAMES_FEATURE.md § "Second entry point: the Reading Center, and the exit destination", READING_WRITING_CENTERS.md.
 */
export interface GameExit {
    /** Route the exit navigates to. */
    path: string;
    /** The destination's name, for "Back to <label>" buttons. */
    label: string;
    /**
     * Nav state handed to the destination on exit, opaque to the game. The Reading
     * Center uses it to come back scrolled to its games carousel, parked on the game
     * just played (ReadingGamesCarousel → `readingCenterExit` / `readReturnedGame`).
     */
    state?: unknown;
}

/** The default destination: the Games hub. */
export const GAMES_HUB_EXIT: GameExit = { path: "/games", label: "Games" };

/** Read `state.exitTo` off a launch, validating its shape (nav state is untyped). */
function readExit(state: unknown): GameExit | null {
    const exit = (state as { exitTo?: Partial<GameExit> } | null)?.exitTo;
    if (exit && typeof exit.path === "string" && typeof exit.label === "string") {
        return { path: exit.path, label: exit.label, state: exit.state };
    }
    return null;
}

/** The current game launch's exit destination (the hub unless the launch said otherwise). */
export function useGameExit(): GameExit {
    const location = useLocation();
    return readExit(location.state) ?? GAMES_HUB_EXIT;
}
