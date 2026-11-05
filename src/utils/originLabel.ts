import { ROUTED_GAMES } from "../games/registry";

/**
 * originLabelFor — a human label for the page a flow was entered from.
 *
 * Used by the provisional set-mode sort flow (docs/PROVISIONAL_CARDS.md § 7): the offer
 * records WHERE it was accepted from (`?from=<pathname>`), and the completion popup uses
 * that to name its "back" button ("Back to Bubble Match") instead of the vague "Go back".
 *
 * Game titles are read from `ROUTED_GAMES` rather than restated, so a renamed game
 * renames the button too. Non-game origins are the handful of pages that can open the
 * flow; anything unrecognised returns null and the caller falls back to a generic label.
 *
 * Referenced by: src/features/discover/AddNewCardsPage.tsx.
 */
const PAGE_LABELS: Record<string, string> = {
    // The Deck Tower (`/`) — its in-place flp session is where a study-time offer opens.
    "/": "Deck Tower",
    "/games": "Games",
};

export function originLabelFor(pathname: string | null | undefined): string | null {
    if (!pathname) return null;
    const game = ROUTED_GAMES.find((entry) => entry.route === pathname);
    if (game) return game.title;
    return PAGE_LABELS[pathname] ?? null;
}
