import { describe, expect, it } from "vitest";
import { relativeSpineHeights, SPINE_MIN_HEIGHT_STEP, SPINE_VARIANTS } from "../components/shelf/spineGeometry";

// Covers src/components/shelf/spineGeometry.ts → relativeSpineHeights
// (docs/SHELF_REDESIGN.md § A3, "Spine heights are relative to the row").
const FLOOR = SPINE_VARIANTS.short.height;
const CEIL = SPINE_VARIANTS.tall.height;

describe("relativeSpineHeights", () => {
    it("separates close counts (the 9 vs 12 case)", () => {
        expect(relativeSpineHeights([43, 9, 12, 9])).toEqual([140, 70, 84, 70]);
    });

    it("puts the max on the ceiling and empty sets on the floor", () => {
        const h = relativeSpineHeights([0, 5, 200, 0]);
        expect(h[2]).toBe(CEIL);
        expect(h[0]).toBe(FLOOR);
        expect(h[3]).toBe(FLOOR);
    });

    it("renders an all-empty row flat on the floor", () => {
        expect(relativeSpineHeights([0, 0, 0, 0])).toEqual([FLOOR, FLOOR, FLOOR, FLOOR]);
    });

    it("keeps order, ties level, and every gap at least the minimum step", () => {
        const counts = [100, 99, 98, 97];
        const h = relativeSpineHeights(counts);
        const sorted = [...h].sort((a, b) => a - b);
        for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(SPINE_MIN_HEIGHT_STEP - 1);
        expect(h[0]).toBe(CEIL);
        expect(Math.min(...h)).toBeGreaterThanOrEqual(FLOOR);
        expect(relativeSpineHeights([7, 7, 3, 7]).filter((x) => x === CEIL)).toHaveLength(3);
    });
});
