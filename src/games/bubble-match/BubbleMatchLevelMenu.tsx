import React from "react";
import { Box, Button, Typography, useTheme } from "@mui/material";
import type { LevelConfig } from "./types";
import { SIZE, WEIGHT } from "../../theme/scale";

interface BubbleMatchLevelMenuProps {
    /** All selectable levels (LEVEL_CONFIGS). */
    levels: LevelConfig[];
    /** The level the just-ended run played — marked "current" in the list. */
    currentLevel: number;
    /** Level numbers already won this week — prefixed with a ⭐ (parity with the
     *  start-screen picker). */
    clearedLevels: Set<number>;
    /** Start the picked level on the SAME loaded card set. */
    onPick: (cfg: LevelConfig) => void;
    /** Dismiss the menu (tap the scrim) and fall back to the end popup. */
    onClose: () => void;
}

/**
 * Compact floating level picker for the end-of-run "Different Level / Same Cards"
 * action. Layered over the stage on top of the end popup; a translucent scrim
 * dismisses it. Selecting a level replays the same vocab set at the new level
 * (the page keeps the loaded pool, so there is no refetch).
 *
 * Layout layer: presentational. The page owns the open/close flag and the
 * loaded pool; this component only lists the levels and reports the choice.
 */
const BubbleMatchLevelMenu: React.FC<BubbleMatchLevelMenuProps> = ({
    levels,
    currentLevel,
    clearedLevels,
    onPick,
    onClose,
}) => {
    const theme = useTheme();
    const fc = theme.palette.flashcard;

    return (
        <Box
            className="bubble-match__level-menu-scrim"
            onClick={onClose}
            sx={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                px: 4,
                // Above the end popup (zIndex 200) so it floats over the card.
                zIndex: 300,
                backgroundColor: "rgba(20, 20, 28, 0.32)",
            }}
        >
            {/* Stop the scrim's dismiss handler from firing on taps inside the menu. */}
            <Box
                className="bubble-match__level-menu"
                onClick={(e) => e.stopPropagation()}
                sx={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 1,
                    p: 1.5,
                    width: "100%",
                    maxWidth: 260,
                    borderRadius: "16px",
                    backgroundColor: fc.flashCard,
                    boxShadow: "0 18px 48px rgba(0, 0, 0, 0.32)",
                }}
            >
                <Typography
                    className="bubble-match__level-menu-title"
                    sx={{ fontSize: SIZE.caption, fontWeight: WEIGHT.bold, color: fc.textSecondary, textAlign: "center", mb: 0.5 }}
                >
                    Pick a level
                </Typography>
                {levels.map((cfg) => {
                    const isCurrent = cfg.level === currentLevel;
                    return (
                        <Button
                            key={cfg.level}
                            className={`bubble-match__level-menu-btn bubble-match__level-menu-btn--${cfg.level}${isCurrent ? " bubble-match__level-menu-btn--current" : ""}`}
                            // The current level reads as outlined (secondary) so the
                            // "different" choices stand out as the filled options.
                            variant={isCurrent ? "outlined" : "contained"}
                            onClick={() => onPick(cfg)}
                            sx={{ py: 1, px: 1.5, textTransform: "none", borderRadius: "10px", justifyContent: "space-between" }}
                        >
                            <Box component="span" className="bubble-match__level-menu-btn-label" sx={{ fontWeight: WEIGHT.bold }}>
                                {clearedLevels.has(cfg.level) ? "⭐ " : ""}Level {cfg.level}
                            </Box>
                            <Box component="span" className="bubble-match__level-menu-btn-meta" sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                                <Box component="span" className="bubble-match__level-menu-btn-name" sx={{ fontSize: SIZE.caption, opacity: 0.85 }}>
                                    {cfg.label}
                                </Box>
                                {isCurrent && (
                                    <Box component="span" className="bubble-match__level-menu-btn-current" sx={{ fontSize: SIZE.micro, opacity: 0.7, fontStyle: "italic" }}>
                                        current
                                    </Box>
                                )}
                            </Box>
                        </Button>
                    );
                })}
            </Box>
        </Box>
    );
};

export default BubbleMatchLevelMenu;
