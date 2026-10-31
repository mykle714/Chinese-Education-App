import { describe, expect, it } from "vitest";
import { seamHeights } from "../iso/cardStackMetrics";

describe("seamHeights", () => {
    it("spaces seams uniformly, 2 per 5 cards, down from the top card", () => {
        const heights = seamHeights(0, 21, 21);
        expect(heights.slice(0, 3)).toEqual([20, 17.5, 15]);
        const gaps = heights.slice(1).map((h, i) => heights[i] - h);
        expect(new Set(gaps)).toEqual(new Set([2.5]));
    });

    it("lands on the top card's underside whatever the deck size", () => {
        for (const count of [2, 7, 40, 41, 42, 43, 44]) expect(seamHeights(0, count, count)).toContain(count - 1);
    });

    it("never draws a seam at the floor", () => {
        expect(seamHeights(0, 12, 11)).not.toContain(0);
    });

    it("is half-open: includes fromCards, excludes toCards", () => {
        expect(seamHeights(15, 20, 21)).toEqual([17.5, 15]);
    });

    it("carries the grid on above the settled top during a collapse", () => {
        expect(seamHeights(21, 26, 21)).toEqual([25, 22.5]);
    });

    it("returns nothing for an empty range", () => {
        expect(seamHeights(5, 5, 21)).toEqual([]);
    });
});
