import { describe, expect, it } from "vitest";
import { formatCooldownRemaining, formatMinutesAsDuration } from "../utils/formatDuration";

/**
 * Tests for the shared minute-points duration formatter (src/utils/formatDuration.ts).
 *
 * The interesting cases are all about which units are ALLOWED TO VANISH: a leading
 * zero unit must go ("1h 30m", not "0d 1h 30m"), a middle one must stay ("1d 0h 5m",
 * never the ambiguous "1d 5m"), and the minutes place must always print so a balance
 * can never render as an empty string.
 */
describe("formatMinutesAsDuration", () => {
    it("renders a sub-hour balance as plain minutes", () => {
        expect(formatMinutesAsDuration(0)).toBe("0m");
        expect(formatMinutesAsDuration(1)).toBe("1m");
        expect(formatMinutesAsDuration(59)).toBe("59m");
    });

    it("drops leading zero units but keeps middle ones", () => {
        expect(formatMinutesAsDuration(90)).toBe("1h 30m");
        expect(formatMinutesAsDuration(60)).toBe("1h 0m");
        // 1d 1h 0m — the zero minutes place stays rather than reading "1d 1h".
        expect(formatMinutesAsDuration(1500)).toBe("1d 1h 0m");
        // 1d 0h 5m — the zero HOURS place stays, or this would look like 1d 5m ≈ 1d.
        expect(formatMinutesAsDuration(1445)).toBe("1d 0h 5m");
    });

    it("leaves days uncollapsed unless weeks are requested", () => {
        // 10080 = exactly 7 days. Default: no week unit, so it stays 7d.
        expect(formatMinutesAsDuration(10080)).toBe("7d 0h 0m");
        expect(formatMinutesAsDuration(10080, { weeks: true })).toBe("1w 0d 0h 0m");
    });

    it("breaks long balances into weeks when asked", () => {
        // 7w 1d 2h 3m = 7*10080 + 1440 + 120 + 3
        expect(formatMinutesAsDuration(7 * 10080 + 1440 + 120 + 3, { weeks: true }))
            .toBe("7w 1d 2h 3m");
        // Under a week, the week unit is absent rather than printed as 0w.
        expect(formatMinutesAsDuration(1440, { weeks: true })).toBe("1d 0h 0m");
    });

    it("renders a nonsense balance as 0m rather than NaN", () => {
        expect(formatMinutesAsDuration(-5)).toBe("0m");
        expect(formatMinutesAsDuration(NaN)).toBe("0m");
        // Fractional minutes floor rather than leaking a decimal into the copy.
        expect(formatMinutesAsDuration(90.7)).toBe("1h 30m");
    });
});

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const WEEK = 7 * DAY;
const MONTH = 30 * DAY;

/**
 * Tests for the cdp cooldown countdown (src/features/flashcards/MasteryProgressBar.tsx).
 *
 * Same "which units may vanish" question as the balance formatter above, one unit
 * wider at each end: a leading zero unit must go, a middle one must stay (otherwise
 * six months reads as six minutes — `m` is both), and the seconds place always prints
 * so a ready track renders 0s rather than an empty string.
 */
describe("formatCooldownRemaining", () => {
    it("prints every unit from the largest non-zero one down to seconds", () => {
        expect(formatCooldownRemaining(4 * MONTH + WEEK + 3 * DAY + 5 * HOUR + 37 * MIN + 26 * SEC))
            .toBe("4m 1w 3d 5h 37m 26s");
        expect(formatCooldownRemaining(3 * HOUR + 12 * MIN + 7 * SEC)).toBe("3h 12m 7s");
        expect(formatCooldownRemaining(5 * MIN)).toBe("5m 0s");
        expect(formatCooldownRemaining(9 * SEC)).toBe("9s");
    });

    it("keeps zero MIDDLE units so months can't be misread as minutes", () => {
        // The four cooldown windows: Unfamiliar 5m, Target 24h, Comfortable 14d,
        // Mastered 180d (= exactly 6 months at a flat 30 days).
        expect(formatCooldownRemaining(DAY)).toBe("1d 0h 0m 0s");
        expect(formatCooldownRemaining(14 * DAY)).toBe("2w 0d 0h 0m 0s");
        expect(formatCooldownRemaining(180 * DAY)).toBe("6m 0w 0d 0h 0m 0s");
        // Without the middle zeros this would be the ambiguous "6m 26s".
        expect(formatCooldownRemaining(6 * MONTH + 26 * SEC)).toBe("6m 0w 0d 0h 0m 26s");
    });

    it("rounds partial seconds UP so a live window never reads 0s", () => {
        expect(formatCooldownRemaining(1)).toBe("1s");
        expect(formatCooldownRemaining(999)).toBe("1s");
    });

    it("renders an elapsed or nonsense remainder as 0s", () => {
        expect(formatCooldownRemaining(0)).toBe("0s");
        expect(formatCooldownRemaining(-5 * MIN)).toBe("0s");
        expect(formatCooldownRemaining(NaN)).toBe("0s");
    });
});
