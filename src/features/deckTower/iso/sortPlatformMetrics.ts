/**
 * sortPlatformMetrics.ts — acp's sort-bin geometry, shared with the Deck Tower's Add Cards
 * button, and that button's heights, kept out of the components so a scene can match its fog
 * / rain stand-ins and tap target to the drawing (DeckTowerPlatform → `sortBin`).
 *
 * acp (src/features/discover/SortBins.tsx) lays its four full-size bins with the S piece
 * (`SORT_BIN_CELLS`, `sortBinCellOffset`) on `SORT_BIN_PLATFORM`s `SORT_BIN_THICKNESS` thick.
 * The Deck Tower's Add Cards button (IsoSortPlatform) is ONE of those platforms — acp's
 * Comfortable bin — scaled down uniformly (`sortMiniScale`), thickness included
 * (`sortMiniThickness`), so it is an exact miniature.
 *
 * Docs: docs/ISO_ART_FRAMEWORK.md § "IsoSortPlatform", docs/DECK_TOWER.md § "The sort
 * platform", docs/SORT_CARDS_REQUIREMENTS.md § 5.3.
 */
import type { WorldRect } from "./geometry";

/**
 * The tetromino, in ISO GRID cells (+isoX is "right", up-right on screen; +isoY is "top",
 * up-left on screen; −isoY is down-right). One cell per bin, in acp's bin order — an S
 * piece (user layout 2026-11-09, flipped from the Z): Target down-right of Unfamiliar
 * (−isoY), Comfortable up-right of Target (+isoX), Mastered down-right of Comfortable
 * (−isoY). On screen the bins zigzag left to right high, low, high, low.
 *
 *     isoY  0   [ U ]
 *     isoY −1   [ T ][ C ]
 *     isoY −2        [ M ]
 *          isoX  0    1
 */
export const SORT_BIN_CELLS = [
    { isoX: 0, isoY: 0 }, // Unfamiliar
    { isoX: 0, isoY: -1 }, // Target
    { isoX: 1, isoY: -1 }, // Comfortable
    { isoX: 1, isoY: -2 }, // Mastered
] as const;
/**
 * One acp bin's platform footprint in acp's bin coordinates (world units at acp's scale):
 * portrait, w along x, d along y, a unit wider than the deck all round (the deck sits at
 * 0 → 4.4 in x — SortBinPrint.tsx → `SORT_BIN_DECK`). The bin's print is drawn in these
 * coordinates.
 */
export const SORT_BIN_PLATFORM: WorldRect = { x: -1, y: -1, w: 6.4, d: 8, r: 1 };
/** An acp bin platform's thickness (acp scale). */
export const SORT_BIN_THICKNESS = 1.2;
/** World units of floor between neighbouring acp platforms (1.4 → 1.9 on 2026-11-09, "a little" further apart). */
export const SORT_BIN_GAP = 1.9;

/**
 * A cell's offset in WORLD units at acp's scale. The iso kit's world runs +x down-right and
 * +y down-left (docs/ISO_ART_FRAMEWORK.md), so +isoX (up-right) is world −y and +isoY
 * (up-left) is world −x; one cell is a platform plus the gap on that axis.
 */
export function sortBinCellOffset(cell: { isoX: number; isoY: number }): { x: number; y: number } {
    return {
        x: -cell.isoY * (SORT_BIN_PLATFORM.w + SORT_BIN_GAP),
        y: -cell.isoX * (SORT_BIN_PLATFORM.d + SORT_BIN_GAP),
    };
}

/** A platform's depth per unit of width — a scene sizes the miniature's rect `w × SORT_BIN_ASPECT` deep. */
export const SORT_BIN_ASPECT = SORT_BIN_PLATFORM.d / SORT_BIN_PLATFORM.w;

/** How much smaller a miniature on `rect` is than acp's bin: its width over acp's platform width. */
export function sortMiniScale(rect: WorldRect): number {
    return rect.w / SORT_BIN_PLATFORM.w;
}

/**
 * A miniature's thickness: acp's 1.2 on 6.4, scaled (0.24 at the Deck Tower's 1.28 width).
 * The floor snow's depth deepens it further (DeckTowerPlatform → `sortThickness`).
 */
export function sortMiniThickness(rect: WorldRect): number {
    return SORT_BIN_THICKNESS * sortMiniScale(rect);
}

/** How high the big jump goes, world units. Exported so a scene can grow its tap target to cover it. */
export const SORT_PLATFORM_JUMP = 1.6;
/**
 * One big jump every this often. The jump and its rebounds take the first half of it
 * (1 s — the 50% mark of IsoSortPlatform's hop keyframes), and it rests for the other half.
 */
export const HOP_PERIOD_MS = 2000;

/**
 * The miniature's top z over a surface at `surfaceZ`, for a build-up `progress`: it lies flat
 * on the surface and grows up out of it, flush at 0 and `thickness` tall at 1. Exported so a
 * scene's fog / rain stand-ins and tap target match the drawing.
 */
export function sortPlatformTopZ(surfaceZ: number, progress: number, thickness: number): number {
    const p = Math.max(0, Math.min(1, progress));
    return surfaceZ + thickness * p;
}
