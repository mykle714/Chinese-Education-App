import { useCallback } from "react";
import type { Projector } from "./geometry";
import { planSidePath, prefersReducedMotion, rand, useAltitudeWander, useSkyTraffic, type AltitudeWander, type AltitudeWanderConfig, type Pt2, type SkyRegion, type SkySide } from "./skyTraffic";

/**
 * useBirdFlights — schedules the birds that cross a scene's sky
 * (docs/ISO_ART_FRAMEWORK.md § "IsoBird").
 *
 * A bird flies ISOMETRICALLY: in a straight line parallel to one of the four sides of
 * `sky.around` (a tower's footprint), a little way out from it, at a random height inside
 * `sky.band`. Its path runs along a world axis, so on screen it crosses diagonally at the
 * grid's 2:1 slope. The path is long enough to run from just off one edge of
 * `sky.screenSpan` to just off the other, so a bird enters and leaves the screen rather
 * than popping in mid-sky.
 *
 * Several birds fly independently: there are `maxAirborne` SLOTS, each looping
 * wait → fly → wait on its own timer, so the sky has 0..maxAirborne birds at once at
 * irregular intervals. Each flight picks its own side, direction, offset and speed. Its
 * height comes from one shared wandering altitude (skyTraffic.ts → createAltitudeWander),
 * so birds that take wing close together fly at close heights.
 *
 * Draw order: a bird on one of the tower's two FRONT sides (+x / +y, the walls a viewer
 * sees) is drawn after the tower; one on a BACK side is drawn before it, so the tower hides
 * it as it passes behind. That is fixed for the whole flight: where a back-side bird's path
 * runs out past the tower's corner it is beside the tower on screen, not over it, so the
 * order cannot be wrong there.
 *
 * React state changes only when a flight starts or ends (a few times a minute). The
 * per-frame flap, bounce and travel are IsoBird's own rAF loop. The path solver and the
 * slot scheduler are shared with the clouds (skyTraffic.ts).
 *
 * Under prefers-reduced-motion no birds fly at all (a bird frozen mid-sky would read as a
 * glitch, not as stillness).
 *
 * Referenced by: docs/ISO_ART_FRAMEWORK.md § "IsoBird" + § "Sky traffic", docs/DECK_TOWER.md § "The scene".
 */

/** Which side of the tower a flight runs along, and so where it is drawn (skyTraffic.ts → SkySide). */
export type BirdSide = SkySide;

export interface BirdFlight {
    /** Unique per flight — the React key, so each flight mounts a fresh IsoBird. */
    id: number;
    /** World x/y the flight starts and ends at. Both lie off screen. */
    from: Pt2;
    to: Pt2;
    /** World height of the flight line (the bird bounces about it). */
    z: number;
    durationMs: number;
    /** Front-side flights draw after the tower, back-side ones before it. */
    side: BirdSide;
    /** Wingbeats per second, and the starting phase, so birds don't flap in unison. */
    flapHz: number;
    flapPhase: number;
}

/** The birds' sky: the band they fly in, the tower they fly beside, the screen they cross. */
export type BirdSky = SkyRegion;

/** How far out from the tower's side a flight line runs, in world units. */
const GAP_MIN = 0.7;
const GAP_MAX = 2.6;
/** Flight speed along the path, world units per second. */
const SPEED_MIN = 3.2;
const SPEED_MAX = 4.6;
/** Wingbeats per second. */
const FLAP_HZ_MIN = 2.6;
const FLAP_HZ_MAX = 3.6;
/** World units past each screen edge the path extends, so the whole bird is off screen. */
const OFFSCREEN_MARGIN = 2;
/** A slot's wait before its first flight (staggered per slot), and between flights. */
const FIRST_WAIT_MS = { min: 300, max: 2200, perSlot: 1800 };
const WAIT_MIN_MS = 1500;
const WAIT_MAX_MS = 6500;

/** The shared flight height drifts across the band over ~half a minute (§ Sky traffic). */
const ALTITUDE_WANDER: AltitudeWanderConfig = { knotMs: 6000, maxStep: 0.2 };

const firstWaitMs = (slot: number) => rand(FIRST_WAIT_MS.min, FIRST_WAIT_MS.max) + slot * FIRST_WAIT_MS.perSlot;
const waitMs = () => rand(WAIT_MIN_MS, WAIT_MAX_MS);

/** One random flight across the sky. */
function planFlight(id: number, proj: Projector, sky: BirdSky, altitude: AltitudeWander): BirdFlight {
    const { from, to, side } = planSidePath(proj, sky, rand(GAP_MIN, GAP_MAX), OFFSCREEN_MARGIN);
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    return {
        id,
        from,
        to,
        z: altitude.sample(sky.band),
        durationMs: (length / rand(SPEED_MIN, SPEED_MAX)) * 1000,
        side,
        flapHz: rand(FLAP_HZ_MIN, FLAP_HZ_MAX),
        flapPhase: rand(0, 2 * Math.PI),
    };
}

export function useBirdFlights(opts: {
    proj: Projector;
    /** Birds fly only while this is true. Turning it false clears the sky. */
    active: boolean;
    /** Expected to be memoized: a new object restarts every slot. */
    sky: BirdSky;
    /** How many birds may be in the air at once (one slot each). */
    maxAirborne?: number;
}): BirdFlight[] {
    const { proj, active, sky, maxAirborne = 3 } = opts;
    const altitude = useAltitudeWander(ALTITUDE_WANDER);
    const plan = useCallback((id: number) => planFlight(id, proj, sky, altitude), [proj, sky, altitude]);
    return useSkyTraffic({ active: active && !prefersReducedMotion(), slots: maxAirborne, plan, firstWaitMs, waitMs });
}
