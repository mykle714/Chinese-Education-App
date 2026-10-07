import { useMemo } from "react";
import { useAuth } from "../../../AuthContext";
import { useSlideNavigate } from "../../../hooks/useSlideNavigate";
import { useGameWins } from "../../../hooks/useGameWins";
import { GAME_REGISTRY, isGameAvailable } from "../../../games/registry";
import type { GameCardData } from "../../../games/shared/GameCard";
import { buildPlayCard } from "../../../games/shared/gameCards";
import { GAME_ID, GAME_KEY } from "../../../games/writing-grid/constants";
import type { GameExit } from "../../../games/runtime/gameExit";
import { isFeatureEnabled } from "../../../../server/contracts/featureFlags";
import { MASTERY_CENTER_PATHS, MASTERY_CENTER_TITLES } from "../masteryCenters";
import { buildNotebookCard, NOTEBOOK_PATH, useNotebookTotal } from "../writingNotebook/notebookBelt";
import GamesBelt from "./GamesBelt";

/**
 * The Writing Center's games belt (docs/READING_WRITING_CENTERS.md, Writing Center § 5):
 *
 *   Writing Grid     — the game, which launches from here only
 *                      (docs/WRITING_PRACTICE_REWORK.md § 2). Its launch carries
 *                      `state.exitTo`, so the game's Back and "Back to …" return here
 *                      (games/runtime/gameExit).
 *   Writing Notebook — NOT a game: the endless practice sheet
 *                      (docs/WRITING_NOTEBOOK.md), behind the `writingNotebook` feature
 *                      flag. Its card wears the notebook's total instead of wins. The
 *                      page's Back always returns here, so it needs no `exitTo`.
 *
 * Both exits carry `returnedFromGame`, so the Writing Center reopens scrolled to the belt
 * (MasteryCenterPage → usePinScrollBottom) parked on the card just left (`focusGameId`).
 * The belt itself is the Reading Center's (`GamesBelt`). zh only — the Center mounts it
 * for zh accounts.
 *
 * Replaced `WritingGridLauncher` (one card, no carousel) on 2026-10-06.
 * Layer: feature component (src/features/flashcards/centers).
 */
const WRITING_CENTER_EXIT: GameExit = {
    path: MASTERY_CENTER_PATHS.writing,
    label: MASTERY_CENTER_TITLES.writing,
    state: { returnedFromGame: GAME_ID },
};

interface WritingGamesCarouselProps {
    className?: string;
    /** Open parked on this card (returning from it) instead of the first. */
    focusGameId?: string | null;
}

export default function WritingGamesCarousel({ className, focusGameId }: WritingGamesCarouselProps) {
    const { user, isAuthenticated } = useAuth();
    const slideNavigate = useSlideNavigate();
    // A win is logged per medalled board (WritingGridPage).
    const { totalWins } = useGameWins(GAME_KEY);
    const notebookTotal = useNotebookTotal();

    const cards = useMemo(() => {
        const out: GameCardData[] = [];
        const grid = GAME_REGISTRY.find((g) => g.gameId === GAME_ID);
        if (grid && isGameAvailable(grid, user, isAuthenticated)) {
            out.push(buildPlayCard(grid, totalWins, () =>
                slideNavigate(grid.route, { state: { exitTo: WRITING_CENTER_EXIT } })
            ));
        }
        if (isFeatureEnabled("writingNotebook")) {
            out.push(buildNotebookCard(notebookTotal, () => slideNavigate(NOTEBOOK_PATH)));
        }
        return out;
    }, [user, isAuthenticated, totalWins, notebookTotal, slideNavigate]);

    return <GamesBelt cards={cards} classPrefix="writing-games-carousel" className={className} focusGameId={focusGameId} />;
}
