import React, { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useBlockEdgeSwipe } from "../../hooks/useBlockEdgeSwipe";
import { GameLeafPage } from "../shared/GameSurface";
import { GAMES_HUB_EXIT } from "../runtime/gameExit";
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
 * the title, the edge-swipe block, the launch's mode, and where "Back to …" goes. The same Stage also runs inside an flp game break (docs/FLP_GAME_BREAKS.md § 6).
 *
 * `state.mode` from the launch: the Games hub tile sends nothing (Pinyin). Nothing launches
 * `no-pinyin` on this route any more — the Reading Center carousel that did was deleted
 * 2026-11-04; the mode lives on for the flp break adapter (flpBreak/bucketDropBreak.ts, not
 * yet in the rotation). See docs/BUCKET_DROP_GAME.md § 1.
 */
const BucketDropPage: React.FC = () => {
    usePageTitle("Bucket Drop");
    // Every game page blocks the browser's edge-swipe-back (CLAUDE.md "Touch & Scroll").
    useBlockEdgeSwipe(true);
    const navigate = useNavigate();
    const location = useLocation();
    const modeConfig = modeConfigFor((location.state as { mode?: unknown } | null)?.mode);

    const leave = useCallback(() => navigate(GAMES_HUB_EXIT.path), [navigate]);

    return (
        <BucketDropStage
            host="page"
            Frame={BucketDropPageFrame}
            modeConfig={modeConfig}
            onDone={leave}
            doneLabel={GAMES_HUB_EXIT.label}
        />
    );
};

export default BucketDropPage;
