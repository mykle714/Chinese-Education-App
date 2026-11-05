import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useAuth } from "../../AuthContext";
import { useSlideNavigate } from "../../hooks/useSlideNavigate";
import { useGameWins } from "../../hooks/useGameWins";
import type { GameCardData } from "../shared/GameCard";
import type { GameDef } from "../types";
import { loadGameState, clearGameState, type SavedWordSearchState } from "./gameStateStorage";
import { GAME_KEY, type WordSearchMode } from "./constants";
import NewGameConfirmDialog from "./NewGameConfirmDialog";
import { buildWordSearchCard } from "./wordSearchCard";

interface UseWordSearchLauncherArgs {
    /** The registry entry, or undefined when the surface gated the game out — the hook
     *  still runs (hooks may not be conditional) and returns `card: null`. */
    game: GameDef | undefined;
    /** The mode the card launches AND the save slot it owns (the hub's: Pinyin; see
     *  gameStateStorage). */
    mode: WordSearchMode;
    /** BEM block for the card, resume tile and dialog classes. */
    classPrefix: string;
}

interface WordSearchLauncher {
    /** The card to render with `GameCard`, or null when `game` is undefined. */
    card: GameCardData | null;
    /** The clobber confirm — render it once, anywhere beside the card. */
    confirmDialog: ReactElement;
}

/**
 * Everything the Games hub (`WordSearchHubItem`, Pinyin) needs to launch Word Search
 * from its save slot.
 *
 * Behavior (docs/WORD_SEARCH_GAME.md §3 / §5b):
 *  - The play button ALWAYS deals a fresh board. With a board parked in this slot it
 *    first asks (`NewGameConfirmDialog`), since the fresh game would overwrite it; on
 *    confirm the slot is cleared before navigating.
 *  - The resume tile restores the parked board — no warning, nothing is lost.
 *  - The resume tile's ✕ → Delete clears the slot; the tile unmounts with it.
 * Another mode's slot is never touched.
 *
 * Layer: feature hook (src/games/word-search) — owns the save-slot state and navigation;
 * the card itself is presentational (`buildWordSearchCard` → `GameCard`).
 */
export function useWordSearchLauncher({
    game, mode, classPrefix,
}: UseWordSearchLauncherArgs): WordSearchLauncher {
    const { user } = useAuth();
    const userId = user?.id;
    const slideNavigate = useSlideNavigate();
    // Game-wide lifetime win count for the pill. Word Search logs every completion
    // under one level bucket, so this is already mode-agnostic.
    const { totalWins } = useGameWins(GAME_KEY);

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
        slideNavigate(route, { state: { mode, resume: false } });
    }, [route, mode, slideNavigate]);

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
            classPrefix,
            onResume: () => {
                if (saved && route) slideNavigate(route, { state: { mode: saved.mode, resume: true } });
            },
            onErase: clearSlot,
            onPlay: () => {
                if (saved) setConfirming(true); // warn before clobbering the parked board
                else startNewGame();
            },
        });
    }, [game, totalWins, saved, classPrefix, route, clearSlot, startNewGame, slideNavigate]);

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
