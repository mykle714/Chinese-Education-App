import { Box } from "@mui/material";
import Icon from "./Icon";
import { COLORS } from "../theme/colors";
import { COMMONALITY_UNIT_COUNT } from "./scoreMeterScale";

/**
 * ScoreMeters — the unit meter a word's comparison measure is drawn with
 * (presentation layer, shared primitive):
 *
 *   • `CommonalityMeter` — det `frequencyScore` (1 = would stop the conversation …
 *     5 = everyday), five CIRCLES. Also a cyoa story's commonality (AdventuresPage).
 *
 * (A six-triangle `DifficultyMeter` for det `difficulty` lived here until 2026-11-21,
 * when difficulty stopped being shown to learners; see DefinitionFacts. Revive it from
 * git history — its triangle optical scale was ×1.05, gap 1px.)
 *
 * It is one `UnitMeter` underneath: `value` units drawn with the Material Symbols
 * FILL axis at 1, the rest at 0 (outlined) — the same glyph, so filled and empty units
 * share one silhouette and the meter reads as "n of max" at a glance. No numeric
 * readout rides beside the meter (decision 2026-11-07: icons only).
 *
 * Sizing: `unitSize` is the NOMINAL glyph font size, shared by both meters so a caller
 * sizes them alike. A glyph does not fill the em box exactly, so the meter applies
 * an optical scale on top (`CIRCLE_OPTICAL_SCALE`): the circle is ink-matched to the
 * old 10px hexagon and draws ~7.8px — about the size of the old CSS-dot
 * meter (`FrequencyScoreDots`, deleted 2026-11-07). The default stroke
 * weight is raised to 700 because `Icon` clamps `opsz` at 20: below 20px the outline is
 * a 20px drawing scaled down, and at weight 400 the empty ring would thin to <1px.
 *
 * Colors are passed in by the caller (flashcard theme vs. app palette vs. a white chip
 * label), exactly as the old dot meter did.
 *
 * Referenced by docs/DEFINITION_MAPPING.md, docs/DEFINITION_CLUSTERS.md,
 * docs/SORT_CARDS_REQUIREMENTS.md, docs/QUICK_MARK.md and docs/SHELF_REDESIGN.md.
 * Rendered by: DefinitionFacts (eip/cdp), AddCardsPage (card header),
 * SensePicker (per-sense commonality), AdventuresPage + StoryEditorPage (story commonality).
 */

/*
 * Optical scale, matched to the old hexagon meter's ink. Measured from
 * the Material Symbols Rounded font itself (FILL 1, wght 700, opsz 20, fontTools
 * AreaPen, cross-checked by point sampling) on 2026-11-07, in a 24-unit em:
 *
 *   glyph            box (w × h)     ink area
 *   hexagon          19.65 × 17.95   273.6   (reference)
 *   circle           20.90 × 20.90   343.8
 */

/** Circle carries 26% more ink than the hexagon: √(273.6 / 343.8) = 0.892. */
const CIRCLE_OPTICAL_SCALE = 0.89;

/*
 * Default unit gap (px). The circle nearly fills its em (~0.3px bearing per side at 10px
 * nominal), so it needs an explicit gap to read as separate units. Tuned by eye
 * 2026-11-07. A caller's explicit `gap` still wins.
 */
const CIRCLE_GAP = 3;

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
            ariaLabel={`usefulness ${score} of ${COMMONALITY_UNIT_COUNT}`}
            className={`commonality-meter${className ? ` ${className}` : ""}`}
        />
    );
}
