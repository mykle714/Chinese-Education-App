import React, { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../AuthContext";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useFlashcardLearnSettings } from "../../hooks/useFlashcardLearnSettings";
import { useBlockEdgeSwipe } from "../../hooks/useBlockEdgeSwipe";
import { GameLeafPage } from "../shared/GameSurface";
import type { GameStageFrameProps } from "../types";
import type { Language } from "../../types";
// The game's accent hue — one constant drives its hub row and its own ground (§ A6b).
import { GAME_HUE } from "./constants";
import MatchSpeedHeaderControls from "./MatchSpeedHeader";
import MatchSpeedStage from "./MatchSpeedStage";
import { GAMES_HUB_EXIT } from "../runtime/gameExit";

/**
 * The page host's chrome for the Stage: Match Speed is a LEAF PAGE
 * (docs/LEAF_NODE_PAGES.md) — no footer, DOWN back arrow, slides up on enter. No
 * per-page IPhoneFrame; the frame comes from MobileDemoFrame via Layout.tsx.
 * Module-level so its identity is stable (a new component per render would remount
 * the whole stage).
 */
const MatchSpeedPageFrame: React.FC<GameStageFrameProps> = ({ title, onExitRequest, headerRight, children }) => (
    <GameLeafPage hue={GAME_HUE} title={title} onBack={onExitRequest} rightContent={headerRight}>
        {children}
    </GameLeafPage>
);

/**
 * Match Speed — the game's own ROUTE (`/games/match-speed`). A thin host around
 * `MatchSpeedStage`, which owns the run; this file owns only what belongs to being a
 * page: the title, the edge-swipe block, the pinyin chip, and where "Back to …" (`GAMES_HUB_EXIT`) goes.
 *
 * One difficulty (Study Mix): a launch's `state.mode` — Study Challenge still sends
 * `"mixed"` (runtime/challengeLaunch.ts) — is ignored.
 *
 * The same stage also runs inside an flp game break (docs/FLP_GAME_BREAKS.md § 6).
 * See docs/MATCH_SPEED_GAME.md.
 */
const MatchSpeedPage: React.FC = () => {
    usePageTitle("Match Speed");
    // Mandatory on every game page (CLAUDE.md): an edge swipe would otherwise
    // navigate away mid-run. CSS touch-action can't stop the history gesture.
    useBlockEdgeSwipe(true);
    const navigate = useNavigate();
    const { user } = useAuth();
    const language = (user?.selectedLanguage ?? "zh") as Language;
    const { settings, update } = useFlashcardLearnSettings();
    const { showPinyin } = settings;

    const backToGames = useCallback(() => navigate(GAMES_HUB_EXIT.path), [navigate]);

    return (
        <MatchSpeedStage
            host="page"
            Frame={MatchSpeedPageFrame}
            headerRight={
                <MatchSpeedHeaderControls
                    language={language}
                    showPinyin={showPinyin}
                    onTogglePinyin={() => update({ showPinyin: !showPinyin })}
                />
            }
            showPinyin={showPinyin}
            onDone={backToGames}
        />
    );
};

export default MatchSpeedPage;
