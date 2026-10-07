import { useRef, useState, type ReactNode } from "react";
import { Box } from "@mui/material";
import WritingCanvas from "../../../components/handwriting/WritingCanvas";
import WritingPanel, { type WritingPanelHandle } from "../../../components/handwriting/WritingPanel";
import MiGridGuide from "./MiGridGuide";
import { NOTEBOOK_CANVAS_SIZE, NOTEBOOK_PEN_WIDTH } from "./notebookLayout";
import type { Ink, WritingCanvasHandle } from "../../../components/handwriting/types";
import Icon from "../../../components/Icon";
import type { NotebookInk } from "../../../../server/contracts/writingNotebook";
import { COLORS, RAMP } from "../../../theme/colors";
import { FONTS } from "../../../theme/fonts";
import { WEIGHT } from "../../../theme/scale";

/**
 * NotebookCellEditor — the Writing Notebook's canvas (docs/WRITING_NOTEBOOK.md § "Canvas").
 *
 * A new, stripped-down writing surface: the shared WritingPanel shell (so it grows out of
 * the tapped cell with the same projection morph as every other writing rectangle) with
 * NO header and a footer of exactly two tools — pen and eraser, one size each. No Clear,
 * no Undo, no guide glyph, no level: the only backdrop is the cell's own teal 米 guide.
 *
 * Tapping outside the panel exits: the ink is read, the panel shrinks back into its
 * cell, and `onDone` hands the normalised ink to the page, which saves (and so
 * validates) it. Nothing about the validation is shown here.
 *
 * ⚠️ DELIBERATE EXCEPTION to the app-wide dim rule (src/components/overlayHost.ts says
 * a dim hosts at the frame and darkens the whole screen). The page header and the word
 * bar stay lit (decided 2026-10-06), so the word being practised stays readable — and its
 * shadows tappable — above the canvas as the reference. The host renders this inside the
 * sheet's own positioned box (`WritingNotebookPage` → `writing-notebook-page__sheet`), and
 * it fills that box (`position: absolute; inset: 0`).
 *
 * FALLBACK — short screens only: when a 3–4 character word's 2×2 bar leaves the sheet too
 * short for this editor (`NOTEBOOK_EDITOR_MIN_HEIGHT`, decided by the page at open), the
 * host renders it one box up (`writing-notebook-page__body`, word bar + sheet) and passes
 * a COMPACT word bar as `topBar`: drawn opaque across the top of the overlay, undimmed
 * and still tappable, over the 2×2 it replaces. A tap the bar does not claim (empty space
 * beside its small row) is tap-out, like the scrim. It fades in / out with the morph as a
 * companion, and nothing beneath it reflows — the tapped cell stays exactly where the
 * panel grows out of and shrinks back into. The scrim fills the rest.
 */

/** The notebook's own canvas edge (notebookLayout.ts), smaller than the shared focus size. */
const CANVAS_SIZE = NOTEBOOK_CANVAS_SIZE;
/** The pen's line width and the eraser's radius (CSS px) — one size each, by design. */
const PEN_WIDTH = NOTEBOOK_PEN_WIDTH;
const ERASER_RADIUS = 14;
/**
 * The 米 guide's line width on the canvas, in its 0–100 units: a little under the cells'
 * 1 (≈1.95px at 260px rather than 2.6px), so the scaled-up guide does not read heavy
 * behind the ink. Dashes are unchanged, so they still line up with the cell's.
 */
const GUIDE_LINE_WIDTH = 0.75;

type Tool = "pen" | "eraser";

interface NotebookCellEditorProps {
    /** The cell's ink when it opened, normalised. */
    initialInk: NotebookInk;
    /** The tapped cell: the panel grows out of it and shrinks back into it. */
    origin: HTMLElement | null;
    /** Tap-out, after the shrink: the final ink, normalised to the cell. */
    onDone: (ink: NotebookInk) => void;
    /** Drawn lit across the overlay's top, above the scrim (the compact word bar). */
    topBar?: ReactNode;
}

/** Normalised → canvas pixels (the canvas needs timestamps; stored ink has none). */
const toCanvasInk = (ink: NotebookInk): Ink =>
    ink.map((s) => ({ xs: s.xs.map((x) => x * CANVAS_SIZE), ys: s.ys.map((y) => y * CANVAS_SIZE), ts: s.xs.map(() => 0) }));

/** Canvas pixels → normalised. */
const toNotebookInk = (ink: Ink): NotebookInk =>
    ink.map((s) => ({ xs: s.xs.map((x) => x / CANVAS_SIZE), ys: s.ys.map((y) => y / CANVAS_SIZE) }));

export default function NotebookCellEditor({ initialInk, origin, onDone, topBar }: NotebookCellEditorProps) {
    const canvasRef = useRef<WritingCanvasHandle>(null);
    const panelRef = useRef<WritingPanelHandle>(null);
    const scrimRef = useRef<HTMLDivElement>(null);
    const topBarRef = useRef<HTMLDivElement>(null);
    const [tool, setTool] = useState<Tool>("pen");
    // Read once: the canvas seeds from it on mount only.
    const [seedInk] = useState(() => toCanvasInk(initialInk));
    // Tap-out runs once, however many taps land while the panel is shrinking.
    const finishingRef = useRef(false);

    const finish = () => {
        if (finishingRef.current) return;
        finishingRef.current = true;
        const ink = toNotebookInk(canvasRef.current?.getInk() ?? []);
        void (panelRef.current?.collapse() ?? Promise.resolve()).then(() => onDone(ink));
    };

    const stop = (e: React.SyntheticEvent) => e.stopPropagation();

    const toolButton = (value: Tool, glyph: string, label: string) => {
        const selected = tool === value;
        return (
            <Box
                component="button"
                type="button"
                className={`notebook-cell-editor__tool notebook-cell-editor__tool--${value}${selected ? " notebook-cell-editor__tool--selected" : ""}`}
                aria-label={label}
                aria-pressed={selected}
                onClick={() => setTool(value)}
                sx={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    height: 36,
                    padding: "0 14px",
                    borderRadius: "999px",
                    // Selected wears the stronger ink ring (CLAUDE.md § "Buttons & cards"
                    // exception); unselected the app's ordinary outline.
                    border: selected ? `1.5px solid ${COLORS.onSurface}` : `1px solid ${COLORS.border}`,
                    backgroundColor: selected ? RAMP.tea.tint : COLORS.white,
                    color: COLORS.onSurface,
                    fontFamily: FONTS.sans,
                    fontSize: 13,
                    fontWeight: selected ? WEIGHT.bold : WEIGHT.medium,
                    cursor: "pointer",
                }}
            >
                <Icon name={glyph} size={18} sx={{ color: COLORS.onSurface }} />
                {label}
            </Box>
        );
    };

    return (
        <Box
            className="notebook-cell-editor"
            onPointerDown={stop}
            onTouchStart={stop}
            onMouseDown={stop}
            // Any tap that is not on the panel lands on the scrim (the column above it is
            // pointer-transparent) = tap out.
            onClick={(e) => {
                e.stopPropagation();
                if (e.target === scrimRef.current) finish();
            }}
            // Above the sheet's own floating "Next empty" button; the header is outside this box.
            sx={{ position: "absolute", inset: 0, zIndex: 20, touchAction: "none", display: "flex", flexDirection: "column" }}
        >
            {topBar && (
                // A tap the bar did not claim (empty space beside the small row) is tap-out,
                // like the scrim; the bar stops propagation of every tap it acts on.
                <Box ref={topBarRef} className="notebook-cell-editor__top-bar" onClick={finish} sx={{ flexShrink: 0 }}>
                    {topBar}
                </Box>
            )}

            {/* Everything under the top bar: the scrim and the centred canvas column. */}
            <Box className="notebook-cell-editor__stage" sx={{ position: "relative", flex: 1, minHeight: 0 }}>
                {/* Its own layer so it fades with the morph while the panel stays opaque. The
                    heavier focusScrim (not modalScrim): the inked sheet beneath is busy. */}
                <Box ref={scrimRef} className="notebook-cell-editor__scrim" sx={{ position: "absolute", inset: 0, bgcolor: COLORS.focusScrim }} />

                <Box
                    className="notebook-cell-editor__column"
                    sx={{
                        position: "relative",
                        height: "100%",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 1.5,
                        pointerEvents: "none",
                        "& > *": { pointerEvents: "auto" },
                    }}
                >
                    <WritingPanel
                        ref={panelRef}
                        className="notebook-cell-editor__panel"
                        size={CANVAS_SIZE}
                        origin={origin}
                        companions={[scrimRef, topBarRef]}
                        tools={
                            <Box className="notebook-cell-editor__tools" sx={{ display: "flex", gap: 1 }}>
                                {toolButton("pen", "ink_pen", "Pen")}
                                {toolButton("eraser", "ink_eraser", "Eraser")}
                            </Box>
                        }
                    >
                        <MiGridGuide className="notebook-cell-editor__guide" lineWidth={GUIDE_LINE_WIDTH} />
                        <Box className="notebook-cell-editor__canvas" sx={{ position: "absolute", inset: 0 }}>
                            <WritingCanvas
                                ref={canvasRef}
                                size={CANVAS_SIZE}
                                initialInk={seedInk}
                                strokeWidth={PEN_WIDTH}
                                tool={tool}
                                eraserRadius={ERASER_RADIUS}
                            />
                        </Box>
                    </WritingPanel>
                </Box>
            </Box>
        </Box>
    );
}
