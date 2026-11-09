import { describe, expect, it } from "vitest";
import { auroraCanRoll, auroraShowing, auroraStrength } from "../towerAurora";
import type { WeatherNow } from "../../../api/weather";

// The aurora's rules (towerAurora.ts header; docs/DECK_TOWER.md § Time of day → "Aurora").
const clear = { kind: "clear", intensity: 0 } as unknown as WeatherNow;
const rain = { kind: "rain", intensity: 0.5 } as unknown as WeatherNow;

describe("auroraCanRoll", () => {
    it("rolls only at night", () => {
        expect(auroraCanRoll(false, clear, true)).toBe(false);
        expect(auroraCanRoll(true, clear, true)).toBe(true);
    });
    it("treats no weather reading as clear", () => {
        expect(auroraCanRoll(true, null, true)).toBe(true);
    });
    it("is blocked by known non-clear weather", () => {
        expect(auroraCanRoll(true, rain, true)).toBe(false);
    });
    it("waits for the weather's first answer", () => {
        expect(auroraCanRoll(true, null, false)).toBe(false);
    });
});

describe("auroraStrength / auroraShowing", () => {
    it("is reading-only and follows night's share", () => {
        expect(auroraStrength("reading", true, 0.4)).toBe(0.4);
        expect(auroraStrength("core", true, 1)).toBe(0);
        expect(auroraStrength("writing", true, 1)).toBe(0);
        expect(auroraStrength("reading", false, 1)).toBe(0);
    });
    it("shows only with some night", () => {
        expect(auroraShowing("reading", true, 0)).toBe(false);
        expect(auroraShowing("reading", true, 0.01)).toBe(true);
    });
});
