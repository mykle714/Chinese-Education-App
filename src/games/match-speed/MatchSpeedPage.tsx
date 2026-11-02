import React, { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../AuthContext";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useFlashcardLearnSettings } from "../../hooks/useFlashcardLearnSettings";
import { useBlockEdgeSwipe } from "../../hooks/useBlockEdgeSwipe";
import { useLaunchCollection } from "../../features/flashcards/useLaunchCollection";
import { GameLeafPage } from "../shared/GameSurface";
import type { GameStageFrameProps } from "../types";
import type { Language } from "../../types";
// The game's accent hue — one constant drives its hub row and its own ground (§ A6b).
import { GAME_HUE, modeConfigFor } from "./constants";
import MatchSpeedHeaderControls from "./MatchSpeedHeader";
import MatchSpeedStage from "./MatchSpeedStage";

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
 * page: the title, the edge-swipe block, the hub's mode + collection, the pinyin chip,
 * and where "Back to Games" goes.
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
    const location = useLocation();
    const { user } = useAuth();
    const language = (user?.selectedLanguage ?? "zh") as Language;
    // Which collection this game was launched from (docs/DECKS_FEATURE.md) — null for
    // an ordinary launch from the Games hub.
    const launchCollection = useLaunchCollection();
    const { settings, update } = useFlashcardLearnSettings();
    const { showPinyin } = settings;

    // The difficulty mode tapped on the Games hub, via nav `state`. A direct visit
    // with no/invalid state falls back to Mix rather than bouncing to the hub — this
    // route predates the modes and must stay playable on its own.
    const baseModeConfig = modeConfigFor((location.state as { mode?: string } | null)?.mode);

    const backToGames = useCallback(() => navigate("/games"), [navigate]);

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
            baseModeConfig={baseModeConfig}
            showPinyin={showPinyin}
            collection={launchCollection}
            onDone={backToGames}
        />
    );
};

export default MatchSpeedPage;
