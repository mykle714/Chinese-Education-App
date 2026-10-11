import { useId, useLayoutEffect, useRef, useState } from "react";
import { Box } from "@mui/material";
import { CATEGORY_BOUNDARIES } from "../../../server/contracts/mastery";
import { BAND_SPINE_CLASS } from "../DeckBuckets";
import { getBandMid } from "../../utils/categoryColors";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";

/**
 * `VelocityArrows` — the velocity breakdown drawn as hand-marked U-arrows that hang
 * under the library shelf, one per adjacent band boundary: each leaves one spine, dips,
 * and climbs into the next spine with an arrowhead, carrying `+N` (the cards that
 * crossed that boundary in the window) in the cup of the U.
 * Shelf System v2, artboard 5 (`App Redesign - Shelf System v2.html`, `svg.velo`).
 *
 * ── THE ARROWS ARE PLACED FROM MEASURED SPINES, NOT FROM THE DESIGN'S NUMBERS ──
 * The artboard hard-codes x positions for 74px spines 10px apart. Neither holds in the
 * app: the band row is `distribute`d (wider phones spread the gaps), and the profile's
 * language panel narrows the spines (`useFittedSpineWidth` in DeckBuckets). So the SVG
 * finds the four spines in the shelf it is paired with (`spineRowRef`), measures their
 * horizontal centres against its own left edge, and draws from those. The pairing is
 * guaranteed by `LibraryShelfWithVelocity`, which renders both halves — nothing else
 * should render this component.
 *
 * ── GEOMETRY ─────────────────────────────────────────────────────────────────────
 * Each arrow is ONE continuous circular arc spanning `ARROW.sweepDegrees` (140°). The
 * artboard's two arms plus the gap read as a full 180°, and so did a first 160° pass
 * (user, 2026-10-10). The arc runs from the tail, just inside the source spine's centre,
 * down through its lowest point and up into the tip, just inside the destination spine's
 * centre. The `+N` pill sits on that lowest point and covers the stroke beneath it;
 * there is no gap cut into the line.
 *
 * The chord (tail → tip) fixes the radius: R = chord / (2·sin(sweep/2)). At the
 * design's 84px spine spacing that gives R ≈ 33.5, with the lowest point ~22px under the
 * top line (y ≈ 31). The tip's tangent leans (90° − sweep/2) = 20° outward from vertical.
 * The arrowhead is the artboard's two 12px wings at ±34° off that tangent. They are
 * computed from the tangent, so they follow any sweep.
 *
 * Wider spacing gives a wider, deeper U. The SVG grows its height to fit the deepest
 * arrow (`svgHeight`). Narrower spacing (the profile panel) scales the insets and
 * wings by k = spacing / 84, and the arc shrinks with its chord.
 *
 * ── THE MARKER TEXTURE ───────────────────────────────────────────────────────────
 * An `feTurbulence` → `feDisplacementMap` filter roughens the strokes into a felt-tip
 * line, as in the artboard. The `+N` pills sit OUTSIDE the filtered layer so the
 * figures stay crisp. The filter id is per instance (`useId`) because the profile page
 * renders one card per language, and duplicate ids would resolve to whichever filter
 * the document finds first.
 *
 * The STROKES are ink (`COLORS.onSurface`). Each `+N` is an ink figure on a
 * highlighter PILL in its arrow's DESTINATION band, Mid tier (`getBandMid`): U→T sits on
 * Target's hue, T→C on Comfortable's, C→M on Mastered's. That is the band the cards
 * arrived in, the same four hues as the spines above. A pill rather than coloured text
 * because in v2 hue never carries text (theme/colors.ts). This is the same treatment the
 * old equation used (`mark{background:…;border-radius:999px}` in the design).
 *
 * The pills are HTML spans laid over the SVG, not SVG `<text>`, so they get a
 * background and padding sized by the browser instead of a measured `<rect>`. Both
 * layers share one origin (the SVG fills the wrapper's width), so the label positions
 * from `arrowBetween` apply to the spans unchanged. Each pill sits ABOVE its arc's
 * lowest point and hides the stroke behind it (the Mid tier is opaque).
 *
 * Referenced by: docs/VELOCITY.md § 4 (UI row).
 */

/** The arrow's construction constants, in px. See "GEOMETRY" above. */
const ARROW = {
    /** Centre-to-centre spacing the design was drawn at (74px spine + 10px gap). */
    designSpacing: 84,
    /** y of the arrow's top line: the tail's start and the head's tip. */
    top: 9,
    /** Tail start / head tip, inset from the spine centre toward the other spine. */
    tipInset: 10.5,
    /**
     * Angular span of the arc, in degrees. 180 would be a semicircle. 140 because 160
     * still read as a semicircle at this size (user, 2026-10-10): its ends lean only 10°.
     */
    sweepDegrees: 140,
    /** Arrowhead wing length and its angle either side of the reversed tangent. */
    wingLength: 12,
    wingDegrees: 34,
    strokeWidth: 6,
    /** Room kept under the lowest point for the stroke and the pill's lower half. */
    belowFloor: 8.6,
    /** SVG height before the centres are measured; the design's 44. */
    height: 44,
} as const;

const DEG = Math.PI / 180;
/** Half the arc's angular span — each endpoint's angle from straight down. */
const HALF_SWEEP = (ARROW.sweepDegrees / 2) * DEG;

/**
 * The selector that finds the band spines. It is built from `BAND_SPINE_CLASS`, which
 * DeckBuckets uses to name them.
 */
const SPINE_SELECTOR = `.${BAND_SPINE_CLASS}`;

/** Two centre lists are "the same" if every centre is within half a pixel. */
const sameCenters = (a: number[] | null, b: number[]): boolean =>
    a !== null && a.length === b.length && a.every((value, i) => Math.abs(value - b[i]) < 0.5);

/**
 * The horizontal centres of the shelf's spines, in the SVG's own x coordinates.
 *
 * Re-measures whenever the SVG, the spine row or any spine changes size. Observing each
 * spine matters: `useFittedSpineWidth` narrows the spines AFTER their first render
 * without resizing the row, and on a distributed row that moves every centre.
 *
 * `getBoundingClientRect` is safe during the spines' pop-in animation because it scales
 * about `center bottom`, which leaves the horizontal centre where it is.
 *
 * `spinesReady` re-runs the effect when the spines mount after the SVG (the Account
 * page loads counts and velocity independently). Without it, the observers would be
 * attached to a row that had no spines yet.
 */
function useSpineCenters(
    svgRef: React.RefObject<SVGSVGElement | null>,
    spineRowRef: React.RefObject<HTMLElement | null>,
    spinesReady: boolean,
): number[] | null {
    const [centers, setCenters] = useState<number[] | null>(null);

    useLayoutEffect(() => {
        const svg = svgRef.current;
        const row = spineRowRef.current;
        if (!svg || !row || !spinesReady) return;

        const spines = Array.from(row.querySelectorAll<HTMLElement>(SPINE_SELECTOR));
        const measure = () => {
            const origin = svg.getBoundingClientRect().left;
            const next = spines.map((spine) => {
                const rect = spine.getBoundingClientRect();
                return rect.left + rect.width / 2 - origin;
            });
            // Skip identical measurements, so each ResizeObserver callback does not
            // cost a re-render.
            setCenters((previous) => (sameCenters(previous, next) ? previous : next));
        };

        measure();
        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(measure);
        observer.observe(svg);
        observer.observe(row);
        spines.forEach((spine) => observer.observe(spine));
        return () => observer.disconnect();
    }, [svgRef, spineRowRef, spinesReady]);

    return centers;
}

/** One boundary's arrow, as SVG path data, plus where its pill goes. */
interface ArrowGeometry {
    paths: string[];
    labelX: number;
    /** The arc's lowest point, where the pill is centred. */
    labelY: number;
}

/**
 * Builds the arc arrow from spine centre `cL` to spine centre `cR`. See "GEOMETRY"
 * in the header.
 */
function arrowBetween(cL: number, cR: number): ArrowGeometry {
    const k = Math.min(1, (cR - cL) / ARROW.designSpacing);
    const n = (v: number) => v.toFixed(2);

    const tailX = cL + ARROW.tipInset * k;
    const tipX = cR - ARROW.tipInset * k;
    const y0 = ARROW.top;
    const radius = (tipX - tailX) / (2 * Math.sin(HALF_SWEEP));
    // The endpoints sit R·cos(sweep/2) below the centre, so the lowest point is
    // R·(1 − cos(sweep/2)) below the top line.
    const floorY = y0 + radius * (1 - Math.cos(HALF_SWEEP));

    // Travel direction at the tip, for a symmetric arc: up, leaning outward by
    // (90° − half-sweep). The wings are the reversed tangent rotated ±wingDegrees.
    const back = Math.atan2(Math.sin(HALF_SWEEP), -Math.cos(HALF_SWEEP)); // reversed tangent
    const wing = (sign: 1 | -1) => {
        const angle = back + sign * ARROW.wingDegrees * DEG;
        const length = ARROW.wingLength * k;
        return `${n(tipX + length * Math.cos(angle))} ${n(y0 + length * Math.sin(angle))}`;
    };

    return {
        paths: [
            // The arc: large-arc 0 (sweep < 180°), sweep 0 so it bows DOWN between the
            // two spines (counter-clockwise in screen coordinates).
            `M${n(tailX)} ${n(y0)}A${n(radius)} ${n(radius)} 0 0 0 ${n(tipX)} ${n(y0)}`,
            // Arrowhead at the destination.
            `M${wing(1)}L${n(tipX)} ${n(y0)}L${wing(-1)}`,
        ],
        labelX: (cL + cR) / 2,
        labelY: floorY,
    };
}

export interface VelocityArrowsProps {
    /**
     * Cards that crossed each boundary in the window, aligned with `CATEGORY_BOUNDARIES`.
     * Every boundary is drawn, a zero included (it reads `+0`).
     */
    boundaryCounts: number[];
    /** The shelf the arrows hang from — the element containing the band spines. */
    spineRowRef: React.RefObject<HTMLElement | null>;
    /** True once the spines are mounted; see `useSpineCenters`. */
    spinesReady: boolean;
}

const VelocityArrows: React.FC<VelocityArrowsProps> = ({ boundaryCounts, spineRowRef, spinesReady }) => {
    const svgRef = useRef<SVGSVGElement | null>(null);
    const centers = useSpineCenters(svgRef, spineRowRef, spinesReady);
    // `useId` returns ids with characters ("«r0»", ":r0:") that are not safe inside
    // `url(#…)`, so strip it down to word characters.
    const filterId = `velocity-marker-${useId().replace(/\W/g, "")}`;

    // One spine per band, so a boundary's arrow needs the centres at i and i+1. Draw
    // nothing until both the centres and the counts match the contract. A partial set
    // would join the wrong spines, which is worse than an empty space for one frame.
    const drawable =
        centers !== null &&
        centers.length === CATEGORY_BOUNDARIES.length + 1 &&
        boundaryCounts.length === CATEGORY_BOUNDARIES.length;
    const arrows = drawable ? CATEGORY_BOUNDARIES.map((_, i) => arrowBetween(centers[i], centers[i + 1])) : [];
    // Tall enough for the deepest arrow and its pill. Wider spacing makes a deeper U.
    const svgHeight = Math.max(ARROW.height, ...arrows.map((arrow) => Math.ceil(arrow.labelY + ARROW.belowFloor)));

    return (
        // The negative top margin pulls the arrows up toward the shelf board, so the
        // arrowheads start ~6px under it, close to the spines they hang from.
        <Box
            className="velocity-arrows"
            sx={{ position: "relative", marginTop: "-6px", marginBottom: "6px" }}
        >
            <svg
                ref={svgRef}
                className="velocity-arrows__svg"
                width="100%"
                height={svgHeight}
                role="img"
                // Screen readers get the boundary names; the arrows are for sighted readers.
                aria-label={CATEGORY_BOUNDARIES.map(
                    (boundary, i) => `${boundaryCounts[i] ?? 0} ${boundary.from} to ${boundary.to}`,
                ).join(", ")}
                style={{ display: "block", overflow: "visible" }}
            >
                <defs>
                    {/* The felt-tip texture. Values are from the artboard. */}
                    <filter id={filterId} x="-5%" y="-20%" width="110%" height="140%">
                        <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves={2} seed={4} />
                        <feDisplacementMap in="SourceGraphic" scale={2.2} />
                    </filter>
                </defs>
                <g
                    className="velocity-arrows__strokes"
                    filter={`url(#${filterId})`}
                    fill="none"
                    stroke={COLORS.onSurface}
                    strokeWidth={ARROW.strokeWidth}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    {arrows.flatMap((arrow, i) =>
                        arrow.paths.map((d, j) => <path key={`${i}-${j}`} className="velocity-arrows__stroke" d={d} />),
                    )}
                </g>
            </svg>
            {arrows.map((arrow, i) => (
                <Box
                    component="span"
                    key={CATEGORY_BOUNDARIES[i].to}
                    className="velocity-arrows__count"
                    aria-hidden
                    sx={{
                        position: "absolute",
                        left: arrow.labelX,
                        top: arrow.labelY,
                        transform: "translate(-50%, -50%)",
                        fontFamily: FONTS.sans,
                        fontSize: 12.5,
                        fontWeight: 600,
                        lineHeight: "16px",
                        whiteSpace: "nowrap",
                        color: COLORS.onSurface,
                        backgroundColor: getBandMid(CATEGORY_BOUNDARIES[i].to),
                        borderRadius: "999px",
                        padding: "1px 6px",
                    }}
                >
                    +{boundaryCounts[i]}
                </Box>
            ))}
        </Box>
    );
};

export default VelocityArrows;
