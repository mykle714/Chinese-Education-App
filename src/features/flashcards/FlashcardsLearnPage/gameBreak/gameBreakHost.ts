import { createContext, useContext } from "react";

/**
 * What the break AREA hands down to the game's Frame (docs/FLP_GAME_BREAKS.md § 6).
 *
 * The break's header row (GameBreakChrome: Leave, the game's name, the audio chip, the
 * flame) is drawn by the area, from the first frame of the grow, so it exists before any
 * Stage does. Two things have to cross from the Stage back up to it:
 *   - `registerExit`: what Leave does. While a Stage is mounted that is the Stage's own
 *     `onExitRequest` (it may end a run, or answer a lent-card offer); with none mounted
 *     (the grow, the Stage's lazy load) Leave ends the break itself (`beginLeave`).
 *   - `trailingSlot`: the row's element for the game's own controls, which `GameFrame`
 *     portals into (`exitRowTrailing`).
 *
 * Kept in a component-free module so Fast Refresh treats the .tsx files as components.
 * Provided by: GameBreakArea. Read by: GameBreakFrame.
 */
export interface GameBreakHost {
    /** Install the Stage's Leave handler; call with null when it unmounts. */
    registerExit: (onExit: (() => void) | null) => void;
    /** The header row's slot for the game's own controls; null until the row mounts. */
    trailingSlot: HTMLElement | null;
}

export const GameBreakHostContext = createContext<GameBreakHost | null>(null);

export function useGameBreakHost(): GameBreakHost | null {
    return useContext(GameBreakHostContext);
}
