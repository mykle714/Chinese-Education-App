import { useMemo } from "react";
import { Box } from "@mui/material";
import { useAuth } from "../../../AuthContext";
import { useSlideNavigate } from "../../../hooks/useSlideNavigate";
import { useGameWins } from "../../../hooks/useGameWins";
import { GAME_REGISTRY, isGameAvailable } from "../../../games/registry";
import GameCard from "../../../games/shared/GameCard";
import { buildPlayCard } from "../../../games/shared/gameCards";
import { GAME_ID, GAME_KEY } from "../../../games/writing-grid/constants";
import type { GameExit } from "../../../games/runtime/gameExit";
import { MASTERY_CENTER_PATHS, MASTERY_CENTER_TITLES } from "../masteryCenters";

/**
 * The Writing Center's game card — the Writing Grid, which launches from here only
 * (docs/WRITING_PRACTICE_REWORK.md § 2). One card, so no carousel: the Reading Center's
 * `ReadingGamesCarousel` would add looping and dots for nothing.
 *
 * The launch carries `state.exitTo`, so the game's Back and "Back to …" return to the
 * Writing Center (games/runtime/gameExit). The exit carries `returnedFromGame` back —
 * the same shape as the Reading Center's (`readReturnedGame`) — so the Writing Center
 * reopens scrolled all the way down to this card (MasteryCenterPage → usePinScrollBottom).
 */
const WRITING_CENTER_EXIT: GameExit = {
    path: MASTERY_CENTER_PATHS.writing,
    label: MASTERY_CENTER_TITLES.writing,
    state: { returnedFromGame: GAME_ID },
};

const WritingGridLauncher: React.FC<{ className?: string }> = ({ className }) => {
    const { user, isAuthenticated } = useAuth();
    const slideNavigate = useSlideNavigate();
    // A win is logged per medalled board (WritingGridPage).
    const { totalWins } = useGameWins(GAME_KEY);

    const card = useMemo(() => {
        const game = GAME_REGISTRY.find((g) => g.gameId === GAME_ID);
        if (!game || !isGameAvailable(game, user, isAuthenticated)) return null;
        return buildPlayCard(game, totalWins, () =>
            slideNavigate(game.route, { state: { exitTo: WRITING_CENTER_EXIT } })
        );
    }, [user, isAuthenticated, totalWins, slideNavigate]);

    if (!card) return null;
    return (
        <Box className={className ? `writing-grid-launcher ${className}` : "writing-grid-launcher"} sx={{ px: "22px", pt: "14px" }}>
            <GameCard card={card} classPrefix="writing-grid-launcher" />
        </Box>
    );
};

export default WritingGridLauncher;
