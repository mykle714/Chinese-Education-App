import { describe, expect, it } from "vitest";
import {
    NOTEBOOK_TOP_PAD,
    currentPage,
    isPageFull,
    jumpScrollTop,
    mountedRows,
    notebookGeometry,
    pageRange,
    pagesForRows,
    rowCountFor,
    rowTop,
} from "../features/flashcards/writingNotebook/notebookLayout";

describe("notebookGeometry", () => {
    it("fits four touching cells inside the side margins, sharing one-pixel edges", () => {
        // 402 − 2·16 = 370; (370 + 3) / 4 → 93px cells, 92px pitch, 4·92 + 1 = 369 wide,
        // centred: (402 − 369) / 2 → 16px left edge.
        expect(notebookGeometry(402)).toEqual({ cellSize: 93, pitch: 92, gridWidth: 369, gridLeft: 16 });
    });
});

describe("virtualisation", () => {
    it("mounts the visible rows plus overscan, clamped to the sheet", () => {
        expect(mountedRows(0, 600, 94, 20)).toEqual({ first: 0, last: 10 });
        expect(mountedRows(rowTop(15, 94), 600, 94, 20)).toEqual({ first: 11, last: 19 });
    });

    it("always holds a page beyond the deepest row seen", () => {
        expect(rowCountFor(0)).toBe(20);
        expect(rowCountFor(9)).toBe(20);
        expect(rowCountFor(10)).toBe(30);
    });

    it("maps rows to pages and pages to cell ranges", () => {
        expect(pagesForRows(8, 12)).toEqual([0, 1]);
        expect(pageRange(2)).toEqual({ from: 80, to: 120 });
    });

    it("reads the current page off the viewport's middle row", () => {
        expect(currentPage(0, 600, 94)).toBe(0);
        expect(currentPage(rowTop(10, 94), 600, 94)).toBe(1);
    });
});

describe("isPageFull", () => {
    it("needs every cell of the page", () => {
        const filled = new Set(Array.from({ length: 40 }, (_, i) => i));
        expect(isPageFull(0, filled)).toBe(true);
        filled.delete(17);
        expect(isPageFull(0, filled)).toBe(false);
    });
});

describe("jumpScrollTop", () => {
    it("shows two rows above the target row", () => {
        // Cell 85 is row 21; rows 19 and 20 sit above it.
        expect(jumpScrollTop(85, 94)).toEqual({ row: 21, scrollTop: rowTop(19, 94) - NOTEBOOK_TOP_PAD });
    });

    it("clamps to the top of the sheet", () => {
        expect(jumpScrollTop(5, 94)).toEqual({ row: 1, scrollTop: 0 });
    });
});
