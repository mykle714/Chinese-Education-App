import { Box, Typography, Tooltip, Chip } from "@mui/material";
import type { VocabEntry } from "../../types";
import { useAuth } from "../../AuthContext";
import { getCategoryColor } from "../../utils/categoryColors";
import {
    masteryBars,
    MARK_TYPE_COLORS,
    MARK_TYPE_LABELS,
    BAR_LABELS,
    PBH_THRESHOLDS,
    PBH_FULL,
    type MasteryGoals,
    type MasteryBar,
} from "../../utils/masteryCompute";
import { SIZE, WEIGHT } from "../../theme/scale";
import { FC_FONT } from "./constants";

/**
 * cdp mastery progress bars (docs/MASTERY_REWORK.md § "Three bars").
 *
 * ONE VERTICAL BAR PER ACTIVE MASTERY BAR — core always, plus reading and/or writing
 * when the account has that goal. Each bar's FILLED height is its own pbh on the
 * shared 0..PBH_FULL scale, so all three share the Target/Comfortable benchmark lines
 * and a card can be full in one bar while empty in another.
 *
 * The core bar's fill is composed of its two mark types in the ratio of their
 * positive marks (blue = Recognition, green = Production); the single-track bars are
 * one solid color. Before migration 143 there was ONE bar composed of all four types
 * whose height was goal-weighted — which meant enabling a goal visibly shrank a card
 * the learner had already finished.
 */
const BAR_HEIGHT = 132;
const BAR_WIDTH = 26;

/** One vertical track: fill, per-type segments, and the two benchmark lines. */
const BarTrack: React.FC<{ bar: MasteryBar }> = ({ bar }) => {
    const filledSegments = bar.segments.filter((s) => s.positive > 0);

    return (
        <Box
            className={`mastery-progress-bar__bar mastery-progress-bar__bar--${bar.id}`}
            sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}
        >
            {/* Track wrapper: NOT clipped, so the benchmark lines can extend past
                the bar's edges. Holds the (clipped) track + the overhanging lines. */}
            <Box
                className="mastery-progress-bar__track-wrap"
                sx={{ position: "relative", width: BAR_WIDTH, height: BAR_HEIGHT, flexShrink: 0 }}
            >
                {/* The vertical track + fill (outlined, rounded, clips the fill) */}
                <Box
                    className="mastery-progress-bar__track"
                    sx={{
                        position: "absolute",
                        inset: 0,
                        boxSizing: "border-box",
                        borderRadius: `${BAR_WIDTH / 2}px`,
                        backgroundColor: "rgba(0,0,0,0.06)",
                        border: "1.5px solid rgba(0,0,0,0.35)",
                        overflow: "hidden",
                    }}
                >
                    <Box
                        className="mastery-progress-bar__fill"
                        sx={{
                            position: "absolute",
                            left: 0,
                            right: 0,
                            bottom: 0,
                            height: `${bar.heightFraction * 100}%`,
                            display: "flex",
                            flexDirection: "column-reverse", // first type stacks at the bottom
                            transition: "height 240ms ease",
                        }}
                    >
                        {filledSegments.map((seg) => (
                            <Tooltip
                                key={seg.type}
                                title={`${MARK_TYPE_LABELS[seg.type]}: ${seg.positive}/${PBH_FULL}`}
                                placement="right"
                            >
                                <Box
                                    className={`mastery-progress-bar__segment mastery-progress-bar__segment--${seg.type}`}
                                    sx={{
                                        height: `${seg.fraction * 100}%`,
                                        backgroundColor: MARK_TYPE_COLORS[seg.type],
                                    }}
                                />
                            </Tooltip>
                        ))}
                    </Box>
                </Box>

                {/* Benchmark lines at the Target (pbh 3) and Comfortable (pbh 6)
                    band boundaries. pbh = PBH_FULL fills the track, so each line
                    sits at (pbh / PBH_FULL) of the height from the bottom. Solid and
                    extended past both edges; rendered in the unclipped wrapper. */}
                {PBH_THRESHOLDS.map((t) => (
                    <Tooltip key={t.label} title={`${t.label} at ${t.pbh}/${PBH_FULL}`} placement="right">
                        <Box
                            className={`mastery-progress-bar__benchmark mastery-progress-bar__benchmark--${t.label.toLowerCase()}`}
                            sx={{
                                position: "absolute",
                                left: -5,
                                right: -5,
                                bottom: `${(t.pbh / PBH_FULL) * 100}%`,
                                height: 0,
                                borderTop: "2px solid rgba(0,0,0,0.55)",
                                pointerEvents: "auto",
                            }}
                        />
                    </Tooltip>
                ))}
            </Box>

            {/* Which bar this is. Always labelled, even when core is the only one:
                the label is what tells a learner the bar is about recognition and
                production rather than everything they have ever done with the card. */}
            <Typography
                className="mastery-progress-bar__bar-label"
                sx={{ fontSize: SIZE.micro, fontFamily: FC_FONT, opacity: 0.85 }}
            >
                {BAR_LABELS[bar.id]}
            </Typography>
        </Box>
    );
};

export const MasteryProgressBar: React.FC<{ entry: VocabEntry; className?: string }> = ({ entry, className }) => {
    const { user } = useAuth();
    const goals: MasteryGoals = {
        reading: user?.readingGoal === true,
        writing: user?.writingGoal === true,
    };

    const bars = masteryBars(entry.typedMarkHistory, goals);
    // The chip reports the CORE band — the card's whole-card level everywhere else in
    // the app (deck counts, the mini-card badge). The per-bar bands are readable from
    // the bars themselves.
    const coreCategory = bars[0].category;
    // Legend rows cover only the types actually on screen, so a learner with no
    // writing goal is not shown a color they will never see in a bar.
    const shownTypes = bars.flatMap((b) => b.segments.map((s) => s.type));

    return (
        <Box
            className={`mastery-progress-bar ${className ?? ""}`}
            sx={{ display: "flex", alignItems: "flex-start", gap: "12px" }}
        >
            <Box
                className="mastery-progress-bar__bars"
                sx={{ display: "flex", alignItems: "flex-start", gap: "10px" }}
            >
                {bars.map((bar) => (
                    <BarTrack key={bar.id} bar={bar} />
                ))}
            </Box>

            {/* Legend: core category + the mark-type colors in play */}
            <Box className="mastery-progress-bar__legend" sx={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <Chip
                    className="mastery-progress-bar__category-chip"
                    label={coreCategory}
                    size="small"
                    sx={{
                        alignSelf: "flex-start",
                        backgroundColor: getCategoryColor(coreCategory),
                        color: "white",
                        fontSize: SIZE.micro,
                        fontWeight: WEIGHT.bold,
                        fontFamily: FC_FONT,
                        height: 22,
                    }}
                />
                {/* Color legend: one swatch + label per mark type on screen (no counts). */}
                {shownTypes.map((type) => (
                    <Box
                        key={type}
                        className={`mastery-progress-bar__legend-row mastery-progress-bar__legend-row--${type}`}
                        sx={{ display: "flex", alignItems: "center", gap: "6px" }}
                    >
                        <Box
                            className="mastery-progress-bar__legend-swatch"
                            sx={{ width: 10, height: 10, borderRadius: "3px", backgroundColor: MARK_TYPE_COLORS[type], flexShrink: 0 }}
                        />
                        <Typography sx={{ fontSize: SIZE.micro, fontFamily: FC_FONT, opacity: 0.85 }}>
                            {MARK_TYPE_LABELS[type]}
                        </Typography>
                    </Box>
                ))}
            </Box>
        </Box>
    );
};

export default MasteryProgressBar;
