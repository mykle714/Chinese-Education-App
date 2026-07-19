/**
 * templatePlacement — the pure SPAWN geometry engine (docs/NIGHT_MARKET_TEMPLATES.md
 * § "Edge signatures" + § "Tiling & Placement"). Given the user's current continent of placed
 * templates and the authored catalog, it decides WHERE a new template attaches when every
 * placeholder slot is full: enumerate exposed street anchors → match complement-direction,
 * equal-width catalog anchors → discard illegal seams → rank by streets-joined → maximin-spread
 * tiebreak → random tiebreak.
 *
 * LAYER: dep-free shared engine (same `server/dal/shared/*` family as versionSelection). No DB,
 * no React. Consumed by {@link ../../services/NightMarketPlacementService} at spawn time only —
 * the result is PERSISTED to `nightmarkettemplatelocations`, so the algorithm runs ONCE,
 * server-side, and is never recomputed on the client (§ "How a new template attaches").
 *
 * COORDINATE CONVENTION (matches versionSelection + the runtime): cell key `"col,row"`;
 * +col = east, +row = NORTH; local (0,0) = SW/min-iso corner. Compass labels follow the runtime's
 * {@link ./versionSelection.outerEdgesOf} (row = height-1 → north, row 0 → south), NOT the doc's
 * "Edge signatures" bit-order table (which labels row 0 = north). ⚠️ This is a KNOWN doc
 * inconsistency — see the note in § "Edge signatures". It does not affect correctness here:
 * anchors are matched by COMPLEMENT pairing + cell coincidence in a consistent along-edge read
 * direction, and the hard constraint is the cell-level {@link isPlacementLegal} check, not the
 * compass label. NOTE: this engine is version-agnostic — the CALLER decides which version's street
 * mask each {@link CatalogVersion} carries. `NightMarketPlacementService.spawnTemplate` supplies each
 * candidate at its MOST-CONDITIONED version (not the base v0, which is empty and exposes no anchors),
 * so candidacy reflects a template's full attachment potential; recompute-on-read then settles the
 * placed template's final active version on the next layout read (§ "Version selection rule").
 */

import {
  type Cardinal,
  outerEdgesOf,
  globalOccupied,
  type PlacementOccupancy,
} from './versionSelection.js';

/** Cell-key format shared by every mask here. */
const tileKey = (col: number, row: number): string => `${col},${row}`;
function parseCell(key: string): [number, number] {
  const [col, row] = key.split(',').map(Number);
  return [col, row];
}

/** Outward step (Δcol, Δrow) per compass direction (+col = east, +row = NORTH). */
const OUTWARD: Record<Cardinal, readonly [number, number]> = {
  n: [0, 1],
  s: [0, -1],
  e: [1, 0],
  w: [-1, 0],
};

/** The opposite cardinal — the only edge a non-rotated template can mate with (n↔s, e↔w). */
export function complement(edge: Cardinal): Cardinal {
  return edge === 'n' ? 's' : edge === 's' ? 'n' : edge === 'e' ? 'w' : 'e';
}

/** A placed template's board rectangle as LOCAL "col,row" cell keys (its full w×h footprint). */
export function boardCells(width: number, height: number): Set<string> {
  const cells = new Set<string>();
  for (let col = 0; col < width; col++) for (let row = 0; row < height; row++) cells.add(tileKey(col, row));
  return cells;
}

// ── Anchors ───────────────────────────────────────────────────────────────────────────────

/**
 * One maximal contiguous run of street-walkable boundary cells on a single edge of a template,
 * described in the template's LOCAL along-edge coordinate. `alongStart` is the run's minimum
 * along-edge coordinate (col for n/s edges — which vary by col; row for e/w edges — which vary by
 * row), so two mating anchors on a shared seam align by equating their along-edge coordinates.
 */
export interface TemplateAnchor {
  edge: Cardinal;
  /** Minimum along-edge LOCAL coordinate of the run (col on n/s edges, row on e/w edges). */
  alongStart: number;
  /** Number of cells in the run. */
  width: number;
}

/** The LOCAL boundary cells of one edge, in ascending along-edge order (col for n/s, row for e/w). */
function edgeCells(edge: Cardinal, width: number, height: number): Array<{ col: number; row: number; along: number }> {
  const out: Array<{ col: number; row: number; along: number }> = [];
  if (edge === 'n' || edge === 's') {
    const row = edge === 'n' ? height - 1 : 0;
    for (let col = 0; col < width; col++) out.push({ col, row, along: col });
  } else {
    const col = edge === 'e' ? width - 1 : 0;
    for (let row = 0; row < height; row++) out.push({ col, row, along: row });
  }
  return out;
}

/**
 * All street anchors of a template version — per edge, the maximal contiguous runs of
 * street-walkable boundary cells. Derived from the cell grid (never hand-entered), so it can't
 * drift from the walkability. Mirror of the doc's anchor derivation (§ "Anchors and the anchor
 * index").
 */
export function deriveAnchors(street: Set<string>, width: number, height: number): TemplateAnchor[] {
  const anchors: TemplateAnchor[] = [];
  for (const edge of ['n', 's', 'e', 'w'] as const) {
    let runStart = -1;
    let runLen = 0;
    const cells = edgeCells(edge, width, height);
    const flush = () => {
      if (runLen > 0) anchors.push({ edge, alongStart: runStart, width: runLen });
      runStart = -1;
      runLen = 0;
    };
    for (const c of cells) {
      if (street.has(tileKey(c.col, c.row))) {
        if (runLen === 0) runStart = c.along;
        runLen++;
      } else {
        flush();
      }
    }
    flush();
  }
  return anchors;
}

// ── Placed continent + catalog ──────────────────────────────────────────────────────────────

/** A template placed in the user's continent — its persisted location + its active version's street mask. */
export interface PlacedTemplate {
  /** Placement row id (`nightmarkettemplatelocations.id`); undefined for a not-yet-persisted candidate. */
  id?: string;
  templateName: string;
  activeVersion: number;
  offsetCol: number;
  offsetRow: number;
  width: number;
  height: number;
  /** The active version's street-walkable LOCAL cells. */
  street: Set<string>;
}

/** One catalog candidate a spawn can place — a specific (name, version) with its street + anchors. */
export interface CatalogVersion {
  templateName: string;
  version: number;
  width: number;
  height: number;
  street: Set<string>;
  anchors: TemplateAnchor[];
}

/** `anchorIndex[edge][width]` → every catalog anchor of that complement direction + width. */
export type AnchorIndex = Map<Cardinal, Map<number, Array<{ cv: CatalogVersion; anchor: TemplateAnchor }>>>;

/** Index the catalog by (edge, width) so "every template with a width-W west anchor" is a direct lookup. */
export function buildAnchorIndex(catalog: readonly CatalogVersion[]): AnchorIndex {
  const index: AnchorIndex = new Map();
  for (const cv of catalog) {
    for (const anchor of cv.anchors) {
      let byWidth = index.get(anchor.edge);
      if (!byWidth) index.set(anchor.edge, (byWidth = new Map()));
      let list = byWidth.get(anchor.width);
      if (!list) byWidth.set(anchor.width, (list = []));
      list.push({ cv, anchor });
    }
  }
  return index;
}

// ── Exposed continent anchors ─────────────────────────────────────────────────────────────

/** One exposed anchor on the continent: a run on placed template `owner`'s edge, in GLOBAL coords. */
export interface ExposedAnchor {
  owner: PlacedTemplate;
  edge: Cardinal;
  /** Minimum along-edge GLOBAL coordinate of the run (global col on n/s, global row on e/w). */
  globalAlongStart: number;
  width: number;
  /** Run-centroid Manhattan distance from the map origin (0,0), for the closest-anchor ranking. */
  originDistance: number;
}

/** Every placed template's footprint as a {@link PlacementOccupancy} (local cells + offset). */
function footprints(placed: readonly PlacedTemplate[]): PlacementOccupancy[] {
  return placed.map((p) => ({ offsetCol: p.offsetCol, offsetRow: p.offsetRow, cells: boardCells(p.width, p.height) }));
}

/**
 * Enumerate every EXPOSED street anchor across the continent: maximal contiguous runs of
 * street-walkable boundary cells whose outward-normal neighbor is void (not occupied by any placed
 * template). Each run is a concrete global cell run + (edge, width). Ranked-later by
 * {@link ExposedAnchor.originDistance}. Mirror of placement-algorithm step 1.
 */
export function exposedAnchors(placed: readonly PlacedTemplate[]): ExposedAnchor[] {
  const occupied = globalOccupied(footprints(placed));
  const out: ExposedAnchor[] = [];

  for (const owner of placed) {
    for (const edge of ['n', 's', 'e', 'w'] as const) {
      const [dc, dr] = OUTWARD[edge];
      const cells = edgeCells(edge, owner.width, owner.height);

      // A boundary cell qualifies iff it is street AND its outward neighbor (global) is void.
      const qualifies = (c: { col: number; row: number }): boolean => {
        if (!owner.street.has(tileKey(c.col, c.row))) return false;
        const gc = c.col + owner.offsetCol;
        const gr = c.row + owner.offsetRow;
        return !occupied.has(tileKey(gc + dc, gr + dr));
      };

      let runStart = -1;
      let runLen = 0;
      const flush = () => {
        if (runLen > 0) {
          // Along-edge global start: col-offset for n/s edges, row-offset for e/w edges.
          const globalAlongStart = runStart + (edge === 'n' || edge === 's' ? owner.offsetCol : owner.offsetRow);
          const centroidAlong = globalAlongStart + (runLen - 1) / 2;
          // The run sits on a fixed cross-axis line; distance uses both axes of the centroid.
          const [cCol, cRow] =
            edge === 'n' || edge === 's'
              ? [centroidAlong, (edge === 'n' ? owner.height - 1 : 0) + owner.offsetRow]
              : [(edge === 'e' ? owner.width - 1 : 0) + owner.offsetCol, centroidAlong];
          out.push({ owner, edge, globalAlongStart, width: runLen, originDistance: Math.abs(cCol) + Math.abs(cRow) });
        }
        runStart = -1;
        runLen = 0;
      };
      for (const c of cells) {
        if (qualifies(c)) {
          if (runLen === 0) runStart = c.along;
          runLen++;
        } else {
          flush();
        }
      }
      flush();
    }
  }

  return out;
}

// ── Legality (cell-level seam check) ────────────────────────────────────────────────────────

/** A candidate placement (a catalog version pinned at an offset) for legality/scoring checks. */
export interface CandidatePlacement {
  templateName: string;
  version: number;
  offsetCol: number;
  offsetRow: number;
  width: number;
  height: number;
  street: Set<string>;
}

type Footprintable = { offsetCol: number; offsetRow: number; width: number; height: number; street: Set<string> };

/** Whether a GLOBAL cell is street-walkable for a placed/candidate template (local lookup). */
function isStreetAt(t: Footprintable, globalCol: number, globalRow: number): boolean {
  return t.street.has(tileKey(globalCol - t.offsetCol, globalRow - t.offsetRow));
}

/** Whether a GLOBAL cell falls inside a template's footprint rectangle. */
function coversGlobal(t: Footprintable, globalCol: number, globalRow: number): boolean {
  const lc = globalCol - t.offsetCol;
  const lr = globalRow - t.offsetRow;
  return lc >= 0 && lc < t.width && lr >= 0 && lr < t.height;
}

/**
 * `isPlacementLegal` — the cell-level seam check (§ "isPlacementLegal"). Two placed templates are
 * legal together iff (a) their footprint rectangles are DISJOINT (any overlap ⇒ illegal), and
 * (b) across every shared seam, each orthogonally-adjacent cell pair agrees on walkability (both
 * street or both non-street). Generalizes the whole-edge "equal facing-edge signatures" rule to
 * partial / multi-template abutment.
 */
export function isPlacementLegal(a: Footprintable, b: Footprintable): boolean {
  // (a) No rectangle overlap.
  const overlap =
    a.offsetCol < b.offsetCol + b.width &&
    b.offsetCol < a.offsetCol + a.width &&
    a.offsetRow < b.offsetRow + b.height &&
    b.offsetRow < a.offsetRow + a.height;
  if (overlap) return false;

  // (b) Seam compatibility: every A-cell / adjacent-B-cell pair must agree on street-walkability.
  for (let lc = 0; lc < a.width; lc++) {
    for (let lr = 0; lr < a.height; lr++) {
      const gc = lc + a.offsetCol;
      const gr = lr + a.offsetRow;
      for (const [dc, dr] of Object.values(OUTWARD)) {
        const ngc = gc + dc;
        const ngr = gr + dr;
        if (!coversGlobal(b, ngc, ngr)) continue; // neighbor not in B → not a seam pair
        if (isStreetAt(a, gc, gr) !== isStreetAt(b, ngc, ngr)) return false;
      }
    }
  }
  return true;
}

// ── Scoring ─────────────────────────────────────────────────────────────────────────────────

/**
 * Count the DISTINCT contiguous street runs a candidate joins across all its seams with the
 * continent (§ step 5). A matched run = a maximal contiguous set of seam cell-pairs that are
 * street on BOTH sides; width doesn't matter — a width-4 join and a width-1 join each count 1.
 * This rewards the NUMBER of road connections, not their width.
 */
export function matchedStreetRuns(candidate: CandidatePlacement, placed: readonly PlacedTemplate[]): number {
  let runs = 0;

  for (const other of placed) {
    // Walk the candidate's boundary and collect seam cell-pairs (both-street) against `other`,
    // grouped into contiguous runs along whichever seam line the two share.
    for (const edge of ['n', 's', 'e', 'w'] as const) {
      const [dc, dr] = OUTWARD[edge];
      const cells = edgeCells(edge, candidate.width, candidate.height);
      let inRun = false;
      for (const c of cells) {
        const gc = c.col + candidate.offsetCol;
        const gr = c.row + candidate.offsetRow;
        const ngc = gc + dc;
        const ngr = gr + dr;
        const bothStreet =
          coversGlobal(other, ngc, ngr) &&
          isStreetAt(candidate, gc, gr) &&
          isStreetAt(other, ngc, ngr);
        if (bothStreet && !inRun) {
          runs++;
          inRun = true;
        } else if (!bothStreet) {
          inRun = false;
        }
      }
    }
  }

  return runs;
}

/**
 * Maximin spread (§ step 6, tiebreak): for each EXPOSED boundary cell of the candidate (outward
 * neighbor void), march along the outward normal to the first occupied cell (void ⇒ the `voidGap`
 * sentinel = "infinite"). Return the MINIMUM such gap over the candidate's exposed cells; a larger
 * minimum spreads templates apart. Anchor-touching cells (outward neighbor immediately occupied,
 * gap 0) are excluded, or the metric collapses to 0 for every candidate.
 */
export function maximinSpread(
  candidate: CandidatePlacement,
  placed: readonly PlacedTemplate[],
  voidGap = 1000,
): number {
  const occupied = globalOccupied(footprints(placed));
  let min = voidGap;

  for (const edge of ['n', 's', 'e', 'w'] as const) {
    const [dc, dr] = OUTWARD[edge];
    for (const c of edgeCells(edge, candidate.width, candidate.height)) {
      const gc = c.col + candidate.offsetCol;
      const gr = c.row + candidate.offsetRow;
      // Immediately-occupied outward neighbor ⇒ a seam/anchor-touching cell; excluded.
      if (occupied.has(tileKey(gc + dc, gr + dr))) continue;
      let gap = voidGap;
      for (let step = 1; step <= voidGap; step++) {
        if (occupied.has(tileKey(gc + dc * step, gr + dr * step))) {
          gap = step;
          break;
        }
      }
      if (gap < min) min = gap;
    }
  }

  return min;
}

// ── The spawn planner ─────────────────────────────────────────────────────────────────────

/** A fully-determined spawn decision (the row to persist), plus why it won. */
export interface SpawnPlan {
  templateName: string;
  version: number;
  offsetCol: number;
  offsetRow: number;
  matchedRuns: number;
  spread: number;
}

/** Structured `template-match-not-found` diagnostics (§ "Anchor fallback + logging"). */
export interface SpawnFailure {
  reason: 'anchor-no-legal-candidate' | 'all-anchors-exhausted';
  edge?: Cardinal;
  width?: number;
  originDistance?: number;
}

export interface SpawnResult {
  plan: SpawnPlan | null;
  /** One entry per anchor that failed to yield a legal placement (for logging). */
  failures: SpawnFailure[];
}

/**
 * Solve the unique offset that mates candidate anchor `bAnchor` to exposed continent anchor `ea`.
 * Both runs are equal width and read in the same along-edge direction, so equating their along-edge
 * coordinates pins the parallel offset; the perpendicular offset is pinned by attaching B one cell
 * beyond the owner's edge along the outward normal (templates never rotate, so B's mating edge is
 * `complement(ea.edge)`). See the per-edge derivation in the module doc.
 */
function solveOffset(ea: ExposedAnchor, cv: CatalogVersion, bAnchor: TemplateAnchor): { offsetCol: number; offsetRow: number } {
  const owner = ea.owner;
  switch (ea.edge) {
    case 'n': // B attaches north of owner; B's south edge (local row 0) sits at owner's north + 1.
      return { offsetRow: owner.offsetRow + owner.height, offsetCol: ea.globalAlongStart - bAnchor.alongStart };
    case 's': // B attaches south; B's north edge (local row H-1) sits at owner's south − 1.
      return { offsetRow: owner.offsetRow - cv.height, offsetCol: ea.globalAlongStart - bAnchor.alongStart };
    case 'e': // B attaches east; B's west edge (local col 0) sits at owner's east + 1.
      return { offsetCol: owner.offsetCol + owner.width, offsetRow: ea.globalAlongStart - bAnchor.alongStart };
    case 'w': // B attaches west; B's east edge (local col W-1) sits at owner's west − 1.
      return { offsetCol: owner.offsetCol - cv.width, offsetRow: ea.globalAlongStart - bAnchor.alongStart };
  }
}

/**
 * Plan where a new template attaches (§ "Placement algorithm"). Returns the single persisted
 * placement, or `{ plan: null }` with per-anchor failures when no legal candidate exists at any
 * exposed anchor. `rng` is injectable for a deterministic random tiebreak in tests (default
 * `Math.random`); the choice is persisted, so true randomness is safe in production.
 */
export function planSpawn(
  placed: readonly PlacedTemplate[],
  catalog: readonly CatalogVersion[],
  rng: () => number = Math.random,
): SpawnResult {
  const index = buildAnchorIndex(catalog);
  const failures: SpawnFailure[] = [];

  // Step 1–2: enumerate exposed anchors, closest-to-origin first.
  const anchors = exposedAnchors(placed).sort((a, b) => a.originDistance - b.originDistance);

  for (const ea of anchors) {
    // Step 3: complement-direction, equal-width catalog candidates.
    const candidates = index.get(complement(ea.edge))?.get(ea.width) ?? [];

    type Scored = { plan: SpawnPlan; spread: number };
    const legal: Scored[] = [];

    for (const { cv, anchor } of candidates) {
      const { offsetCol, offsetRow } = solveOffset(ea, cv, anchor);
      const candidate: CandidatePlacement = {
        templateName: cv.templateName,
        version: cv.version,
        offsetCol,
        offsetRow,
        width: cv.width,
        height: cv.height,
        street: cv.street,
      };

      // Step 4: legal against EVERY placed template it would touch.
      if (!placed.every((p) => isPlacementLegal(candidate, p))) continue;

      const matchedRuns = matchedStreetRuns(candidate, placed);
      const spread = maximinSpread(candidate, placed);
      legal.push({
        plan: { templateName: cv.templateName, version: cv.version, offsetCol, offsetRow, matchedRuns, spread },
        spread,
      });
    }

    if (legal.length === 0) {
      failures.push({ reason: 'anchor-no-legal-candidate', edge: ea.edge, width: ea.width, originDistance: ea.originDistance });
      continue; // Anchor fallback: try the next-closest anchor.
    }

    // Step 5: maximize matched street runs. Step 6: maximin spread. Step 7: random among survivors.
    const bestRuns = Math.max(...legal.map((s) => s.plan.matchedRuns));
    const byRuns = legal.filter((s) => s.plan.matchedRuns === bestRuns);
    const bestSpread = Math.max(...byRuns.map((s) => s.spread));
    const survivors = byRuns.filter((s) => s.spread === bestSpread);
    const winner = survivors[Math.floor(rng() * survivors.length)] ?? survivors[0];
    return { plan: winner.plan, failures };
  }

  failures.push({ reason: 'all-anchors-exhausted' });
  return { plan: null, failures };
}
