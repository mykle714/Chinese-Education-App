import React from "react";
import MinimizablePopup from "../../components/MinimizablePopup";

interface GameEndPopupProps {
    /** When true the card is collapsed into the top-right square puck. */
    minimized?: boolean;
    /**
     * Collapse the card into the corner square (the card's × button). OMIT to make
     * the end popup non-minimizable — no × and no puck, so the only exits are the
     * popup's own buttons.
     */
    onMinimize?: () => void;
    /** Re-expand the card from the corner square (clicking the puck). */
    onRestore?: () => void;
    /** BEM-style class prefix so each game keeps descriptive, distinct classes. */
    classPrefix: string;
    /** Render in place rather than at the frame — see MinimizablePopup's `inPlace`. */
    inPlace?: boolean;
    /** Card body (title / message / actions) supplied by the page. */
    children: React.ReactNode;
}

/**
 * Shared end-of-run popup. Its one game caller is Bubble Match, which passes the
 * minimize handlers to get the collapse-to-corner affordance (its board stays usable
 * after a loss — cleanup mode). Every other game runs as an flp break and reports to
 * the break's results card instead (docs/FLP_GAME_BREAKS.md § 5b); the Match Speed,
 * Word Search and Bucket Drop popups were deleted 2026-11-10 with the medals.
 *
 * The scrim/card/puck mechanics live in the shared
 * `MinimizablePopup` (src/components/MinimizablePopup.tsx) because the
 * provisional sort offer reuses them; this wrapper pins the end-of-run flavor —
 * the TOP-RIGHT corner and the neutral card-colored puck — so the sort offer,
 * which collapses to the TOP-LEFT in its own accent color, can never be mistaken
 * for it when both are on screen at once (docs/PROVISIONAL_CARDS.md § 5).
 *
 * The puck docks into the GAME FRAME's corner (`.game-frame`, GameFrame), not the
 * screen's: the scrim covers the ENTIRE screen (header included — MinimizablePopup
 * portals it to the phone frame), but the minimized puck sits inside the game viewport
 * it belongs to.
 */
const GameEndPopup: React.FC<GameEndPopupProps> = (props) => (
    <MinimizablePopup corner="top-right" puckAnchorSelector=".game-frame" {...props} />
);

export default GameEndPopup;
