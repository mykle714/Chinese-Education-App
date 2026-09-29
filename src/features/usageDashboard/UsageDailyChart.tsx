import { useState } from "react";
import { Box, Typography } from "@mui/material";
import { COLORS, RAMP, type RampHue } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE } from "../../theme/scale";

/**
 * UsageDailyChart — one bar per day for a single metric of the User Usage dashboard
 * (docs/USAGE_DASHBOARD.md § UI).
 *
 * Inline SVG rather than a chart library: the app has none, and a bar-per-day column
 * chart is ~40 lines. The viewBox is one unit per day and stretched with
 * `preserveAspectRatio="none"`, so 7 days and 200 days both fill the card width.
 *
 * The readout line above the bars names ONE day: the last one by default, or the bar
 * under the pointer while it is down / hovering. That replaces a y-axis — an operator
 * reads a specific day's figure, and the max label gives the scale.
 *
 * `touchAction: "pan-y"` keeps vertical scrolling of the tester dashboard working when
 * a finger lands on the chart; only horizontal scrubbing is claimed.
 */

const CHART_HEIGHT = 96;

export interface UsageDailyChartProps {
    /** One point per day, oldest first, zero-filled. */
    points: Array<{ date: string; value: number }>;
    /** Unit suffix in the readout, e.g. "min", "users". */
    unit: string;
    hue: RampHue;
}

/** "2026-09-23" → "Sep 23". Parsed as UTC so the label never slides a day. */
function shortDate(yyyymmdd: string): string {
    const d = new Date(`${yyyymmdd}T00:00:00Z`);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

export default function UsageDailyChart({ points, unit, hue }: UsageDailyChartProps) {
    const [scrubIndex, setScrubIndex] = useState<number | null>(null);

    if (points.length === 0) return null;

    const max = points.reduce((m, p) => Math.max(m, p.value), 0);
    const activeIndex = scrubIndex ?? points.length - 1;
    const active = points[activeIndex];
    // Narrow bars get no gap: at 200 days a gap would eat most of each bar.
    const gap = points.length > 60 ? 0 : 0.18;

    /** Map a pointer x to a day index. */
    const indexAt = (e: React.PointerEvent<SVGSVGElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const ratio = (e.clientX - rect.left) / Math.max(1, rect.width);
        return Math.min(points.length - 1, Math.max(0, Math.floor(ratio * points.length)));
    };

    return (
        <Box className="usage-daily-chart">
            <Box className="usage-daily-chart__readout" sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", mb: "6px" }}>
                <Typography className="usage-daily-chart__readout-date" sx={{ fontFamily: FONTS.label, fontSize: SIZE.caption, color: COLORS.textSecondary }}>
                    {shortDate(active.date)}
                </Typography>
                <Typography className="usage-daily-chart__readout-value" sx={{ fontFamily: FONTS.mono, fontSize: SIZE.body, color: COLORS.onSurface }}>
                    {active.value.toLocaleString()} {unit}
                </Typography>
            </Box>

            <Box className="usage-daily-chart__plot" sx={{ position: "relative", height: CHART_HEIGHT, backgroundColor: RAMP[hue].tint, borderRadius: "8px", overflow: "hidden" }}>
                <svg
                    className="usage-daily-chart__svg"
                    viewBox={`0 0 ${points.length} ${CHART_HEIGHT}`}
                    preserveAspectRatio="none"
                    width="100%"
                    height={CHART_HEIGHT}
                    style={{ display: "block", touchAction: "pan-y", cursor: "crosshair" }}
                    onPointerMove={(e) => setScrubIndex(indexAt(e))}
                    onPointerDown={(e) => setScrubIndex(indexAt(e))}
                    onPointerLeave={() => setScrubIndex(null)}
                    role="img"
                    aria-label={`Daily ${unit}, ${shortDate(points[0].date)} to ${shortDate(points[points.length - 1].date)}, peak ${max}`}
                >
                    {points.map((p, i) => {
                        // A zero day keeps a 1-unit stub so the day still visibly exists.
                        const h = max > 0 ? Math.max(p.value > 0 ? 2 : 1, (p.value / max) * (CHART_HEIGHT - 8)) : 1;
                        return (
                            <rect
                                key={p.date}
                                x={i + gap / 2}
                                y={CHART_HEIGHT - h}
                                width={1 - gap}
                                height={h}
                                fill={i === activeIndex ? RAMP[hue].mark : p.value > 0 ? RAMP[hue].mid : COLORS.grey}
                            />
                        );
                    })}
                </svg>
                <Typography className="usage-daily-chart__max" sx={{ position: "absolute", top: 4, left: 8, fontFamily: FONTS.mono, fontSize: SIZE.micro, color: COLORS.textFaint, pointerEvents: "none" }}>
                    peak {max.toLocaleString()}
                </Typography>
            </Box>

            <Box className="usage-daily-chart__axis" sx={{ display: "flex", justifyContent: "space-between", mt: "4px" }}>
                {[points[0].date, points[points.length - 1].date].map((d, i) => (
                    <Typography key={i} className="usage-daily-chart__axis-label" sx={{ fontFamily: FONTS.mono, fontSize: SIZE.micro, color: COLORS.textFaint }}>
                        {shortDate(d)}
                    </Typography>
                ))}
            </Box>
        </Box>
    );
}
