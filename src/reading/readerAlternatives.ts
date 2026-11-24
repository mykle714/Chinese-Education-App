// Hit-testing on the Reader's Pinyin view (ReaderCpcdView):
//   - the tiebreak alternatives (the yellow boxes drawn over a losing word;
//     ReaderCpcdView § "Tiebreak alternatives");
//   - the character under a tap (READER_OFFSET_ATTR), for the tap-inside-the-selection
//     drill (readerDrill.ts; ReaderTapOverlay → `onTapInsideSelection`).
// Docs: docs/READER_SEGMENTATION.md § "Tiebreak alternatives", § "Phrase stepping".

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

// Every cpcd cell carries the content offset of the character it draws (ReaderCpcdView →
// buildParagraphs), so a tap can be resolved to a character.
export const READER_OFFSET_ATTR = "data-reader-offset";

/**
 * The content offset of the cpcd cell whose box contains the point, or null. Geometric for
 * the same reason as findAlternativeCellAt: a tap on the pinyin must count for its
 * character. Used by ReaderTapOverlay (mobile) and ReaderCpcdView's click-capture (desktop).
 */
export function findOffsetAt(box: HTMLElement, clientX: number, clientY: number): number | null {
    for (const cell of box.querySelectorAll<HTMLElement>(`[${READER_OFFSET_ATTR}]`)) {
        const r = cell.getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
            const offset = Number(cell.getAttribute(READER_OFFSET_ATTR));
            return Number.isFinite(offset) ? offset : null;
        }
    }
    return null;
}
