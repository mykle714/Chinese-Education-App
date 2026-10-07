import { memo, useMemo } from "react";
import { Box } from "@mui/material";
import MiGridGuide from "./MiGridGuide";
import { NOTEBOOK_INK_RATIO } from "./notebookLayout";
import { decodeNotebookInk, INK_GRID } from "../../../../server/contracts/writingNotebook";
import { COLORS } from "../../../theme/colors";

/**
 * NotebookCell — one square of the Writing Notebook sheet: the teal 米 guide and, when
 * filled, the learner's ink redrawn as SVG polylines from the stored encoding
 * (docs/WRITING_NOTEBOOK.md § "Cells"). SVG rather than a canvas per cell: a page is 40
 * cells, and static vector ink costs nothing to keep mounted or to scale.
 *
 * A cell whose PAGE has not been fetched yet (`loaded` false — rows a jump scrolled
 * past, or rows still arriving) draws its frame only: showing the guide there would
 * claim the cell is blank before the server has said so.
 *
 * Tappable (an outlined button per CLAUDE.md § "Buttons & cards"); tapping a loaded cell
 * hands its own element up as the canvas's morph origin.
 */

/** Ink line width as a share of the cell's edge — the canvas's pen at its edge (notebookLayout.ts → NOTEBOOK_INK_RATIO). */
const INK_WIDTH = NOTEBOOK_INK_RATIO * INK_GRID;

interface NotebookCellProps {
    cellIndex: number;
    size: number;
    left: number;
    top: number;
    /** Encoded ink, when filled. */
    ink: string | undefined;
    loaded: boolean;
    onOpen: (cellIndex: number, element: HTMLElement) => void;
}

const NotebookCell = memo(function NotebookCell({ cellIndex, size, left, top, ink, loaded, onOpen }: NotebookCellProps) {
    // Decoding is per ink string; a malformed one (never expected — the server validates
    // every write) draws as blank rather than taking the sheet down.
    const strokes = useMemo(() => {
        if (!ink) return [];
        try {
            return decodeNotebookInk(ink);
        } catch {
            return [];
        }
    }, [ink]);

    return (
        <Box
            component="button"
            type="button"
            className={`notebook-cell${ink ? " notebook-cell--filled" : ""}${loaded ? "" : " notebook-cell--loading"}`}
            aria-label={`Cell ${cellIndex + 1}${ink ? ", written" : ""}`}
            disabled={!loaded}
            onClick={(e) => onOpen(cellIndex, e.currentTarget)}
            sx={{
                position: "absolute",
                left,
                top,
                width: size,
                height: size,
                padding: 0,
                margin: 0,
                // Square: the cells touch and share hairlines (notebookLayout →
                // NOTEBOOK_CELL_BORDER), so rounded corners would leave notches.
                borderRadius: 0,
                border: `1px solid ${COLORS.border}`,
                backgroundColor: COLORS.white,
                overflow: "hidden",
                cursor: loaded ? "pointer" : "default",
                // Scrolling the sheet is the page's pan; a tap is the only gesture here.
                touchAction: "pan-y",
                WebkitTapHighlightColor: "transparent",
            }}
        >
            {loaded && <MiGridGuide className="notebook-cell__guide" />}
            {strokes.length > 0 && (
                <Box
                    component="svg"
                    className="notebook-cell__ink"
                    viewBox={`0 0 ${INK_GRID} ${INK_GRID}`}
                    aria-hidden
                    sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
                >
                    <g fill="none" stroke={COLORS.onSurface} strokeWidth={INK_WIDTH} strokeLinecap="round" strokeLinejoin="round">
                        {strokes.map((s, i) => (
                            <polyline
                                key={i}
                                // A one-point tap is drawn as a zero-length line, which the round cap turns into a dot.
                                points={(s.xs.length === 1 ? [0, 0] : s.xs.map((_, j) => j))
                                    .map((j) => `${(s.xs[j] * INK_GRID).toFixed(1)},${(s.ys[j] * INK_GRID).toFixed(1)}`)
                                    .join(" ")}
                            />
                        ))}
                    </g>
                </Box>
            )}
        </Box>
    );
});

export default NotebookCell;
