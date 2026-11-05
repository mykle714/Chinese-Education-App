import { hexToOklch, hueTurn, mixHex, oklchToHex, washTone, type IsoWash } from "./iso";
import { phaseShare, type DayPhase, type TimeOfDay } from "../../timeOfDay/dayPhase";
import { phaseWash } from "../../timeOfDay/wash";
import type { TowerWorld } from "./towerWorlds";

/**
 * timeOfDay.ts — the Deck Tower's time of day: day and night, blended gradually across
 * twilights anchored to the learner's real sunrise and sunset
 * (docs/DECK_TOWER.md § "Time of day").
 *
 * Layer: page logic (feature module `src/features/deckTower`). Pure — `useTimeOfDay.ts`
 * samples it on a clock; DeckTowerPage paints with the result.
 *
 * WHEN each phase holds — the keyframes around the learner's real sunrise and sunset and
 * the hour-long day ↔ night twilight blends — is the shared clock in src/timeOfDay/dayPhase.ts
 * (`timeOfDayAt`); this file says only what a phase LOOKS like over the tower.
 *
 * ── What a phase changes ───────────────────────────────────────────────────────
 *   - SKY: each world's own day sky (TowerWorld.sky, a COLORS token) by day; at night that
 *     sky turned in OKLCH (`NIGHT_SKY`): its hue rotated part-way toward night's hue along
 *     the shortest arc, its lightness and chroma set to night's. So every world keeps a
 *     tint of its own hue at night. ⚠️ Derived colours, outside the colour framework (the
 *     same divergence as `spaceOver`): the framework has no night tier.
 *   - WASH (night only; `phaseWash`, src/timeOfDay/wash.ts): everything drawn ON the sky (platform, cards, pawns, clouds, wind,
 *     plates, the page's white text and arrows) is lit by night's light (the iso
 *     framework's ambient wash); day leaves it as drawn. The sky itself is
 *     never washed — it IS the light. HTML over the tower (the flp session, the slab
 *     footer) is NOT washed: its SVG-filter wash was cut 2026-10-30 (CPU-rasterised, laggy).
 *   - STARS: night shows the star field faintly from the ground (`PHASE_STARS`); space
 *     still brings them in fully as a tall tower is climbed.
 *   - SHOOTING STARS: while the look is mostly night (`shootingStars`), SpaceBackdrop's
 *     ShootingStars layer fires an occasional burst of 1–3 meteors.
 *
 * Depends on: src/timeOfDay/dayPhase.ts, iso/wash.ts. Depended on by: useTimeOfDay.ts, DeckTowerPage.tsx.
 */

// The clock moved to the shared src/timeOfDay/ (2026-10-29); re-exported so the tower's
// own importers (towerWorlds, the tests) keep their paths.
export { timeOfDayAt, type DayPhase, type TimeOfDay } from "../../timeOfDay/dayPhase";

/**
 * Night's sky, as a turn of the world's day sky (OKLCH): `hueBy` of the shortest turn
 * toward `hue`, at lightness `L` and chroma `C`. Night is dark and cool but keeps most of
 * the world's own hue (a 35% turn toward 270°), and is lighter than SPACE (L ≈ 0.25), so a
 * climb at night still deepens. (Dawn and sunset had their own, much stronger turns until
 * they were cut 2026-11-04 — docs/TOWER_WEATHER_SKY.md § 1 — along with the per-world
 * `skyRecipes` overrides, which only ever overrode those two.)
 */
interface SkyRecipe {
    hue: number;
    hueBy: number;
    L: number;
    C: number;
}

const NIGHT_SKY: SkyRecipe = { hue: 270, hueBy: 0.35, L: 0.34, C: 0.08 };

/** The star field's opacity from the ground, per phase (SpaceBackdrop `groundStars`). */
const PHASE_STARS: Record<DayPhase, number> = { day: 0, night: 0.55 };

/** The sky-bearing part of a world: its day sky. */
export type SkyWorld = Pick<TowerWorld, "sky">;

/** A world's day sky at `phase`: as it is by day, turned by `NIGHT_SKY` at night. */
export function phaseSky(world: SkyWorld, phase: DayPhase): string {
    const daySky = world.sky;
    if (phase === "day") return daySky;
    const [, , h] = hexToOklch(daySky);
    return oklchToHex(NIGHT_SKY.L, NIGHT_SKY.C, (h + hueTurn(h, NIGHT_SKY.hue) * NIGHT_SKY.hueBy + 360) % 360);
}

/** Everything the page paints with for one time of day. */
export interface TowerLight {
    time: TimeOfDay;
    /** The iso scene's ambient wash (IsoScene `wash`), also for the page's own sky-borne UI. */
    wash: IsoWash;
    /** The star field's opacity from the ground. */
    groundStars: number;
    /** Whether meteors fly (ShootingStars): true while night outweighs day in the blend. */
    shootingStars: boolean;
    /** A world's sky at this time (unwashed: the sky is the light). Pass the TOWER_WORLDS entry. */
    skyOf: (world: SkyWorld) => string;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function towerLight(time: TimeOfDay): TowerLight {
    const { from, to, t } = time;
    // Keyed by the world object (TOWER_WORLDS entries are constants), memoised per light.
    const skies = new WeakMap<SkyWorld, string>();
    return {
        time,
        wash: phaseWash(time),
        groundStars: lerp(PHASE_STARS[from], PHASE_STARS[to], t),
        // Night's share of the blend: 1 holding night, 1 − t leaving it, t entering it.
        shootingStars: phaseShare(time, "night") >= 0.5,
        skyOf: (world) => {
            let sky = skies.get(world);
            if (sky === undefined) {
                sky = mixHex(phaseSky(world, from), phaseSky(world, to), t);
                skies.set(world, sky);
            }
            return sky;
        },
    };
}

/**
 * A world as it looks under `light`: its sky (and the sky's ground plane, which takes the
 * platform's shadow) at this time, its platform, floor and lever ball washed. Space is
 * left as it is — one night above every world, at every hour.
 */
export function litWorld(world: TowerWorld, light: TowerLight): TowerWorld {
    const sky = light.skyOf(world);
    const platform = washTone(world.platform, light.wash);
    return {
        ...world,
        sky,
        platform,
        floor: { ...world.floor, color: platform.material.top },
        ground: { ...world.ground, color: sky },
        leverKnob: light.wash(world.leverKnob),
    };
}
