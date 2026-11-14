import { describe, it, expect } from "vitest";
import {
    WEATHER_FAMILY_DEFAULT_PIN,
    WEATHER_PINS,
    isEffectless,
    parseWeatherOverride,
    pinnedWeather,
    weatherCloudCount,
    weatherEffect,
} from "../towerWeather";
import { weatherDaySky } from "../weatherSky";

/** towerWeather.ts (docs/DECK_TOWER.md § "Weather"). */
describe("weatherEffect", () => {
    it("draws particles only for the kinds that have them", () => {
        expect(weatherEffect(pinnedWeather("rain-heavy")).rainDensity).toBeGreaterThan(0);
        expect(weatherEffect(pinnedWeather("snow-heavy")).snowDensity).toBeGreaterThan(0);
        expect(weatherEffect(pinnedWeather("fog")).fog).toBeGreaterThan(0);
        expect(weatherEffect(pinnedWeather("storm")).lightning).toBe(true);
    });

    it("treats clear, cloudy and no weather as nothing to draw", () => {
        expect(isEffectless(weatherEffect(null))).toBe(true);
        expect(isEffectless(weatherEffect(pinnedWeather("clear")))).toBe(true);
        expect(isEffectless(weatherEffect(pinnedWeather("overcast")))).toBe(true);
        expect(isEffectless(weatherEffect(pinnedWeather("partly-cloudy")))).toBe(true);
    });
});

describe("weatherCloudCount", () => {
    it("draws clouds only under the cloudy kind", () => {
        expect(weatherCloudCount(null)).toBe(0);
        for (const kind of ["clear", "fog", "drizzle", "rain", "snow", "storm"] as const) {
            expect(weatherCloudCount(pinnedWeather(WEATHER_FAMILY_DEFAULT_PIN[kind]))).toBe(0);
        }
        expect(weatherCloudCount(pinnedWeather("partly-cloudy"))).toBe(4);
    });

    it("flies no clouds under overcast (the grey sky is the cloud)", () => {
        expect(weatherCloudCount(pinnedWeather("overcast"))).toBe(0);
    });

    it("flies the full partly-cloudy count whatever the cloud cover", () => {
        const thin = { kind: "cloudy" as const, intensity: 0.35, wmoCode: 2, cloudCover: 0.5 };
        expect(weatherCloudCount(thin)).toBe(4);
    });
});

describe("pinnedWeather", () => {
    it("carries a representative WMO code for the sky design to read", () => {
        expect(pinnedWeather("overcast").wmoCode).toBe(3);
        expect(pinnedWeather("partly-cloudy").wmoCode).toBe(2);
        expect(pinnedWeather("storm").wmoCode).toBe(95);
    });

    it("files every pin under the family its code folds into", () => {
        for (const pin of WEATHER_PINS) {
            expect(pinnedWeather(pin.id).kind).toBe(pin.family);
        }
    });

    it("gives every pin a distinct look (particles, intensity or sky)", () => {
        const looks = WEATHER_PINS.map((p) => {
            const w = pinnedWeather(p.id);
            return `${w.kind}|${w.intensity}|${weatherDaySky(w)}`;
        });
        expect(new Set(looks).size).toBe(WEATHER_PINS.length);
    });

    it("covers every WMO code Open-Meteo sends, and each alias draws like its pin", () => {
        const KNOWN = [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99];
        const covered = WEATHER_PINS.flatMap((p) => [p.wmoCode, ...p.alsoCodes]).sort((a, b) => a - b);
        expect(covered).toEqual(KNOWN);
        for (const pin of WEATHER_PINS) {
            const base = pinnedWeather(pin.id);
            for (const code of pin.alsoCodes) {
                const alias = { ...base, wmoCode: code };
                expect(weatherDaySky(alias)).toBe(weatherDaySky(base));
            }
        }
    });
});

describe("parseWeatherOverride", () => {
    it("reads pin ids, maps pre-2026-11-13 kind pins to their family default, else Auto", () => {
        expect(parseWeatherOverride("rain-freezing-light")).toBe("rain-freezing-light");
        expect(parseWeatherOverride("cloudy")).toBe("overcast");
        expect(parseWeatherOverride("rain")).toBe("rain-heavy");
        expect(parseWeatherOverride("bogus")).toBe("auto");
        expect(parseWeatherOverride(null)).toBe("auto");
    });
});
