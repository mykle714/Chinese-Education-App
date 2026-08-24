import React from "react";
import { GameTimer } from "../shared/GameFrame";
import { formatTimeMs } from "../../utils/timeUtils";
import { GAME_HUE, RUN_DURATION_MS } from "./constants";
import { COLORS, RAMP } from "../../theme/colors";

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
 * The run clock — Match Speed's binding of the shared `GameTimer`
 * (docs/SHELF_REDESIGN.md § A6, class `.timer`).
 *
 * The GENERIC half (the 28px tabular numerals, the 4px track, where the block sits in the
 * play panel, the fade-when-dimmed) moved to `src/games/shared/GameFrame.tsx` so all five
 * games read the same. What stays here is the part that is only true of Match Speed: the
 * run length it divides by, and the ten-second urgency threshold with its pulse.
 *
 * The clock lives at the top of the PLAY AREA rather than in the page header because it is
 * game state — the player's eyes are on the board, and a countdown they have to look away
 * to read is a countdown they stop reading.
 *
 * Layer: presentational; the page owns the deadline and passes the remainder down.
 *
 * See docs/MATCH_SPEED_GAME.md § Page shell, header, and chrome.
 */
const MatchSpeedTimerBar: React.FC<MatchSpeedTimerBarProps> = ({ remainingMs, dimmed = false }) => {
    const urgent = remainingMs <= URGENT_MS;
    // Clamped at the low end here as well as in GameTimer: this fraction also has to be
    // a sane number if anything else ever reads it.
    const fraction = Math.max(0, remainingMs / RUN_DURATION_MS);

    return (
        <GameTimer
            className={`match-speed__timer-bar${urgent ? " match-speed__timer-bar--urgent" : ""}`}
            value={formatTimeMs(remainingMs)}
            fraction={fraction}
            // The urgency colour is the palette's semantic red — this is ink on white,
            // not a fill under text, so it takes `dangerInk` and not the pastel.
            valueColor={urgent ? COLORS.dangerInk : COLORS.onSurface}
            // The resting track is THIS GAME'S accent ink, not the palette's neutral
            // blue: the clock now sits on a strip tinted with that same hue (§ A6b), and
            // a blue bar on a green strip read as a widget borrowed from another screen.
            // It cannot be confused with the board's green "matched" fill — that is a
            // card body, this is a 4px rule in the chrome.
            fillColor={urgent ? COLORS.dangerInk : RAMP[GAME_HUE].ink}
            dimmed={dimmed}
            pulse={urgent}
        />
    );
};

export default MatchSpeedTimerBar;
