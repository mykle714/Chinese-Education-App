/**
 * versionSelection — SERVER mirror of the client's pure version-selection engine, merged into
 * one dep-free module. Combines four client engine files (all under `src/engine/market/`):
 *   • placeholderIslands.ts  → {@link labelIslands}
 *   • conditionAnalysis.ts   → {@link analyzeConditions}, {@link borderStreetCells}, {@link placeholderAreaId}
 *   • seamAdjacency.ts       → {@link outerEdgesOf}, {@link cellAbutsOthers}, {@link globalOccupied}, {@link abuttingBorderIslandIds}
 *   • versionSelector.ts     → {@link scoreVersion}, {@link conditionScoreSelector}
 *
 * WHY A MIRROR: the server can't import the client engine (it lives outside the `server/`
 * Docker build context — see the Dockerfile `COPY . .`), so the pure logic is duplicated here
 * and kept in sync BY HAND (same accepted pattern as the blocking-decor mirror in
 * NightMarketTemplateService, and the `placeholderArea.ts` mirror this file imports).
 * If you change any of the four client modules' scoring behavior, change it here too.
 *
 * LAYER: dep-free shared engine (same family as the other `server/dal/shared/*` mirrors). No
 * DB, no React, no assets. Consumed by {@link ../../services/NightMarketWorldService} to
 * RECOMPUTE each placement's active version on every layout read (docs/NIGHT_MARKET_TEMPLATE_
 * RUNTIME_PLAN.md § "Version selection — recompute on read").
 *
 * KEY PROPERTY (no fixpoint): a placement's conditions are a pure function of DB state —
 * placeholder conditions ← its filled occupant slots; border-street conditions ← whether a
 * neighbor's FOOTPRINT abuts an edge (geometry, NOT the neighbor's active version). So a single
 * pass over placements suffices; no version depends on another version's selection.
 */

import {
  placeholderAreaAt,
  placeholderCoveredCells,
  type PlaceholderArea,
} from './placeholderArea.js';

/** Cell-key format shared by every mask here (mirror of engine `tileGraph.tileKey`). */
const tileKey = (col: number, row: number): string => `${col},${row}`;

/** Parse a "col,row" cell key into a numeric coordinate pair. */
function parseCell(key: string): [number, number] {
  const [col, row] = key.split(',').map(Number);
  return [col, row];
}

// ── placeholderIslands.ts mirror ──────────────────────────────────────────────────────────

/** One 4-connected component of a cell mask. */
export interface CellIsland {
  /** Deterministic id from the island's min cell (min col, then min row). Format `"col_row"`. */
  id: string;
  cells: Set<string>;
  bbox: { minCol: number; minRow: number; maxCol: number; maxRow: number };
}

/**
 * Split a cell mask into its 4-connected components (islands). Deterministic seed order and a
 * min-cell id make the labeling stable across loads/iteration order. Explicit stack (no
 * recursion) so a large mask can't blow the call stack. Mirror of the client `labelIslands`.
 */
export function labelIslands(cells: Set<string>): CellIsland[] {
  const visited = new Set<string>();
  const islands: CellIsland[] = [];

  const seeds = [...cells].sort((a, b) => {
    const [ac, ar] = parseCell(a);
    const [bc, br] = parseCell(b);
    return ac - bc || ar - br;
  });

  for (const seed of seeds) {
    if (visited.has(seed)) continue;

    const component = new Set<string>();
    let minCol = Infinity;
    let minRow = Infinity;
    let maxCol = -Infinity;
    let maxRow = -Infinity;
    const stack = [seed];
    visited.add(seed);

    while (stack.length > 0) {
      const key = stack.pop()!;
      const [col, row] = parseCell(key);
      component.add(key);
      if (col < minCol) minCol = col;
      if (row < minRow) minRow = row;
      if (col > maxCol) maxCol = col;
      if (row > maxRow) maxRow = row;

      const neighbors = [
        tileKey(col + 1, row),
        tileKey(col - 1, row),
        tileKey(col, row + 1),
        tileKey(col, row - 1),
      ];
      for (const n of neighbors) {
        if (cells.has(n) && !visited.has(n)) {
          visited.add(n);
          stack.push(n);
        }
      }
    }

    islands.push({ id: `${minCol}_${minRow}`, cells: component, bbox: { minCol, minRow, maxCol, maxRow } });
  }

  islands.sort((a, b) => {
    const [ac, ar] = parseCell(a.id.replace('_', ','));
    const [bc, br] = parseCell(b.id.replace('_', ','));
    return ac - bc || ar - br;
  });

  return islands;
}

// ── conditionAnalysis.ts mirror ───────────────────────────────────────────────────────────

export type ConditionKind = 'placeholder' | 'border-street';

/** One classified condition (a labeled island of the combined condition mask). */
export interface ConditionIsland extends CellIsland {
  kind: ConditionKind;
  /** PLACEHOLDER islands: anchor id ("col_row") of the area they sit on (an unlock's `placeholderAreaId`). */
  placeholderAreaId?: string;
  /** True when a mixed-substrate island was coerced to placeholder (fallback path). */
  mixedFallback?: boolean;
}

/** The result of analyzing one version's condition mask. */
export interface ConditionAnalysis {
  islands: ConditionIsland[];
  /** Canonical per-version condition count = number of islands (the scoring denominator). */
  conditionCount: number;
}

export interface ConditionAnalysisInput {
  /** The author's MANUAL condition cells (placeholder-substrate), LOCAL coords. */
  condition: Set<string>;
  /** The authored placeholder areas ({col,row,w,h}) — the shared v0 set. */
  placeholderAreas: readonly PlaceholderArea[];
  /** The version's street-walkable cells, LOCAL coords. */
  street: Set<string>;
  width: number;
  height: number;
}

/** An anchor-id ("col_row") for an authored placeholder area — stable + unique (areas can't overlap). */
export function placeholderAreaId(area: PlaceholderArea): string {
  return `${area.col}_${area.row}`;
}

/** The outer-edge street cells of a board — the auto-added border-street condition cells. */
export function borderStreetCells(street: Set<string>, width: number, height: number): Set<string> {
  const out = new Set<string>();
  for (const key of street) {
    const [col, row] = parseCell(key);
    if (col === 0 || col === width - 1 || row === 0 || row === height - 1) out.add(key);
  }
  return out;
}

/** Find the authored area id covering any of an island's cells. Mirror of the client helper. */
function areaIdForIsland(island: CellIsland, areas: readonly PlaceholderArea[]): string | undefined {
  for (const key of island.cells) {
    const [col, row] = parseCell(key);
    const area = placeholderAreaAt(areas, col, row);
    if (area) return placeholderAreaId(area);
  }
  return undefined;
}

/**
 * Classify a version's condition mask into scored conditions. Re-derives border-street cells
 * from `street ∩ outer-edge` (canonical-at-load — never trust the persisted border cells),
 * labels the union of manual + border cells into 4-connected islands, and classifies each by
 * substrate. Mirror of the client `analyzeConditions`.
 */
export function analyzeConditions(input: ConditionAnalysisInput): ConditionAnalysis {
  const { condition, placeholderAreas, street, width, height } = input;

  const borderCells = borderStreetCells(street, width, height);
  const placeholderCells = placeholderCoveredCells(placeholderAreas);

  const combined = new Set<string>(condition);
  for (const c of borderCells) combined.add(c);

  const islands = labelIslands(combined).map((island): ConditionIsland => {
    let hasPlaceholder = false;
    let hasBorder = false;
    for (const cell of island.cells) {
      if (placeholderCells.has(cell)) hasPlaceholder = true;
      if (borderCells.has(cell)) hasBorder = true;
    }

    if (hasPlaceholder && hasBorder) {
      console.error(
        `[versionSelection] island ${island.id} mixes placeholder + border-street cells ` +
          `(authoring invariant: keep them non-adjacent). Coercing to a placeholder condition.`,
      );
      return { ...island, kind: 'placeholder', placeholderAreaId: areaIdForIsland(island, placeholderAreas), mixedFallback: true };
    }

    if (hasBorder) return { ...island, kind: 'border-street' };

    if (!hasPlaceholder) {
      console.error(
        `[versionSelection] island ${island.id} sits on neither placeholder nor border-street ` +
          `cells (malformed). Treating as an unsatisfiable placeholder condition.`,
      );
    }
    return { ...island, kind: 'placeholder', placeholderAreaId: areaIdForIsland(island, placeholderAreas) };
  });

  return { islands, conditionCount: islands.length };
}

// ── seamAdjacency.ts mirror ───────────────────────────────────────────────────────────────

/** A cardinal edge / outward normal direction. */
export type Cardinal = 'n' | 'e' | 's' | 'w';

/** Outward step (Δcol, Δrow) per compass direction (+isoX = east = +col, +isoY = NORTH = +row). */
const OUTWARD: Record<Cardinal, readonly [number, number]> = {
  n: [0, 1],
  s: [0, -1],
  e: [1, 0],
  w: [-1, 0],
};

/** Which outer edges a LOCAL cell (col,row) lies on, for a width×height board (corners → two). */
export function outerEdgesOf(col: number, row: number, width: number, height: number): Cardinal[] {
  const edges: Cardinal[] = [];
  if (row === height - 1) edges.push('n');
  if (row === 0) edges.push('s');
  if (col === 0) edges.push('w');
  if (col === width - 1) edges.push('e');
  return edges;
}

/** One placement's occupancy: its LOCAL cells + offset (translated to global by {@link globalOccupied}). */
export interface PlacementOccupancy {
  offsetCol: number;
  offsetRow: number;
  /** LOCAL occupied cell keys "col,row" (the template's footprint). */
  cells: Set<string>;
}

/** Union of every placement's cells in GLOBAL coordinates. */
export function globalOccupied(placements: readonly PlacementOccupancy[]): Set<string> {
  const out = new Set<string>();
  for (const p of placements) {
    for (const key of p.cells) {
      const [col, row] = parseCell(key);
      out.add(tileKey(col + p.offsetCol, row + p.offsetRow));
    }
  }
  return out;
}

/** Whether a GLOBAL cell has an orthogonal neighbor in `occupiedByOthers` (restrict to `dirs`). */
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
 * their outer edge). Directional. Mirror of the client `abuttingBorderIslandIds`.
 */
export function abuttingBorderIslandIds(input: BorderAbutmentInput): Set<string> {
  const { islands, offsetCol, offsetRow, width, height, occupiedByOthers } = input;
  const satisfied = new Set<string>();

  for (const island of islands) {
    if (island.kind !== 'border-street') continue;
    for (const key of island.cells) {
      const [col, row] = parseCell(key);
      const dirs = outerEdgesOf(col, row, width, height);
      if (dirs.length === 0) continue;
      if (cellAbutsOthers(col + offsetCol, row + offsetRow, occupiedByOthers, dirs)) {
        satisfied.add(island.id);
        break;
      }
    }
  }

  return satisfied;
}

// ── versionSelector.ts mirror ─────────────────────────────────────────────────────────────

/** Per-version condition state the scored selector needs. */
export interface VersionConditionState {
  analysis: ConditionAnalysis;
  abuttingBorderIslandIds: Set<string>;
}

/** What the scored selector keys on. */
export interface VersionSelectContext {
  name: string;
  offsetCol: number;
  offsetRow: number;
  /** Placeholder-area ids filled by an unlock, for THIS placement (same across versions). */
  filledPlaceholderIds?: Set<string>;
  /** Per-candidate-version condition state (islands, count, abutting border islands). */
  byVersion?: Map<number, VersionConditionState>;
}

/** A version's satisfaction breakdown — `score = satisfied / count` (0/0 defined as 0). */
export interface VersionScore {
  satisfied: number;
  count: number;
  score: number;
}

/**
 * Score one version: how many of its conditions are currently satisfied, over its total.
 * Mirror of the client `scoreVersion`.
 */
export function scoreVersion(state: VersionConditionState, filledPlaceholderIds: Set<string>): VersionScore {
  const { islands, conditionCount } = state.analysis;
  let satisfied = 0;
  for (const island of islands) {
    if (island.kind === 'placeholder') {
      if (island.placeholderAreaId && filledPlaceholderIds.has(island.placeholderAreaId)) satisfied++;
    } else if (state.abuttingBorderIslandIds.has(island.id)) {
      satisfied++;
    }
  }
  const score = conditionCount > 0 ? satisfied / conditionCount : 0;
  return { satisfied, count: conditionCount, score };
}

/**
 * The REAL version-selection rule: render the version satisfying the most conditions in ABSOLUTE
 * terms (highest `satisfied` count). Tiebreaks: higher `satisfied / conditionCount` ratio, then
 * LOWEST version number (so version 0 — no conditions, satisfied 0, 0/0 = 0 — wins every all-zero
 * tie). Mirror of client `conditionScoreSelector`.
 */
export function conditionScoreSelector(availableVersions: number[], ctx: VersionSelectContext): number {
  if (availableVersions.length === 0) return 0;
  const versions = [...availableVersions].sort((a, b) => a - b);
  if (!ctx.byVersion) return versions[0]; // no scoring inputs → base version

  const filled = ctx.filledPlaceholderIds ?? new Set<string>();
  let best = versions[0];
  let bestSatisfied = -1;
  let bestScore = -1;

  // Primary key: absolute satisfied count. Tiebreak: satisfied/count ratio, then lowest version
  // (ascending iteration + strict `>` keeps the lower version on a full tie).
  for (const v of versions) {
    const state = ctx.byVersion.get(v);
    const { satisfied, score } = state ? scoreVersion(state, filled) : { satisfied: 0, score: 0 };
    if (satisfied > bestSatisfied || (satisfied === bestSatisfied && score > bestScore)) {
      best = v;
      bestSatisfied = satisfied;
      bestScore = score;
    }
  }
  return best;
}
