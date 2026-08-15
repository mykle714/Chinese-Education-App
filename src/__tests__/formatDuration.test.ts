import { describe, expect, it } from "vitest";
import { formatMinutesAsDuration } from "../utils/formatDuration";

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
