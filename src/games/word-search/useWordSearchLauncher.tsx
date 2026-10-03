import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useAuth } from "../../AuthContext";
import { useSlideNavigate } from "../../hooks/useSlideNavigate";
import { useGameWins } from "../../hooks/useGameWins";
import type { GameCardData } from "../shared/GameCard";
import type { GameDef } from "../types";
import { loadGameState, clearGameState, type SavedWordSearchState } from "./gameStateStorage";
import { GAME_KEY, type WordSearchMode } from "./constants";
import { useWordSearchSettings } from "./useWordSearchSettings";
import NewGameConfirmDialog from "./NewGameConfirmDialog";
import { buildWordSearchCard } from "./wordSearchCard";

interface UseWordSearchLauncherArgs {
    /** The registry entry, or undefined when the surface gated the game out — the hook
     *  still runs (hooks may not be conditional) and returns `card: null`. */
    game: GameDef | undefined;
    /** The mode this surface launches AND the save slot it owns (hub = Pinyin, Reading
     *  Center = No Pinyin; see gameStateStorage). */
    mode: WordSearchMode;
    /** BEM block for the card, resume tile and dialog classes. */
    classPrefix: string;
    /** Where a NEW game goes — the hub appends the selected collection's params.
     *  Default: the game's bare route. A RESUME never takes these: the parked board was
     *  built from whatever set was selected when it started, and nothing refetches. */
    newGamePath?: string;
    /** Extra nav state on every launch (the Reading Center's `exitTo`). */
    launchState?: Record<string, unknown>;
}

interface WordSearchLauncher {
    /** The card to render with `GameCard`, or null when `game` is undefined. */
    card: GameCardData | null;
    /** The clobber confirm — render it once, anywhere beside the card. */
    confirmDialog: ReactElement;
}

/**
 * Everything a surface needs to launch Word Search from its own save slot — the ONE
 * implementation shared by the Games hub (`WordSearchHubItem`, Pinyin) and the Reading
 * Center carousel (`ReadingGamesCarousel`, No Pinyin), which used to each hand-roll it.
 *
 * Behavior (docs/WORD_SEARCH_GAME.md §3 / §5b):
 *  - The play button ALWAYS deals a fresh board. With a board parked in this slot it
 *    first asks (`NewGameConfirmDialog`), since the fresh game would overwrite it; on
 *    confirm the slot is cleared before navigating.
 *  - The resume tile restores the parked board — no warning, nothing is lost.
 *  - The resume tile's ✕ → Delete clears the slot; the tile unmounts with it.
 * The other surface's slot is never touched.
 *
 * Layer: feature hook (src/games/word-search) — owns the save-slot state and navigation;
 * the card itself is presentational (`buildWordSearchCard` → `GameCard`).
 */
export function useWordSearchLauncher({
    game, mode, classPrefix, newGamePath, launchState,
}: UseWordSearchLauncherArgs): WordSearchLauncher {
    const { user } = useAuth();
    const userId = user?.id;
    const slideNavigate = useSlideNavigate();
    // Game-wide lifetime win count for the pill. Word Search logs every completion
    // under one level bucket, so this is already mode-agnostic.
    const { totalWins } = useGameWins(GAME_KEY);
    // The device-local "show timer" preference the in-game HUD eye toggles — the
    // resume tile honours it so a hidden clock stays hidden on the launch surface too.
    const { showTimer } = useWordSearchSettings().settings;

    // This surface's parked board, read once on mount; null when nothing to resume.
    const [saved, setSaved] = useState<SavedWordSearchState | null>(() =>
        userId ? loadGameState(userId, mode) : null
    );
    // Whether a play tap is waiting on the "your saved game will be lost" confirm.
    const [confirming, setConfirming] = useState(false);

    const route = game?.route;
    const clearSlot = useCallback(() => {
        if (userId) clearGameState(userId, mode);
        setSaved(null);
    }, [userId, mode]);

    // resume:false → WordSearchPage always fetches a new board.
    const startNewGame = useCallback(() => {
        if (!route) return;
        slideNavigate(newGamePath ?? route, { state: { ...launchState, mode, resume: false } });
    }, [route, newGamePath, launchState, mode, slideNavigate]);

    const confirmNewGame = useCallback(() => {
        setConfirming(false);
        clearSlot();
        startNewGame();
    }, [clearSlot, startNewGame]);

    const card = useMemo(() => {
        if (!game) return null;
        return buildWordSearchCard({
            game,
            wins: totalWins,
            saved,
            showTimer,
            classPrefix,
            onResume: () => {
                if (saved) slideNavigate(game.route, { state: { ...launchState, mode: saved.mode, resume: true } });
            },
            onErase: clearSlot,
            onPlay: () => {
                if (saved) setConfirming(true); // warn before clobbering the parked board
                else startNewGame();
            },
        });
    }, [game, totalWins, saved, showTimer, classPrefix, launchState, clearSlot, startNewGame, slideNavigate]);

    const confirmDialog = (
        <NewGameConfirmDialog
            classPrefix={classPrefix}
            open={confirming}
            savedGame={saved}
            onCancel={() => setConfirming(false)}
            onConfirm={confirmNewGame}
        />
    );

    return { card, confirmDialog };
}
