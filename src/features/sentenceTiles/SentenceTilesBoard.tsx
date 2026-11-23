import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { Box } from "@mui/material";
import { COLORS } from "../../theme/colors";
import { SENTENCE_TILES_BOARD_SIZE, SENTENCE_TILES_CENTRE } from "../../../server/contracts/sentenceTiles";
import type { SentenceTilesBoardTile } from "../../../server/contracts/sentenceTiles";
import TileFace from "./TileFace";
import { TILES_HUE, TILE_RADIUS_PX } from "./sentenceTilesStyles";

/**
 * SentenceTilesBoard — the 13 × 13 grid (docs/SENTENCE_TILES_GAME.md § "Pages").
 *
 * The grid is wider than a phone, so it sits in its own scroller that pans both ways by touch
 * (`touch-action: pan-x pan-y`; the page declares `horizontalPan` so the shell lets it). On
 * mount it scrolls to centre the middle square, where play starts. The scroller shows NO
 * scrollbars (it is panned by drag / wheel), and its four edges fade out, so the board reads
 * as a window onto a larger field rather than a boxed panel.
 *
 * Tiles: committed tiles are grounded card stock (wall, no cast shadow) in cream; the most
 * recent play wears the moss TINT so "what just happened" is visible at a glance; this turn's
 * unsent tiles wear the moss MID. The empty centre square carries a moss MARK dot until
 * something covers it.
 *
 * ── Drag and drop ──
 * A rack tile being dragged (DraggableRackTile) asks the board, through the imperative handle,
 * which square is under the pointer (`cellAt`) and to light it (`setHover`). The hover lives in
 * THIS component's state so a drag re-renders only the board, never the page or the dragged
 * tile (a mid-gesture re-render of the tile would break its gesture — see DraggableRackTile).
 * `cellAt` reads the grid's live rect, so it is correct at any scroll offset, and refuses a
 * point outside the scroller's visible window (a square scrolled out of view is not a target).
 *
 * Taps still work: the page decides what a tap means (place a selected tile, recall, inspect).
 */

export interface PendingTile {
    tileId: number;
    word: string;
    row: number;
    col: number;
}

export interface BoardCell {
    row: number;
    col: number;
}

export interface SentenceTilesBoardHandle {
    /** The square under a viewport point, or null (off the grid / outside the visible window). */
    cellAt: (clientX: number, clientY: number) => BoardCell | null;
    /** Light a square as the drop target (null clears it). */
    setHover: (cell: BoardCell | null) => void;
}

interface SentenceTilesBoardProps {
    board: SentenceTilesBoardTile[];
    pending: PendingTile[];
    /** Turn number whose tiles get the "last play" tint (0 = none). */
    lastPlayTurn: number;
    onCellTap: (row: number, col: number) => void;
    cellPx: number;
}

const GAP_PX = 3;
const GRID_PAD_PX = 20;
/** Depth of the fade at each edge of the visible window, px. */
const EDGE_FADE_PX = 22;

const fadeAlong = (dir: "right" | "bottom") =>
    `linear-gradient(to ${dir}, transparent 0, #000 ${EDGE_FADE_PX}px, #000 calc(100% - ${EDGE_FADE_PX}px), transparent 100%)`;

const SentenceTilesBoard = forwardRef<SentenceTilesBoardHandle, SentenceTilesBoardProps>(function SentenceTilesBoard(
    { board, pending, lastPlayTurn, onCellTap, cellPx },
    ref,
) {
    const scrollerRef = useRef<HTMLDivElement>(null);
    const gridRef = useRef<HTMLDivElement>(null);
    const [hover, setHover] = useState<BoardCell | null>(null);

    // Centre the middle square once, before first paint.
    useLayoutEffect(() => {
        const el = scrollerRef.current;
        if (!el) return;
        el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
        el.scrollTop = (el.scrollHeight - el.clientHeight) / 2;
    }, []);

    useImperativeHandle(ref, () => ({
        cellAt: (clientX, clientY) => {
            const scroller = scrollerRef.current?.getBoundingClientRect();
            const grid = gridRef.current?.getBoundingClientRect();
            if (!scroller || !grid) return null;
            if (clientX < scroller.left || clientX > scroller.right || clientY < scroller.top || clientY > scroller.bottom) return null;
            const pitch = cellPx + GAP_PX;
            const col = Math.floor((clientX - grid.left - GRID_PAD_PX) / pitch);
            const row = Math.floor((clientY - grid.top - GRID_PAD_PX) / pitch);
            if (row < 0 || col < 0 || row >= SENTENCE_TILES_BOARD_SIZE || col >= SENTENCE_TILES_BOARD_SIZE) return null;
            return { row, col };
        },
        // Bail out on an unchanged square so a drag re-renders the board only when it crosses a line.
        setHover: (cell) => setHover((cur) => (cur?.row === cell?.row && cur?.col === cell?.col ? cur : cell)),
    }), [cellPx]);

    const placed = new Map(board.map((t) => [`${t.row},${t.col}`, t]));
    const pend = new Map(pending.map((t) => [`${t.row},${t.col}`, t]));
    const cells = [];
    for (let row = 0; row < SENTENCE_TILES_BOARD_SIZE; row++) {
        for (let col = 0; col < SENTENCE_TILES_BOARD_SIZE; col++) {
            const key = `${row},${col}`;
            const tile = placed.get(key);
            const mine = pend.get(key);
            const isCentre = row === SENTENCE_TILES_CENTRE && col === SENTENCE_TILES_CENTRE;
            const isTarget = hover?.row === row && hover?.col === col;
            cells.push(
                <Box
                    key={key}
                    component="button"
                    type="button"
                    className={isTarget ? "sentence-tiles-board__cell sentence-tiles-board__cell--target" : "sentence-tiles-board__cell"}
                    onClick={() => onCellTap(row, col)}
                    sx={{
                        width: cellPx,
                        height: cellPx,
                        padding: 0,
                        border: "none",
                        borderRadius: `${TILE_RADIUS_PX}px`,
                        backgroundColor: tile || mine ? "transparent" : isTarget ? TILES_HUE.mid : COLORS.card,
                        outline: isTarget ? `2px solid ${COLORS.onSurface}` : "none",
                        outlineOffset: "-2px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        touchAction: "manipulation",
                    }}
                >
                    {tile && <TileFace word={tile.word} sizePx={cellPx} face={tile.turn === lastPlayTurn ? TILES_HUE.tint : undefined} />}
                    {!tile && mine && <TileFace word={mine.word} sizePx={cellPx} face={TILES_HUE.mid} />}
                    {!tile && !mine && !isTarget && isCentre && (
                        <Box className="sentence-tiles-board__centre-mark" sx={{ width: 10, height: 10, borderRadius: "50%", backgroundColor: TILES_HUE.mark }} />
                    )}
                </Box>
            );
        }
    }

    return (
        <Box
            ref={scrollerRef}
            className="sentence-tiles-board"
            sx={{
                overflow: "auto",
                touchAction: "pan-x pan-y",
                maxHeight: "min(58vh, 640px)",
                // Panned by drag / wheel only — never a visible bar.
                scrollbarWidth: "none",
                "&::-webkit-scrollbar": { display: "none" },
                // Fade all four edges of the visible window: two gradients, intersected.
                maskImage: `${fadeAlong("right")}, ${fadeAlong("bottom")}`,
                WebkitMaskImage: `${fadeAlong("right")}, ${fadeAlong("bottom")}`,
                maskComposite: "intersect",
                WebkitMaskComposite: "source-in",
            }}
        >
            <Box
                ref={gridRef}
                className="sentence-tiles-board__grid"
                sx={{
                    display: "grid",
                    gridTemplateColumns: `repeat(${SENTENCE_TILES_BOARD_SIZE}, ${cellPx}px)`,
                    gap: `${GAP_PX}px`,
                    padding: `${GRID_PAD_PX}px`,
                    width: "max-content",
                }}
            >
                {cells}
            </Box>
        </Box>
    );
});

export default SentenceTilesBoard;
