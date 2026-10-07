import { describe, expect, it } from "vitest";
import { distanceToLine, inkInRect, maskFromAlpha, placeStrokeNumbers } from "../features/flashcards/writingNotebook/strokeNumberPlacement";

/** RGBA buffer with ink (alpha 255) wherever `isInk(x, y)`. */
function rgba(size: number, isInk: (x: number, y: number) => boolean): Uint8ClampedArray {
    const data = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (isInk(x, y)) data[(y * size + x) * 4 + 3] = 255;
    return data;
}

const SIZE = 100;
const FONT = 12;
const box = (p: { x: number; y: number }, n: number) => {
    const hw = (String(n).length * 0.6 * FONT) / 2;
    const hh = (0.75 * FONT) / 2;
    return { x0: p.x - hw, y0: p.y - hh, x1: p.x + hw, y1: p.y + hh };
};

describe("ink mask", () => {
    it("counts ink inside a rectangle", () => {
        const mask = maskFromAlpha(rgba(SIZE, (x, y) => x >= 10 && x < 20 && y >= 10 && y < 20), SIZE, SIZE);
        expect(inkInRect(mask, 0, 0, SIZE, SIZE)).toBe(100);
        expect(inkInRect(mask, 15, 15, 25, 25)).toBe(25);
        expect(inkInRect(mask, 50, 50, 60, 60)).toBe(0);
    });
});

describe("placeStrokeNumbers", () => {
    it("keeps a number off the shadow's ink", () => {
        // A horizontal bar across the middle; the stroke starts on its left end.
        const mask = maskFromAlpha(rgba(SIZE, (_x, y) => y >= 45 && y < 55), SIZE, SIZE);
        const [p] = placeStrokeNumbers([[[20, 50], [80, 50]]], { size: SIZE, fontPx: FONT, pad: 1, masks: { union: mask, strokes: [maskFromAlpha(rgba(SIZE, () => false), SIZE, SIZE, true)] } });
        const b = box(p, 1);
        expect(inkInRect(mask, b.x0, b.y0, b.x1, b.y1)).toBe(0);
        expect(distanceToLine(p.x, p.y, [[20, 50], [80, 50]])).toBeLessThan(1.5 * FONT);
    });

    it("sits on the shadow rather than travel past its reach to a clear spot", () => {
        // A band 60px thick; the nearest clear spot is ~2.5 type sizes from the head.
        const mask = maskFromAlpha(rgba(SIZE, (_x, y) => y >= 20 && y < 80), SIZE, SIZE);
        const line: [number, number][] = [[30, 50], [70, 50]];
        const [p] = placeStrokeNumbers([line], { size: SIZE, fontPx: FONT, pad: 1, masks: { union: mask, strokes: [maskFromAlpha(rgba(SIZE, () => false), SIZE, SIZE, true)] } });
        expect(distanceToLine(p.x, p.y, line)).toBeLessThanOrEqual(1.5 * FONT + 1e-6);
    });

    it("may sit anywhere along its stroke, but not nearer another stroke", () => {
        // Two parallel bars; stroke 1 starts at the top-left corner, crowded by stroke 2's
        // start just below it, so the number moves along stroke 1 to the right.
        const lines: [number, number][][] = [
            [[10, 30], [90, 30]],
            [[10, 45], [90, 45]],
        ];
        const placed = placeStrokeNumbers(lines, { size: SIZE, fontPx: FONT, pad: 1, masks: null });
        placed.forEach((p, i) => {
            const own = distanceToLine(p.x, p.y, lines[i]);
            const other = distanceToLine(p.x, p.y, lines[1 - i]);
            expect(own).toBeLessThanOrEqual(other);
        });
    });

    it("never covers its own stroke, and prefers touching fewer other strokes", () => {
        // Stroke 1: horizontal bar y 45..55. Stroke 2: vertical bar x 45..55 crossing it.
        const own = rgba(SIZE, (_x, y) => y >= 45 && y < 55);
        const other = rgba(SIZE, (x) => x >= 45 && x < 55);
        const union = rgba(SIZE, (x, y) => (y >= 45 && y < 55) || (x >= 45 && x < 55));
        const masks = {
            union: maskFromAlpha(union, SIZE, SIZE),
            strokes: [maskFromAlpha(own, SIZE, SIZE, true), maskFromAlpha(other, SIZE, SIZE, true)],
        };
        const lines: [number, number][][] = [[[10, 50], [90, 50]], [[50, 10], [50, 90]]];
        const [p] = placeStrokeNumbers(lines, { size: SIZE, fontPx: FONT, pad: 1, masks });
        const b = box(p, 1);
        expect(inkInRect(masks.strokes[0], b.x0 - 1, b.y0 - 1, b.x1 + 1, b.y1 + 1)).toBe(0);
        expect(inkInRect(masks.strokes[1], b.x0 - 1, b.y0 - 1, b.x1 + 1, b.y1 + 1)).toBe(0);
    });

    it("keeps clear of a parallel stroke it could be confused with", () => {
        // Strokes 1 and 2 are parallel 20px apart; the number should sit on stroke 1's
        // far side, not in the gap where it reads as either's.
        const lines: [number, number][][] = [[[20, 50], [80, 50]], [[20, 70], [80, 70]]];
        const [p] = placeStrokeNumbers(lines, { size: SIZE, fontPx: FONT, pad: 1, masks: null });
        expect(p.y).toBeLessThan(50);
    });

    it("never stacks two numbers whose strokes share a head", () => {
        const heads: [number, number][][] = [
            [[30, 30], [70, 30]],
            [[30, 30], [30, 70]],
            [[31, 30], [70, 70]],
        ];
        const placed = placeStrokeNumbers(heads, { size: SIZE, fontPx: FONT, pad: 1, masks: null });
        for (let i = 0; i < placed.length; i++) {
            for (let j = i + 1; j < placed.length; j++) {
                const a = box(placed[i], i + 1);
                const b = box(placed[j], j + 1);
                const overlap = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
                expect(overlap).toBe(0);
            }
        }
    });

    it("stays inside the cell for a head on the edge", () => {
        const [p] = placeStrokeNumbers([[[0, 0], [40, 0]]], { size: SIZE, fontPx: FONT, pad: 1, masks: null });
        const b = box(p, 1);
        expect(b.x0).toBeGreaterThanOrEqual(0);
        expect(b.y0).toBeGreaterThanOrEqual(0);
    });
});
