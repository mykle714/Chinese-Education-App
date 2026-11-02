import React, { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useBlockEdgeSwipe } from "../../hooks/useBlockEdgeSwipe";
import { useLaunchCollection } from "../../features/flashcards/useLaunchCollection";
import { GameLeafPage } from "../shared/GameSurface";
import { useGameExit } from "../runtime/gameExit";
import type { GameStageFrameProps } from "../types";
// The game's accent hue — one constant drives its hub row and its own ground (§ A6b).
import { GAME_HUE, modeConfigFor } from "./constants";
import WordSearchHeaderControls from "./WordSearchHeader";
import WordSearchStage from "./WordSearchStage";

/**
 * The page host's chrome for the Stage: Word Search is a LEAF PAGE
 * (docs/LEAF_NODE_PAGES.md) — no footer, DOWN back arrow, slides up on enter.
 * Module-level so its identity is stable (a new component per render would remount
 * the whole stage).
 */
const WordSearchPageFrame: React.FC<GameStageFrameProps> = ({ title, onExitRequest, headerRight, children }) => (
    <GameLeafPage hue={GAME_HUE} title={title} onBack={onExitRequest} rightContent={headerRight}>
        {children}
    </GameLeafPage>
);

/**
 * Word Search — the game's own ROUTE (`/games/word-search`). A thin host around
 * `WordSearchStage`, which owns the run; this file owns only what belongs to being a page:
 * the title, the edge-swipe block, the launch's mode + collection + resume intent, and
 * where "Back to …" goes.
 *
 * The same stage also runs inside an flp game break (docs/FLP_GAME_BREAKS.md § 6).
 * See docs/WORD_SEARCH_GAME.md.
 */
const WordSearchPage: React.FC = () => {
    usePageTitle("Word Search");
    // An edge swipe would navigate away mid-drag; block it while mounted.
    useBlockEdgeSwipe(true);
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams] = useSearchParams();
    // Which collection this game was launched from (docs/DECKS_FEATURE.md) — null for an
    // ordinary launch from the Games hub.
    const launchCollection = useLaunchCollection();
    // Where Back / "Back to …" land: the hub, or the surface that launched us.
    const gameExit = useGameExit();

    // The board mode ("pinyin" / "no-pinyin") is chosen on the Games hub (one sub-card
    // each — see GamesPage) and passed in via nav `state.mode`, read once on mount.
    //
    // A challenge round's `?mode=` query param is the fallback: `state` does not survive a
    // reload (challengeLaunch.ts), and without this a mid-round refresh lost the mode and
    // bounced the player to /games, discarding an in-progress challenge round even though
    // `useChallengeRound` itself reads `challengeId` from the URL and stays active. Only a
    // challenge launch ever sets `?mode=`, so an ordinary hub launch is unaffected.
    const [modeConfig] = useState(() => modeConfigFor(
        (location.state as { mode?: string } | null)?.mode ?? searchParams.get("mode")
    ));

    // Whether this mount was launched as a RESUME (restore this mode's saved board) vs a
    // fresh launch (always a new board). Captured once on mount — a fresh launch must
    // never silently resume; only the launching surface's resume affordance does
    // (WordSearchHubItem for Pinyin, ReadingGamesCarousel for No Pinyin — one save slot
    // each). See docs/WORD_SEARCH_GAME.md §5b.
    const [resume] = useState(() => (location.state as { resume?: boolean } | null)?.resume === true);

    // No mode chosen (direct URL / stray nav) — bounce back to the Games hub, where the
    // player picks Pinyin vs No Pinyin.
    useEffect(() => {
        if (!modeConfig) navigate("/games", { replace: true });
    }, [modeConfig, navigate]);

    const exit = useCallback(
        () => navigate(gameExit.path, { state: gameExit.state }),
        [navigate, gameExit.path, gameExit.state]
    );

    if (!modeConfig) return null;

    return (
        <WordSearchStage
            host="page"
            Frame={WordSearchPageFrame}
            headerRight={<WordSearchHeaderControls />}
            modeConfig={modeConfig}
            collection={launchCollection}
            resume={resume}
            onDone={exit}
            doneLabel={gameExit.label}
        />
    );
};

export default WordSearchPage;
