import { createContext, useContext } from "react";

/**
 * The play panel's EXIT control (docs/FLP_GAME_BREAKS.md § 6) — an action a HOST may
 * hang in the top-right corner of every `GameFrame` beneath it.
 *
 * Only an flp game break provides one: it has no page header of its own (the game is
 * just the panel, on the flp's ground), so its Leave lives on the panel's top strip —
 * the right edge every strip keeps clear since the timer eye moved left
 * (`TimerEyeToggle`). A game's own route provides none, so standalone games draw nothing
 * extra and leave through the page header's Back.
 *
 * Kept in its own module (no components) so Fast Refresh can treat GameFrame.tsx as a
 * component file. Read by: `GameFrame` (GameFrame.tsx). Provided by:
 * features/flashcards/FlashcardsLearnPage/gameBreak/GameBreakFrame.tsx.
 */
export interface GameFrameExit {
    label: string;
    onExit: () => void;
}

export const GameFrameExitContext = createContext<GameFrameExit | null>(null);

/** The host's exit control for the enclosing panel, or null when there is none. */
export function useGameFrameExit(): GameFrameExit | null {
    return useContext(GameFrameExitContext);
}
