import { describe, expect, it } from "vitest";
import { dilate, enclosedWater, erode, floodFromBorder } from "../games/memory-map/highlightMask";

/**
 * The pure pixel steps behind the Memory Map's highlight mask
 * (src/games/memory-map/highlightMask.ts; docs/MEMORY_MAP_GAME.md § 2.3). The canvas drawing
 * step needs a real browser and is not covered here.
 */

/** A w×h grid with a square ring (1px thick) from (a,a) to (b,b), optionally with a gap. */
function ringGrid(w: number, h: number, a: number, b: number, gapWidth = 0): Uint8Array {
    const g = new Uint8Array(w * h);
    for (let i = a; i <= b; i++) {
        g[a * w + i] = 1;
        g[b * w + i] = 1;
        g[i * w + a] = 1;
        g[i * w + b] = 1;
    }
    // Open a gap in the top edge, centred.
    const mid = Math.floor((a + b) / 2);
    for (let k = 0; k < gapWidth; k++) g[a * w + mid + k] = 0;
    return g;
}

const W = 20;
const H = 20;
const centre = 10 * W + 10;

describe("memory map highlight mask", () => {
    it("a closed ring leaves its interior unreached", () => {
        const reached = floodFromBorder(ringGrid(W, H, 4, 15), W, H);
        expect(reached[0]).toBe(1);
        expect(reached[centre]).toBe(0);
    });

    it("an open ring floods its interior", () => {
        const reached = floodFromBorder(ringGrid(W, H, 4, 15, 3), W, H);
        expect(reached[centre]).toBe(1);
    });

    it("dilation by 1 closes a 2px opening but not a 4px one", () => {
        const narrow = floodFromBorder(dilate(ringGrid(W, H, 4, 15, 2), W, H, 1), W, H);
        expect(narrow[centre]).toBe(0);
        const wide = floodFromBorder(dilate(ringGrid(W, H, 4, 15, 4), W, H, 1), W, H);
        expect(wide[centre]).toBe(1);
    });

    it("dilate grows a single pixel into a (2r+1)² square", () => {
        const g = new Uint8Array(W * H);
        g[centre] = 1;
        const out = dilate(g, W, H, 2);
        expect(out.reduce((s, v) => s + v, 0)).toBe(25);
        expect(out[8 * W + 8]).toBe(1);
        expect(out[7 * W + 10]).toBe(0);
    });

    it("fills a pocket narrower than the tolerance (a bare dilation swallowed it)", () => {
        // A thick block with a 1px pocket in the middle: the pocket is all there is.
        const g = new Uint8Array(W * H);
        for (let y = 6; y <= 14; y++) for (let x = 6; x <= 14; x++) g[y * W + x] = 1;
        g[centre] = 0;
        const result = enclosedWater(g, W, H, 2);
        expect(result).not.toBeNull();
        expect(result!.grown[centre]).toBe(1);
        expect(result!.grown.reduce((s, v) => s + v, 0)).toBe(1);
    });

    it("fills a ring sealed by the tolerance, but never the outside water", () => {
        const sealed = enclosedWater(ringGrid(W, H, 4, 15, 2), W, H, 1);
        expect(sealed!.grown[centre]).toBe(1);
        expect(sealed!.grown[0]).toBe(0);
        expect(sealed!.grown[2 * W + 10]).toBe(0);
        expect(enclosedWater(ringGrid(W, H, 4, 15, 4), W, H, 1)).toBeNull();
    });

    it("erode undoes dilate on a solid block", () => {
        const g = new Uint8Array(W * H);
        for (let y = 6; y <= 14; y++) for (let x = 6; x <= 14; x++) g[y * W + x] = 1;
        expect(Array.from(erode(dilate(g, W, H, 2), W, H, 2))).toEqual(Array.from(g));
    });
});
