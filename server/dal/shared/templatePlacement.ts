/**
 * templatePlacement — the pure SPAWN geometry engine (docs/NIGHT_MARKET_TEMPLATES.md
 * § "Edge signatures" + § "Tiling & Placement"). Given the user's current continent of placed
 * templates and the authored catalog, it decides WHERE a new template attaches when every
 * placeholder slot is full: enumerate exposed street anchors → match complement-direction,
 * equal-width catalog anchors → discard illegal seams → discard candidates that would FLANK a
 * still-open street mouth ({@link flankedAnchorKeys}) → discard candidates that would SEAL the
 * continent (the injected {@link SealCheck}) → rank by fewest same-name neighbors → streets-joined →
 * most distinct templates touched → maximin-spread tiebreak → random tiebreak.
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
  globalOccupied,
  boardCells,
  type PlacementOccupancy,
} from './versionSelection.js';

// `boardCells` lives in versionSelection (single source — the layout read and the seal simulation
// need it too); re-exported here because this module's callers/tests have always imported it here.
export { boardCells };

/** Cell-key format shared by every mask here. */
const tileKey = (col: number, row: number): string => `${col},${row}`;

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

// ── Flank ban (a street mouth may not run alongside a neighbour's outer edge) ───────────────

/**
 * The two DIAGONAL flank cells of an exposed anchor, in GLOBAL coords: step one cell along the
 * outward normal, then one cell "left" and "right" along the edge axis — i.e. the cells just off
 * each END of the anchor's outward-facing mouth.
 *
 * (The cells directly outward of the run itself need no test: {@link exposedAnchors} only emits a
 * cell whose outward neighbour is void, so the whole outward strip is void by construction. The
 * flanks are the only two cells the ban adds.)
 */
export function anchorFlankCells(a: ExposedAnchor): Array<[number, number]> {
  const [dc, dr] = OUTWARD[a.edge];
  const alongLo = a.globalAlongStart - 1;
  const alongHi = a.globalAlongStart + a.width;

  if (a.edge === 'n' || a.edge === 's') {
    // n/s runs vary by COL on a fixed global row; flanks step outward (±row) and along (±col).
    const row = a.owner.offsetRow + (a.edge === 'n' ? a.owner.height - 1 : 0) + dr;
    return [
      [alongLo, row],
      [alongHi, row],
    ];
  }
  // e/w runs vary by ROW on a fixed global col.
  const col = a.owner.offsetCol + (a.edge === 'e' ? a.owner.width - 1 : 0) + dc;
  return [
    [col, alongLo],
    [col, alongHi],
  ];
}

/** Stable identity for an exposed anchor: its edge + the global cell run it occupies. */
function exposedAnchorKey(a: ExposedAnchor): string {
  const cross =
    a.edge === 'n' || a.edge === 's'
      ? a.owner.offsetRow + (a.edge === 'n' ? a.owner.height - 1 : 0)
      : a.owner.offsetCol + (a.edge === 'e' ? a.owner.width - 1 : 0);
  return `${a.edge}:${cross}:${a.globalAlongStart}:${a.width}`;
}

/**
 * Every exposed anchor in a world whose mouth is FLANKED — a template occupies one of its
 * {@link anchorFlankCells}. Such a street runs flush alongside that neighbour's outer edge, which
 * is banned (§ "The flank ban"): the mouth can never be attached to, and the road visually dies
 * against the side of a board.
 *
 * Returned as KEYS rather than a boolean so {@link planSpawn} can veto only the violations a
 * candidate *introduces*. Vetoing on the absolute count would deadlock spawning forever if a world
 * already contains a flanked anchor (a layout persisted before this ban existed) — every candidate
 * would inherit the pre-existing violation and be rejected.
 */
export function flankedAnchorKeys(placed: readonly PlacedTemplate[]): Set<string> {
  const occupied = globalOccupied(footprints(placed));
  const flanked = new Set<string>();

  for (const a of exposedAnchors(placed)) {
    for (const [col, row] of anchorFlankCells(a)) {
      if (occupied.has(tileKey(col, row))) {
        flanked.add(exposedAnchorKey(a));
        break;
      }
    }
  }

  return flanked;
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
export function rectsOverlap(a: Footprintable, b: Footprintable): boolean {
  return (
    a.offsetCol < b.offsetCol + b.width &&
    b.offsetCol < a.offsetCol + a.width &&
    a.offsetRow < b.offsetRow + b.height &&
    b.offsetRow < a.offsetRow + a.height
  );
}

export function isPlacementLegal(a: Footprintable, b: Footprintable): boolean {
  // (a) No rectangle overlap.
  if (rectsOverlap(a, b)) return false;

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
 * Whether two DISJOINT footprint rectangles touch orthogonally (share a seam line with a non-empty
 * overlap along it). Corner-only contact is NOT adjacency — the rectangles meet at a point, no cell
 * pair is orthogonally adjacent, so the two templates never read as one continuous block.
 * Assumes non-overlap (guaranteed by {@link isPlacementLegal} before this is ever consulted).
 */
export function rectsAbut(a: Footprintable, b: Footprintable): boolean {
  // Vertical seam: one's right edge is the other's left edge, and their row spans overlap.
  const rowsOverlap = a.offsetRow < b.offsetRow + b.height && b.offsetRow < a.offsetRow + a.height;
  const colsOverlap = a.offsetCol < b.offsetCol + b.width && b.offsetCol < a.offsetCol + a.width;
  const touchVertically = a.offsetCol + a.width === b.offsetCol || b.offsetCol + b.width === a.offsetCol;
  const touchHorizontally = a.offsetRow + a.height === b.offsetRow || b.offsetRow + b.height === a.offsetRow;
  return (touchVertically && rowsOverlap) || (touchHorizontally && colsOverlap);
}

/**
 * Count how many already-placed instances of the SAME template the candidate would sit flush
 * against (§ step 4c / step 5). This is a SOFT signal, not a veto: two copies of one template
 * touching reads as a visually repeated block, so we prefer any other legal candidate — but if the
 * duplicate is the only thing that mates the anchor, placing it beats stalling continent growth.
 * Compared by `templateName` only (not version): two versions of one template are the same building
 * to the eye, which is what this rule is about.
 */
export function duplicateAdjacencies(candidate: CandidatePlacement, placed: readonly PlacedTemplate[]): number {
  return placed.filter((p) => p.templateName === candidate.templateName && rectsAbut(candidate, p)).length;
}

/**
 * Count how many DISTINCT placed templates the candidate would sit flush against (§ step 5b).
 * Maximized: contact is preferred over any gap, so a candidate that seats into a concavity and
 * abuts three neighbors beats one that juts into void touching only the anchor's owner.
 *
 * Contact is FOOTPRINT abutment ({@link rectsAbut}), not street agreement — deliberately the same
 * predicate {@link ../../../src/engine/market/seamAdjacency} uses to satisfy border-street
 * conditions, so maximizing it directly raises how many conditions the version selector can
 * satisfy on the final render. The street-flavored signal already exists separately as
 * {@link matchedStreetRuns}, which outranks this key.
 *
 * Always ≥ 1: {@link solveOffset} pins the candidate flush against its anchor's owner, so the
 * owner is always counted. Same-name neighbors count here too, but they cannot smuggle a
 * duplicate past {@link duplicateAdjacencies} — that key filters FIRST, so by the time this one is
 * consulted every surviving candidate already has the same duplicate count.
 */
export function touchedTemplates(candidate: CandidatePlacement, placed: readonly PlacedTemplate[]): number {
  return placed.filter((p) => rectsAbut(candidate, p)).length;
}

/**
 * Maximin spread (§ step 6, tiebreak): for each EXPOSED boundary cell of the candidate (outward
 * neighbor void), march along the outward normal to the first occupied cell (void ⇒ the `voidGap`
 * sentinel = "infinite"). Return the MINIMUM such gap over the candidate's exposed cells; a larger
 * minimum spreads templates apart. Anchor-touching cells (outward neighbor immediately occupied,
 * gap 0) are excluded, or the metric collapses to 0 for every candidate.
 *
 * Ranked BELOW {@link touchedTemplates}, and the two compose into one intent: take contact wherever
 * it is available, and where a gap is unavoidable, make it as wide as possible. Contact is settled
 * first, so this key only ever chooses among candidates that already touch equally many templates —
 * it can never trade a neighbor away for open void.
 */
export function maximinSpread(
  candidate: CandidatePlacement,
  placed: readonly PlacedTemplate[],
  voidGap = 1000,
): number {
  const occupied = globalOccupied(footprints(placed));
  let min = voidGap;

  // Bounding box of the whole continent, from RECTANGLE bounds only — O(placed), not O(cells).
  // A ray that has left this box can never hit anything, so there is nothing to find between there
  // and the `voidGap` sentinel. Without this bound every ray aimed at open void walks the full
  // `voidGap` (1000 steps) before giving up — ~1000 lookups per exposed perimeter cell, per
  // candidate, per anchor, and again inside the seal check's re-simulation.
  let minCol = Infinity;
  let maxCol = -Infinity;
  let minRow = Infinity;
  let maxRow = -Infinity;
  for (const p of placed) {
    if (p.offsetCol < minCol) minCol = p.offsetCol;
    if (p.offsetRow < minRow) minRow = p.offsetRow;
    if (p.offsetCol + p.width - 1 > maxCol) maxCol = p.offsetCol + p.width - 1;
    if (p.offsetRow + p.height - 1 > maxRow) maxRow = p.offsetRow + p.height - 1;
  }

  for (const edge of ['n', 's', 'e', 'w'] as const) {
    const [dc, dr] = OUTWARD[edge];
    for (const c of edgeCells(edge, candidate.width, candidate.height)) {
      const gc = c.col + candidate.offsetCol;
      const gr = c.row + candidate.offsetRow;
      // Immediately-occupied outward neighbor ⇒ a seam/anchor-touching cell; excluded.
      if (occupied.has(tileKey(gc + dc, gr + dr))) continue;

      // Early-out: a ray travelling along one axis keeps its OTHER coordinate fixed, so if that
      // coordinate sits outside the box the ray runs alongside the continent and can never hit it.
      const fixedInBox = dc === 0 ? gc >= minCol && gc <= maxCol : gr >= minRow && gr <= maxRow;
      if (!fixedInBox) {
        min = Math.min(min, voidGap);
        continue;
      }

      // Steps until the ray exits the box along its travel axis. `voidGap` still caps it, so a
      // continent wider than the sentinel yields exactly the pre-bound result.
      const toBoxEdge = dc === 1 ? maxCol - gc : dc === -1 ? gc - minCol : dr === 1 ? maxRow - gr : gr - minRow;
      const limit = Math.min(toBoxEdge, voidGap);

      let gap = voidGap;
      // Starts at 2, not 1: the `continue` above already tested step 1 for this cell, so step 1 can
      // never be a hit here. The reachable gap domain is therefore {2..voidGap-1} ∪ {voidGap}.
      for (let step = 2; step <= limit; step++) {
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
  /**
   * How many same-name placed templates this placement ends up flush against. Preferred to be 0;
   * a non-zero value on a persisted plan means every alternative at that anchor was worse or absent
   * (see {@link duplicateAdjacencies}).
   */
  dupAdjacent: number;
  matchedRuns: number;
  /** Distinct placed templates this placement ends up flush against; maximized (≥ 1). */
  touchCount: number;
  spread: number;
}

/** Structured `template-match-not-found` diagnostics (§ "Anchor fallback + logging"). */
export interface SpawnFailure {
  reason:
    | 'anchor-no-legal-candidate'
    /**
     * The anchor had geometrically legal candidates, but EVERY one of them would seal the
     * continent (§ "The seal constraint"). This is an AUTHORING defect, not a runtime state:
     * the catalog is supposed to always offer some template that leaves a road stub open. It
     * is logged loudly with the rejected count so the author can fix the catalog.
     */
    | 'anchor-all-candidates-seal'
    /**
     * The anchor had geometrically legal candidates, but EVERY one of them would leave some
     * still-open street mouth FLANKED by the new template's outer edge (§ "The flank ban").
     */
    | 'anchor-all-candidates-flank'
    | 'all-anchors-exhausted';
  edge?: Cardinal;
  width?: number;
  originDistance?: number;
  /** For `anchor-all-candidates-seal`: how many otherwise-legal candidates the seal rule rejected. */
  sealedCandidates?: number;
  /** For `anchor-all-candidates-flank`: how many otherwise-legal candidates the flank ban rejected. */
  flankedCandidates?: number;
}

/**
 * The growth-safety guard injected into {@link planSpawn}: given a candidate placement, would the
 * resulting continent be SEALED (no open street condition left on ANY placement's final rendered
 * version)? `true` ⇒ the candidate is rejected exactly like an illegal seam.
 *
 * The predicate is injected rather than implemented here because deciding it needs every
 * template's full per-version condition masks — a DB-backed catalog load this dep-free geometry
 * engine must not take on. {@link ../../services/NightMarketPlacementService.planNextPlacement}
 * supplies it (backed by {@link ./continentSeal.sealsContinent}) for BOTH the live continent and
 * the author sandbox, so the two surfaces cannot diverge.
 */
export type SealCheck = (candidate: CandidatePlacement) => boolean;

export interface SpawnResult {
  plan: SpawnPlan | null;
  /** One entry per anchor that failed to yield a legal placement (for logging). */
  failures: SpawnFailure[];
}

// ── Trace (opt-in decision log) ───────────────────────────────────────────────────────────────

/**
 * Every decision {@link planSpawn} makes, as structured events. Injected as a callback rather than
 * `console.log`ged here so this module stays a pure, dep-free engine: the CALLER decides whether to
 * format the events to a terminal (the nms Iterate button does — see
 * {@link ../../services/NightMarketPlacementService.planNextPlacement}), ship them to a client
 * inspector, or ignore them entirely. Tracing is OFF unless a callback is passed, so the live
 * growth path pays nothing.
 *
 * The events answer the question the summary `failures` list cannot: why a SPECIFIC nearby anchor
 * was passed over. `anchor-no-candidates` reports the widths the catalog *does* offer on the needed
 * edge (the exact-width match at step 3 is the most common silent skip); `candidate-rejected`
 * names the placed template that blocked it and whether it was an overlap, a seam disagreement, or
 * the seal guard.
 */
export type SpawnTraceEvent =
  /** The full sorted anchor queue, before any are tried. Index = the order they will be visited. */
  | {
      type: 'anchors';
      anchors: Array<{ index: number; owner: string; edge: Cardinal; width: number; globalAlongStart: number; originDistance: number }>;
      /** `edge → widths` the catalog can mate with, i.e. the entire reachable match space. */
      catalogWidthsByEdge: Record<string, number[]>;
    }
  /** Starting work on one anchor (visited in queue order). */
  | { type: 'anchor'; index: number; owner: string; edge: Cardinal; width: number; originDistance: number; candidateCount: number }
  /** The anchor had ZERO complement-edge/equal-width catalog entries — skipped without geometry. */
  | { type: 'anchor-no-candidates'; index: number; edge: Cardinal; neededEdge: Cardinal; neededWidth: number; availableWidths: number[] }
  | {
      type: 'candidate-rejected';
      index: number;
      templateName: string;
      version: number;
      offsetCol: number;
      offsetRow: number;
      reason: 'overlap' | 'seam-mismatch' | 'flanks-open-anchor' | 'seals-continent';
      /** For `flanks-open-anchor`: the anchor keys (`edge:cross:alongStart:width`) it would flank. */
      flankedAnchors?: string[];
      /** For overlap/seam: the placed template that vetoed it (`name@(col,row)`). */
      blocker?: string;
    }
  | {
      type: 'candidate-legal';
      index: number;
      templateName: string;
      version: number;
      offsetCol: number;
      offsetRow: number;
      /** Same-name templates this candidate would touch — the soft duplicate-adjacency penalty. */
      dupAdjacent: number;
      matchedRuns: number;
      /** Distinct placed templates this candidate would abut — maximized (≥ 1). */
      touchCount: number;
      spread: number;
    }
  /** The anchor produced legal candidates; these are the tiebreak results. */
  | {
      type: 'anchor-winner';
      index: number;
      /**
       * The winning (i.e. lowest) duplicate-adjacency count at this anchor. `> 0` means EVERY legal
       * candidate touched a copy of itself and the deprioritization had to yield.
       */
      bestDupAdjacent: number;
      bestRuns: number;
      /** The winning (i.e. highest) distinct-templates-touched count at this anchor. */
      bestTouch: number;
      bestSpread: number;
      survivors: number;
      chosen: SpawnPlan;
    }
  | { type: 'anchor-failed'; index: number; failure: SpawnFailure }
  | { type: 'exhausted' };

export type SpawnTrace = (event: SpawnTraceEvent) => void;

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
 *
 * `sealCheck` (optional) is the growth-safety veto — see {@link SealCheck}. Omitting it restores
 * the pre-constraint behavior (used by the geometry-only unit tests).
 */
export function planSpawn(
  placed: readonly PlacedTemplate[],
  catalog: readonly CatalogVersion[],
  rng: () => number = Math.random,
  sealCheck?: SealCheck,
  trace?: SpawnTrace,
): SpawnResult {
  const index = buildAnchorIndex(catalog);
  const failures: SpawnFailure[] = [];

  // Flank-ban baseline: violations the world ALREADY has (a layout persisted before the ban).
  // Only NEW violations veto a candidate — see {@link flankedAnchorKeys}.
  const preFlanked = flankedAnchorKeys(placed);

  // Step 1–2: enumerate exposed anchors, closest-to-origin first.
  const anchors = exposedAnchors(placed).sort((a, b) => a.originDistance - b.originDistance);

  if (trace) {
    // The whole match space up front: the anchor queue in visit order + every width the catalog can
    // actually mate with per edge. An anchor whose width is absent from its complement edge's list
    // is unmatchable by construction, no matter how close to the origin it sits.
    const catalogWidthsByEdge: Record<string, number[]> = {};
    for (const [edge, byWidth] of index) catalogWidthsByEdge[edge] = [...byWidth.keys()].sort((a, b) => a - b);
    trace({
      type: 'anchors',
      anchors: anchors.map((a, i) => ({
        index: i,
        owner: `${a.owner.templateName}@(${a.owner.offsetCol},${a.owner.offsetRow})`,
        edge: a.edge,
        width: a.width,
        globalAlongStart: a.globalAlongStart,
        originDistance: a.originDistance,
      })),
      catalogWidthsByEdge,
    });
  }

  for (let anchorIndex = 0; anchorIndex < anchors.length; anchorIndex++) {
    const ea = anchors[anchorIndex];
    // Step 3: complement-direction, equal-width catalog candidates.
    const neededEdge = complement(ea.edge);
    const candidates = index.get(neededEdge)?.get(ea.width) ?? [];

    if (trace) {
      trace({
        type: 'anchor',
        index: anchorIndex,
        owner: `${ea.owner.templateName}@(${ea.owner.offsetCol},${ea.owner.offsetRow})`,
        edge: ea.edge,
        width: ea.width,
        originDistance: ea.originDistance,
        candidateCount: candidates.length,
      });
      if (candidates.length === 0) {
        trace({
          type: 'anchor-no-candidates',
          index: anchorIndex,
          edge: ea.edge,
          neededEdge,
          neededWidth: ea.width,
          availableWidths: [...(index.get(neededEdge)?.keys() ?? [])].sort((a, b) => a - b),
        });
      }
    }

    type Scored = { plan: SpawnPlan; spread: number };
    const legal: Scored[] = [];
    // Candidates that passed the seam check but were vetoed by the seal guard (for diagnostics).
    let sealed = 0;
    // Candidates vetoed by the flank ban (for diagnostics).
    let flanked = 0;

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

      // Step 4: legal against EVERY placed template it would touch. `find` (not `every`) so the
      // trace can name the blocker and say whether it was a footprint overlap or a seam disagreement.
      const blocker = placed.find((p) => !isPlacementLegal(candidate, p));
      if (blocker) {
        trace?.({
          type: 'candidate-rejected',
          index: anchorIndex,
          templateName: cv.templateName,
          version: cv.version,
          offsetCol,
          offsetRow,
          reason: rectsOverlap(candidate, blocker) ? 'overlap' : 'seam-mismatch',
          blocker: `${blocker.templateName}@(${blocker.offsetCol},${blocker.offsetRow})`,
        });
        continue;
      }

      // Step 4a (the flank ban): reject a candidate that would leave ANY still-open street mouth —
      // its own or an already-placed template's — running flush alongside a board's outer edge
      // (§ "The flank ban"). Cheap (pure geometry over the post-placement world), so it runs before
      // the version-resimulating seal check.
      const postFlanked = flankedAnchorKeys([
        ...placed,
        { templateName: cv.templateName, activeVersion: cv.version, offsetCol, offsetRow, width: cv.width, height: cv.height, street: cv.street },
      ]);
      const introduced = [...postFlanked].filter((k) => !preFlanked.has(k));
      if (introduced.length > 0) {
        flanked++;
        trace?.({
          type: 'candidate-rejected',
          index: anchorIndex,
          templateName: cv.templateName,
          version: cv.version,
          offsetCol,
          offsetRow,
          reason: 'flanks-open-anchor',
          flankedAnchors: introduced,
        });
        continue;
      }

      // Step 4b (growth safety): reject a candidate that would leave the continent with NO open
      // street condition — a sealed continent can never spawn again. Checked AFTER the cheap seam
      // test because it re-simulates version selection over the whole world (see ./continentSeal).
      if (sealCheck?.(candidate)) {
        sealed++;
        trace?.({
          type: 'candidate-rejected',
          index: anchorIndex,
          templateName: cv.templateName,
          version: cv.version,
          offsetCol,
          offsetRow,
          reason: 'seals-continent',
        });
        continue;
      }

      // Step 4c (the duplicate-adjacency deprioritization): NOT a veto — scored, then applied as the
      // FIRST ranking key below, so a self-touching placement is only ever chosen when no
      // alternative at this anchor is duplicate-free.
      const dupAdjacent = duplicateAdjacencies(candidate, placed);
      const matchedRuns = matchedStreetRuns(candidate, placed);
      const touchCount = touchedTemplates(candidate, placed);
      const spread = maximinSpread(candidate, placed);
      trace?.({
        type: 'candidate-legal',
        index: anchorIndex,
        templateName: cv.templateName,
        version: cv.version,
        offsetCol,
        offsetRow,
        dupAdjacent,
        matchedRuns,
        touchCount,
        spread,
      });
      legal.push({
        plan: { templateName: cv.templateName, version: cv.version, offsetCol, offsetRow, dupAdjacent, matchedRuns, touchCount, spread },
        spread,
      });
    }

    if (legal.length === 0) {
      // Distinguish "nothing fit the seam" from "everything fit but every fit would seal the
      // continent" — the latter is an authoring gap in the catalog and needs a different fix.
      // Precedence: the seal veto is the loudest signal (an authoring gap in the catalog), then
      // the flank ban, then "nothing fit the seam" at all.
      const failure: SpawnFailure =
        sealed > 0
          ? {
              reason: 'anchor-all-candidates-seal',
              edge: ea.edge,
              width: ea.width,
              originDistance: ea.originDistance,
              sealedCandidates: sealed,
            }
          : flanked > 0
            ? {
                reason: 'anchor-all-candidates-flank',
                edge: ea.edge,
                width: ea.width,
                originDistance: ea.originDistance,
                flankedCandidates: flanked,
              }
            : { reason: 'anchor-no-legal-candidate', edge: ea.edge, width: ea.width, originDistance: ea.originDistance };
      failures.push(failure);
      trace?.({ type: 'anchor-failed', index: anchorIndex, failure });
      continue; // Anchor fallback: try the next-closest anchor.
    }

    // Step 4c (as a ranking key): fewest same-name neighbors wins, and it outranks every other key —
    // that is what makes it a strict deprioritization rather than a preference that street-run
    // scoring can override. Because it FILTERS rather than vetoes, a set where every candidate is
    // duplicate-adjacent still yields a winner (bestDup > 0) instead of failing the anchor.
    // Step 5: maximize matched street runs. Step 5b: maximize distinct templates touched. Step 6:
    // maximin spread. Step 7: random among survivors.
    //
    // 5b and 6 are ONE intent expressed lexicographically: contact beats any gap, and an unavoidable
    // gap should be as wide as possible. Because each key only filters the survivors of the key
    // above it, spread can never trade a neighbor away for open void — it chooses only among
    // candidates already tied on contact. (Those ties are the common case: at most anchors every
    // candidate touches exactly the owner, so spread still decides most placements.)
    const bestDupAdjacent = Math.min(...legal.map((s) => s.plan.dupAdjacent));
    const byDup = legal.filter((s) => s.plan.dupAdjacent === bestDupAdjacent);
    const bestRuns = Math.max(...byDup.map((s) => s.plan.matchedRuns));
    const byRuns = byDup.filter((s) => s.plan.matchedRuns === bestRuns);
    const bestTouch = Math.max(...byRuns.map((s) => s.plan.touchCount));
    const byTouch = byRuns.filter((s) => s.plan.touchCount === bestTouch);
    const bestSpread = Math.max(...byTouch.map((s) => s.spread));
    const survivors = byTouch.filter((s) => s.spread === bestSpread);
    const winner = survivors[Math.floor(rng() * survivors.length)] ?? survivors[0];
    trace?.({
      type: 'anchor-winner',
      index: anchorIndex,
      bestDupAdjacent,
      bestRuns,
      bestTouch,
      bestSpread,
      survivors: survivors.length,
      chosen: winner.plan,
    });
    return { plan: winner.plan, failures };
  }

  failures.push({ reason: 'all-anchors-exhausted' });
  trace?.({ type: 'exhausted' });
  return { plan: null, failures };
}
