import React, { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useBlockEdgeSwipe } from "../../hooks/useBlockEdgeSwipe";
import { useLaunchCollection } from "../../features/flashcards/useLaunchCollection";
import { GameLeafPage } from "../shared/GameSurface";
import { useGameExit } from "../runtime/gameExit";
import type { GameStageFrameProps } from "../types";
import BucketDropStage from "./BucketDropStage";
import { GAME_HUE, modeConfigFor } from "./constants";

/**
 * The page host's chrome for the Stage: a LEAF PAGE (docs/LEAF_NODE_PAGES.md).
 * Module-level so its identity is stable (a new component per render would remount the
 * whole Stage).
 */
const BucketDropPageFrame: React.FC<GameStageFrameProps> = ({ title, onExitRequest, headerRight, children }) => (
    <GameLeafPage hue={GAME_HUE} title={title} onBack={onExitRequest} rightContent={headerRight}>
        {children}
    </GameLeafPage>
);

/**
 * Bucket Drop — the game's own ROUTE (`/games/bucket-drop`). A thin host around
 * `BucketDropStage`, which owns the run; this file owns only what belongs to being a page:
 * the title, the edge-swipe block, the launch's mode + collection, and where "Back to …"
 * goes. The same Stage also runs inside an flp game break (docs/FLP_GAME_BREAKS.md § 6).
 *
 * `state.mode` from the launch: the Games hub tile sends nothing (Pinyin), the Reading
 * Center carousel sends `no-pinyin`. See docs/BUCKET_DROP_GAME.md § 1.
 */
const BucketDropPage: React.FC = () => {
    usePageTitle("Bucket Drop");
    // Every game page blocks the browser's edge-swipe-back (CLAUDE.md "Touch & Scroll").
    useBlockEdgeSwipe(true);
    const navigate = useNavigate();
    const location = useLocation();
    const gameExit = useGameExit();
    // Which collection the hub was pointed at (docs/DECKS_FEATURE.md). Null for the
    // Reading Center launch.
    const launchCollection = useLaunchCollection();
    const modeConfig = modeConfigFor((location.state as { mode?: unknown } | null)?.mode);

    const leave = useCallback(() => navigate(gameExit.path, { state: gameExit.state }), [navigate, gameExit.path, gameExit.state]);

    return (
        <BucketDropStage
            host="page"
            Frame={BucketDropPageFrame}
            modeConfig={modeConfig}
            collection={launchCollection}
            onDone={leave}
            doneLabel={gameExit.label}
        />
    );
};

export default BucketDropPage;
