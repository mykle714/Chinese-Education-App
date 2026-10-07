import { describe, expect, it } from "vitest";
import { bowedChars, shapeFromMeasure, type MeasuredWord } from "../games/memory-map/glyphShapes";
import { bowShape } from "../../server/services/memoryMapLayout";
import { OUTLINE_PX, PIXELS_PER_WORLD_UNIT } from "../games/memory-map/constants";

/**
 * glyphShapes.ts → shapeFromMeasure (docs/MEMORY_MAP_GAME.md § 2.3): a measured word
 * becomes the layout's collision boxes. The measuring itself needs a real canvas and
 * font, so it is not covered here; this pins the conversion both the layout and the
 * renderer depend on.
 */

const outline = OUTLINE_PX / PIXELS_PER_WORLD_UNIT;

// Two square glyphs, 1em advance each, ink 0.1em inside each side, baseline at 0.88em.
const measured: MeasuredWord = {
    width: 2,
    baseline: 0.88,
    chars: [
        { char: "你", x: 0, advance: 1, inkLeft: -0.1, inkRight: 0.9, inkAscent: 0.8, inkDescent: 0.05 },
        { char: "好", x: 1, advance: 1, inkLeft: -0.1, inkRight: 0.9, inkAscent: 0.8, inkDescent: 0.05 },
    ],
};

describe("shapeFromMeasure", () => {
    it("places one box per character's ink, relative to the line-box centre", () => {
        const [a, b] = shapeFromMeasure(measured, 1);
        // Ink of 你 spans x 0.1..0.9 → centre 0.5, i.e. −0.5 from the word's centre at 1.
        expect(a.dx).toBeCloseTo(-0.5);
        expect(b.dx).toBeCloseTo(0.5);
        // Ink spans y 0.08..0.93 → centre 0.505, i.e. +0.005 from the line centre.
        expect(a.dy).toBeCloseTo(0.005);
    });

    it("scales ink with the slot but adds the outline unscaled", () => {
        const [one] = shapeFromMeasure(measured, 1);
        const [two] = shapeFromMeasure(measured, 2);
        expect(one.width).toBeCloseTo(0.8 + 2 * outline);
        expect(two.width).toBeCloseTo(1.6 + 2 * outline);
        expect(two.dx).toBeCloseTo(one.dx * 2);
    });

    it("gives an inkless character (a space) no box", () => {
        const spaced: MeasuredWord = {
            ...measured,
            chars: [
                measured.chars[0],
                { char: " ", x: 1, advance: 0.3, inkLeft: 0, inkRight: 0, inkAscent: 0, inkDescent: 0 },
            ],
        };
        expect(shapeFromMeasure(spaced, 1)).toHaveLength(1);
    });

    it("pivots each box at its advance centre", () => {
        const [a, b] = shapeFromMeasure(measured, 2);
        expect(a.pivotDx).toBeCloseTo(-1);
        expect(b.pivotDx).toBeCloseTo(1);
    });
});

describe("bowedChars", () => {
    it("draws the same arc the layout collides", () => {
        const scale = 1.5;
        const drawn = bowedChars(measured, 12);
        const collided = bowShape(shapeFromMeasure(measured, scale), 12);
        drawn.forEach((d, i) => {
            expect(d.rotate).toBeCloseTo(collided[i].rotate ?? 0);
            // Pivot = span left + pivotOffsetEm; the ink box is the turned offset from it.
            expect(d.pivotOffsetEm).toBeCloseTo(0.5);
        });
        expect(drawn[1].rotate).toBeLessThan(0); // smile: right end turns up
    });

    it("leaves a one-character word straight", () => {
        const one: MeasuredWord = { width: 1, baseline: 0.88, chars: [measured.chars[0]] };
        expect(bowedChars(one, 15)).toEqual([{ dy: 0, rotate: 0, pivotOffsetEm: 0.5 }]);
    });
});
