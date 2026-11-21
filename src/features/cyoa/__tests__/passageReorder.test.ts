import { describe, expect, it } from "vitest";
import { dropIndex, moveItem, rowShift } from "../passageReorder";

/** Tests for the passage-list drag maths (src/features/cyoa/passageReorder.ts). */

// Three 40px rows, 8px apart: centres at 20, 68, 116.
const rows = [{ top: 0, height: 40 }, { top: 48, height: 40 }, { top: 96, height: 40 }];

describe("passageReorder", () => {
    it("lands the row after every centre it has passed", () => {
        expect(dropIndex(rows, 0, 0)).toBe(0);
        expect(dropIndex(rows, 0, 47)).toBe(0); // centre 67 — not yet past row 1 (68)
        expect(dropIndex(rows, 0, 49)).toBe(1);
        expect(dropIndex(rows, 0, 200)).toBe(2);
        expect(dropIndex(rows, 2, -100)).toBe(0);
    });

    it("steps the passed rows aside by the dragged height plus the gap", () => {
        expect([0, 1, 2].map((i) => rowShift(rows, 0, 2, i, 8))).toEqual([0, -48, -48]);
        expect([0, 1, 2].map((i) => rowShift(rows, 2, 1, i, 8))).toEqual([0, 48, 0]);
        expect([0, 1, 2].map((i) => rowShift(rows, 1, 1, i, 8))).toEqual([0, 0, 0]);
    });

    it("moves one item", () => {
        expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
        expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    });
});
