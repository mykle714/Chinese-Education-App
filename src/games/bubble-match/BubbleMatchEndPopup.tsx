import React from "react";
import GameEndPopup from "../runtime/GameEndPopup";

interface BubbleMatchEndPopupProps {
    /** When true the card is collapsed into the top-right square puck. */
    minimized: boolean;
    /** Collapse the card into the corner square (the card's × button). */
    onMinimize: () => void;
    /** Re-expand the card from the corner square (clicking the puck). */
    onRestore: () => void;
    /** Card body (title / message / actions) supplied by the page. */
    children: React.ReactNode;
}

/**
 * End-of-run popup (won / lost) for Bubble Match. Thin wrapper over the shared
 * `GameEndPopup` (src/games/runtime/GameEndPopup.tsx), pinning the `bubble-match`
 * class prefix so the collapse/expand behavior is identical to Word Search.
 */
const BubbleMatchEndPopup: React.FC<BubbleMatchEndPopupProps> = (props) => (
    <GameEndPopup classPrefix="bubble-match" {...props} />
);

export default BubbleMatchEndPopup;
