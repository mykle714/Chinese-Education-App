import { describe, expect, it } from "vitest";
import { accuracyTierFor, formatAccuracy, gradeSpeed, speedTierFor } from "../runTiers";

// The engine half of docs/GAMES_FEATURE.md § Run tiers: seven tiers, 1 is the best,
// and every value lands on one.
const SPEED = { maxMs: [10, 20, 30, 40, 50, 60] } as const;
const ACCURACY = { minRatio: [1, 0.9, 0.8, 0.7, 0.6, 0.5] } as const;

describe("speedTierFor", () => {
    it("is inclusive of each cutoff, best-first", () => {
        expect(speedTierFor(0, SPEED)).toBe(1);
        expect(speedTierFor(10, SPEED)).toBe(1);
        expect(speedTierFor(11, SPEED)).toBe(2);
        expect(speedTierFor(60, SPEED)).toBe(6);
    });

    it("puts anything past the last cutoff on tier 7", () => {
        expect(speedTierFor(61, SPEED)).toBe(7);
        expect(speedTierFor(Number.MAX_SAFE_INTEGER, SPEED)).toBe(7);
    });
});

describe("accuracyTierFor", () => {
    it("grades the right-answer share, best-first", () => {
        expect(accuracyTierFor(10, 10, ACCURACY)).toBe(1);
        expect(accuracyTierFor(9, 10, ACCURACY)).toBe(2);
        expect(accuracyTierFor(5, 10, ACCURACY)).toBe(6);
        expect(accuracyTierFor(4, 10, ACCURACY)).toBe(7);
    });

    it("reads zero attempts as perfect", () => {
        expect(accuracyTierFor(0, 0, ACCURACY)).toBe(1);
    });
});

describe("gradeSpeed", () => {
    it("grades a scaled time but keeps the real one for display", () => {
        expect(gradeSpeed(15, SPEED, 25)).toEqual({ tier: 3, elapsedMs: 15 });
    });
});

describe("formatAccuracy", () => {
    it("shows the fraction and the rounded percentage", () => {
        expect(formatAccuracy(28, 30)).toBe("28/30 · 93%");
        expect(formatAccuracy(0, 0)).toBe("0/0 · 100%");
    });
});
