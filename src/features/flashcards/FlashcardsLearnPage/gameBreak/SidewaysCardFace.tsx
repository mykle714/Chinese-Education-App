import React from "react";
import { Box } from "@mui/material";
import { useSidewaysStage } from "../../../../games/runtime/useSidewaysStage";

/**
 * Turns a break card's face 90° for a game played LANDSCAPE (`FlpBreakGame.sideways`,
 * docs/FLP_GAME_BREAKS.md § 5): the title card and the results card read upright only once
 * the learner has turned the phone, which is how the card says "this game is sideways"
 * before Play, and lets the results be read before turning back.
 *
 * It reuses the game's own `useSidewaysStage`, so the card and the game turn the SAME way
 * (`ROTATION_DEG`) and obey the same rule: rotate while the box is taller than wide. A card
 * that is already landscape (rotation lock off, phone turned) renders straight, as the
 * game does.
 *
 * With `sideways` false it renders its children untouched, so the faces need no branch.
 * Nothing inside reads pointer coordinates (Skip / Play are plain buttons; the results
 * card's swipe is taken by `BreakCardLayer`, outside this box), so `toStageCoords` is
 * not needed.
 *
 * Layer: feature component (features/flashcards). Used by GameBreakCard and
 * GameBreakResultCard.
 */
const SidewaysCardFace: React.FC<{ sideways: boolean; children: React.ReactNode }> = ({ sideways, children }) => {
    const stage = useSidewaysStage();
    if (!sideways) return <>{children}</>;
    return (
        <Box
            // NOT rotated: its shape decides the rotation (useSidewaysStage).
            ref={stage.outerRef}
            className="game-break-sideways-face"
            sx={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}
        >
            <Box
                className={`game-break-sideways-face__stage${stage.rotated ? " game-break-sideways-face__stage--rotated" : ""}`}
                style={stage.stageStyle}
            >
                {children}
            </Box>
        </Box>
    );
};

export default SidewaysCardFace;
