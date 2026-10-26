import { convexHull, projectOutline, roundedRectWorld, toPath, type Projector, type WorldRect } from "./geometry";

/**
 * hatchGeometry.ts — the footprints of the floor hatches things rise out of (IsoHatch,
 * docs/ISO_ART_FRAMEWORK.md § "IsoHatch"): the focus lever's and the mode switch's
 * (IsoModeSwitch, currently unused). Its own module so the component files export only components (fast refresh),
 * and so layouts (towerPlatforms.ts) can use a footprint as a pawn obstacle without
 * importing a component.
 *
 * Also the one clip every floor opening shares (`openingSweepPath`): IsoHatch, IsoFloorRecess
 * and IsoPawn's `opening` all hide what has sunk below the floor with it.
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

/**
 * A floor opening's outline swept straight up the screen: the region in which something
 * sunk into the opening can still be seen. Anything under the floor projects BELOW the
 * opening's outline (world −z is screen +y), so clipping to this cuts off exactly what the
 * floor in front of the opening hides, while what shows through the opening and everything
 * standing above it stays visible. Used by IsoHatch, IsoFloorRecess and IsoPawn (`opening`).
 */
export function openingSweepPath(proj: Projector, opening: WorldRect, floorZ: number): string {
    const outline = projectOutline(proj, roundedRectWorld(opening), floorZ);
    return toPath(convexHull([...outline, ...outline.map((p) => ({ x: p.x, y: p.y - 4000 }))]));
}
