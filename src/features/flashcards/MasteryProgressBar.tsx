import { Box, Typography, Tooltip, Chip } from "@mui/material";
import type { VocabEntry } from "../../types";
import { useAuth } from "../../AuthContext";
import { getCategoryColor } from "../../utils/categoryColors";
import {
    masteryBar,
    MARK_TYPE_COLORS,
    MARK_TYPE_LABELS,
    PBH_THRESHOLDS,
    PBH_FULL,
    type MasteryGoals,
} from "../../utils/masteryCompute";
import { SIZE, WEIGHT } from "../../theme/scale";
import { FC_FONT } from "./FlashcardsLearnPage/constants";

/**
 * cdp mastery progress bar (docs/MASTERY_REWORK.md).
 *
 * A vertical stacked bar whose FILLED height = the card's progress-bar-height
 * (pbh), full at pbh = 8 (Mastered). The fill is composed of the four mark types
 * in the ratio of their positive marks (regardless of which goals are set):
 * blue = Recognition, green = Production, red = Reading, yellow = Writing.
 *
 * pbh depends on the account's reading/writing goals, so we read them from auth.
 */
const BAR_HEIGHT = 132;
const BAR_WIDTH = 26;

export const MasteryProgressBar: React.FC<{ entry: VocabEntry; className?: string }> = ({ entry, className }) => {
    const { user } = useAuth();
    const goals: MasteryGoals = {
        reading: user?.readingGoal === true,
        writing: user?.writingGoal === true,
    };

    const bar = masteryBar(entry.typedMarkHistory, goals);
    const filledSegments = bar.segments.filter((s) => s.positive > 0);

    return (
        <Box
            className={`mastery-progress-bar ${className ?? ""}`}
            sx={{ display: "flex", alignItems: "flex-start", gap: "12px" }}
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
                                title={`${MARK_TYPE_LABELS[seg.type]}: ${seg.positive}/8`}
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

            {/* Legend: category + per-type positive counts */}
            <Box className="mastery-progress-bar__legend" sx={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <Chip
                    className="mastery-progress-bar__category-chip"
                    label={bar.category}
                    size="small"
                    sx={{
                        alignSelf: "flex-start",
                        backgroundColor: getCategoryColor(bar.category),
                        color: "white",
                        fontSize: SIZE.micro,
                        fontWeight: WEIGHT.bold,
                        fontFamily: FC_FONT,
                        height: 22,
                    }}
                />
                {/* Color legend: one swatch + label per mark type (no counts). */}
                {bar.segments.map((seg) => (
                    <Box
                        key={seg.type}
                        className={`mastery-progress-bar__legend-row mastery-progress-bar__legend-row--${seg.type}`}
                        sx={{ display: "flex", alignItems: "center", gap: "6px" }}
                    >
                        <Box
                            className="mastery-progress-bar__legend-swatch"
                            sx={{ width: 10, height: 10, borderRadius: "3px", backgroundColor: MARK_TYPE_COLORS[seg.type], flexShrink: 0 }}
                        />
                        <Typography sx={{ fontSize: SIZE.micro, fontFamily: FC_FONT, opacity: 0.85 }}>
                            {MARK_TYPE_LABELS[seg.type]}
                        </Typography>
                    </Box>
                ))}
            </Box>
        </Box>
    );
};

export default MasteryProgressBar;
