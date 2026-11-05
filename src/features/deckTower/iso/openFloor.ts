import { insetRect, insideRoundedRect, type Pt, type WorldRect } from "./geometry";

/**
 * openFloor.ts — picking a random spot of a platform's floor that the fixed view can SEE
 * (docs/ISO_ART_FRAMEWORK.md § "IsoRain" → "Landing points", § "IsoLightningBolt").
 *
 * Something falling from the sky onto the floor (a raindrop, a lightning strike) is drawn
 * in front of what stands on it, so it must not land on floor that a solid hides from the
 * camera. A floor point is HIDDEN behind a solid when it is short of both of the solid's
 * visible faces (world x and y both under its front edges) and inside its screen-x span:
 * the column above it is the solid's own face there. Rounded corners are ignored (a sliver).
 *
 * Pure geometry for the FIXED view (iso/geometry.ts → `makeProjector`), which looks in from
 * +x/+y. Not for the study camera.
 *
 * Depends on: geometry.ts. Depended on by: IsoRain.tsx; src/features/deckTower/DeckTowerPage.tsx
 * (the strike point, `strikePlatform`).
 */

/** Something standing on the floor that hides the floor behind it. */
export interface FloorSolid {
    rect: WorldRect;
    /** World z of its top. */
    zTop: number;
}

/** Whether the floor point (x, y) is hidden from the fixed view behind `s`. */
export function hiddenBehind(x: number, y: number, s: FloorSolid): boolean {
    const maxX = s.rect.x + s.rect.w;
    const maxY = s.rect.y + s.rect.d;
    if (x >= maxX || y >= maxY) return false; // in front of one of its two visible faces
    const screenX = x - y; // the projection's screen x, in units of `unit`
    return screenX > s.rect.x - maxY && screenX < maxX - s.rect.y;
}

/** A sampled spot: its world point, and the solid it is on top of (null = the floor). */
export interface OpenFloorSpot {
    at: Pt;
    on: FloorSolid | null;
}

/**
 * A uniformly random visible spot of `floor` inset by `inset`, or null after `tries` misses.
 * `onSolids`: a point inside a solid's footprint lands ON its top (rain); otherwise such
 * points are rejected too (a burn mark belongs on the floor).
 */
export function openFloorSpot(
    floor: WorldRect,
    solids: readonly FloorSolid[],
    opts: { inset: number; onSolids: boolean; tries?: number; random?: () => number },
): OpenFloorSpot | null {
    const area = insetRect(floor, opts.inset);
    const rnd = opts.random ?? Math.random;
    for (let i = 0; i < (opts.tries ?? 24); i++) {
        const at = { x: area.x + rnd() * area.w, y: area.y + rnd() * area.d };
        if (!insideRoundedRect(at, area)) continue;
        const on = solids.find((s) => insideRoundedRect(at, s.rect)) ?? null;
        if (on) {
            if (opts.onSolids) return { at, on };
            continue;
        }
        if (solids.some((s) => hiddenBehind(at.x, at.y, s))) continue;
        return { at, on: null };
    }
    return null;
}
