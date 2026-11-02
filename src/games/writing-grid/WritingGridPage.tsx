import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { GameLeafPage } from "../shared/GameSurface";
import { useGameExit } from "../runtime/gameExit";
import { useBlockEdgeSwipe } from "../../hooks/useBlockEdgeSwipe";
import { usePageTitle } from "../../hooks/usePageTitle";
import type { GameStageFrameProps } from "../types";
import { GAME_HUE } from "./constants";
import WritingGridStage from "./WritingGridStage";

/** Module-level so its identity is stable: a new component per render would remount the run. */
const WritingGridPageFrame: React.FC<GameStageFrameProps> = ({ title, onExitRequest, headerRight, children }) => (
    <GameLeafPage hue={GAME_HUE} title={title} onBack={onExitRequest} rightContent={headerRight}>
        {children}
    </GameLeafPage>
);

/**
 * Writing Grid — the game's own ROUTE (`/games/writing-grid`), launched from the Writing
 * Center. A thin host around `WritingGridStage`, which owns the run; this file owns only
 * what belongs to being a page: the title, the edge-swipe block and where "Back to …" goes.
 * The same Stage also runs inside an flp game break (docs/FLP_GAME_BREAKS.md § 6).
 */
const WritingGridPage: React.FC = () => {
    usePageTitle("Writing Grid");
    useBlockEdgeSwipe(true);
    const navigate = useNavigate();
    const gameExit = useGameExit();
    const leave = useCallback(() => navigate(gameExit.path, { state: gameExit.state }), [navigate, gameExit.path, gameExit.state]);
    return <WritingGridStage host="page" Frame={WritingGridPageFrame} onDone={leave} doneLabel={gameExit.label} />;
};

export default WritingGridPage;
