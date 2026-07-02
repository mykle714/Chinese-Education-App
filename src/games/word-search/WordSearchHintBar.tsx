import React from "react";
import { Box } from "@mui/material";
import { HINT_BAR_UNITS, HINT_COST } from "./constants";

interface WordSearchHintBarProps {
    /** How many segments are currently filled (0..HINT_BAR_UNITS). */
    units: number;
}

/**
 * The hint meter shown in the HUD: a row of `HINT_BAR_UNITS` (8) hollow segments
 * that fill left-to-right as the player makes successful finds. A threshold line
 * is drawn after the `HINT_COST` (4th) segment to signal "a hint is usable from
 * here." Once `units >= HINT_COST` the already-filled segments switch to the
 * "ready" (brighter) fill so the meter itself reads as armed. Purely presentational
 * — spending/arming logic lives in WordSearchPage. See docs/WORD_SEARCH_GAME.md §5a.
 */
const WordSearchHintBar: React.FC<WordSearchHintBarProps> = ({ units }) => {
    const ready = units >= HINT_COST;
    return (
        <Box
            className="word-search__hint-bar"
            sx={{ display: "flex", alignItems: "center", gap: "3px" }}
        >
            {/* Small lightbulb so the meter reads as the hint gauge. */}
            <Box
                component="span"
                className="word-search__hint-bar-icon"
                aria-hidden
                sx={{ fontSize: 12, lineHeight: 1, mr: "2px", opacity: ready ? 1 : 0.5 }}
            >
                💡
            </Box>
            {Array.from({ length: HINT_BAR_UNITS }).map((_, i) => {
                const filled = i < units;
                return (
                    <React.Fragment key={i}>
                        <Box
                            className={`word-search__hint-unit${filled ? " word-search__hint-unit--filled" : ""}${
                                filled && ready ? " word-search__hint-unit--ready" : ""
                            }`}
                            sx={{
                                width: "10px",
                                height: "10px",
                                borderRadius: "3px",
                                boxSizing: "border-box",
                                border: "1.5px solid",
                                borderColor: filled ? (ready ? "#FFA726" : "#FFCC80") : "#D7DEEC",
                                backgroundColor: filled ? (ready ? "#FFB74D" : "#FFE0B2") : "transparent",
                                transition: "background-color 0.15s ease, border-color 0.15s ease",
                            }}
                        />
                        {/* Threshold divider after the HINT_COST-th segment: the
                            "usable from here" marker. */}
                        {i === HINT_COST - 1 && (
                            <Box
                                className="word-search__hint-threshold"
                                aria-hidden
                                sx={{
                                    width: "2px",
                                    height: "16px",
                                    borderRadius: "1px",
                                    backgroundColor: ready ? "#FB8C00" : "#B7C0D6",
                                    mx: "2px",
                                    transition: "background-color 0.15s ease",
                                }}
                            />
                        )}
                    </React.Fragment>
                );
            })}
        </Box>
    );
};

export default WordSearchHintBar;
