import { describe, expect, it } from "vitest";
import { fallDistanceAt, fallEasing, fallMs, type FallParams } from "../theme/gravity";

/**
 * The shared fall math (src/theme/gravity.ts → `fallMs`, `fallDistanceAt`, `fallEasing`), which
 * every iso-world fall times itself by (docs/GRAVITY_LAB.md § 2).
 */

const P = (g: number, v0 = 0, j = 0): FallParams => ({ g, v0, j });

/** y(x) of a cubic bezier easing with P1 = (1/3, y1), P2 = (2/3, y2): x is linear in the parameter, so x = u. */
function bezierY(easing: string, x: number): number {
    const [, y1, , y2] = easing.match(/cubic-bezier\(([^)]+)\)/)![1].split(",").map(Number);
    const u = x;
    return 3 * (1 - u) ** 2 * u * y1 + 3 * (1 - u) * u * u * y2 + u ** 3;
}

const CASES: FallParams[] = [P(110), P(110, 25), P(60, 40), P(300, 5), P(110, 0, 300), P(1, 0, 1000), P(110, 20, 500)];

describe("fall math", () => {
    it("from rest with no jerk is the classic √(2d/g)", () => {
        expect(fallMs(55, P(110))).toBeCloseTo(Math.sqrt((2 * 55) / 110) * 1000, 6);
        expect(fallMs(0, P(110, 20, 300))).toBe(0);
    });

    it("fallMs and fallDistanceAt agree: falling for fallMs covers the distance", () => {
        for (const p of CASES) {
            for (const d of [0.3, 55, 240]) {
                expect(fallDistanceAt(fallMs(d, p) / 1000, p)).toBeCloseTo(d, 6);
            }
        }
    });

    it("start speed and jerk only ever shorten a fall", () => {
        expect(fallMs(55, P(110, 20))).toBeLessThan(fallMs(55, P(110)));
        expect(fallMs(55, P(110, 0, 300))).toBeLessThan(fallMs(55, P(110)));
    });

    it("with no start speed or jerk the easing is the old y = x² curve (1/3, 0), (2/3, 1/3)", () => {
        expect(fallEasing(55, P(110))).toBe("cubic-bezier(0.3333, 0.0000, 0.6667, 0.3333)");
    });

    it("the easing traces the real fall at every point, jerk included", () => {
        for (const p of CASES) {
            const d = 40;
            const total = fallMs(d, p) / 1000;
            const easing = fallEasing(d, p);
            for (const x of [0.1, 0.25, 0.5, 0.75, 0.9]) {
                expect(bezierY(easing, x)).toBeCloseTo(fallDistanceAt(x * total, p) / d, 3);
            }
        }
    });
});
