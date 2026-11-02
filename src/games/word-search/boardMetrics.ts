import { cpcdNaturalSize, type CPCDSize } from "../../components/CPCDRow";
import { CELL_GAP, GRID_BOX_PADDING, GRID_MARGIN } from "./constants";

/**
 * The board's unscaled size, computed rather than measured. Shared by the grid, which lays
 * itself out with it, and the stage, which needs to know where a board of this size centres
 * before the grid's own container has been squeezed by the panel.
 * See docs/WORD_SEARCH_GAME.md § The play panel, top to bottom.
 */

/** Side (px) of one square tile, before `useFitScale`. Wide enough for its cpcd in both axes. */
export function boardCellSide(cellSize: CPCDSize, showPinyin: boolean): number {
    const natural = cpcdNaturalSize(cellSize, { bigPinyin: showPinyin, reservePinyin: true });
    return Math.ceil(Math.max(natural.width, natural.height));
}

/** The grid container's height (px) at scale 1, including its padding and fit margin. */
export function boardNaturalHeight(rowCount: number, cellSize: CPCDSize, showPinyin: boolean): number {
    if (rowCount <= 0) return 0;
    const cellSide = boardCellSide(cellSize, showPinyin);
    return rowCount * cellSide + (rowCount - 1) * CELL_GAP + 2 * (GRID_BOX_PADDING + GRID_MARGIN);
}
