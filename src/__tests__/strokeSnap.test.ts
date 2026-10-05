import { describe, expect, it } from "vitest";
import { guideToCanvas, medianToStroke, strokeMatchesMedian } from "../components/handwriting/strokeSnap";
import type { Stroke } from "../components/handwriting/types";

/**
 * Snap's matcher (docs/PRACTICE_WRITING.md § "Snap"). 一's single stroke from the
 * hanzi-writer-data corpus, in font units (y-up).
 */
const YI_MEDIAN = [[121, 393], [193, 372], [417, 402], [827, 434], [920, 401]];
const SIZE = 300;

/** The median drawn on the canvas, densely, as a learner's stroke would be sampled. */
function drawnAlong(median: number[][], offset: [number, number] = [0, 0]): Stroke {
    const map = guideToCanvas(SIZE);
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < median.length - 1; i++) {
        const [ax, ay] = map.point(median[i]);
        const [bx, by] = map.point(median[i + 1]);
        for (let t = 0; t < 10; t++) {
            xs.push(ax + ((bx - ax) * t) / 10 + offset[0]);
            ys.push(ay + ((by - ay) * t) / 10 + offset[1]);
        }
    }
    return { xs, ys, ts: xs.map((_, i) => i * 8) };
}

describe("strokeMatchesMedian (Snap)", () => {
    it("accepts the stroke drawn where it belongs, with a little wobble", () => {
        expect(strokeMatchesMedian(drawnAlong(YI_MEDIAN, [4, -6]), YI_MEDIAN, SIZE)).toBe(true);
    });
    it("rejects the right shape in the wrong place", () => {
        expect(strokeMatchesMedian(drawnAlong(YI_MEDIAN, [0, 110]), YI_MEDIAN, SIZE)).toBe(false);
    });
    it("rejects the stroke drawn backwards", () => {
        const forward = drawnAlong(YI_MEDIAN);
        const backward: Stroke = { xs: [...forward.xs].reverse(), ys: [...forward.ys].reverse(), ts: forward.ts };
        expect(strokeMatchesMedian(backward, YI_MEDIAN, SIZE)).toBe(false);
    });
    it("rejects a much shorter stroke", () => {
        const half = drawnAlong(YI_MEDIAN.slice(0, 2));
        expect(strokeMatchesMedian(half, YI_MEDIAN, SIZE)).toBe(false);
    });
});

describe("medianToStroke", () => {
    it("lands on the median's canvas points and keeps the drawn stroke's time span", () => {
        const drawn = drawnAlong(YI_MEDIAN);
        const snapped = medianToStroke(YI_MEDIAN, SIZE, drawn);
        const first = guideToCanvas(SIZE).point(YI_MEDIAN[0]);
        expect(snapped.xs[0]).toBeCloseTo(first[0]);
        expect(snapped.ys[0]).toBeCloseTo(first[1]);
        expect(snapped.ts[0]).toBe(drawn.ts[0]);
        expect(snapped.ts[snapped.ts.length - 1]).toBe(drawn.ts[drawn.ts.length - 1]);
    });
});
