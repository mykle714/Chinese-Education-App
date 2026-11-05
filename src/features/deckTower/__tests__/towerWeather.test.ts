import { describe, it, expect } from "vitest";
import { isEffectless, pinnedWeather, weatherCloudCount, weatherEffect } from "../towerWeather";

/** towerWeather.ts (docs/DECK_TOWER.md § "Weather"). */
describe("weatherEffect", () => {
    it("draws particles only for the kinds that have them", () => {
        expect(weatherEffect(pinnedWeather("rain")).rainDensity).toBeGreaterThan(0);
        expect(weatherEffect(pinnedWeather("snow")).snowDensity).toBeGreaterThan(0);
        expect(weatherEffect(pinnedWeather("fog")).fog).toBeGreaterThan(0);
        expect(weatherEffect(pinnedWeather("storm")).lightning).toBe(true);
    });

    it("treats clear, cloudy and no weather as nothing to draw", () => {
        expect(isEffectless(weatherEffect(null))).toBe(true);
        expect(isEffectless(weatherEffect(pinnedWeather("clear")))).toBe(true);
        expect(isEffectless(weatherEffect(pinnedWeather("cloudy")))).toBe(true);
    });
});

describe("weatherCloudCount", () => {
    it("draws clouds only under the cloudy kind", () => {
        expect(weatherCloudCount(null)).toBe(0);
        for (const kind of ["clear", "fog", "drizzle", "rain", "snow", "storm"] as const) {
            expect(weatherCloudCount(pinnedWeather(kind))).toBe(0);
        }
        expect(weatherCloudCount(pinnedWeather("cloudy"))).toBe(4);
    });

    it("thins the clouds out for partly cloudy", () => {
        const partly = { kind: "cloudy" as const, intensity: 0.35, wmoCode: 2, cloudCover: 0.5 };
        expect(weatherCloudCount(partly)).toBe(2);
    });
});

describe("pinnedWeather", () => {
    it("carries a representative WMO code for the sky design to read", () => {
        expect(pinnedWeather("cloudy").wmoCode).toBe(3);
        expect(pinnedWeather("storm").wmoCode).toBe(95);
    });
});
