import { describe, expect, it } from "vitest";
import { sunDay } from "../../../timeOfDay/sunTimes";
import { phaseSky, timeOfDayAt, towerLight } from "../timeOfDay";
import { NO_WASH, hexToOklch } from "../iso";
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

    it("blends night → day across sunrise, half-way at it", () => {
        const half = timeOfDayAt(rise, CHICAGO);
        expect(half).toMatchObject({ from: "night", to: "day" });
        expect(half.t).toBeCloseTo(0.5, 2);
        expect(timeOfDayAt(rise - 15 * MIN, CHICAGO).t).toBeCloseTo(0.25, 2);
        expect(timeOfDayAt(rise + 31 * MIN, CHICAGO)).toEqual({ from: "day", to: "day", t: 0 });
    });

    it("blends day → night across sunset", () => {
        const q = timeOfDayAt(set + 15 * MIN, CHICAGO);
        expect(q).toMatchObject({ from: "day", to: "night" });
        expect(q.t).toBeCloseTo(0.75, 2);
    });

    it("never yields a phase other than day or night", () => {
        for (let m = 0; m < 24 * 60; m += 5) {
            const time = timeOfDayAt(Date.UTC(2026, 5, 21) + m * MIN, CHICAGO);
            expect(["day", "night"]).toContain(time.from);
            expect(["day", "night"]).toContain(time.to);
        }
    });

    it("meets both twilights at midday on a day too short for plain day", () => {
        // Search north along one meridian on the December solstice for a day with sun for
        // under an hour, so the two hour-long blends overlap.
        const when = Date.UTC(2026, 11, 21, 11);
        let where: { lat: number; lon: number } | undefined;
        let sun: ReturnType<typeof sunDay> | undefined;
        for (let lat = 60; lat < 70 && !where; lat += 0.05) {
            const s = sunDay(when, { lat, lon: 18.96 });
            if (!s.polar && s.set! - s.rise! < 60 * MIN) [where, sun] = [{ lat, lon: 18.96 }, s];
        }
        expect(where).toBeDefined();
        const midday = (sun!.rise! + sun!.set!) / 2;
        expect(timeOfDayAt(midday - 1, where!)).toMatchObject({ from: "night", to: "day" });
        expect(timeOfDayAt(midday + 1, where!)).toMatchObject({ from: "day", to: "night" });
    });
});

describe("skies and light", () => {
    it("keeps the day sky as the token, and darkens it at night", () => {
        const blue = { sky: "#59BFFF" };
        expect(phaseSky(blue, "day")).toBe("#59BFFF");
        const lum = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
        expect(lum(phaseSky(blue, "night"))).toBeLessThan(lum(phaseSky(blue, "day")));
    });

    it("keeps a grey day grey at night, and a saturated day at full night chroma", () => {
        const chroma = (hex: string) => hexToOklch(hex)[1];
        const blueNight = phaseSky({ sky: "#59BFFF" }, "night");
        const greyNight = phaseSky({ sky: "#B3C6DE" }, "night"); // overcast (weatherSky.ts)
        expect(chroma(blueNight)).toBeCloseTo(0.08, 2);
        expect(chroma(greyNight)).toBeLessThan(0.04);
        expect(greyNight).not.toBe(blueNight);
    });

    it("leaves colours untouched at plain day", () => {
        const light = towerLight({ from: "day", to: "day", t: 0 });
        expect(light.wash("#FBF7EC")).toBe("#FBF7EC");
        expect(light.groundStars).toBe(0);
        expect(light.shootingStars).toBe(false);
    });

    it("flies shooting stars only while night outweighs the blend", () => {
        expect(towerLight({ from: "night", to: "night", t: 0 }).shootingStars).toBe(true);
        expect(towerLight({ from: "day", to: "night", t: 0.4 }).shootingStars).toBe(false);
        expect(towerLight({ from: "day", to: "night", t: 0.6 }).shootingStars).toBe(true);
        expect(towerLight({ from: "night", to: "day", t: 0.6 }).shootingStars).toBe(false);
    });

    it("washes only at night: day leaves the scene as drawn", () => {
        expect(towerLight({ from: "day", to: "day", t: 0 }).wash).toBe(NO_WASH);
        expect(towerLight({ from: "night", to: "day", t: 1 }).wash).toBe(NO_WASH);
        expect(towerLight({ from: "night", to: "day", t: 0.5 }).wash).not.toBe(NO_WASH);
        expect(towerLight({ from: "night", to: "night", t: 0 }).wash).not.toBe(NO_WASH);
    });

    it("is exact at both ends of a blend", () => {
        const night = towerLight({ from: "night", to: "night", t: 0 });
        const toNight = towerLight({ from: "day", to: "night", t: 1 });
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
