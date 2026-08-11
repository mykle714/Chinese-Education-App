import React from "react";
import MinimizablePopup from "../../components/MinimizablePopup";

interface GameEndPopupProps {
    /** When true the card is collapsed into the top-right square puck. */
    minimized: boolean;
    /** Collapse the card into the corner square (the card's × button). */
    onMinimize: () => void;
    /** Re-expand the card from the corner square (clicking the puck). */
    onRestore: () => void;
    /** BEM-style class prefix so each game keeps descriptive, distinct classes. */
    classPrefix: string;
    /** Card body (title / message / actions) supplied by the page. */
    children: React.ReactNode;
}

/**
 * Shared end-of-run popup for games with a minimize-to-corner affordance
 * (Bubble Match, Match Speed, Speed Reading, Word Search).
 *
 * The scrim/card/puck mechanics live in the shared
 * `MinimizablePopup` (src/components/MinimizablePopup.tsx) because the
 * provisional sort offer reuses them; this wrapper pins the end-of-run flavor —
 * the TOP-RIGHT corner and the neutral card-colored puck — so the sort offer,
 * which collapses to the TOP-LEFT in its own accent color, can never be mistaken
 * for it when both are on screen at once (docs/PROVISIONAL_CARDS.md § 5).
 */
const GameEndPopup: React.FC<GameEndPopupProps> = (props) => (
    <MinimizablePopup corner="top-right" {...props} />
);

export default GameEndPopup;
