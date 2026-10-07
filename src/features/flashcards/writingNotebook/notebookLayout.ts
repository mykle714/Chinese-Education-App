/**
 * notebookLayout — the Writing Notebook grid's geometry, as pure functions
 * (docs/WRITING_NOTEBOOK.md § "Scrolling, pages and the jump").
 *
 * The sheet is endless, so the grid is VIRTUALISED: every row has the same pitch, the
 * scroller's content is one tall spacer, and only the rows near the viewport mount. That
 * fixed pitch is what makes the rest simple:
 *   • "jump to next empty" is a real scroll to a row's offset (no window swapping), so
 *     the scrolling animation and the index the learner lands on are the same thing;
 *   • rows a jump skipped over are just rows whose PAGE has not been fetched — scrolling
 *     back up brings them into view and the grid fetches their pages then.
 *
 * A "page" is a load chunk of NOTEBOOK_PAGE_ROWS rows (server/contracts/writingNotebook.ts).
 */
import { WRITING_PANEL_FOOTER_HEIGHT } from "../../../components/handwriting/writingPanelStyles";
import { NOTEBOOK_COLUMNS, NOTEBOOK_PAGE_ROWS, NOTEBOOK_PAGE_SIZE } from "../../../../server/contracts/writingNotebook";

/** Side margin of the grid (px) — the app's phone gutter. */
export const NOTEBOOK_SIDE_GUTTER = 16;
/**
 * Cells TOUCH: neighbours share one 1px edge. Each cell draws its full 1px border and
 * sits one pixel back over its neighbour's, so the shared edge is a single hairline, not
 * two (a copybook grid, not a row of tiles).
 */
export const NOTEBOOK_CELL_BORDER = 1;
/** Space above the first row (px). */
export const NOTEBOOK_TOP_PAD = 12;
/** Rows mounted beyond each edge of the viewport. */
export const NOTEBOOK_OVERSCAN_ROWS = 4;
/** Rows of FILLED cells shown above the target row after a jump (the spec's "2 rows"). */
export const JUMP_CONTEXT_ROWS = 2;

export interface NotebookGeometry {
    /** A cell's outer size, borders included. */
    cellSize: number;
    /** Cell-to-cell distance, both axes: a cell less the border it shares with the next. */
    pitch: number;
    /** The grid's total width (cells overlap by one border at each shared edge). */
    gridWidth: number;
    /** The grid's left edge: centred, so the floor() rounding splits evenly across both gutters. */
    gridLeft: number;
}

/**
 * Cell size, pitch, grid width and left edge for a container of this width. Shared by the
 * sheet (NotebookGrid) and the word bar (NotebookWordBar), so the header's shadow grid
 * spans exactly the practice grid's width.
 */
export function notebookGeometry(width: number): NotebookGeometry {
    const inner = Math.max(0, width - 2 * NOTEBOOK_SIDE_GUTTER);
    // N cells overlapping by one border at each of the N − 1 shared edges fill
    // N · size − (N − 1) · border.
    const cellSize = Math.max(2, Math.floor((inner + (NOTEBOOK_COLUMNS - 1) * NOTEBOOK_CELL_BORDER) / NOTEBOOK_COLUMNS));
    const pitch = cellSize - NOTEBOOK_CELL_BORDER;
    const gridWidth = NOTEBOOK_COLUMNS * pitch + NOTEBOOK_CELL_BORDER;
    return { cellSize, pitch, gridWidth, gridLeft: Math.max(0, Math.floor((width - gridWidth) / 2)) };
}

/** The left offset of column `col` within the grid. */
export const colLeft = (col: number, pitch: number) => col * pitch;

/** The scroll offset of row `row`'s top edge. */
export const rowTop = (row: number, pitch: number) => NOTEBOOK_TOP_PAD + row * pitch;

/** The row under a vertical offset (clamped to 0). */
export const rowAt = (offset: number, pitch: number) => Math.max(0, Math.floor((offset - NOTEBOOK_TOP_PAD) / pitch));

/** The rows to MOUNT for a viewport: everything visible plus the overscan, within [0, rowCount). */
export function mountedRows(scrollTop: number, viewport: number, pitch: number, rowCount: number): { first: number; last: number } {
    const first = Math.max(0, rowAt(scrollTop, pitch) - NOTEBOOK_OVERSCAN_ROWS);
    const last = Math.min(rowCount - 1, rowAt(scrollTop + viewport, pitch) + NOTEBOOK_OVERSCAN_ROWS);
    return { first, last };
}

/** Page index of a row. */
export const pageOfRow = (row: number) => Math.floor(row / NOTEBOOK_PAGE_ROWS);

/** Every page touching rows [first, last]. */
export function pagesForRows(first: number, last: number): number[] {
    const pages: number[] = [];
    for (let p = pageOfRow(first); p <= pageOfRow(Math.max(first, last)); p++) pages.push(p);
    return pages;
}

/** The cell index range [from, to) a page covers. */
export const pageRange = (page: number) => ({ from: page * NOTEBOOK_PAGE_SIZE, to: (page + 1) * NOTEBOOK_PAGE_SIZE });

/**
 * How many rows the spacer must hold. The sheet never ends: it always reaches at least a
 * page past the deepest row the learner has seen (or jumped to), so the next page is
 * there to scroll into.
 */
export function rowCountFor(deepestRow: number): number {
    return (pageOfRow(Math.max(0, deepestRow)) + 2) * NOTEBOOK_PAGE_ROWS;
}

/** The page the learner is "on": the one holding the row at the middle of the viewport. */
export function currentPage(scrollTop: number, viewport: number, pitch: number): number {
    return pageOfRow(rowAt(scrollTop + viewport / 2, pitch));
}

/** True when a loaded page has every one of its cells filled. */
export function isPageFull(page: number, filled: ReadonlySet<number>): boolean {
    const { from, to } = pageRange(page);
    for (let i = from; i < to; i++) if (!filled.has(i)) return false;
    return true;
}

/**
 * Where a jump to `cellIndex` lands: scrolled so that JUMP_CONTEXT_ROWS rows sit above
 * the target's row (filled ones — the target is the first empty cell after them), and
 * the target row is the next one down. Near the top it clamps to the sheet's start.
 */
export function jumpScrollTop(cellIndex: number, pitch: number): { row: number; scrollTop: number } {
    const row = Math.floor(cellIndex / NOTEBOOK_COLUMNS);
    const firstShown = Math.max(0, row - JUMP_CONTEXT_ROWS);
    return { row, scrollTop: firstShown === 0 ? 0 : rowTop(firstShown, pitch) - NOTEBOOK_TOP_PAD };
}

/** The jump's scroll duration: longer for a longer trip, within a band that never drags. */
export function jumpDurationMs(distance: number): number {
    return Math.round(Math.min(900, Math.max(450, 300 + Math.abs(distance) * 0.15)));
}

/** easeInOutCubic — the jump's scroll curve. */
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** The word bar's shadow cells per row (NotebookWordBar): two, so 3–4 characters make a 2×2. */
export const WORD_BAR_CELLS_PER_ROW = 2;

/**
 * Whether NotebookWordBar's `compact` form changes this word's bar — only a word that
 * would make the 2×2 (docs/WRITING_NOTEBOOK.md § "Canvas").
 */
export const wordBarCompacts = (word: string | null) => word !== null && [...word].length > WORD_BAR_CELLS_PER_ROW;

/**
 * The cell editor's canvas edge (px). The notebook's own size, a little under the shared
 * WRITING_FOCUS_SIZE (300) so the canvas fits beneath the word bar on a phone. Stored ink
 * is normalised to the cell, so this can change without touching saved cells.
 */
export const NOTEBOOK_CANVAS_SIZE = 260;
/** The pen's line width on that canvas (px) — one size, by design. */
export const NOTEBOOK_PEN_WIDTH = 7;
/** Pen width as a share of the canvas edge: a sheet cell draws ink at this share of its own edge. */
export const NOTEBOOK_INK_RATIO = NOTEBOOK_PEN_WIDTH / NOTEBOOK_CANVAS_SIZE;

/** Breathing room kept above and below the cell editor's panel (px). */
const NOTEBOOK_EDITOR_MARGIN_Y = 16;

/**
 * The height the cell editor needs (px): the headerless panel (canvas + footer + its 1px
 * border top and bottom) and a margin. When the sheet under a 3–4 character
 * word bar is shorter than this, the editor COMPACTS the bar instead
 * (WritingNotebookPage → `openCell`; docs/WRITING_NOTEBOOK.md § "Canvas").
 */
export const NOTEBOOK_EDITOR_MIN_HEIGHT =
    NOTEBOOK_CANVAS_SIZE + WRITING_PANEL_FOOTER_HEIGHT + 2 + 2 * NOTEBOOK_EDITOR_MARGIN_Y;
