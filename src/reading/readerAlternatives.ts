// Hit-testing for the Reader's tiebreak alternatives (the yellow boxes the Pinyin view
// draws over a losing word; ReaderCpcdView § "Tiebreak alternatives").
// Docs: docs/READER_SEGMENTATION.md § "Tiebreak alternatives".

// The cell attribute a tap on a tiebreak alternative is recognised by.
export const ALTERNATIVE_CELL_ATTR = "data-reader-alternative";

/**
 * The tiebreak-alternative cell (ALTERNATIVE_CELL_ATTR) whose box contains the point, or
 * null. Geometric rather than `elementsFromPoint`, because the pinyin is not drawn inside
 * its cell's DOM subtree (CPCDRow positions it in a layer of its own), so a tap on the
 * pinyin would miss the cell. Used by ReaderCpcdView's desktop click-capture and by
 * ReaderTapOverlay → `handlePointerUp`.
 */
export function findAlternativeCellAt(box: HTMLElement, clientX: number, clientY: number): HTMLElement | null {
    for (const cell of box.querySelectorAll<HTMLElement>(`[${ALTERNATIVE_CELL_ATTR}]`)) {
        const r = cell.getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return cell;
    }
    return null;
}
