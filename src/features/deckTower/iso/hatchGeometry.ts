import type { WorldRect } from "./geometry";

/**
 * hatchGeometry.ts — the footprints of the floor hatches things rise out of (IsoHatch,
 * docs/ISO_ART_FRAMEWORK.md § "IsoHatch"): the focus lever's and the mode switch's
 * (IsoModeSwitch, currently unused). Its own module so the component files export only components (fast refresh),
 * and so layouts (towerPlatforms.ts) can use a footprint as a pawn obstacle without
 * importing a component.
 */

/** The focus lever's square opening (world units). */
export const LEVER_HOLE = 1.0;

/**
 * The mode switch's opening: `w` across (x) by `d` along (y). Its body
 * (IsoModeSwitch) is a 1.3 × 2.4 light-switch block, long along y; the opening leaves a 0.15
 * margin round it.
 */
export const MODE_SWITCH_HOLE = { w: 1.6, d: 2.7 };

/** A hatch of `w` × `d` (square when `d` is omitted) centred at `at` — also the pawns' obstacle. */
export function hatchFootprint(at: { x: number; y: number }, w: number, d: number = w): WorldRect {
    return { x: at.x - w / 2, y: at.y - d / 2, w, d, r: 0.18 };
}

/** The lever's hatch. */
export function leverFootprint(at: { x: number; y: number }): WorldRect {
    return hatchFootprint(at, LEVER_HOLE);
}

/** The mode switch's hatch. */
export function modeSwitchFootprint(at: { x: number; y: number }): WorldRect {
    return hatchFootprint(at, MODE_SWITCH_HOLE.w, MODE_SWITCH_HOLE.d);
}
