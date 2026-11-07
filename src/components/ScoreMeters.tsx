import { Box } from "@mui/material";
import Icon from "./Icon";
import { COLORS } from "../theme/colors";
import { COMMONALITY_UNIT_COUNT, DIFFICULTY_UNIT_COUNT, difficultyAriaLabel } from "./scoreMeterScale";

/**
 * ScoreMeters — the unit meters a word's two comparison measures are drawn with
 * (presentation layer, shared primitive):
 *
 *   • `CommonalityMeter` — det `frequencyScore` (1 = would stop the conversation …
 *     5 = everyday), five CIRCLES.
 *   • `DifficultyMeter` — det `difficulty` (1 … 6), six upward TRIANGLES (Material
 *     Symbols `change_history`; hexagons until 2026-11-07). The triangle points up, so
 *     the row reads as a climb, and its shape cannot be mistaken for the commonality
 *     circles beside it. Shown as a bare meter, never as a named scale: the app no
 *     longer labels difficulty "HSK n" (2026-11-07) because the values are an AI
 *     estimate, not an HSK-list lookup.
 *
 * Both are one `UnitMeter` underneath: `value` units drawn with the Material Symbols
 * FILL axis at 1, the rest at 0 (outlined) — the same glyph, so filled and empty units
 * share one silhouette and the meter reads as "n of max" at a glance. No numeric
 * readout rides beside the meter (decision 2026-11-07: icons only).
 *
 * Sizing: `unitSize` is the NOMINAL glyph font size, shared by both meters so a caller
 * sizes them alike. The two glyphs do not fill the em box equally, so each meter applies
 * an optical scale on top (see `CIRCLE_OPTICAL_SCALE` / `TRIANGLE_OPTICAL_SCALE`): the
 * circle is ink-matched to the old 10px hexagon and draws ~7.8px, and the triangle is
 * tuned by eye to read the same size (~8.7 × 6.8px) — about the size of the old CSS-dot
 * meter (`FrequencyScoreDots`, deleted 2026-11-07). The default stroke
 * weight is raised to 700 because `Icon` clamps `opsz` at 20: below 20px the outline is
 * a 20px drawing scaled down, and at weight 400 the empty ring would thin to <1px.
 *
 * Colors are passed in by the caller (flashcard theme vs. app palette vs. a white chip
 * label), exactly as the old dot meter did.
 *
 * Referenced by docs/DEFINITION_MAPPING.md, docs/DEFINITION_CLUSTERS.md,
 * docs/SORT_CARDS_REQUIREMENTS.md, docs/QUICK_MARK.md and docs/SHELF_REDESIGN.md.
 * Rendered by: DefinitionFacts (eip/cdp), AddCardsPage (card header + level pill/menu),
 * QuickMarkPanel (level chip/menu), SensePicker (per-sense commonality).
 */

/*
 * Optical scales, so the two meters read as the same size side by side. Measured from
 * the Material Symbols Rounded font itself (FILL 1, wght 700, opsz 20, fontTools
 * AreaPen, cross-checked by point sampling) on 2026-11-07, in a 24-unit em:
 *
 *   glyph            box (w × h)     ink area
 *   hexagon          19.65 × 17.95   273.6   (reference)
 *   circle           20.90 × 20.90   343.8
 *   change_history   19.81 × 15.58   182.7
 */

/** Circle carries 26% more ink than the hexagon: √(273.6 / 343.8) = 0.892. */
const CIRCLE_OPTICAL_SCALE = 0.89;

/**
 * The triangle is tuned by eye between two measured anchors (2026-11-07):
 *   • ink-matched (×1.22, ~10.1 × 7.9px at 10px nominal) read as bigger than the circles;
 *   • width-matched to the circle (×0.94, ~7.8 × 6.1px) read as too small, because a
 *     triangle covers far less area than a circle of the same width.
 * ×1.05 sits between them: ~8.7 × 6.8px, a touch wider than the ~7.8px circle.
 */
const TRIANGLE_OPTICAL_SCALE = 1.05;

/*
 * Default unit gaps (px). The glyphs carry different side bearings at their scaled sizes:
 * the circle nearly fills its em (~0.3px bearing per side at 10px nominal) while the
 * triangle leaves ~0.8px per side, so the same `gap` looked tighter between circles than
 * between triangles. Tuned by eye 2026-11-07 — circles opened up, triangles drawn closer.
 * A caller's explicit `gap` still wins.
 */
const CIRCLE_GAP = 3;
const TRIANGLE_GAP = 1;

interface UnitMeterProps {
    /** Filled units; clamped to 0..max. */
    value: number;
    /** Total units. */
    max: number;
    /** Material Symbols ligature name drawn for every unit. */
    glyph: string;
    /** Nominal glyph font size in px (default 10 ≈ an 8px shape). */
    unitSize?: number;
    /**
     * Per-glyph multiplier on `unitSize` that equalizes ink area across glyphs
     * (default 1). Set by the named meters, not by callers.
     */
    opticalScale?: number;
    /** Gap between units in px (default 2 — the glyph's own side bearing adds ~1px). */
    gap?: number;
    /** Color of a filled unit. */
    filledColor?: string;
    /** Color of an empty (outlined) unit. */
    emptyColor?: string;
    /** Outline stroke weight, 100–700 (default 700; see the sizing note above). */
    weight?: number;
    /** Screen-reader name for the whole meter, e.g. "commonality 3 of 5". */
    ariaLabel: string;
    className?: string;
}

/** `value` filled glyphs followed by `max - value` outlined ones. */
export function UnitMeter({
    value,
    max,
    glyph,
    unitSize = 10,
    opticalScale = 1,
    gap = 2,
    filledColor = COLORS.onSurface,
    emptyColor = COLORS.border,
    weight = 700,
    ariaLabel,
    className,
}: UnitMeterProps) {
    const filledCount = Math.max(0, Math.min(max, Math.round(value)));
    return (
        <Box
            className={`unit-meter${className ? ` ${className}` : ""}`}
            role="img"
            aria-label={ariaLabel}
            sx={{ display: "inline-flex", alignItems: "center", gap: `${gap}px`, lineHeight: 0 }}
        >
            {Array.from({ length: max }, (_, i) => {
                const filled = i < filledCount;
                return (
                    <Icon
                        key={i}
                        name={glyph}
                        size={unitSize * opticalScale}
                        weight={weight}
                        fill={filled ? 1 : 0}
                        color={filled ? filledColor : emptyColor}
                        className={`unit-meter__unit unit-meter__unit--${filled ? "filled" : "empty"}`}
                    />
                );
            })}
        </Box>
    );
}

type MeterProps = Omit<UnitMeterProps, "value" | "max" | "glyph" | "ariaLabel" | "opticalScale"> & {
    score: number;
};

/** Five-circle meter for a word's (or one sense's) `frequencyScore`. */
export function CommonalityMeter({ score, className, gap = CIRCLE_GAP, ...rest }: MeterProps) {
    return (
        <UnitMeter
            {...rest}
            gap={gap}
            value={score}
            max={COMMONALITY_UNIT_COUNT}
            glyph="circle"
            opticalScale={CIRCLE_OPTICAL_SCALE}
            ariaLabel={`commonality ${score} of ${COMMONALITY_UNIT_COUNT}`}
            className={`commonality-meter${className ? ` ${className}` : ""}`}
        />
    );
}

/** Six-triangle meter for a word's `difficulty` level. */
export function DifficultyMeter({ score, className, gap = TRIANGLE_GAP, ...rest }: MeterProps) {
    return (
        <UnitMeter
            {...rest}
            gap={gap}
            value={score}
            max={DIFFICULTY_UNIT_COUNT}
            glyph="change_history"
            opticalScale={TRIANGLE_OPTICAL_SCALE}
            ariaLabel={difficultyAriaLabel(score)}
            className={`difficulty-meter${className ? ` ${className}` : ""}`}
        />
    );
}
