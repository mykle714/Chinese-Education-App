import { useLayoutEffect, useRef, useState } from "react";
import { GRID_COLUMNS, GRID_ROWS, type PlacedTile } from "./wordGridModel";

/** Gap between cells, px — the design's `.cgrid` gap. */
export const WORD_GRID_CELL_GAP = 6;
/** The grid's side gutter, px — the design's `.cgrid` padding. */
export const WORD_GRID_SIDE_GUTTER = 22;
/** Space above the grid, px — the 18px top padding the removed "Your words" heading used to supply. */
export const WORD_GRID_TOP_GAP = 18;

export interface GridRect { left: number; top: number; width: number; height: number }

/**
 * Geometry for a 6×6 word grid (wordGridModel), shared by both Centers' grids
 * (ReadingSwipeGrid, WritingPracticeGrid — docs/READING_WRITING_CENTERS.md).
 *
 * Tiles are ABSOLUTELY positioned from (row, col, span) against the measured grid
 * width rather than laid out by CSS grid, because the reading grid animates a tile's
 * own left/top/width/height (an open tile grows in place). Square cells: the cell size
 * is derived from the width, and the grid's height from the cell size.
 *
 * `ready` re-binds the ResizeObserver once the grid element mounts (callers render it
 * only after they have tiles).
 */
export function useWordGridGeometry(ready: boolean) {
    const gridRef = useRef<HTMLDivElement | null>(null);
    const [gridWidth, setGridWidth] = useState(0);

    useLayoutEffect(() => {
        const el = gridRef.current;
        if (!el) return;
        const measure = () => setGridWidth(el.clientWidth);
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, [ready]);

    const cell = gridWidth > 0 ? (gridWidth - WORD_GRID_CELL_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS : 0;
    const gridHeight = cell * GRID_ROWS + WORD_GRID_CELL_GAP * (GRID_ROWS - 1);

    /** A placed tile's rectangle: `span` cells wide, one cell tall. */
    const cellRect = (t: Pick<PlacedTile, "row" | "col" | "span">): GridRect => ({
        left: t.col * (cell + WORD_GRID_CELL_GAP),
        top: t.row * (cell + WORD_GRID_CELL_GAP),
        width: t.span * cell + (t.span - 1) * WORD_GRID_CELL_GAP,
        height: cell,
    });

    return { gridRef, gridWidth, cell, gridHeight, cellRect };
}
