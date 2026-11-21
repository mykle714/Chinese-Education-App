import { COLORS, RAMP } from "../../theme/colors";
import type { Tier2Look } from "../../timeOfDay/tier2Look";
import { FIRST_LANE_X, LANE_GAP, linkGutterWidth, type PassageLinkLayout, type RowBox } from "./passageLinkLayout";

/**
 * StoryPassageLinks — the story editor's link gutter: an SVG to the RIGHT of the passage
 * rows that draws the story's links as merged TRUNKS: out of each source row at a dot,
 * along a lane, and into each target row with an arrowhead — every dot on a trunk leads to
 * every arrow on it. docs/CYOA_FEATURE.md § 5.2. Lanes and slots come from
 * passageLinkLayout.ts; this component only turns them into pixels.
 *
 * ── Colour ────────────────────────────────────────────────────────────────────
 * One colour per LANE (LINK_COLORS, in lane order), so trunks running side by side are
 * always different colours; two trunks in the same lane never overlap vertically. A
 * trunk's branches share its colour, which is what makes them read as one merged line. The
 * colours are the ramp's MARK tier (the framework's most saturated pastel), plus greyA,
 * gld and ink to reach ten. Pastel marks vanish on the day ground (tea on #E0F3FF is
 * ~1.1:1), so every line is CASED: drawn over a wider stroke of ink (day) or the slate
 * lip (night) — the app's outlined-pastel look (CLAUDE.md § Buttons & cards), which also
 * keeps two lines distinct where they cross.
 *
 * Purely visual: `pointer-events: none`, `aria-hidden` (the rows carry the meaning).
 *
 * Layer: feature presentation (src/features/cyoa). Rendered by StoryPassageList.tsx.
 */

/** Lane colours, innermost first. Neighbouring entries are far apart in hue. */
const LINK_COLORS = [
    RAMP.blu.mark,
    RAMP.org.mark,
    RAMP.grn.mark,
    RAMP.red.mark,
    RAMP.pur.mark,
    RAMP.yel.mark,
    RAMP.tea.mark,
    COLORS.greyA,
    RAMP.gld.mark,
    null, // the look's ink2 — resolved per look below
] as const;

/** The coloured line and its casing, px. */
const LINE_WIDTH = 2;
const CASING_WIDTH = 4;
/** Corner radius where a stub turns into its lane, px. */
const CORNER = 4;
/** The arrowhead's length along the stub, and its half-height, px. */
const ARROW_LENGTH = 6;
const ARROW_HALF = 3.5;


interface StoryPassageLinksProps {
    look: Tier2Look;
    layout: PassageLinkLayout;
    rows: RowBox[];
    /** The list's full height, px. */
    height: number;
}

function StoryPassageLinks({ look, layout, rows, height }: StoryPassageLinksProps) {
    const width = linkGutterWidth(layout.laneCount);
    if (width === 0 || rows.length === 0) return null;
    const casing = look.dark ? look.surfaceEdge : look.ink;

    /** y of slot `slot` on row `row`: the row's height split evenly between its ends. */
    const slotY = (row: number, slot: number) => {
        const box = rows[row];
        if (!box) return 0;
        return box.top + (box.height * (slot + 1)) / (layout.slotCounts[row] + 1);
    };

    const drawn = layout.trunks.map((trunk) => {
        const x = FIRST_LANE_X + trunk.lane * LANE_GAP;
        // Every end on the trunk: a dot's stub starts at the row edge (0), an arrow's stub
        // stops at the arrowhead's base.
        const dots = trunk.sources.map((source) => slotY(source.row, source.slot));
        const ends = [
            ...dots.map((y) => ({ y, stubStart: 0, isDot: true })),
            ...trunk.targets.map((target) => ({ y: slotY(target.row, target.slot), stubStart: ARROW_LENGTH, isDot: false })),
        ];
        const ys = ends.map((end) => end.y);
        const yTop = Math.min(...ys);
        const yBottom = Math.max(...ys);
        const r = Math.min(CORNER, (yBottom - yTop) / 2, x / 2);
        // The lane's vertical, short of the two corners; then each stub. The topmost and
        // bottommost stubs round into the lane; the ones between meet it in a T.
        const parts = [`M ${x} ${yTop + r} V ${yBottom - r}`];
        ends.forEach((end, index) => {
            const isTop = end.y === yTop && ys.indexOf(yTop) === index;
            const isBottom = !isTop && end.y === yBottom && ys.lastIndexOf(yBottom) === index;
            if (isTop) parts.push(`M ${end.stubStart} ${end.y} H ${x - r} Q ${x} ${end.y} ${x} ${end.y + r}`);
            else if (isBottom) parts.push(`M ${end.stubStart} ${end.y} H ${x - r} Q ${x} ${end.y} ${x} ${end.y - r}`);
            else parts.push(`M ${end.stubStart} ${end.y} H ${x}`);
        });
        const arrows = ends.filter((end) => !end.isDot).map((end) =>
            `M 0.5 ${end.y} L ${ARROW_LENGTH + 0.5} ${end.y - ARROW_HALF} L ${ARROW_LENGTH + 0.5} ${end.y + ARROW_HALF} Z`,
        );
        const color = LINK_COLORS[trunk.lane] ?? look.ink2;
        // Trunks sharing a lane never share a row, so lane + top row is unique.
        const topRow = Math.min(...trunk.sources.map((end) => end.row), ...trunk.targets.map((end) => end.row));
        return { key: `trunk-${trunk.lane}-${topRow}`, d: parts.join(" "), arrows, dots, color };
    });

    return (
        <svg
            className="story-passage-links"
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            aria-hidden="true"
            style={{ position: "absolute", top: 0, right: 0, pointerEvents: "none", overflow: "visible" }}
        >
            {/* Casings first, all of them, so every coloured line sits above every casing. */}
            <g className="story-passage-links__casings" fill="none" stroke={casing} strokeWidth={CASING_WIDTH} strokeLinejoin="round">
                {drawn.map((link) => <path key={link.key} d={link.d} />)}
            </g>
            {drawn.map((link) => (
                <g key={link.key} className="story-passage-links__link">
                    <path className="story-passage-links__line" d={link.d} fill="none" stroke={link.color} strokeWidth={LINE_WIDTH} strokeLinejoin="round" />
                    {link.dots.map((y, index) => (
                        <circle key={index} className="story-passage-links__source" cx={2.5} cy={y} r={2.5} fill={link.color} stroke={casing} strokeWidth={1} />
                    ))}
                    {link.arrows.map((arrow, index) => (
                        <path key={index} className="story-passage-links__arrow" d={arrow} fill={link.color} stroke={casing} strokeWidth={1} strokeLinejoin="round" />
                    ))}
                </g>
            ))}
        </svg>
    );
}

export default StoryPassageLinks;
