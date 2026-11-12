import React, { useMemo } from "react";
import { Box } from "@mui/material";
import { keyframes } from "@mui/material/styles";
import { ISO } from "./iso";
import { speedLineField } from "../../utils/speedLineField";

/**
 * SpeedLines — the horizontal streaks that sell the Deck Tower's camera dash between
 * worlds (docs/DECK_TOWER.md § "Worlds → The pan"). The vertical form (`axis="y"`) was built
 * for the archived home screen's shifts and has no caller today (docs/DEFERRED_WORK.md).
 *
 * Layer: page-private component (feature module `src/features/deckTower`). Screen space,
 * not iso: a full-stage overlay of flat white bars racing across, opposite to the
 * camera's travel. Mounted only while a pan runs; `strength` (useWorldPan `speed`)
 * fades the whole field in and out, so the lines gather and die with the dash.
 *
 * Flat white like IsoWind's strokes (`ISO.wind`), no gradients — the iso style.
 *
 * Depends on: iso/palette.ts (`ISO.wind`), src/utils/speedLineField.ts (the lanes, shared with
 * the page dash — src/hooks/pageDash.ts). Depended on by: DeckTowerPage.tsx (the pan and the home shift).
 */

/** A streak crossing from just past the right edge to just past the left one. */
const streakLeftward = keyframes`
    from { transform: translateX(110vw); }
    to   { transform: translateX(-110%); }
`;
const streakRightward = keyframes`
    from { transform: translateX(-110%); }
    to   { transform: translateX(110vw); }
`;
/** Vertical (`axis="y"`): a streak falling from just above the top edge to just past the bottom one. */
const streakDownward = keyframes`
    from { transform: translateY(-110%); }
    to   { transform: translateY(110vh); }
`;
const streakUpward = keyframes`
    from { transform: translateY(110vh); }
    to   { transform: translateY(-110%); }
`;

interface SpeedLinesProps {
    /**
     * The camera's travel. Horizontal: +1 right (so the streaks race LEFT), −1 left.
     * Vertical: +1 UP (so the streaks race DOWN — the return to home), −1 DOWN (streaks race UP — Enter).
     */
    direction: -1 | 1;
    /** "x" (default): the world pan's horizontal dash. "y": the same field turned vertical. */
    axis?: "x" | "y";
    /** 0 → 1, the dash's strength (opacity of the whole field). */
    strength: number;
    /** The overlay's bottom edge (the footer bar's height), matching the scroller's. */
    bottom: number | string;
    /** The streaks' colour: `ISO.wind` under the time-of-day wash (timeOfDay.ts). Default unwashed. */
    color?: string;
}

const SpeedLines: React.FC<SpeedLinesProps> = ({ direction, strength, bottom, color = ISO.wind, axis = "x" }) => {
    // Each streak's lane, length, weight, speed and phase — the shared field, so the page
    // dash (src/hooks/pageDash.ts) draws the same streaks. Fixed per mount.
    const lines = useMemo(speedLineField, []);
    const vertical = axis === "y";
    const streak = vertical ? (direction > 0 ? streakDownward : streakUpward) : direction > 0 ? streakLeftward : streakRightward;

    return (
        <Box
            className="deck-tower-page__speed-lines"
            aria-hidden
            sx={{ position: "absolute", zIndex: 1, top: 0, left: 0, right: 0, bottom, overflow: "hidden", pointerEvents: "none", opacity: strength }}
        >
            {lines.map((l) => (
                <Box
                    key={l.id}
                    className="deck-tower-page__speed-line"
                    sx={{
                        position: "absolute",
                        // Vertical: the same lanes turned 90° — the lane's position runs across, its length down.
                        left: vertical ? `${l.topPct}%` : 0,
                        top: vertical ? 0 : `${l.topPct}%`,
                        width: vertical ? l.heightPx : `${l.widthPct}%`,
                        height: vertical ? `${l.widthPct}%` : l.heightPx,
                        borderRadius: l.heightPx,
                        backgroundColor: color,
                        opacity: l.opacity,
                        animation: `${streak} ${l.durationMs}ms linear ${l.delayMs}ms infinite`,
                    }}
                />
            ))}
        </Box>
    );
};

export default SpeedLines;
