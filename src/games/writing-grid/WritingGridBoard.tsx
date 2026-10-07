import { useEffect, useRef, useState } from "react";
import { Box } from "@mui/material";
import TonedPronunciation from "../../components/TonedPronunciation";
import WritingStage from "../../components/handwriting/WritingStage";
import ResultStamp from "../../components/handwriting/ResultStamp";
import DelayedCircularProgress from "../../components/DelayedCircularProgress";
import type { Ink } from "../../components/handwriting/types";
import { WRITING_GRID_COLUMNS, type WritingGridCharacter } from "../../../server/contracts/writingGrid";
import { WRITING_LEVELS, modeOfLevel } from "../../../server/contracts/writingLevels";
import { levelPreview, type LevelPreview } from "../../components/handwriting/levelBehavior";
import { COLORS } from "../../theme";
import { SIZE } from "../../theme/scale";
import { CANVAS_SIZE, CELL_GAP, CELL_GAP_MAX, DRAG_SLOP_PX, SHADOW_PREVIEW_MAX_LEVEL } from "./constants";
import { moveItem } from "./gridOrder";

export type CellResult = "idle" | "checking" | "correct" | "wrong";
export type BoardPhase = "countdown" | "arrange" | "write" | "ended";

/**
 * WritingGridBoard — the 8-cell grid (docs/WRITING_PRACTICE_REWORK.md § 2).
 *
 * The board FITS its frame: it fills the space the page gives it (flex: 1) and sizes
 * each cell from whichever of the frame's width or height binds first, so the rows
 * never push the page into scrolling. The axis that does NOT bind spreads its slack
 * into its gaps (`spreadGap`, CELL_GAP → CELL_GAP_MAX).
 *
 * Two arrangements (`GRID_LAYOUTS`), picked per frame by `pickLayout` — whichever gives
 * the bigger cell:
 *   tall    — 4 rows × 2 columns (WRITING_GRID_COLUMNS), difficulty labels in the side
 *             columns. The normal phone layout.
 *   compact — 3 rows × 3 columns (3 + 3 + 2), for a vertically tight frame (a short
 *             phone, landscape, the keyboard up). No side columns: "Easiest" sits in a
 *             band above the first slot and "Hardest" in a band above the last slot.
 *
 * POSITION carries the level: cell i (reading order) is Level i + 1. The level's NAME is
 * written in a band under each slot (it belongs to the slot, so it never moves with a
 * drag); there is no per-cell "L1"…"L8" badge. The two ends are labelled in the side
 * columns: "Easiest" (green) beside the first slot, "Hardest" (red) beside the last, each centred in its column, so the direction of the handicap reads without decoding the level names.
 *
 *   arrange (Phase 1) — every character shown as its full, still SHADOW (outline) with
 *                       tone-coloured pinyin at the cell's bottom centre; press-and-drag MOVES a character to another slot
 *                       (`moveItem`: the rest shift, it is not a swap). Cells are laid
 *                       out absolutely from their index, so a reorder animates.
 *   write   (Phase 2) — glyphs hidden (the arrangement is now from memory). Slots
 *                       L1–L3 (SHADOW_PREVIEW_MAX_LEVEL) show the level's shadow
 *                       preview (`levelPreview` — what the editor first shows) under the
 *                       learner's ink; the rest show the dd in that spot, replaced by the
 *                       ink once written. Every cell keeps its pinyin at the bottom
 *                       centre (`PinyinCell`). ✓ / ✗ on every cell.
 *                       Tapping a cell that is not yet correct opens it for writing.
 *   ended            — every cell ✓, each showing the learner's ink over the
 *                       character's full still shadow (all slots, any level), pinyin at
 *                       the bottom centre — the finished board to look back over.
 *                       Every cell is tappable: it reopens its canvas as drawn for a
 *                       practice redraw (the page verifies it but sends no mark).
 *
 * Presentation + the drag gesture only; the order, results and inks are the page's.
 */
interface WritingGridBoardProps {
    cells: WritingGridCharacter[];
    phase: BoardPhase;
    results: Record<string, CellResult>;
    inks: Record<string, Ink>;
    onReorder: (from: number, to: number) => void;
    /**
     * `el` is the tapped cell's drawing area (`PinyinCell`'s upper square) — the editor
     * grows out of it (WritingPanel's morph), so its canvas lands on the cell's ink.
     */
    onOpenCell: (index: number, el: HTMLElement) => void;
}

/**
 * Shadow size (Phase 1, and Phase 2's shadow slots) as a fraction of the cell, so the
 * pinyin pinned to the cell's bottom edge has room beneath it (the stage is lifted by
 * half the leftover margin).
 */
const SHADOW_SCALE = 0.68;

/** Height (px) of the level-name band under each row of cells. */
const LEVEL_NAME_BAND = 18;
/** Clear space (px) between a cell's bottom edge and its level-name band. */
const LEVEL_NAME_OFFSET = 5;
/** Everything a row adds under its cell: the offset plus the band. Reserved in the fit. */
const LEVEL_NAME_ROW = LEVEL_NAME_OFFSET + LEVEL_NAME_BAND;
/**
 * Width (px) of the gutter kept free on EACH side of the grid for the difficulty
 * labels — "Easiest" beside the first slot (L1, the most help) and "Hardest" beside
 * the last (L8, the least). Reserved in the cell-size fit, so on a narrow phone the
 * cells shrink to make room rather than the labels overlapping them.
 *
 * The frame runs to the screen edge (WritingGridPage gives the board area no side
 * padding), so this also covers the page's usual 16px edge padding: 58px of label
 * room + 16px. A label then centres between the screen edge and the grid.
 */
const DIFFICULTY_GUTTER = 58 + 16;

/** Screen-edge padding (px) each side of the compact layout, which has no side columns. */
const COMPACT_EDGE_PAD = 16;

/**
 * One grid arrangement. `sideGutter` is reserved on EACH side of the grid (the tall
 * layout's label columns); `topBand` is reserved above the first row and `lastRowBand`
 * above the last row (the compact layout's "Easiest" / "Hardest" bands — "Hardest" needs
 * its own band because the row above the last cell already holds a level name).
 */
interface GridLayout {
    name: "tall" | "compact";
    columns: number;
    sideGutter: number;
    topBand: number;
    lastRowBand: number;
}

const GRID_LAYOUTS: readonly [tall: GridLayout, compact: GridLayout] = [
    { name: "tall", columns: WRITING_GRID_COLUMNS, sideGutter: DIFFICULTY_GUTTER, topBand: 0, lastRowBand: 0 },
    { name: "compact", columns: 3, sideGutter: COMPACT_EDGE_PAD, topBand: LEVEL_NAME_BAND, lastRowBand: LEVEL_NAME_BAND },
];

/** The square cell size (px) `layout` would give `count` cells in a `width` × `height` frame. */
function cellSizeFor(layout: GridLayout, count: number, width: number, height: number): number {
    if (width <= 0 || height <= 0) return 0;
    const rows = Math.ceil(count / layout.columns) || 1;
    const fromWidth = (width - layout.sideGutter * 2 - CELL_GAP * (layout.columns - 1)) / layout.columns;
    const fromHeight = (height - layout.topBand - layout.lastRowBand - CELL_GAP * (rows - 1) - LEVEL_NAME_ROW * rows) / rows;
    return Math.max(0, Math.min(fromWidth, fromHeight));
}

/**
 * The arrangement for this frame: the tall layout unless the compact one gives a
 * strictly bigger cell — i.e. once height binds the tall fit hard enough that trading a
 * row for a column wins. Ties (and an unmeasured frame) stay tall.
 */
function pickLayout(count: number, width: number, height: number): GridLayout {
    const [tall, compact] = GRID_LAYOUTS;
    return cellSizeFor(compact, count, width, height) > cellSizeFor(tall, count, width, height) ? compact : tall;
}

/**
 * Shared box for the two difficulty labels: centred (both axes) in the side column
 * beside a cell. The box's width is set per render to the whole side column — see
 * `sideColumn` — so the label sits mid-column, not hugging the grid.
 */
const difficultyLabelSx = {
    position: "absolute",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12,
    fontWeight: 700,
    whiteSpace: "nowrap",
    pointerEvents: "none",
} as const;

interface DragState {
    from: number;
    over: number;
    /** Pointer offset from the press point, px. */
    dx: number;
    dy: number;
    pointerId: number;
}

export default function WritingGridBoard({ cells, phase, results, inks, onReorder, onOpenCell }: WritingGridBoardProps) {
    // The frame is measured (both axes); the board inside it is sized to fit.
    const frameRef = useRef<HTMLDivElement | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [frame, setFrame] = useState({ width: 0, height: 0 });
    useEffect(() => {
        const el = frameRef.current;
        if (!el) return;
        const measure = () => setFrame({ width: el.clientWidth, height: el.clientHeight });
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        measure();
        return () => ro.disconnect();
    }, []);

    const layout = pickLayout(cells.length, frame.width, frame.height);
    const { columns, sideGutter, topBand, lastRowBand } = layout;
    const rows = Math.ceil(cells.length / columns) || 1;
    // Cells are square — the cell is the writing surface, so it matches the square canvas.
    const cell = cellSizeFor(layout, cells.length, frame.width, frame.height);
    // Only one axis binds the fit; the other is left with slack. Spread that slack into
    // the gaps on its axis (up to CELL_GAP_MAX) so the cells breathe instead of huddling.
    // Slack is measured AFTER the side gutters, the top band and the level-name bands, so
    // widening a gap never eats into any of them; whatever the cap leaves over stays in the
    // side columns (horizontal) or below the board (vertical, which is top-aligned).
    const slackX = frame.width - sideGutter * 2 - cell * columns - CELL_GAP * (columns - 1);
    const slackY = frame.height - topBand - lastRowBand - (cell + LEVEL_NAME_ROW) * rows - CELL_GAP * (rows - 1);
    const gapX = spreadGap(slackX, columns);
    const gapY = spreadGap(slackY, rows);
    const colPitch = cell + gapX;
    const boardWidth = cell * columns + gapX * (columns - 1);
    const slotX = (i: number) => (i % columns) * colPitch;
    // Tall layout: the board is centred in its frame, so each side of it has an equal free
    // column. When height binds the fit, that column is wider than DIFFICULTY_GUTTER; the
    // difficulty labels span the WHOLE column so they centre in it rather than in the
    // reserved minimum strip against the grid.
    const sideColumn = Math.max(sideGutter, (frame.width - boardWidth) / 2);
    // Each row is the cell plus the level-name row beneath it; the compact layout's
    // "Easiest" band sits above the first row.
    const rowPitch = cell + LEVEL_NAME_ROW + gapY;
    // Top of row `row`; the last row is pushed down by the compact layout's "Hardest" band.
    const rowY = (row: number) => topBand + row * rowPitch + (row === rows - 1 ? lastRowBand : 0);
    const slotY = (i: number) => rowY(Math.floor(i / columns));

    // ── Phase 1 drag ─────────────────────────────────────────────────────────────
    const [drag, setDrag] = useState<DragState | null>(null);
    const pressRef = useRef<{ index: number; x: number; y: number; pointerId: number } | null>(null);

    /** The slot under a board-relative point (nearest centre), clamped to the board. */
    const slotAt = (x: number, y: number): number => {
        const col = Math.max(0, Math.min(columns - 1, Math.floor(x / colPitch)));
        // The last row whose top is at or above the pointer (rows are not evenly pitched
        // once the compact layout's "Hardest" band shifts the last one down).
        let row = 0;
        while (row < rows - 1 && y >= rowY(row + 1)) row++;
        // Over the compact layout's empty ninth slot, this clamps to the last cell.
        return Math.min(cells.length - 1, row * columns + col);
    };

    const onPointerDown = (index: number) => (e: React.PointerEvent) => {
        if (phase !== "arrange") return;
        pressRef.current = { index, x: e.clientX, y: e.clientY, pointerId: e.pointerId };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: React.PointerEvent) => {
        const press = pressRef.current;
        if (!press || press.pointerId !== e.pointerId) return;
        const dx = e.clientX - press.x;
        const dy = e.clientY - press.y;
        if (!drag && Math.hypot(dx, dy) < DRAG_SLOP_PX) return;
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const over = slotAt(e.clientX - rect.left, e.clientY - rect.top);
        setDrag({ from: press.index, over, dx, dy, pointerId: e.pointerId });
    };
    const onPointerUp = (e: React.PointerEvent) => {
        const press = pressRef.current;
        if (!press || press.pointerId !== e.pointerId) return;
        pressRef.current = null;
        if (drag) onReorder(drag.from, drag.over);
        setDrag(null);
    };

    // While dragging, lay the others out as if the move had happened (preview).
    const order = cells.map((_, i) => i);
    const preview = drag ? moveItem(order, drag.from, drag.over) : order;
    const slotOf = new Map(preview.map((cellIndex, slot) => [cellIndex, slot]));

    // The Easiest / Hardest labels guide the ARRANGING; Phase 2 (write) drops them. Their
    // gutters / bands stay reserved, so the cells do not resize when the phase changes.
    const showDifficulty = cells.length > 0 && phase !== "write";

    return (
        <Box
            ref={frameRef}
            className="writing-grid-board__frame"
            sx={{ flex: 1, minHeight: 0, width: "100%", display: "flex", justifyContent: "center", alignItems: "flex-start" }}
        >
        <Box
            ref={containerRef}
            className={`writing-grid-board writing-grid-board--${phase} writing-grid-board--${layout.name}`}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            sx={{
                position: "relative",
                width: boardWidth,
                height: topBand + lastRowBand + rows * rowPitch - gapY,
                touchAction: "none",
                userSelect: "none",
                WebkitUserSelect: "none",
            }}
        >
            {/* Slot outlines belong to SLOTS, so they are drawn under the moving cells. */}
            {cells.map((_, slot) => (
                <Box
                    key={`slot-${slot}`}
                    className="writing-grid-board__slot"
                    sx={{
                        position: "absolute",
                        left: slotX(slot),
                        top: slotY(slot),
                        width: cell,
                        height: cell,
                        borderRadius: "14px",
                        border: `1px dashed ${COLORS.border}`,
                    }}
                />
            ))}
            {cells.map((_, slot) => (
                <Box
                    key={`slot-name-${slot}`}
                    className="writing-grid-board__level-name"
                    sx={{
                        position: "absolute",
                        left: slotX(slot),
                        top: slotY(slot) + cell + LEVEL_NAME_OFFSET,
                        width: cell,
                        height: LEVEL_NAME_BAND,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 12,
                        fontWeight: 600,
                        color: COLORS.textSecondary,
                        whiteSpace: "nowrap",
                        pointerEvents: "none",
                    }}
                >
                    {WRITING_LEVELS[slot]?.name ?? ""}
                </Box>
            ))}

            {/* Difficulty ends, at the first and last SLOTS (they label positions, so like
                the level names they never move with a drag). Green / red are the ramp's
                Mark tier — the deepest green and red in the palette, which has no ink tier
                for hues (theme/colors.ts).
                Tall: beside the slots, each centred in its side column.
                Compact: each in its own band above its slot — "Easiest" above the first,
                "Hardest" above the last (the lastRowBand, clear of the level name of the
                cell above it). */}
            {showDifficulty && layout.name === "compact" && (
                <>
                    <Box
                        className="writing-grid-board__difficulty writing-grid-board__difficulty--easiest"
                        sx={{ ...difficultyLabelSx, left: slotX(0), width: cell, top: 0, height: topBand, color: COLORS.grnMk }}
                    >
                        Easiest
                    </Box>
                    <Box
                        className="writing-grid-board__difficulty writing-grid-board__difficulty--hardest"
                        sx={{ ...difficultyLabelSx, left: slotX(cells.length - 1), width: cell, top: slotY(cells.length - 1) - lastRowBand, height: lastRowBand, color: COLORS.redMk }}
                    >
                        Hardest
                    </Box>
                </>
            )}
            {showDifficulty && layout.name === "tall" && (
                <>
                    <Box
                        className="writing-grid-board__difficulty writing-grid-board__difficulty--easiest"
                        sx={{ ...difficultyLabelSx, left: -sideColumn, width: sideColumn, top: slotY(0), height: cell, color: COLORS.grnMk }}
                    >
                        Easiest
                    </Box>
                    <Box
                        className="writing-grid-board__difficulty writing-grid-board__difficulty--hardest"
                        sx={{ ...difficultyLabelSx, left: boardWidth, width: sideColumn, top: slotY(cells.length - 1), height: cell, color: COLORS.redMk }}
                    >
                        Hardest
                    </Box>
                </>
            )}

            {cells.map((c, i) => {
                const slot = slotOf.get(i) ?? i;
                const isDragged = drag?.from === i;
                const level = (drag ? slot : i) + 1;
                const result = results[c.char] ?? "idle";
                const ink = inks[c.char];
                // Phase 2: an unfinished cell opens for writing. End board: ANY cell reopens its
                // canvas as drawn, for a practice redraw (verified, never marked — the page).
                const tappable =
                    result !== "checking" && ((phase === "write" && result !== "correct") || phase === "ended");
                const x = isDragged ? slotX(drag.from) + drag.dx : slotX(slot);
                const y = isDragged ? slotY(drag.from) + drag.dy : slotY(slot);
                return (
                    <Box
                        key={c.char}
                        component={tappable ? "button" : "div"}
                        type={tappable ? "button" : undefined}
                        className={`writing-grid-board__cell writing-grid-board__cell--${result}${isDragged ? " writing-grid-board__cell--dragging" : ""}`}
                        onPointerDown={onPointerDown(i)}
                        // The editor projects out of the cell's drawing AREA, not the whole
                        // cell: the pinyin band shrinks and lifts the area, and the canvas must
                        // land on the shadow / ink it shows, not centred on the full cell.
                        onClick={tappable ? (e: React.MouseEvent<HTMLElement>) => onOpenCell(i, cellAreaOf(e.currentTarget)) : undefined}
                        sx={{
                            position: "absolute",
                            left: 0,
                            top: 0,
                            width: cell,
                            height: cell,
                            transform: `translate(${x}px, ${y}px)${isDragged ? " scale(1.06)" : ""}`,
                            transition: isDragged ? "none" : "transform 180ms ease",
                            zIndex: isDragged ? 3 : 1,
                            p: 0,
                            font: "inherit",
                            borderRadius: "14px",
                            border: `1px solid ${COLORS.border}`,
                            // The verdict is carried by the corner ✓ / ✗ icon alone — the cell's
                            // ground stays white so the learner's ink reads against it unchanged.
                            bgcolor: COLORS.white,
                            boxShadow: isDragged ? "0 8px 18px rgba(23, 22, 26, 0.18)" : "none",
                            cursor: phase === "arrange" ? "grab" : tappable ? "pointer" : "default",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            overflow: "hidden",
                            touchAction: "none",
                        }}
                    >
                        {phase === "countdown" || phase === "arrange" ? (
                            // Phase 1 (and the countdown's readable board): every character as
                            // its full, still shadow, pinyin pinned to the cell's bottom centre.
                            // Every slot shows the whole glyph — arranging needs to see them all.
                            <PinyinCell pinyin={c.pinyin} cell={cell}>
                                <CellStage character={c.char} px={cell * SHADOW_SCALE} ink={[]} preview={{ guide: true, loop: false, snap: false }} />
                            </PinyinCell>
                        ) : phase === "ended" ? (
                            // Ended: the learner's own canvas for every cell, drawn over the
                            // character's FULL still shadow — every slot, whatever its level
                            // (an L4–L8 slot never showed one while writing), so the finished
                            // board reads as "what you wrote vs. the character". `snap` stays
                            // per level: a Snap slot's ink was snapped strokes.
                            <PinyinCell pinyin={c.pinyin} cell={cell}>
                                <CellStage
                                    character={c.char}
                                    px={cell * SHADOW_SCALE}
                                    ink={ink ?? []}
                                    preview={{ guide: true, loop: false, snap: levelPreview(modeOfLevel(level)).snap }}
                                />
                            </PinyinCell>
                        ) : level <= SHADOW_PREVIEW_MAX_LEVEL ? (
                            // Most-help slots: the level's first-look shadow with the ink over
                            // it, and the pinyin kept at the bottom as in Phase 1.
                            <PinyinCell pinyin={c.pinyin} cell={cell}>
                                <CellStage
                                    character={c.char}
                                    px={cell * SHADOW_SCALE}
                                    ink={ink ?? []}
                                    // A still shadow: Trace's looping stroke order is an editor cue,
                                    // too busy across a board of cells.
                                    preview={{ ...levelPreview(modeOfLevel(level)), loop: false }}
                                />
                            </PinyinCell>
                        ) : (
                            // Least-help slots: no shadow — the dd sits where it would be, and
                            // the learner's ink replaces the dd once written.
                            <PinyinCell pinyin={c.pinyin} cell={cell}>
                                {ink && ink.length > 0 ? (
                                    <CellStage
                                        character={c.char}
                                        px={cell * SHADOW_SCALE}
                                        ink={ink}
                                        preview={{ ...levelPreview(modeOfLevel(level)), guide: false }}
                                    />
                                ) : (
                                    <CellDefinition definition={c.definition} />
                                )}
                            </PinyinCell>
                        )}

                        {result === "checking" && (
                            <DelayedCircularProgress className="writing-grid-board__checking" size={16} sx={{ position: "absolute", top: 5, right: 5 }} />
                        )}
                        {(result === "correct" || result === "wrong") && (
                            <ResultStamp className="writing-grid-board__result" result={result} size={22} inset={4} />
                        )}
                    </Box>
                );
            })}
        </Box>
        </Box>
    );
}

/**
 * The gap (px) between `count` cells on one axis once that axis's `slack` (px left over
 * after the minimum-gap fit) is shared among its gaps: CELL_GAP plus an equal share,
 * capped at CELL_GAP_MAX. A single row/column has no gap to widen.
 */
function spreadGap(slack: number, count: number): number {
    if (count < 2 || slack <= 0) return CELL_GAP;
    return Math.min(CELL_GAP_MAX, CELL_GAP + slack / (count - 1));
}

/**
 * The full-size writing stage scaled into a cell, so the ink's coordinates match the
 * editor's. `preview` decides the shadow under the ink (none when `preview.guide` is off).
 */
function CellStage({ character, px, ink, preview }: { character: string; px: number; ink: Ink; preview: LevelPreview }) {
    return (
        <Box className="writing-grid-board__stage" sx={{ position: "relative", width: px, height: px, flexShrink: 0 }}>
            <Box sx={{ position: "absolute", inset: 0, transform: `scale(${px / CANVAS_SIZE})`, transformOrigin: "top left", width: CANVAS_SIZE, height: CANVAS_SIZE, pointerEvents: "none" }}>
                <WritingStage
                    // `initialInk` only seeds the stage on mount, so the key must change with
                    // the drawing. Stroke count alone misses a same-count redraw (the End
                    // board's practice); the last stroke's end time is unique per drawing.
                    key={`${character}-${ink.length}-${ink[ink.length - 1]?.ts.at(-1) ?? 0}`}
                    character={character}
                    size={CANVAS_SIZE}
                    drawable={false}
                    showGuide={preview.guide}
                    guideVisible={preview.guide}
                    loopAnimation={preview.loop}
                    regionClip={preview.regionClip}
                    // A Snap slot's ink is snapped strokes: printed shapes.
                    snap={preview.snap}
                    initialInk={ink}
                    result="idle"
                />
            </Box>
        </Box>
    );
}

/**
 * The dd of a no-shadow slot (L4–L8), centred in the square the shadow would fill.
 */
function CellDefinition({ definition }: { definition: string | null }) {
    if (!definition) return null;
    return (
        <Box
            component="span"
            className="writing-grid-board__definition"
            sx={{
                px: 0.5,
                fontSize: SIZE.body,
                lineHeight: 1.25,
                textAlign: "center",
                color: COLORS.textSecondary,
                maxWidth: "100%",
                display: "-webkit-box",
                WebkitLineClamp: 4,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                wordBreak: "break-word",
            }}
        >
            {definition}
        </Box>
    );
}

const CELL_AREA_CLASS = "writing-grid-board__cell-area";

/** The tapped cell's drawing area (the projection origin), or the cell itself if absent. */
function cellAreaOf(cellEl: HTMLElement): HTMLElement {
    return cellEl.querySelector<HTMLElement>(`.${CELL_AREA_CLASS}`) ?? cellEl;
}

/**
 * The shared cell layout for Phase 1 and every Phase 2 slot: an upper square
 * (`SHADOW_SCALE` of the cell, lifted to leave room) holding the shadow, the ink or the
 * dd, and tone-coloured pinyin pinned to the cell's bottom centre.
 */
function PinyinCell({ pinyin, cell, children }: { pinyin: string | null; cell: number; children: React.ReactNode }) {
    const area = cell * SHADOW_SCALE;
    return (
        <>
            <Box
                className={CELL_AREA_CLASS}
                sx={{
                    width: area,
                    height: area,
                    mb: `${(cell - area) * 0.5}px`,
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    // Invisible (no fill / border) — read only by useProjectionMorph as the
                    // collapsed frame's corner, the cell's 14px scaled down to this square.
                    borderRadius: `${Math.round(14 * SHADOW_SCALE)}px`,
                }}
            >
                {children}
            </Box>
            {pinyin && (
                <TonedPronunciation
                    pronunciation={pinyin}
                    className="writing-grid-board__cell-pinyin"
                    fontSize={SIZE.body}
                    justifyContent="center"
                    sx={{ position: "absolute", left: 0, right: 0, bottom: 4, pointerEvents: "none" }}
                />
            )}
        </>
    );
}
