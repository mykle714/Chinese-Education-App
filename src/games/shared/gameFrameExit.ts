import { createContext, useContext } from "react";
import { BACK_ARROW_PX, TOWER_STUDY_BACK_ARROW_TOP_PX, TOWER_STUDY_HEADER_BOTTOM_PX } from "../../components/pageHeaderSizing";

/**
 * The break host's hold on every `GameFrame` beneath it (docs/FLP_GAME_BREAKS.md § 6).
 *
 * Only an flp game break provides one. The break's header row — Leave's back arrow, the
 * game's name, the audio chip and the minute-points flame — is drawn by the HOST
 * (features/flashcards/…/gameBreak/GameBreakChrome.tsx), not by the game, so it is on screen
 * from the first frame of the circle grow, before the Stage has even mounted. What reaches
 * the game through this context is:
 *   - that there IS a host: the screen is the frame, so `GameFrame` drops its panel look,
 *     `GameHud` / `GameTimer` drop their band, and the game's content fades in (it arrives
 *     after the grow, while the row was already there);
 *   - `trailingSlot`: the row's element for the game's own controls (`GameFrame`
 *     `exitRowTrailing` portals into it, just left of the audio chip). Null until the row
 *     has mounted.
 * A game's own route provides none, so standalone games draw nothing extra and leave
 * through the page header's Back.
 *
 * Kept in its own module (no components) so Fast Refresh can treat GameFrame.tsx as a
 * component file. Read by: `GameFrame`, `GameHud`, `GameTimer`, `GameCentered`
 * (GameFrame.tsx), and the constants by the break Stages. Provided by:
 * features/flashcards/FlashcardsLearnPage/gameBreak/GameBreakFrame.tsx.
 */
/**
 * How far down the exit arrow's row reaches: the tower study header's bottom edge. A game
 * with no top strip (Match Speed, Word Search) keeps this much clear above its content.
 */
export const GAME_FRAME_EXIT_CLEARANCE_PX = TOWER_STUDY_HEADER_BOTTOM_PX;

/** The exit arrow's painted bottom edge, for content centred in the space below it. */
export const GAME_FRAME_EXIT_ARROW_BOTTOM_PX = TOWER_STUDY_BACK_ARROW_TOP_PX + BACK_ARROW_PX;

export interface GameFrameHost {
    /** The header row's slot for the game's own controls; null until the row mounts. */
    trailingSlot: HTMLElement | null;
}

export const GameFrameHostContext = createContext<GameFrameHost | null>(null);

/** The break host enclosing this panel, or null on a game's own route. */
export function useGameFrameHost(): GameFrameHost | null {
    return useContext(GameFrameHostContext);
}

/** The fade a game's content arrives with under a host, ms (§ 2 "playing"). */
export const GAME_FRAME_HOST_FADE_IN_MS = 250;
