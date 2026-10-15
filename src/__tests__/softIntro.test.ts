import { describe, expect, it } from "vitest";
import { hasMetThresholds, recordVisit, type SoftIntroRecord } from "../softIntro/softIntroStorage";
import { VISIT_DEDUPE_MS, type SoftIntroSpec } from "../softIntro/softIntroRegistry";

// The pure half of the soft-introduction system (docs/SOFT_INTRODUCTION.md § 3):
// visit counting with its dedupe window, and the BOTH-thresholds graduation rule.

const DAY = 24 * 60 * 60 * 1000;
const SPEC: SoftIntroSpec = { minVisits: 5, minDays: 3, description: "test" };
const T0 = 1_760_000_000_000;

/** `count` visits spaced `gap` ms apart, starting at T0. */
function visits(count: number, gap: number): SoftIntroRecord {
    let record: SoftIntroRecord | undefined;
    for (let i = 0; i < count; i++) record = recordVisit(record, T0 + i * gap);
    return record!;
}

describe("recordVisit", () => {
    it("starts a record on the first visit", () => {
        expect(recordVisit(undefined, T0)).toEqual({ firstVisitAt: T0, lastVisitAt: T0, visits: 1 });
    });

    it("ignores a visit inside the dedupe window (returns the same object)", () => {
        const first = recordVisit(undefined, T0);
        expect(recordVisit(first, T0 + VISIT_DEDUPE_MS - 1)).toBe(first);
    });

    it("counts a visit once the window has passed, keeping firstVisitAt", () => {
        const second = recordVisit(recordVisit(undefined, T0), T0 + VISIT_DEDUPE_MS);
        expect(second).toEqual({ firstVisitAt: T0, lastVisitAt: T0 + VISIT_DEDUPE_MS, visits: 2 });
    });
});

describe("hasMetThresholds", () => {
    it("is false with no record", () => {
        expect(hasMetThresholds(undefined, SPEC, T0)).toBe(false);
    });

    it("needs the visits even when the days have passed", () => {
        const record = visits(4, DAY);
        expect(hasMetThresholds(record, SPEC, T0 + 30 * DAY)).toBe(false);
    });

    it("needs the days even when the visits are in", () => {
        const record = visits(10, VISIT_DEDUPE_MS);
        expect(hasMetThresholds(record, SPEC, T0 + 3 * DAY - 1)).toBe(false);
    });

    it("graduates once both are met", () => {
        const record = visits(5, VISIT_DEDUPE_MS);
        expect(hasMetThresholds(record, SPEC, T0 + 3 * DAY)).toBe(true);
    });

    it("stays graduated once stamped, even under stricter thresholds", () => {
        const record: SoftIntroRecord = { ...visits(1, 0), graduatedAt: T0 };
        expect(hasMetThresholds(record, { ...SPEC, minVisits: 99 }, T0)).toBe(true);
    });
});
