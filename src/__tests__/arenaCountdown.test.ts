import { describe, it, expect } from "vitest";
import { formatCountdownParts } from "../features/arena/arenaStyles";

/**
 * The arena countdown's formatting rule (docs/ARENA_FEATURE.md § 2.4).
 *
 * Worth testing because every failure mode here is SILENT and cosmetic-looking: a
 * countdown that renders "0d 19h" wastes the biggest slot on a zero, and one that
 * returns an empty list under a minute leaves the page's headline blank.
 */
describe("formatCountdownParts", () => {
    it("drops leading zero units but keeps trailing ones", () => {
        // 19h 40m 12s — no day part, per artboard A4.
        const ms = ((19 * 60 + 40) * 60 + 12) * 1000;
        expect(formatCountdownParts(ms)).toEqual([
            { value: 19, unit: "h" },
            { value: 40, unit: "m" },
            { value: 12, unit: "s" },
        ]);
    });

    it("keeps all four units once there is a day", () => {
        // 2d 4h 31m 8s — artboard A1.
        const ms = (((2 * 24 + 4) * 60 + 31) * 60 + 8) * 1000;
        expect(formatCountdownParts(ms)).toEqual([
            { value: 2, unit: "d" },
            { value: 4, unit: "h" },
            { value: 31, unit: "m" },
            { value: 8, unit: "s" },
        ]);
    });

    it("keeps an interior zero rather than collapsing the row", () => {
        // 1d 0h 5m 0s: only LEADING zeros are dropped. Collapsing the middle would
        // make "1d 5m" read as five minutes past one day.
        const ms = ((24 * 60 + 5) * 60) * 1000;
        expect(formatCountdownParts(ms)).toEqual([
            { value: 1, unit: "d" },
            { value: 0, unit: "h" },
            { value: 5, unit: "m" },
            { value: 0, unit: "s" },
        ]);
    });

    it("renders seconds alone under a minute", () => {
        expect(formatCountdownParts(8_000)).toEqual([{ value: 8, unit: "s" }]);
    });

    it("never yields an empty row at zero", () => {
        expect(formatCountdownParts(0)).toEqual([{ value: 0, unit: "s" }]);
    });

    it("clamps a past target to zero rather than counting negative", () => {
        // The page can outlive its own boundary by a poll interval; a "-1s" is worse
        // than a stopped clock.
        expect(formatCountdownParts(-90_000)).toEqual([{ value: 0, unit: "s" }]);
    });
});
