import { describe, expect, it } from "vitest";
import { sortLookAt } from "../sortTimeOfDay";
import { phaseSky, towerLight } from "../../deckTower/timeOfDay";
import { TOWER_WORLDS } from "../../deckTower/towerWorlds";
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
});
