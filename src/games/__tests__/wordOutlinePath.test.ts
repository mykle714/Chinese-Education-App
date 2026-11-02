import { describe, expect, it } from "vitest";
import { wordOutlinePath } from "../word-search/wordOutlinePath";
import type { Coord } from "../word-search/types";

const GEOMETRY = { cellSide: 40, gap: 4, origin: 4, outset: 2, radius: 5, concaveRadius: 3 };
const loopCount = (d: string) => d.match(/M/g)?.length ?? 0;
const cornerCount = (d: string) => d.match(/A/g)?.length ?? 0;

describe("wordOutlinePath", () => {
    it("draws nothing for no cells", () => {
        expect(wordOutlinePath([], GEOMETRY)).toBe("");
    });

    it("draws a lone tile as a rounded square outside its edges", () => {
        const d = wordOutlinePath([[0, 0]], GEOMETRY);
        expect(cornerCount(d)).toBe(4);
        expect(d.startsWith("M")).toBe(true);
        expect(d).toContain("46"); // right/bottom line: 4 + 40 + 2
    });

    it("spans the gutter of a straight word with one four-cornered loop", () => {
        const d = wordOutlinePath([[0, 0], [0, 1], [0, 2]], GEOMETRY);
        expect(loopCount(d)).toBe(1);
        expect(cornerCount(d)).toBe(4);
        expect(d).toContain("134"); // right line: 4 + 2*44 + 40 + 2
    });

    it("turns an L into six corners, one of them concave", () => {
        const d = wordOutlinePath([[0, 0], [1, 0], [1, 1]], GEOMETRY);
        expect(cornerCount(d)).toBe(6);
        expect(d.match(/A3 3 0 0 0/g)).toHaveLength(1);
    });

    it("treats a 2×2 block as solid rather than tracing its inner gutter", () => {
        const d = wordOutlinePath([[0, 0], [0, 1], [1, 1], [1, 0]], GEOMETRY);
        expect(loopCount(d)).toBe(1);
        expect(cornerCount(d)).toBe(4);
    });

    it("gives a ring a second loop for its hole", () => {
        const ring: Coord[] = [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2], [2, 1], [2, 0], [1, 0]];
        expect(loopCount(wordOutlinePath(ring, GEOMETRY))).toBe(2);
    });

    it("keeps tiles touching only at a corner as separate loops", () => {
        expect(loopCount(wordOutlinePath([[0, 0], [1, 1]], GEOMETRY))).toBe(2);
    });
});
