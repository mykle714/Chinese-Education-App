import React from "react";
import { Box, useTheme } from "@mui/material";
import { formatTimeMs } from "../../utils/timeUtils";
import { RUN_DURATION_MS } from "./constants";
import { SIZE, WEIGHT } from "../../theme/scale";

/** Below this the clock turns red and pulses. */
const URGENT_MS = 10_000;

interface MatchSpeedTimerBarProps {
    /** Milliseconds left in the run. */
    remainingMs: number;
    /** Dims the whole bar — used once the run is over and the board is only a
     *  cleanup surface, where a frozen 0:00 clock would read as broken. */
    dimmed?: boolean;
}

/**
 * The run clock, pinned to the top of the PLAY AREA rather than the page header.
 *
 * It sits here, not in the header chrome, because it is game state: the player's
 * eyes are on the board, and a countdown they have to look away to read is a
 * countdown they stop reading. The drain bar underneath makes the last ten seconds
 * legible peripherally — you can feel the run ending without parsing digits.
 *
 * Layer: presentational; the page owns the deadline and passes the remainder down.
 *
 * See docs/MATCH_SPEED_GAME.md § Page shell, header, and chrome.
 */
const MatchSpeedTimerBar: React.FC<MatchSpeedTimerBarProps> = ({ remainingMs, dimmed = false }) => {
    const theme = useTheme();
    const fc = theme.palette.flashcard;
    const urgent = remainingMs <= URGENT_MS;
    // Clamped both ends: the deadline clock can overshoot a tick past zero.
    const fraction = Math.min(1, Math.max(0, remainingMs / RUN_DURATION_MS));

    return (
        <Box
            className={`match-speed__timer-bar${urgent ? " match-speed__timer-bar--urgent" : ""}`}
            sx={{
                flexShrink: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 0.5,
                px: 1.5,
                pt: 1,
                opacity: dimmed ? 0.35 : 1,
                transition: "opacity 200ms linear",
            }}
        >
            <Box
                className="match-speed__timer"
                sx={{
                    fontSize: SIZE.heading,
                    fontWeight: WEIGHT.bold,
                    // Tabular figures: without them the digits jitter horizontally
                    // once a second, which reads as the layout twitching.
                    fontVariantNumeric: "tabular-nums",
                    lineHeight: 1.1,
                    color: urgent ? "#F44336" : fc.onSurface,
                    animation: urgent ? "match-speed-timer-pulse 1s ease-in-out infinite" : "none",
                    "@keyframes match-speed-timer-pulse": {
                        "0%, 100%": { opacity: 1 },
                        "50%": { opacity: 0.45 },
                    },
                }}
            >
                {formatTimeMs(remainingMs)}
            </Box>
            <Box
                className="match-speed__timer-track"
                sx={{
                    width: "100%",
                    height: "4px",
                    borderRadius: "2px",
                    backgroundColor: fc.toggleInactiveBg,
                    overflow: "hidden",
                }}
            >
                <Box
                    className="match-speed__timer-fill"
                    sx={{
                        height: "100%",
                        // Width is driven by the clock's own 200ms tick, so the
                        // transition just smooths between samples.
                        width: `${fraction * 100}%`,
                        backgroundColor: urgent ? "#F44336" : "#3D6BD6",
                        transition: "width 200ms linear, background-color 300ms linear",
                    }}
                />
            </Box>
        </Box>
    );
};

export default MatchSpeedTimerBar;
