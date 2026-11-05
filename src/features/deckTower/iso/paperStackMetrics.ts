/**
 * paperStackMetrics.ts — how tall an IsoPaperStack is (docs/ISO_ART_FRAMEWORK.md
 * § "IsoPaperStack"). Kept out of the component, as cardStackMetrics.ts is for IsoCardStack,
 * so the scene can read the same numbers for the stack's stand-ins.
 *
 * Depended on by: IsoPaperStack.tsx (drawing), DeckTowerPlatform.tsx (fog / rain / tap-target height).
 */

/** World thickness of one sheet: ~1px on a ~390px phone (one world unit ≈ 16.5px). */
export const PAPER_SHEET_THICKNESS = 0.06;

/**
 * World height of a stack of `sheets` at build-up `progress`: the top sheet always, the
 * rest grown in by `progress`. Also read by the Deck Tower for the stack's fog / rain /
 * tap-target height (DeckTowerPlatform), so the solid and its stand-ins never disagree.
 */
export function paperStackHeight(sheets: number, progress = 1): number {
    if (sheets <= 0) return 0;
    return (1 + (sheets - 1) * Math.min(1, Math.max(0, progress))) * PAPER_SHEET_THICKNESS;
}
