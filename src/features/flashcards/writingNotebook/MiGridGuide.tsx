import { memo } from "react";
import { Box } from "@mui/material";
import { RAMP } from "../../../theme/colors";

/**
 * MiGridGuide — the 米字格 practice guide: eight dotted rays from the centre (the
 * vertical, horizontal and both diagonals), drawn in teal. It fills its positioned
 * parent and ignores pointers, so it can sit under a canvas or an ink thumbnail.
 *
 * `color` overrides the teal: the word bar's ShadowCell turns its guide grey in the
 * colored stroke-aid state, so the guide steps back behind the six stroke hues.
 *
 * Teal is `RAMP.tea.mid` — the hue has no mark tier (RAMP's note: `tea` mark = mid), so
 * this is the darkest teal the framework defines. Dashes, gaps and line width are all in
 * the guide's own 0–100 units (no `non-scaling-stroke`), so the pattern SCALES with the
 * square: the 260px canvas shows the same guide as its ~90px cell, proportionally
 * bigger — what the learner wrote in the canvas lines up with the guide they see back in
 * the cell. The one exception is LINE WIDTH: scaled up, the cell's line reads heavy on
 * the canvas, so the editor passes a thinner `lineWidth` (NotebookCellEditor →
 * GUIDE_LINE_WIDTH). Only the weight changes; the rays and dashes still line up.
 *
 * The Word of the Day card draws its own DASHED blue 米 grid (WordOfTheDayCard →
 * `guideGridSvg`) as a CSS background; that one is a glyph backdrop, not a writing
 * guide, and is deliberately a different look.
 *
 * Used by: NotebookCell, NotebookCellEditor, ShadowCell (this folder). Lives here, not under
 * src/components/handwriting, because the notebook is its only importer
 * (docs/FRONTEND_LAYERING.md § 1); move it up if a second feature wants the guide.
 * Docs: docs/WRITING_NOTEBOOK.md § "Cells".
 */
/** Line width and dash / gap, in the guide's 0–100 viewBox units (they scale with it). */
const GUIDE_LINE_WIDTH = 1;
const GUIDE_DASH_LENGTH = 4;
const GUIDE_DASH = `${GUIDE_DASH_LENGTH} 3`;

interface MiGridGuideProps {
    className?: string;
    /** Line colour; defaults to the guide's teal. */
    color?: string;
    /** Line width in viewBox units; defaults to the cells' weight (GUIDE_LINE_WIDTH). */
    lineWidth?: number;
}

const MiGridGuide = memo(function MiGridGuide({ className, color = RAMP.tea.mid, lineWidth = GUIDE_LINE_WIDTH }: MiGridGuideProps) {
    return (
        <Box
            component="svg"
            className={`mi-grid-guide${className ? ` ${className}` : ""}`}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden
            sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", display: "block" }}
        >
            <g
                stroke={color}
                // In viewBox units (0–100): a ~92px cell draws 0.9px lines with 3.7px dashes;
                // the 260px canvas 10.4px dashes (its lines thinner — `lineWidth`).
                strokeWidth={lineWidth}
                strokeLinecap="butt"
                strokeDasharray={GUIDE_DASH}
                fill="none"
            >
                {/* Each ray drawn FROM the centre outward, so all eight start on a dash at
                    the centre and the pattern is symmetric about it. */}
                <path className="mi-grid-guide__cross" d="M50 50V0M50 50V100M50 50H0M50 50H100" />
                {/* The diagonals skip their first dash (offset by one dash length), so the two
                    centre dashes of the X — the ones that would meet at the middle — are not
                    drawn and each diagonal ray starts on a gap. */}
                <path className="mi-grid-guide__diagonals" strokeDashoffset={GUIDE_DASH_LENGTH} d="M50 50L0 0M50 50L100 100M50 50L100 0M50 50L0 100" />
            </g>
        </Box>
    );
});

export default MiGridGuide;
