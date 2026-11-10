/**
 * The pawns' channel through settled snow — its store (snowChannel.ts records and draws it;
 * docs/TOWER_SNOW.md § "The pawn's trail"). Owned by the scene, not the component, so the
 * channel outlasts the component remounting — the Deck Tower's platform remounts on every
 * world pan (useTowerSnow.ts keeps one per world and surface — the floor, the tower's top —
 * and a new one after each clear of that surface).
 *
 * A channel is a list of RUNS: polylines of world ground points, one per stretch a walker
 * stayed on the snow's surface. A walker leaving it (the tower's top for the floor's store,
 * the floor for the tower's, a fall) or leaving the ground (IsoPawn `airborne`: a jump,
 * the flight onto the tower) closes its run; landing opens a new one.
 */

/** A world ground point (x–y). */
export interface TrailPoint {
    x: number;
    y: number;
}

export interface SnowTrail {
    /** Every run, oldest first. Each is the walking line of one stay on the floor. */
    runs: TrailPoint[][];
    /** The run each walker is extending now, by key. Dropped while it is off the floor. */
    open: Map<string, TrailPoint[]>;
    /** Points across all runs (for the cap). */
    points: number;
    /** Redraws to run when points have been added (snowChannel.ts → `useSnowChannel`, one per slab drawing this store). */
    listeners: Set<() => void>;
}

/** The most points a trail keeps across its runs; the oldest go first. */
export const MAX_TRAIL_POINTS = 1500;

export function newSnowTrail(): SnowTrail {
    return { runs: [], open: new Map(), points: 0, listeners: new Set() };
}

/** Drops the oldest points until the trail is within `MAX_TRAIL_POINTS`. */
export function capSnowTrail(trail: SnowTrail): void {
    while (trail.points > MAX_TRAIL_POINTS && trail.runs.length > 0) {
        const oldest = trail.runs[0];
        const drop = Math.min(oldest.length, trail.points - MAX_TRAIL_POINTS);
        oldest.splice(0, drop);
        trail.points -= drop;
        if (oldest.length > 0) continue;
        trail.runs.shift();
        // A walker still extending that run starts a fresh one at its next point.
        for (const [key, run] of trail.open) if (run === oldest) trail.open.delete(key);
    }
}
