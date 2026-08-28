import { describe, it, expect } from "vitest";
import { computeRowWindow } from "../hooks/useWindowedRows";

// The decks grid's real lattice: three 92×132 cards per row, 16px flex gap.
const GEO = { itemCount: 470, perRow: 3, rowHeight: 132, rowGap: 16 };
const STRIDE = GEO.rowHeight + GEO.rowGap;

/** Height the grid's content box would have with every row mounted. */
const fullHeight = (itemCount: number, perRow: number, rowHeight: number, rowGap: number) => {
    const rows = Math.ceil(itemCount / perRow);
    return rows * rowHeight + Math.max(rows - 1, 0) * rowGap;
};

/**
 * Height the container ACTUALLY has with the window applied: the two spacers are flex
 * items, so each one that exists also brings one of the container's gaps with it.
 */
const windowedHeight = (
    win: ReturnType<typeof computeRowWindow>,
    { itemCount, perRow, rowHeight, rowGap }: typeof GEO,
) => {
    const renderedRows = Math.ceil((win.end - win.start) / perRow);
    let h = renderedRows > 0 ? renderedRows * rowHeight + (renderedRows - 1) * rowGap : 0;
    if (win.leadingPx > 0) h += win.leadingPx + (renderedRows > 0 ? rowGap : 0);
    if (win.trailingPx > 0) h += win.trailingPx + (renderedRows > 0 ? rowGap : 0);
    // Two spacers and nothing between them still have one gap of their own.
    if (renderedRows === 0 && win.leadingPx > 0 && win.trailingPx > 0) h += rowGap;
    void itemCount;
    return h;
};

describe("computeRowWindow", () => {
    it("mounts only the rows the band touches", () => {
        // A band covering rows 4..9 (y = 592..1480 at a 148px stride).
        const win = computeRowWindow(4 * STRIDE, 10 * STRIDE, GEO);
        expect(win.start).toBe(4 * 3);
        expect(win.end).toBe(10 * 3);
    });

    it("renders the whole list when the band covers it", () => {
        const win = computeRowWindow(0, 1e6, GEO);
        expect(win.start).toBe(0);
        expect(win.end).toBe(GEO.itemCount);
        expect(win.leadingPx).toBe(0);
        expect(win.trailingPx).toBe(0);
    });

    it("keeps the container's height identical to the un-windowed grid", () => {
        const expected = fullHeight(GEO.itemCount, GEO.perRow, GEO.rowHeight, GEO.rowGap);
        // Sweep the band down the whole list, including both ends and a band that has
        // scrolled clear past the grid (nothing rendered, two spacers).
        for (let top = -2000; top < expected + 2000; top += 97) {
            const win = computeRowWindow(top, top + 800, GEO);
            expect(windowedHeight(win, GEO)).toBe(expected);
        }
    });

    it("holds the height invariant for a partial last row", () => {
        // 470 cards = 156 full rows plus a row of 2 — the large test account's real shape.
        const geo = { ...GEO, itemCount: 470 };
        expect(geo.itemCount % geo.perRow).not.toBe(0);
        const win = computeRowWindow(0, STRIDE, geo);
        expect(win.end).toBe(3);
        expect(windowedHeight(win, geo)).toBe(
            fullHeight(geo.itemCount, geo.perRow, geo.rowHeight, geo.rowGap));
    });

    it("never returns an end before its start, even scrolled past the grid", () => {
        const win = computeRowWindow(1e6, 1e6 + 800, GEO);
        expect(win.start).toBe(GEO.itemCount);
        expect(win.end).toBe(GEO.itemCount);
        expect(win.trailingPx).toBe(0);
    });

    it("clamps a band that starts above the grid", () => {
        const win = computeRowWindow(-5000, 300, GEO);
        expect(win.start).toBe(0);
        expect(win.leadingPx).toBe(0);
    });

    it("is a no-op window for an empty list", () => {
        const win = computeRowWindow(0, 800, { ...GEO, itemCount: 0 });
        expect(win).toEqual({ start: 0, end: 0, leadingPx: 0, trailingPx: 0 });
    });
});
