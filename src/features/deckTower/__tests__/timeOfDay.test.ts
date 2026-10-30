import { describe, expect, it } from "vitest";
import { sunDay } from "../../../timeOfDay/sunTimes";
import { phaseSky, timeOfDayAt, towerLight } from "../timeOfDay";
import { NO_WASH } from "../iso";
import { TZ_COORDINATES } from "../../../timeOfDay/tzCoordinates";

const CHICAGO = { lat: 41.9, lon: -87.6 };
const MIN = 60_000;

/** Minutes between two epoch ms. */
const minutesApart = (a: number, b: number) => Math.abs(a - b) / MIN;

describe("sunDay", () => {
    it("matches Chicago's published solstice sunrise/sunset within a few minutes", () => {
        // 2026-06-21: sunrise ≈ 05:16 CDT (10:16Z), sunset ≈ 20:29 CDT (01:29Z on the 22nd).
        const sun = sunDay(Date.UTC(2026, 5, 21, 17), CHICAGO);
        expect(sun.polar).toBeUndefined();
        expect(minutesApart(sun.rise!, Date.UTC(2026, 5, 21, 10, 16))).toBeLessThan(5);
        expect(minutesApart(sun.set!, Date.UTC(2026, 5, 22, 1, 29))).toBeLessThan(5);
    });

    it("returns the same local day whether asked at local morning or late evening", () => {
        const morning = sunDay(Date.UTC(2026, 5, 21, 12), CHICAGO); // 07:00 CDT
        const evening = sunDay(Date.UTC(2026, 5, 22, 4), CHICAGO); // 23:00 CDT
        expect(morning.rise).toBe(evening.rise);
    });

    it("reports polar day and night", () => {
        const svalbard = { lat: 78.2, lon: 15.6 };
        expect(sunDay(Date.UTC(2026, 5, 21, 12), svalbard).polar).toBe("day");
        expect(sunDay(Date.UTC(2026, 11, 21, 12), svalbard).polar).toBe("night");
    });
});

describe("timeOfDayAt", () => {
    const sun = sunDay(Date.UTC(2026, 5, 21, 17), CHICAGO);
    const rise = sun.rise!;
    const set = sun.set!;

    it("is plain day at noon and plain night at midnight", () => {
        expect(timeOfDayAt(Date.UTC(2026, 5, 21, 17), CHICAGO)).toEqual({ from: "day", to: "day", t: 0 });
        expect(timeOfDayAt(Date.UTC(2026, 5, 21, 5), CHICAGO)).toEqual({ from: "night", to: "night", t: 0 });
    });

    it("blends night → dawn before sunrise and peaks at it", () => {
        const half = timeOfDayAt(rise - 15 * MIN, CHICAGO);
        expect(half.from).toBe("night");
        expect(half.to).toBe("dawn");
        expect(half.t).toBeCloseTo(0.5, 2);
        expect(timeOfDayAt(rise + 1, CHICAGO).from).toBe("dawn");
    });

    it("blends sunset → night after sunset", () => {
        const q = timeOfDayAt(set + 7.5 * MIN, CHICAGO);
        expect(q).toMatchObject({ from: "sunset", to: "night" });
        expect(q.t).toBeCloseTo(0.25, 2);
    });

    it("holds day through a polar summer", () => {
        expect(timeOfDayAt(Date.UTC(2026, 5, 21, 0), { lat: 78.2, lon: 15.6 })).toEqual({ from: "day", to: "day", t: 0 });
    });
});

describe("skies and light", () => {
    it("keeps the day sky as the token, and darkens night below dawn", () => {
        const blue = { sky: "#59BFFF" };
        expect(phaseSky(blue, "day")).toBe("#59BFFF");
        const lum = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
        expect(lum(phaseSky(blue, "night"))).toBeLessThan(lum(phaseSky(blue, "dawn")));
    });

    it("lets a world override a phase's recipe", () => {
        const green = { sky: "#78E292" };
        const own = { ...green, skyRecipes: { sunset: { hue: 35, hueBy: 0.95, L: 0.68, C: 0.17 } } };
        expect(phaseSky(own, "sunset")).not.toBe(phaseSky(green, "sunset"));
        expect(phaseSky(own, "dawn")).toBe(phaseSky(green, "dawn"));
    });

    it("leaves colours untouched at plain day", () => {
        const light = towerLight({ from: "day", to: "day", t: 0 });
        expect(light.wash("#FBF7EC")).toBe("#FBF7EC");
        expect(light.groundStars).toBe(0);
        expect(light.shootingStars).toBe(false);
    });

    it("flies shooting stars only while night outweighs the blend", () => {
        expect(towerLight({ from: "night", to: "night", t: 0 }).shootingStars).toBe(true);
        expect(towerLight({ from: "sunset", to: "night", t: 0.4 }).shootingStars).toBe(false);
        expect(towerLight({ from: "sunset", to: "night", t: 0.6 }).shootingStars).toBe(true);
        expect(towerLight({ from: "night", to: "dawn", t: 0.6 }).shootingStars).toBe(false);
    });

    it("washes only at night: dawn, day and sunset leave the scene as drawn", () => {
        for (const phase of ["dawn", "day", "sunset"] as const) {
            expect(towerLight({ from: phase, to: phase, t: 0 }).wash).toBe(NO_WASH);
        }
        expect(towerLight({ from: "dawn", to: "day", t: 0.5 }).wash).toBe(NO_WASH);
        expect(towerLight({ from: "night", to: "night", t: 0 }).wash).not.toBe(NO_WASH);
    });

    it("is exact at both ends of a blend", () => {
        const night = towerLight({ from: "night", to: "night", t: 0 });
        const toNight = towerLight({ from: "sunset", to: "night", t: 1 });
        expect(toNight.wash("#FFB100")).toBe(night.wash("#FFB100"));
        const red = { sky: "#FF767D" };
        expect(toNight.skyOf(red)).toBe(night.skyOf(red));
    });
});

describe("TZ_COORDINATES", () => {
    it("resolves canonical zones and legacy aliases", () => {
        expect(TZ_COORDINATES["America/Chicago"]).toEqual([41.9, -87.6]);
        expect(TZ_COORDINATES["Asia/Calcutta"]).toEqual(TZ_COORDINATES["Asia/Kolkata"]);
    });
});
