import { useCallback, useEffect, useRef } from "react";

/**
 * The flp side of `FlpBreakStageProps.onCardCleared` (docs/FLP_GAME_BREAKS.md § 4a).
 *
 * Each id a break game clears is reported to the Deck Tower at once (it tallies and drops
 * the lot when the game closes) and HELD for the working loop until the game is gone —
 * the loop is behind the game, so changing it mid-game would only re-render unseen
 * cards, and one batch means one refill request. A mark whose response lands after the
 * game closed is passed straight through.
 *
 * Layer: feature hook (features/flashcards). Returns the `onCardCleared` for GameBreakArea.
 */
export function useBreakClears(
    /** The game is on screen (`growing` / `playing`). */
    gameUp: boolean,
    /** `useWorkingLoop` → `replaceGameCleared`. */
    replaceGameCleared: (cardIds: readonly number[]) => void,
    /** The tower's tally (`FlpTowerHost.onGameCardCleared`). */
    onTowerCardCleared: () => void
): (cardId: number) => void {
    const pending = useRef<number[]>([]);
    // Latest-ref: the callback is handed to a Stage that holds it in its own ref.
    const latest = useRef({ gameUp, replaceGameCleared, onTowerCardCleared });
    latest.current = { gameUp, replaceGameCleared, onTowerCardCleared };

    const flush = useCallback(() => {
        if (pending.current.length === 0) return;
        const ids = pending.current;
        pending.current = [];
        latest.current.replaceGameCleared(ids);
    }, []);

    useEffect(() => {
        if (!gameUp) flush();
    }, [gameUp, flush]);

    return useCallback((cardId: number) => {
        latest.current.onTowerCardCleared();
        pending.current.push(cardId);
        if (!latest.current.gameUp) flush();
    }, [flush]);
}
