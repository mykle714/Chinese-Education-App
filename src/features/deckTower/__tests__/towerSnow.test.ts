import { describe, it, expect } from "vitest";
import { BARE_CLOCK, clearedClock, settleOnEntry, SNOW_SETTLES_AFTER_MS, snowKey } from "../towerSnow";

/** towerSnow.ts (docs/TOWER_SNOW.md § "The rule"). */
describe("settleOnEntry", () => {
    const now = 1_000_000_000_000;

    it("snows over a never-cleared component when it is snowing", () => {
        expect(settleOnEntry(BARE_CLOCK, { snowing: true, now }).snowy).toBe(true);
    });

    it("never snows over anything when it is not snowing", () => {
        expect(settleOnEntry(BARE_CLOCK, { snowing: false, now }).snowy).toBe(false);
    });

    it("needs 6 h since the last clear", () => {
        const justUnder = clearedClock(now - SNOW_SETTLES_AFTER_MS + 1);
        const exactly = clearedClock(now - SNOW_SETTLES_AFTER_MS);
        expect(settleOnEntry(justUnder, { snowing: true, now }).snowy).toBe(false);
        expect(settleOnEntry(exactly, { snowing: true, now }).snowy).toBe(true);
    });

    it("keeps a snowy component snowy once the snow has stopped", () => {
        const snowy = { lastClearedAt: now - 10, snowy: true };
        expect(settleOnEntry(snowy, { snowing: false, now })).toEqual(snowy);
    });

    it("shows a tower above the clouds bare, without counting it as a clear", () => {
        const snowy = { lastClearedAt: 5, snowy: true };
        expect(settleOnEntry(snowy, { snowing: true, now, aboveClouds: true })).toEqual({ lastClearedAt: 5, snowy: false });
        expect(settleOnEntry(BARE_CLOCK, { snowing: true, now, aboveClouds: true }).snowy).toBe(false);
    });
});

describe("clearedClock / snowKey", () => {
    it("records the clear and leaves the component bare", () => {
        expect(clearedClock(42)).toEqual({ lastClearedAt: 42, snowy: false });
    });
    it("keys per world and component", () => {
        expect(snowKey("writing", "notebook")).toBe("writing:notebook");
    });
});
