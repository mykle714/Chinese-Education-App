/**
 * sortPlatformMetrics.ts — IsoSortPlatform's dimensions and heights, kept out of the
 * component so a scene can match its fog / rain stand-ins and tap target to the drawing
 * (DeckTowerPlatform → `sortBin`). Docs: docs/ISO_ART_FRAMEWORK.md § "IsoSortPlatform".
 */

/** The slab's thickness. ancp's bins are 1.2 thick on a 6.4-wide slab; this keeps the ratio. */
export const SLAB_THICKNESS = 0.28;
/** The light bevel round the slab's top (IsoPlatform's RIM_WIDTH at this scale). */
export const MINI_RIM = 0.05;
/** The dashed footprint's inset from the slab's edge — ancp's DECK sits 1 unit in on a 6.4 slab. */
export const FOOTPRINT_INSET = 0.2;
/**
 * How far the dashed footprint is darkened from the deck colour (a `shadeHex` amount):
 * ancp's day `FOOTPRINT_SHADE` (sortTimeOfDay.ts). The tower's time-of-day wash already
 * darkens slab and footprint together at night, so the day value serves every hour.
 */
export const FOOTPRINT_SHADE = 0.18;
/** The footprint's stroke and dash, in floor units (× `proj.unit` for px) — ancp's 1.8 / "6 5" at about this screen size. */
export const FOOTPRINT_STROKE = 0.06;
export const FOOTPRINT_DASH = 0.15;
export const FOOTPRINT_GAP = 0.125;
/** How high the big jump goes, world units. Exported so a scene can grow its tap target to cover it. */
export const SORT_PLATFORM_JUMP = 1.6;
/**
 * One big jump every this often. The jump and its rebounds take the first half of it
 * (1 s — the 50% mark of IsoSortPlatform's hop keyframes), and it rests for the other half.
 */
export const HOP_PERIOD_MS = 2000;

/**
 * The slab's top z over a surface at `surfaceZ`, for a build-up `progress`: it lies flat on
 * the surface and grows up out of it, flush at 0 and `SLAB_THICKNESS` tall at 1. Exported so
 * a scene's fog / rain stand-ins and tap target match the drawing.
 */
export function sortPlatformTopZ(surfaceZ: number, progress = 1): number {
    const p = Math.max(0, Math.min(1, progress));
    return surfaceZ + SLAB_THICKNESS * p;
}
