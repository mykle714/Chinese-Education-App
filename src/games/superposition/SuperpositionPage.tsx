import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { GameLeafPage } from "../shared/GameSurface";
import { useGameExit } from "../runtime/gameExit";
import { useBlockEdgeSwipe } from "../../hooks/useBlockEdgeSwipe";
import { usePageTitle } from "../../hooks/usePageTitle";
import type { GameStageFrameProps } from "../types";
import { GAME_HUE } from "./constants";
import SuperpositionStage from "./SuperpositionStage";

/** Module-level so its identity is stable: a new component per render would remount the run. */
const SuperpositionPageFrame: React.FC<GameStageFrameProps> = ({ title, onExitRequest, headerRight, children }) => (
    <GameLeafPage hue={GAME_HUE} title={title} onBack={onExitRequest} rightContent={headerRight}>
        {children}
    </GameLeafPage>
);

/**
 * Superposition's own ROUTE (`/games/superposition`). The game is hidden from the hub and
 * reached through an flp break; every registered game needs a route, and this one is also
 * the direct way in for tuning. A thin host around `SuperpositionStage`.
 */
const SuperpositionPage: React.FC = () => {
    usePageTitle("Superposition");
    useBlockEdgeSwipe(true);
    const navigate = useNavigate();
    const gameExit = useGameExit();
    const leave = useCallback(() => navigate(gameExit.path, { state: gameExit.state }), [navigate, gameExit.path, gameExit.state]);
    return <SuperpositionStage host="page" Frame={SuperpositionPageFrame} onDone={leave} doneLabel={gameExit.label} />;
};

export default SuperpositionPage;
