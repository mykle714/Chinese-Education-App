import { describe, expect, it } from "vitest";
import { eraseDiscFromStroke, eraseSweep } from "../components/handwriting/inkErase";
import type { Stroke } from "../components/handwriting/types";

/** A horizontal line from x = 0 to x = 100 at y = 50, sampled every `step`. */
const line = (step: number): Stroke => {
    const xs: number[] = [];
    for (let x = 0; x <= 100; x += step) xs.push(x);
    return { xs, ys: xs.map(() => 50), ts: xs.map((_, i) => i) };
};

describe("eraseDiscFromStroke", () => {
    it("returns the same stroke when the disc misses", () => {
        const s = line(10);
        expect(eraseDiscFromStroke(s, 50, 90, 5)[0]).toBe(s);
    });

    it("splits a stroke in two, cutting exactly on the circle", () => {
        const pieces = eraseDiscFromStroke(line(10), 50, 50, 5);
        expect(pieces).toHaveLength(2);
        expect(pieces[0].xs[pieces[0].xs.length - 1]).toBeCloseTo(45);
        expect(pieces[1].xs[0]).toBeCloseTo(55);
    });

    it("cuts a sparse stroke whose samples straddle the disc", () => {
        // Two samples, 100px apart: no sample is inside, but the segment crosses it.
        const pieces = eraseDiscFromStroke({ xs: [0, 100], ys: [50, 50], ts: [0, 1] }, 50, 50, 5);
        const rounded = pieces.map((p) => p.xs.map((x) => Math.round(x * 1000) / 1000));
        expect(rounded).toEqual([[0, 45], [55, 100]]);
    });

    it("trims an end", () => {
        const pieces = eraseDiscFromStroke(line(10), 100, 50, 15);
        expect(pieces).toHaveLength(1);
        expect(pieces[0].xs[pieces[0].xs.length - 1]).toBeCloseTo(85);
    });

    it("erases a dot inside the disc, keeps one outside", () => {
        const dot = { xs: [10], ys: [10], ts: [0] };
        expect(eraseDiscFromStroke(dot, 10, 12, 5)).toEqual([]);
        expect(eraseDiscFromStroke(dot, 40, 40, 5)[0]).toBe(dot);
    });
});

describe("eraseSweep", () => {
    it("erases a continuous band across a stroke", () => {
        const ink = [line(2)];
        const out = eraseSweep(ink, 20, 50, 80, 50, 5);
        expect(out).toHaveLength(2);
        expect(out[0].xs[out[0].xs.length - 1]).toBeCloseTo(15);
        expect(out[1].xs[0]).toBeCloseTo(85);
    });

    it("returns the same array when nothing is touched", () => {
        const ink = [line(10)];
        expect(eraseSweep(ink, 0, 0, 100, 0, 5)).toBe(ink);
    });
});
