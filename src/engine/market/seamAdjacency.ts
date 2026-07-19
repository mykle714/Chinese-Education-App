import { tileKey } from './tileGraph';
import type { ConditionIsland } from './conditionAnalysis';

/**
 * seamAdjacency — pure geometry for "does this template abut a neighbor across an edge?"
 * (docs/NIGHT_MARKET_TEMPLATES.md § "Version selection rule" → border-street conditions,
 * § "How a new template attaches" → exposed anchors;
 * docs/NIGHT_MARKET_TEMPLATE_RUNTIME_PLAN.md § "Version selection — seam adjacency").
 *
 * LAYER: pure engine. No React, no DB, no assets. A pure function of placements' occupied
 * cells + offsets — independent of any active version, so version selection has NO fixpoint:
 * a border-street condition is satisfied by footprint ABUTMENT, not by walkability.
 *
 * ── What this answers ───────────────────────────────────────────────────────────────────
 * A border-street condition island (outer-edge street cells) is satisfied when a SEPARATE
 * placed template abuts across that edge. Abutment is directional: a neighbor to the north
 * satisfies only a north-edge island. {@link abuttingBorderIslandIds} resolves, for one
 * placement, which of its border-street islands abut — the boolean input the version
 * selector consumes (so the selector itself stays pure scoring).
 *
 * This is the same "exposed vs. abutting boundary cell" primitive `spawnTemplate` needs
 * (an exposed anchor is a boundary run that does NOT abut) — {@link cellAbutsOthers} is the
 * shared core; the placement algorithm can reuse it when it lands (slice 3).
 *
 * DEPENDS ON: {@link ./tileGraph tileKey}, {@link ./conditionAnalysis ConditionIsland}.
 */

/** A cardinal edge / outward normal direction. */
export type Cardinal = 'n' | 'e' | 's' | 'w';

/**
 * Outward step (Δcol, Δrow) per compass direction, following the project's iso axes
 * (isometric.ts): +isoX = east = +col, +isoY = NORTH = +row. So north = +row, south = −row,
 * east = +col, west = −col. (Note: because +row is north, the MIN-iso corner (col 0, row 0)
 * is the SOUTH-WEST corner — the near/front corner of the footprint.)
 */
const OUTWARD: Record<Cardinal, readonly [number, number]> = {
  n: [0, 1],
  s: [0, -1],
  e: [1, 0],
  w: [-1, 0],
};

/** Which outer edges a LOCAL cell (col,row) lies on, for a width×height board (corners → two). */
export function outerEdgesOf(col: number, row: number, width: number, height: number): Cardinal[] {
  const edges: Cardinal[] = [];
  if (row === height - 1) edges.push('n'); // max row = north edge (+isoY)
  if (row === 0) edges.push('s'); // row 0 = south edge (min-iso / near corner)
  if (col === 0) edges.push('w'); // col 0 = west edge (min-iso)
  if (col === width - 1) edges.push('e'); // max col = east edge
  return edges;
}

/** One placement's global occupied cells: its LOCAL cells translated by (offsetCol, offsetRow). */
export interface PlacementOccupancy {
  offsetCol: number;
  offsetRow: number;
  /** LOCAL occupied cell keys "col,row" (union of the template's walkable/footprint masks). */
  cells: Set<string>;
}

/** Union of every placement's cells in GLOBAL coordinates. */
export function globalOccupied(placements: readonly PlacementOccupancy[]): Set<string> {
  const out = new Set<string>();
  for (const p of placements) {
    for (const key of p.cells) {
      const [col, row] = key.split(',').map(Number);
      out.add(tileKey(col + p.offsetCol, row + p.offsetRow));
    }
  }
  return out;
}

/**
 * Whether a GLOBAL cell has an orthogonal neighbor in `occupiedByOthers` — the shared
 * "abuts a different template" test (4-connectivity). Restrict directions with `dirs` (e.g.
 * only a cell's outward-edge normals); omit to test all four.
 */
export function cellAbutsOthers(
  globalCol: number,
  globalRow: number,
  occupiedByOthers: Set<string>,
  dirs: readonly Cardinal[] = ['n', 'e', 's', 'w'],
): boolean {
  for (const d of dirs) {
    const [dc, dr] = OUTWARD[d];
    if (occupiedByOthers.has(tileKey(globalCol + dc, globalRow + dr))) return true;
  }
  return false;
}

export interface BorderAbutmentInput {
  /** This placement's border-street condition islands (LOCAL coords, from analyzeConditions). */
  islands: readonly ConditionIsland[];
  offsetCol: number;
  offsetRow: number;
  width: number;
  height: number;
  /** GLOBAL occupied cells of every OTHER placed template (exclude this placement). */
  occupiedByOthers: Set<string>;
}

/**
 * Resolve which border-street islands of one placement are SATISFIED (abut a neighbor across
 * their outer edge). Directional: each island cell is tested only along the outward normals
 * of the edge(s) it sits on, so a neighbor on a different side does not spuriously satisfy it.
 *
 * Returns the set of satisfied island ids — fed straight to the version selector.
 */
export function abuttingBorderIslandIds(input: BorderAbutmentInput): Set<string> {
  const { islands, offsetCol, offsetRow, width, height, occupiedByOthers } = input;
  const satisfied = new Set<string>();

  for (const island of islands) {
    if (island.kind !== 'border-street') continue;
    for (const key of island.cells) {
      const [col, row] = key.split(',').map(Number);
      const dirs = outerEdgesOf(col, row, width, height);
      if (dirs.length === 0) continue; // defensive: a border island cell should be on an edge
      if (cellAbutsOthers(col + offsetCol, row + offsetRow, occupiedByOthers, dirs)) {
        satisfied.add(island.id);
        break; // one abutting cell satisfies the whole island
      }
    }
  }

  return satisfied;
}
