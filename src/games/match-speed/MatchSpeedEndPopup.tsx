import React from "react";
import GameEndPopup from "../runtime/GameEndPopup";

interface MatchSpeedEndPopupProps {
    /** When true the card is collapsed into the top-right square puck. */
    minimized: boolean;
    /** Collapse the card into the corner square (the card's × button). */
    onMinimize: () => void;
    /** Re-expand the card from the corner square (clicking the puck). */
    onRestore: () => void;
    /** Card body (score / medal / actions) supplied by the page. */
    children: React.ReactNode;
}

/**
 * End-of-run popup for Match Speed. Thin wrapper over the shared `GameEndPopup`
 * (src/games/runtime/GameEndPopup.tsx), pinning the `match-speed` class prefix so
 * the collapse/expand behavior is identical to Bubble Match and Word Search.
 *
 * Minimizing it is also what puts the run into its cleanup phase — the page
 * derives that from `popupMinimized`, not from a separate state value.
 */
const MatchSpeedEndPopup: React.FC<MatchSpeedEndPopupProps> = (props) => (
    <GameEndPopup classPrefix="match-speed" {...props} />
);

export default MatchSpeedEndPopup;
