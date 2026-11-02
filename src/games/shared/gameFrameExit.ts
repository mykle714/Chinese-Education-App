import { createContext, useContext } from "react";
import { BACK_ARROW_PX, TOWER_STUDY_BACK_ARROW_TOP_PX, TOWER_STUDY_HEADER_BOTTOM_PX } from "../../components/pageHeaderSizing";

/**
 * The play panel's EXIT control (docs/FLP_GAME_BREAKS.md § 6) — an action a HOST may
 * hang in the top-left corner of every `GameFrame` beneath it.
 *
 * Only an flp game break provides one: the game is the whole screen with no page header,
 * so its Leave is a back arrow where the header's would be (`GameFrameExitButton`), with the
 * game's name beside it (`GameFrameExitTitle`). `label` is the arrow's screen-reader name. A provider also means the screen is the frame,
 * so `GameFrame` drops its panel look. A game's own route provides none, so standalone
 * games draw nothing extra and leave through the page header's Back.
 *
 * Kept in its own module (no components) so Fast Refresh can treat GameFrame.tsx as a
 * component file. Read by: `GameFrame` (GameFrame.tsx), and the constants by
 * MatchSpeedStage, WordSearchStage and WritingGridStage. Provided by:
 * features/flashcards/FlashcardsLearnPage/gameBreak/GameBreakFrame.tsx.
 */
/**
 * How far down the exit arrow's row reaches: the tower study header's bottom edge. A game
 * with no top strip (Match Speed, Word Search) keeps this much clear above its content.
 */
export const GAME_FRAME_EXIT_CLEARANCE_PX = TOWER_STUDY_HEADER_BOTTOM_PX;

/** The exit arrow's painted bottom edge, for content centred in the space below it. */
export const GAME_FRAME_EXIT_ARROW_BOTTOM_PX = TOWER_STUDY_BACK_ARROW_TOP_PX + BACK_ARROW_PX;

export interface GameFrameExit {
    label: string;
    /** The game's name, shown beside the arrow as a page header's title would be. */
    title: string;
    onExit: () => void;
}

export const GameFrameExitContext = createContext<GameFrameExit | null>(null);

/** The host's exit control for the enclosing panel, or null when there is none. */
export function useGameFrameExit(): GameFrameExit | null {
    return useContext(GameFrameExitContext);
}
