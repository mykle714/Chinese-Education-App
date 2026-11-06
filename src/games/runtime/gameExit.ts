/**
 * Exit destinations carried in nav state: a launching surface states where the
 * launched page's Back should land (`state.exitTo`), and the page reads it back.
 *
 * The destination travels in nav state, not a URL param, so it costs nothing on a
 * shared link and the launched page never needs to import the surface that launched
 * it (src/games has no back-edge into src/features — docs/FRONTEND_LAYERING.md).
 *
 * Producers today are the Deck Tower's world props (DeckTowerPage → `NOTEBOOK_EXIT`,
 * `SORT_EXIT`), read back by WritingNotebookPage and AddCardsPage. No launch of a
 * GAME carries `exitTo` any more: its only producers were the Reading / Writing Center
 * carousels (deleted 2026-11-04), so the routed games' exits all lead to the Games hub
 * (`GAMES_HUB_EXIT`) — or, for a challenge round, to the challenge (`useGameBack`).
 *
 * Referenced by: useGameBack, BubbleMatchPage, WordSearchPage, BucketDropPage,
 * WritingNotebookPage, AddCardsPage, DeckTowerPage.
 * Referenced by docs: GAMES_FEATURE.md, DECK_TOWER.md.
 */
export interface GameExit {
    /** Route the exit navigates to. */
    path: string;
    /** The destination's name, for "Back to <label>" buttons. */
    label: string;
    /**
     * Nav state handed to the destination on exit, opaque to the launched page. The
     * Deck Tower uses it to come back on the world it was left from (`towerWorld`).
     */
    state?: unknown;
}

/**
 * The routed games' default exit destination. It was the Games hub (`/games`) until the
 * hub was deleted on 2026-11-06; it is now the Deck Tower. (The routed pages themselves
 * are off behind the `standaloneGames` feature flag — src/games/registry.ts → `ROUTED_GAMES`.)
 * The name is kept so the five game pages read unchanged.
 */
export const GAMES_HUB_EXIT: GameExit = { path: "/", label: "Deck Tower" };

/**
 * Read `state.exitTo` off a launch, validating its shape (nav state is untyped). Null
 * when the launch carried none; each caller supplies its own fallback.
 */
export function readExit(state: unknown): GameExit | null {
    const exit = (state as { exitTo?: Partial<GameExit> } | null)?.exitTo;
    if (exit && typeof exit.path === "string" && typeof exit.label === "string") {
        return { path: exit.path, label: exit.label, state: exit.state };
    }
    return null;
}
