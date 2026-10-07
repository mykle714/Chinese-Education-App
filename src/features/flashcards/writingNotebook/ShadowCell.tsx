import { memo, useEffect, useMemo, useState } from "react";
import { Box } from "@mui/material";
import { loadGlyph, peekGlyph, type GlyphData } from "../../../components/handwriting/GlyphSvg";
import { guideToCanvas } from "../../../components/handwriting/strokeSnap";
import MiGridGuide from "./MiGridGuide";
import { strokeColor, type StrokeAid } from "./strokeAid";
import { placeStrokeNumbers, rasterizeGlyphMasks, type StrokeLine } from "./strokeNumberPlacement";
import { COLORS } from "../../../theme/colors";
import { FONTS } from "../../../theme/fonts";
import { WEIGHT } from "../../../theme/scale";

/**
 * ShadowCell — one character's WRITING SHADOW drawn in an exact replica of a notebook
 * sheet cell (docs/WRITING_NOTEBOOK.md § "Page anatomy"): the same square, 1px outline,
 * white ground and teal 米 guide as `NotebookCell`, with the character's stroke shapes
 * placed exactly where the practice canvas places its guide (`guideToCanvas` — the
 * Hanzi Writer padding, proportional to the side), in the guide's grey. What the learner
 * sees in the header is what a cell would look like with the guide behind it.
 *
 * `aid` is the stroke-order help painted over the shadow (`StrokeAid`, cycled by a tap in
 * NotebookWordBar): `"off"` is the bare shadow; `"numbers"` paints each stroke's ORDER
 * number in ink; `"colored"` also fills each stroke in its own hue — stroke i takes
 * `RAMP[STROKE_HUES[i % 6]].mark`, a contrasting cycle (red, grn, blu, org, pur, yel) that wraps — and its number in
 * the same hue, with no outline (the paler hues — yel especially — read weakly on white;
 * an ink outline was tried and dropped). Number positions are identical in both states, so stepping from one to the other
 * never moves a digit. Positions are
 * resolved by `placeStrokeNumbers` (strokeNumberPlacement.ts) against each stroke's centre
 * line (its corpus median) and its own rasterised ink: never on its own stroke, touching
 * as few other strokes and as little shadow as a nearby spot allows, clear of the other
 * numbers, and clearly nearer its own stroke than any other.
 *
 * Presentational, no taps of its own (NotebookWordBar wraps each cell in its own
 * per-position stroke-aid toggle).
 */

interface ShadowCellProps {
    char: string;
    /** Outer side, border included (px). */
    size: number;
    aid: StrokeAid;
}

/** The shadow's colour — the practice canvas guide's (HanziGuide `outlineColor` default). */
const SHADOW_COLOR = COLORS.border;
/** Stroke-number type size as a share of the cell side, with a legible floor (px). */
const NUMBER_SIZE_RATIO = 0.13;
const NUMBER_MIN_PX = 9;
/** Clearance kept between the shadow's edge and the dotted 米 guide, as a share of the
 *  cell side, with a floor (px). The white underlay is stroked this wide past the shadow
 *  so the guide's dots stop short of it instead of running right up to its edge. */
const GUIDE_CLEARANCE_RATIO = 0.015;
const GUIDE_CLEARANCE_MIN_PX = 1.5;
const ShadowCell = memo(function ShadowCell({ char, size, aid }: ShadowCellProps) {
    // A cached glyph paints on the first frame; otherwise it loads (and the cell shows
    // its empty guide meanwhile). A miss (char not in the corpus) stays an empty cell.
    const [loaded, setLoaded] = useState<{ char: string; data: GlyphData | null } | null>(null);
    const glyph = peekGlyph(char) ?? (loaded?.char === char ? loaded.data : null);

    useEffect(() => {
        if (peekGlyph(char)) return;
        let cancelled = false;
        void loadGlyph(char).then((data) => { if (!cancelled) setLoaded({ char, data }); });
        return () => { cancelled = true; };
    }, [char]);

    // The canvas's own glyph placement, at this cell's inner size (inside the border).
    const inner = size - 2;
    const map = guideToCanvas(inner);
    const fontPx = Math.max(NUMBER_MIN_PX, Math.round(size * NUMBER_SIZE_RATIO));
    // The underlay's outline is centred on the path, so it reaches half its width past the
    // shadow: twice the clearance, converted from px into the glyph's font units.
    const underlayStrokeWidth = (2 * Math.max(GUIDE_CLEARANCE_MIN_PX, size * GUIDE_CLEARANCE_RATIO)) / map.scale;

    // Breathing room the placer keeps around each label (px, both sides combined). It only
    // spaces the digits off the ink, and is the same in the numbers and colored states so a
    // digit never jumps when the state changes.
    const labelPad = Math.max(2, fontPx * 0.28);

    // The shadow rasterised once per (glyph, size), for the placer's ink lookups.
    const numbered = aid !== "off";
    const colored = aid === "colored";
    const inkMasks = useMemo(
        () => (numbered && glyph ? rasterizeGlyphMasks(glyph.strokes, inner, map.pad, map.scale) : null),
        [numbered, glyph, inner, map.pad, map.scale]
    );

    const numbers = useMemo(() => {
        if (!numbered || !glyph?.medians) return [];
        const lines: StrokeLine[] = glyph.medians.map((median) => median.map((pt) => map.point(pt)));
        return placeStrokeNumbers(lines, { size: inner, fontPx, pad: labelPad / 2, masks: inkMasks })
            .map((p, i) => ({ n: i + 1, ...p }));
        // `map` is derived from `inner`; listing its fields would only repeat that.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [numbered, glyph, inner, fontPx, labelPad, inkMasks]);

    return (
        <Box
            className="shadow-cell"
            sx={{
                position: "relative",
                flexShrink: 0,
                width: size,
                height: size,
                border: `1px solid ${COLORS.border}`,
                backgroundColor: COLORS.white,
                overflow: "hidden",
            }}
        >
            {/* In the colored state the 米 guide goes grey (the shadow's own grey, which the
                strokes have just given up), so its teal never competes with the six stroke
                hues. Still dotted — only the colour changes. */}
            <MiGridGuide className="shadow-cell__guide" color={colored ? SHADOW_COLOR : undefined} />
            <Box
                component="svg"
                className="shadow-cell__glyph"
                viewBox={`0 0 ${inner} ${inner}`}
                width={inner}
                height={inner}
                aria-hidden
                sx={{ position: "absolute", inset: 0, display: "block" }}
            >
                {glyph && (
                    <g transform={map.svgTransform}>
                        {/* SHADOW_COLOR is translucent (--line2), so an opaque white copy of the
                            strokes goes underneath first: it hides the 米 guide behind the
                            shadow, and the grey reads exactly as it does on the white ground.
                            The copy is also outlined in white, a thin halo that keeps the
                            guide's dots from running right up to the shadow's edge. */}
                        {glyph.strokes.map((d, i) => (
                            <path
                                key={`under-${i}`}
                                d={d}
                                fill={COLORS.white}
                                stroke={COLORS.white}
                                strokeWidth={underlayStrokeWidth}
                                strokeLinejoin="round"
                            />
                        ))}
                        {glyph.strokes.map((d, i) => <path key={i} d={d} fill={colored ? strokeColor(i) : SHADOW_COLOR} />)}
                    </g>
                )}
                {numbers.map(({ n, x, y }) => (
                    <text
                        key={n}
                        className="shadow-cell__number"
                        x={x}
                        y={y}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontFamily={FONTS.label}
                        fontSize={fontPx}
                        fontWeight={WEIGHT.bold}
                        fill={colored ? strokeColor(n - 1) : COLORS.onSurface}
                    >
                        {n}
                    </text>
                ))}
            </Box>
        </Box>
    );
});

export default ShadowCell;
