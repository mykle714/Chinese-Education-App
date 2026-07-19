/**
 * Pure geometry for the DECAY-time "dangling template" prune (no DB, no I/O) — the counterpart to
 * {@link ./templatePlacement} (spawn geometry). Consumed by
 * NightMarketPlacementService.pruneDanglingTemplates; kept pure so the adjacency fixpoint is unit-
 * testable in isolation.
 *
 * Rule (see docs/NIGHT_MARKET_TEMPLATES.md § "Losing minutes removes templates"): after decay, a
 * placement is removable when it is EMPTY (0 occupants), NOT the starter hub, and touches other
 * placements on {0, 1, or 2 ADJACENT} sides — never an opposing pair (a corridor/bridge). Removal is
 * iterated to a fixpoint because peeling one placement can expose others.
 */

/** A placement's footprint on the continent, half-open `[colMin,colMax) × [rowMin,rowMax)`. */
export interface PruneRect {
  id: string;
  templateName: string;
  colMin: number;
  colMax: number;
  rowMin: number;
  rowMax: number;
}

/**
 * Which of `rect`'s four edges are touched by a DISTINCT other placement in `present` — a neighbour
 * sitting flush against that edge with the perpendicular span overlapping. Axis-grouped: east/west
 * are the col-edges, high/low are the row-edges.
 */
function touchedSides(
  rect: PruneRect,
  present: PruneRect[],
): { hasEast: boolean; hasWest: boolean; hasHigh: boolean; hasLow: boolean } {
  let hasEast = false;
  let hasWest = false;
  let hasHigh = false;
  let hasLow = false;
  for (const other of present) {
    if (other.id === rect.id) continue;
    const rowsOverlap = other.rowMin < rect.rowMax && other.rowMax > rect.rowMin;
    const colsOverlap = other.colMin < rect.colMax && other.colMax > rect.colMin;
    if (rowsOverlap) {
      if (other.colMin === rect.colMax) hasEast = true; // flush against the high-col edge
      if (other.colMax === rect.colMin) hasWest = true; // …the low-col edge
    }
    if (colsOverlap) {
      if (other.rowMin === rect.rowMax) hasHigh = true; // flush against the high-row edge
      if (other.rowMax === rect.rowMin) hasLow = true; //  …the low-row edge
    }
  }
  return { hasEast, hasWest, hasHigh, hasLow };
}

/**
 * Is `rect` removable given the surviving `present` set, per-placement occupant counts, and the hub
 * name? Empty + non-hub + at most one neighbour per axis (`!(E&&W) && !(high&&low)`), which encodes
 * "{0,1,2-adjacent} touched sides, never an opposing bridge".
 */
export function isPrunable(
  rect: PruneRect,
  present: PruneRect[],
  occCount: Map<string, number>,
  hubTemplateName: string,
): boolean {
  if (rect.templateName === hubTemplateName) return false;
  if ((occCount.get(rect.id) ?? 0) > 0) return false;
  const { hasEast, hasWest, hasHigh, hasLow } = touchedSides(rect, present);
  return !(hasEast && hasWest) && !(hasHigh && hasLow);
}

/**
 * Iteratively peel every removable placement until a pass removes nothing (a fixpoint), returning
 * the ids to delete. Removal only ever REDUCES a neighbour's touched-side set, so `isPrunable` is
 * monotonic and the result is order-independent — we can remove all currently-removable placements
 * each pass. Placement counts per user are small (tens), so the O(n²)/pass scan is cheap.
 */
export function prunableDanglingPlacements(
  rects: PruneRect[],
  occCount: Map<string, number>,
  hubTemplateName: string,
): string[] {
  let present = rects;
  const removedIds: string[] = [];
  for (;;) {
    const survivors = present.filter((r) => !isPrunable(r, present, occCount, hubTemplateName));
    if (survivors.length === present.length) break; // fixpoint
    for (const r of present) {
      if (!survivors.includes(r)) removedIds.push(r.id);
    }
    present = survivors;
  }
  return removedIds;
}
