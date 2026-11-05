import { describe, expect, it } from "vitest";
import { sortLookAt } from "../sortTimeOfDay";
import { phaseSky, towerLight } from "../../deckTower/timeOfDay";
import { TOWER_WORLDS } from "../../deckTower/towerWorlds";
import { weatherDaySky } from "../../deckTower/weatherSky";
import { pinnedWeather } from "../../deckTower/towerWeather";
import type { TimeOfDay } from "../../../timeOfDay/dayPhase";

const NIGHT = { from: "night", to: "night", t: 0 } as TimeOfDay;
const DAY = { from: "day", to: "day", t: 0 } as TimeOfDay;

describe("sortLookAt", () => {
    it("paints the tower's main-world night sky, stars and meteors at night", () => {
        const look = sortLookAt(NIGHT);
        const light = towerLight(NIGHT);
        expect(look.ground).toBe(phaseSky(TOWER_WORLDS.core, "night"));
        expect(look.ground).toBe(light.skyOf(TOWER_WORLDS.core));
        expect(look.stars).toBe(light.groundStars);
        expect(look.shootingStars).toBe(true);
    });

    it("has no stars or meteors by day", () => {
        const look = sortLookAt(DAY);
        expect(look.stars).toBe(0);
        expect(look.shootingStars).toBe(false);
    });

    it("follows the weather's hue by day and at night", () => {
        const clear = weatherDaySky(null);
        const fog = weatherDaySky(pinnedWeather("fog"));
        // By day the ground is the tower's own weather sky.
        expect(sortLookAt(DAY, clear).ground).toBe(clear);
        expect(sortLookAt(DAY, fog).ground).toBe(fog);
        expect(sortLookAt(DAY, fog).ground).not.toBe(sortLookAt(DAY, clear).ground);
        // Night matches the tower's night sky under the same weather.
        expect(sortLookAt(NIGHT, fog).ground).toBe(phaseSky({ ...TOWER_WORLDS.core, sky: fog }, "night"));
    });
});
