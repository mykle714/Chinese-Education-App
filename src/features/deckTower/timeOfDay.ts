import { hexToOklch, hueTurn, mixHex, oklchToHex, washTone, type IsoWash } from "./iso";
import { phaseShare, type DayPhase, type TimeOfDay } from "../../timeOfDay/dayPhase";
import { phaseWash } from "../../timeOfDay/wash";
import type { TowerWorld } from "./towerWorlds";

/**
 * timeOfDay.ts — the Deck Tower's time of day: dawn, day, sunset and night, blended
 * gradually and anchored to the learner's real sunrise and sunset
 * (docs/DECK_TOWER.md § "Time of day").
 *
 * Layer: page logic (feature module `src/features/deckTower`). Pure — `useTimeOfDay.ts`
 * samples it on a clock; DeckTowerPage paints with the result.
 *
 * WHEN each phase holds — the keyframes around the learner's real sunrise and sunset and
 * the 30-minute twilight blends — is the shared clock in src/timeOfDay/dayPhase.ts
 * (`timeOfDayAt`); this file says only what a phase LOOKS like over the tower.
 *
 * ── What a phase changes ───────────────────────────────────────────────────────
 *   - SKY: each world's own day sky (TowerWorld.sky, a COLORS token) turned toward the
 *     phase's light in OKLCH (`PHASE_SKY`): its hue rotated part-way toward the phase's
 *     hue along the shortest arc, its lightness and chroma set to the phase's. So every
 *     world keeps a tint of its own hue at every hour. ⚠️ Derived colours, outside the
 *     colour framework (the same divergence as `spaceOver`): the framework has no dawn,
 *     sunset or night tiers.
 *   - WASH (night only; `phaseWash`, src/timeOfDay/wash.ts): everything drawn ON the sky (platform, cards, pawns, clouds, wind,
 *     plates, the page's white text and arrows) is lit by night's light (the iso
 *     framework's ambient wash); dawn, day and sunset leave it as drawn. The sky itself is
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
 * A phase's sky, as a turn of the world's day sky (OKLCH): `hueBy` of the shortest turn
 * toward `hue`, at lightness `L` and chroma `C`.
 *   - Dawn and sunset turn MOST of the way (80–90%). A weak turn only looks natural when
 *     the world's hue is already near the target: at 30%, a green sky (opposite pink)
 *     stopped on the yellow side of the wheel, an olive dawn. Strong turns leave each
 *     world a trace of its hue: dawn is rose over blue, peach over green, coral-pink over
 *     red; sunset coral orange over blue, orange over red.
 *   - Dawn aims at peach (hue 20), sunset at orange (55), so the two don't read alike.
 *   - Night is dark and cool but keeps more of its own hue, and is lighter than SPACE
 *     (L ≈ 0.25), so a climb at night still deepens.
 * A world can override a phase's recipe (`TowerWorld.skyRecipes`).
 */
export interface SkyRecipe {
    hue: number;
    hueBy: number;
    L: number;
    C: number;
}

const PHASE_SKY: Record<Exclude<DayPhase, "day">, SkyRecipe> = {
    dawn: { hue: 20, hueBy: 0.8, L: 0.8, C: 0.12 },
    sunset: { hue: 55, hueBy: 0.9, L: 0.72, C: 0.17 },
    night: { hue: 270, hueBy: 0.35, L: 0.34, C: 0.08 },
};

/** The star field's opacity from the ground, per phase (SpaceBackdrop `groundStars`). */
const PHASE_STARS: Record<DayPhase, number> = { dawn: 0.08, day: 0, sunset: 0, night: 0.55 };

/** The sky-bearing part of a world: its day sky and any per-phase recipe overrides. */
export type SkyWorld = Pick<TowerWorld, "sky" | "skyRecipes">;

/** A world's day sky turned to `phase` (see `PHASE_SKY`; the world's own recipe wins). */
export function phaseSky(world: SkyWorld, phase: DayPhase): string {
    const daySky = world.sky;
    if (phase === "day") return daySky;
    const r = world.skyRecipes?.[phase] ?? PHASE_SKY[phase];
    const [, , h] = hexToOklch(daySky);
    return oklchToHex(r.L, r.C, (h + hueTurn(h, r.hue) * r.hueBy + 360) % 360);
}

/** Everything the page paints with for one time of day. */
export interface TowerLight {
    time: TimeOfDay;
    /** The iso scene's ambient wash (IsoScene `wash`), also for the page's own sky-borne UI. */
    wash: IsoWash;
    /** The star field's opacity from the ground. */
    groundStars: number;
    /** Whether meteors fly (ShootingStars): true while night outweighs the other phase of the blend. */
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
