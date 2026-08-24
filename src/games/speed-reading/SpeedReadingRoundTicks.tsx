import { Box } from "@mui/material";
import { COLORS } from "../../theme/colors";

/**
 * The run's per-round outcome, one pip per round, in the HUD strip
 * (docs/SHELF_REDESIGN.md § 15 — `.hud` with the tick grid; docs/SPEED_READING_GAME.md).
 *
 * WHAT IT IS FOR. This game's score is a TIME, and a wrong answer is paid for in
 * seconds rather than in a lost round — so mid-run there is nothing on screen that says
 * how the run is actually going. The clock alone cannot: a slow clean run and a fast
 * sloppy one read the same. The pips are the run's shape, and because they hold their
 * position they also say WHERE it went wrong, which "17/20 correct" at the end does not.
 *
 * WHY A GRID AND NOT A ROW. Twenty pips in one row are 14px wide each and the two-pixel
 * gap between them is the only thing separating a red from its neighbours. The design's
 * revision splits them into TWO ROWS OF TEN at 8px tall, which is enough height for a
 * colour to be seen peripherally — which is the only way it will be seen, since the
 * player's eyes are on the words.
 *
 * ── THE COLOURS ARE THE APP'S, NOT THE ARTBOARD'S ─────────────────────────────────
 * The artboard fills these with `#22C55E` / `#EF4444` — a bright green/red pair that is
 * outside the app's ramp. They are drawn here with `COLORS.successInk` / `dangerInk`,
 * the app's ONE green and ONE red for "this went well / this went badly", because a
 * second pair would make these pips disagree with every other success and failure in
 * the app (the tap-zone flash this same answer just produced included). A pending pip
 * takes `COLORS.card`, the same inert fill every empty track in the app uses.
 *
 * Layer: presentational — it holds no state and computes nothing but its own layout.
 */

/** One answered round's outcome; `undefined` positions are not yet played. */
export type RoundTick = "correct" | "wrong";

export interface SpeedReadingRoundTicksProps {
    /** Outcomes in the order they were answered. Shorter than `total` mid-run. */
    results: RoundTick[];
    /** How many rounds the run has in total — the number of pips drawn. */
    total: number;
    /**
     * Pips per row. Ten is the design's, and it is also the only value that makes the
     * grid readable as tens: a player counting pips to find round 14 counts one row
     * plus four.
     */
    perRow?: number;
    className?: string;
}

const TICK_COLOR: Record<RoundTick, string> = {
    correct: COLORS.successInk,
    wrong: COLORS.dangerInk,
};

const SpeedReadingRoundTicks: React.FC<SpeedReadingRoundTicksProps> = ({
    results,
    total,
    perRow = 10,
    className,
}) => {
    // Rows are derived from the total rather than fixed at two, so changing
    // TARGET_ROUNDS cannot silently drop pips off the end of the strip.
    const rowCount = Math.ceil(total / perRow);
    const rows = Array.from({ length: rowCount }, (_, row) =>
        Array.from({ length: Math.min(perRow, total - row * perRow) }, (_, col) => row * perRow + col)
    );

    return (
        <Box
            className={className ? `speed-reading__ticks ${className}` : "speed-reading__ticks"}
            // The pips restate what `Round n of 20` says above them, so the strip is
            // ONE labelled thing to a screen reader rather than twenty unlabelled ones.
            role="img"
            aria-label={`${results.filter((r) => r === "correct").length} correct of ${results.length} answered`}
            sx={{ display: "flex", flexDirection: "column", gap: "5px" }}
        >
            {rows.map((row, i) => (
                <Box
                    key={i}
                    className={`speed-reading__ticks-row speed-reading__ticks-row--${i + 1}`}
                    // Every pip is `flex: 1` inside its row, so a partial last row's pips
                    // are WIDER than the rest instead of leaving a gap the eye reads as
                    // missing rounds. With a multiple of `perRow` this never comes up.
                    sx={{ display: "flex", gap: "4px" }}
                >
                    {row.map((index) => {
                        const tick = results[index];
                        return (
                            <Box
                                key={index}
                                className={`speed-reading__tick speed-reading__tick--${tick ?? "pending"}`}
                                sx={{
                                    flex: 1,
                                    height: "8px",
                                    borderRadius: "3px",
                                    backgroundColor: tick ? TICK_COLOR[tick] : COLORS.card,
                                    // Only the pip that just landed animates; the rest
                                    // are already at their colour when this runs.
                                    transition: "background-color 200ms linear",
                                }}
                            />
                        );
                    })}
                </Box>
            ))}
        </Box>
    );
};

export default SpeedReadingRoundTicks;
