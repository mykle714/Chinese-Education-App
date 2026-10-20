import type { WorldRect } from "./geometry";

/**
 * leverGeometry.ts — the focus lever's hatch footprint (IsoLever,
 * docs/ISO_ART_FRAMEWORK.md § "IsoLever"). Its own module so IsoLever.tsx exports only a
 * component (fast refresh), and so layouts (towerPlatforms.ts) can use the footprint as a
 * pawn obstacle without importing the component.
 */

/** The hatch's square opening (world units). */
export const LEVER_HOLE = 1.0;

/** The hatch's footprint for a lever centred at `at` — also the pawns' obstacle. */
export function leverFootprint(at: { x: number; y: number }): WorldRect {
    return { x: at.x - LEVER_HOLE / 2, y: at.y - LEVER_HOLE / 2, w: LEVER_HOLE, d: LEVER_HOLE, r: 0.18 };
}
