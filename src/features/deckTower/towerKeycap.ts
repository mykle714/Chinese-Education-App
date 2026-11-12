import { roundedEdgeFillet, roundedEdgeRimLight } from "../../theme/roundedEdge";

/**
 * towerKeycap — the box-shadow of a td HTML keycap standing on the sky: a DIAGONAL wall,
 * a hard cast shadow on the ground, and the hairline rounded edge.
 *
 * Used by td's cards-page filter keys (TowerFilterKeys), so every keycap on the tower's sky is
 * cut the same way.
 *
 * The wall is DIAGONAL, like the mini cards' card stock: box-shadow cannot slant, so it is
 * the face's outline stepped 1px at a time along (1, 1), one copy per px of wall
 * (sortCardStock.ts → `panelWall`'s technique). The cast shadow lies on the ground, so it
 * stays put while the face sinks: its offset from the face shrinks by `sunk` on both axes.
 * Flush (`sunk` = `wallPx`) leaves no wall and no fillet — only the rim light and the
 * shadow under the face. The rounded edge is theme/roundedEdge.ts (a 0.5px fillet over the
 * wall's first step, a 1px rim light on the face's top-left edge).
 *
 * Layer: feature style helper (src/features/deckTower). Pure.
 * Docs: docs/DECK_TOWER.md § "The cards page" → "Controls";
 * docs/designGuidelines.md § "The rounded edge".
 */

export interface TowerKeycapMetrics {
    /** The wall under an UP key, px. */
    wallPx: number;
    /** How far the cast shadow reaches past an UP key's wall, right and down, px. */
    castReachPx: number;
}

/** The key's shadow with its face `sunk` px down-right of its UP position. */
export function towerKeyShadow(
    face: string,
    wall: string,
    sunk: number,
    metrics: TowerKeycapMetrics,
    groundShadow: string
): string {
    const wallPx = metrics.wallPx - sunk;
    const fillet = wallPx > 0 ? [roundedEdgeFillet(face, wall)] : [];
    const steps = Array.from({ length: wallPx }, (_, i) => `${i + 1}px ${i + 1}px 0 ${wall}`);
    const cast = metrics.wallPx + metrics.castReachPx - sunk;
    return [roundedEdgeRimLight(face), ...fillet, ...steps, `${cast}px ${cast}px 0 ${groundShadow}`].join(", ");
}
