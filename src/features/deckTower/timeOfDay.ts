import { blendWash, hexToOklch, hueTurn, lightWash, mixHex, oklchToHex, washTone, type IsoWash, type WashLight } from "./iso";
import { sunDay, type GeoPoint } from "./sunTimes";
import type { TowerWorld } from "./towerWorlds";

/**
 * timeOfDay.ts — the Deck Tower's time of day: dawn, day, sunset and night, blended
 * gradually and anchored to the learner's real sunrise and sunset
 * (docs/DECK_TOWER.md § "Time of day").
 *
 * Layer: page logic (feature module `src/features/deckTower`). Pure — `useTimeOfDay.ts`
 * samples it on a clock; DeckTowerPage paints with the result.
 *
 * ── The day's keyframes ────────────────────────────────────────────────────────
 * Around each sunrise and sunset (sunTimes.ts), TWILIGHT_MS either side:
 *
 *   night ──(rise − 1h)──▶ dawn @ rise ──(rise + 1h)──▶ day
 *   day   ──(set − 1h)───▶ sunset @ set ──(set + 1h)──▶ night
 *
 * Between two keyframes of different phases the look blends linearly; between two of the
 * same phase it holds. A day too short for a full hour of plain day (high-latitude winter)
 * meets dawn and sunset at its midday. A polar day / night holds day / night all day.
 *
 * ── What a phase changes ───────────────────────────────────────────────────────
 *   - SKY: each world's own day sky (TowerWorld.sky, a COLORS token) turned toward the
 *     phase's light in OKLCH (`PHASE_SKY`): its hue rotated part-way toward the phase's
 *     hue along the shortest arc, its lightness and chroma set to the phase's. So every
 *     world keeps a tint of its own hue at every hour. ⚠️ Derived colours, outside the
 *     colour framework (the same divergence as `spaceOver`): the framework has no dawn,
 *     sunset or night tiers.
 *   - WASH: everything drawn ON the sky (platform, cards, pawns, clouds, wind, plates, the
 *     page's white text and arrows, and the flp session laid over the tower — as a colour
 *     matrix, iso `washColorMatrix`) is lit by the phase's light (`PHASE_LIGHT`, the iso
 *     framework's ambient wash). The sky itself is never washed — it IS the light.
 *   - STARS: night shows the star field faintly from the ground (`PHASE_STARS`); space
 *     still brings them in fully as a tall tower is climbed.
 *   - SHOOTING STARS: while the look is mostly night (`shootingStars`), SpaceBackdrop's
 *     ShootingStars layer fires an occasional burst of 1–3 meteors.
 *
 * Depends on: sunTimes.ts, iso/wash.ts. Depended on by: useTimeOfDay.ts, DeckTowerPage.tsx.
 */

export type DayPhase = "dawn" | "day" | "sunset" | "night";

/** How long each side of a sunrise / sunset the sky takes to change. */
const TWILIGHT_MS = 60 * 60_000;
const DAY_MS = 86_400_000;

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

/**
 * Each phase's light over the scene (iso `WashLight`: a cast toward `toward`, then a dim).
 * Day is the scene as drawn. Dawn a faint pink cast (`pnk`), sunset a warm orange one
 * (`orgMk`) with a touch of dimming, night a cool blue cast (`bluMk`) dimmed as lightly as sunset (4%) — so
 * cream card stock reads peach at sunset and slate at night, and the clouds with it.
 * The `toward` colours are COLORS tokens; the dimmed results are derived.
 */
const PHASE_LIGHT: Record<DayPhase, WashLight> = {
    dawn: { toward: "#FFD1FF", amount: 0.12, dim: 0 }, // COLORS.pnk
    day: { toward: "#FFFFFF", amount: 0, dim: 0 },
    sunset: { toward: "#FF9800", amount: 0.16, dim: 0.04 }, // COLORS.orgMk
    night: { toward: "#59BFFF", amount: 0.14, dim: 0.04 }, // COLORS.bluMk — dim cut from 0.22 on 2026-10-25 (read too dark)
};

/** The star field's opacity from the ground, per phase (SpaceBackdrop `groundStars`). */
const PHASE_STARS: Record<DayPhase, number> = { dawn: 0.08, day: 0, sunset: 0, night: 0.55 };

/** The time of day at one moment: `t` of the way from phase `from` to phase `to` (equal = holding). */
export interface TimeOfDay {
    from: DayPhase;
    to: DayPhase;
    t: number;
}

interface Keyframe {
    at: number;
    phase: DayPhase;
}

/** One solar day's keyframes (see the header), or its polar phase. */
function dayKeyframes(atMs: number, where: GeoPoint): Keyframe[] | DayPhase {
    const sun = sunDay(atMs, where);
    if (sun.polar) return sun.polar;
    let dayStart = sun.rise + TWILIGHT_MS;
    let dayEnd = sun.set - TWILIGHT_MS;
    if (dayStart > dayEnd) dayStart = dayEnd = (sun.rise + sun.set) / 2;
    return [
        { at: sun.rise - TWILIGHT_MS, phase: "night" },
        { at: sun.rise, phase: "dawn" },
        { at: dayStart, phase: "day" },
        { at: dayEnd, phase: "day" },
        { at: sun.set, phase: "sunset" },
        { at: sun.set + TWILIGHT_MS, phase: "night" },
    ];
}

/** The time of day at `nowMs` for a learner at `where`. Pure. */
export function timeOfDayAt(nowMs: number, where: GeoPoint): TimeOfDay {
    // Yesterday's, today's and tomorrow's keyframes, so `now` is always bracketed (a
    // night runs from one day's last keyframe to the next day's first).
    const days = [-1, 0, 1].map((d) => dayKeyframes(nowMs + d * DAY_MS, where));
    const frames = days.flatMap((d) => (typeof d === "string" ? [] : d)).sort((a, b) => a.at - b.at);
    for (let i = 0; i < frames.length - 1; i++) {
        const a = frames[i];
        const b = frames[i + 1];
        if (nowMs >= a.at && nowMs < b.at) {
            if (a.phase === b.phase) return { from: a.phase, to: a.phase, t: 0 };
            return { from: a.phase, to: b.phase, t: (nowMs - a.at) / (b.at - a.at) };
        }
    }
    // Not bracketed: a polar day or night (or the edge of one).
    const today = days[1];
    const phase: DayPhase = typeof today === "string" ? today : frames.length > 0 && nowMs < frames[0].at ? frames[0].phase : "night";
    return { from: phase, to: phase, t: 0 };
}

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
        wash: blendWash(lightWash(PHASE_LIGHT[from]), lightWash(PHASE_LIGHT[to]), t),
        groundStars: lerp(PHASE_STARS[from], PHASE_STARS[to], t),
        // Night's share of the blend: 1 holding night, 1 − t leaving it, t entering it.
        shootingStars: (from === "night" ? 1 - t : 0) + (to === "night" ? t : 0) >= 0.5,
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
