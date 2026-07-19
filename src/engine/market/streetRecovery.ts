import type { Street } from './nightMarketRegistry';
import { tileKey } from './tileGraph';

/**
 * streetRecovery — decompose a stitched STREET-walkable cell mask into the `Street[]`
 * rectangles + per-cell ownership that the existing {@link ./streetGraph buildStreetGraph}
 * consumes (docs/NIGHT_MARKET_TEMPLATES.md § "Street recovery (mask → Street[])",
 * docs/NIGHT_MARKET_TEMPLATE_RUNTIME_PLAN.md § streetRecovery, slice 2).
 *
 * LAYER: pure engine. No React, no DB, no assets. A pure function of the stitched mask —
 * NOTHING here is persisted (only template *placements* are); recovery re-runs on every
 * load, replacing the old hand-authored `Street[]`.
 *
 * IMPORTANT — recovery does NOT build nodes/edges. It only emits `Street` rectangles +
 * `intersectingStreets` ownership; {@link ./streetGraph buildStreetGraph} still does node
 * projection, dead-ends, and lane edge bodies. Reimplementing those here would drop
 * projection (breaking N2) and dead-end handling.
 *
 * ── Algorithm: greedy maximal-rectangle cover ──────────────────────────────────────────
 * A run-length "fan out, take the shorter axis as width" heuristic is deliberately NOT
 * used: at a crossing the perpendicular fan measures the *crossing* street, yielding a
 * bogus-but-legal width no `width ≤ 8` gate can catch. Instead, for each uncovered seed:
 *   1. Grow the seed's maximal axis-aligned rectangle (see {@link growMaximalRect}).
 *   2. Its longer extent is the primary axis (`isNorthSouth = height > width`).
 *   3. Skip if the seed is already covered by a rectangle of the SAME orientation (dedup) —
 *      growth is a pure function of the mask, so a same-orientation seed regrows the
 *      identical rectangle. A cell covered by rectangles of BOTH orientations is an
 *      intersection, detected by ownership length ≥ 2 (no width test needed).
 *   4. Stamp the emitted street into `ownership` for every cell it covers.
 * Every emitted street is a genuine filled rectangle, so the graph invariants S1/S2/E2 hold
 * by construction; `buildStreetGraph`'s projection covers T-junctions (N2).
 *
 * DEPENDS ON: {@link ./tileGraph tileKey} (cell-key format). Feeds {@link ./marketWorld}.
 */

/** A recovered street rectangle plus per-cell ownership (a cell in ≥2 streets ⇒ intersection). */
export interface RecoveredStreets {
  streets: Street[];
  /** tileKey → every recovered street covering it. Length ≥ 2 marks an intersection cell. */
  ownership: Map<string, Street[]>;
}

/** Parse a "isoX,isoY" cell key into a numeric coordinate pair. */
function parseCell(key: string): [number, number] {
  const [x, y] = key.split(',').map(Number);
  return [x, y];
}

/** The maximal filled-rectangle extent grown around a seed cell. */
interface GrownRect {
  minCol: number;
  maxCol: number;
  minRow: number;
  maxRow: number;
  isNorthSouth: boolean;
}

/**
 * Grow the maximal axis-aligned street rectangle around `(seedCol, seedRow)`.
 *
 * 1. Measure the seed's maximal contiguous street RUN along each axis (its full column run
 *    and full row run).
 * 2. The longer run is the primary axis. (Ties → east–west, matching `isNorthSouth = height
 *    > width`; a square rectangle is identical under either orientation, so the tiebreak is
 *    harmless.)
 * 3. Fix the primary-axis span, then WIDEN perpendicular one lane at a time — a lane joins
 *    only when EVERY cell across the fixed span is street. A perpendicular crossing street's
 *    arms don't span the primary run, so widening stops at the true street width (this is
 *    exactly why the run-length heuristic is avoided).
 *
 * Growth reads only `streetCells`, never the covered sets, so two seeds in the same street
 * regrow the identical rectangle — which is what makes same-orientation dedup exact.
 */
function growMaximalRect(seedCol: number, seedRow: number, streetCells: Set<string>): GrownRect {
  const isStreet = (c: number, r: number) => streetCells.has(tileKey(c, r));

  // Maximal vertical run (column seedCol) and horizontal run (row seedRow) through the seed.
  let rMin = seedRow;
  while (isStreet(seedCol, rMin - 1)) rMin--;
  let rMax = seedRow;
  while (isStreet(seedCol, rMax + 1)) rMax++;
  let cMin = seedCol;
  while (isStreet(cMin - 1, seedRow)) cMin--;
  let cMax = seedCol;
  while (isStreet(cMax + 1, seedRow)) cMax++;

  const vertical = rMax - rMin; // height − 1
  const horizontal = cMax - cMin; // width − 1
  const isNorthSouth = vertical > horizontal; // strictly longer vertical ⇒ N–S; tie ⇒ E–W

  if (isNorthSouth) {
    // Fix the vertical span at [rMin, rMax]; widen columns east/west while the whole span is street.
    let wMin = seedCol;
    let wMax = seedCol;
    const columnFilled = (c: number) => {
      for (let r = rMin; r <= rMax; r++) if (!isStreet(c, r)) return false;
      return true;
    };
    while (columnFilled(wMin - 1)) wMin--;
    while (columnFilled(wMax + 1)) wMax++;
    return { minCol: wMin, maxCol: wMax, minRow: rMin, maxRow: rMax, isNorthSouth: true };
  }

  // E–W: fix the horizontal span at [cMin, cMax]; widen rows north/south while the whole span is street.
  let wMin = seedRow;
  let wMax = seedRow;
  const rowFilled = (r: number) => {
    for (let c = cMin; c <= cMax; c++) if (!isStreet(c, r)) return false;
    return true;
  };
  while (rowFilled(wMin - 1)) wMin--;
  while (rowFilled(wMax + 1)) wMax++;
  return { minCol: cMin, maxCol: cMax, minRow: wMin, maxRow: wMax, isNorthSouth: false };
}

/** Convert a grown rectangle into a {@link Street} with a stable, deterministic name. */
function rectToStreet(rect: GrownRect): Street {
  const { minCol, maxCol, minRow, maxRow, isNorthSouth } = rect;
  if (isNorthSouth) {
    return {
      name: `st_ns_${minCol}_${minRow}_${maxRow}`,
      isNorthSouth: true,
      start: minRow,
      end: maxRow,
      offset: minCol,
      width: maxCol - minCol + 1,
    };
  }
  return {
    name: `st_ew_${minRow}_${minCol}_${maxCol}`,
    isNorthSouth: false,
    start: minCol,
    end: maxCol,
    offset: minRow,
    width: maxRow - minRow + 1,
  };
}

/**
 * Recover `Street[]` + ownership from a set of street-walkable cell keys.
 *
 * Iterates seeds in a deterministic (sorted) order so the output is stable across loads.
 * Asserts every emitted street has `width ∈ [1, 8]` (the authoring bound, S3) — a wider
 * rectangle means a malformed mask or a growth bug, so it throws loudly.
 */
export function recoverStreets(streetCells: Set<string>): RecoveredStreets {
  const streets: Street[] = [];
  const ownership = new Map<string, Street[]>();
  // Per-orientation covered sets: a cell may legitimately be covered once as N–S and once
  // as E–W (an intersection), but never twice under the same orientation.
  const coveredNS = new Set<string>();
  const coveredEW = new Set<string>();

  // Deterministic seed order (sort by isoX then isoY) → stable street names + ownership.
  const seeds = [...streetCells].sort((a, b) => {
    const [ax, ay] = parseCell(a);
    const [bx, by] = parseCell(b);
    return ax - bx || ay - by;
  });

  for (const seedKey of seeds) {
    const [col, row] = parseCell(seedKey);
    const rect = growMaximalRect(col, row, streetCells);
    const covered = rect.isNorthSouth ? coveredNS : coveredEW;
    if (covered.has(seedKey)) continue; // same-orientation rectangle already emitted (dedup)

    const street = rectToStreet(rect);
    if (street.width < 1 || street.width > 8) {
      throw new Error(
        `[streetRecovery] recovered street "${street.name}" has width ${street.width} (must be 1..8) — ` +
          `malformed stitched street mask or a growth bug. Rect=${JSON.stringify(rect)}`,
      );
    }
    streets.push(street);

    // Stamp ownership + mark every covered cell in this orientation's covered set.
    for (let c = rect.minCol; c <= rect.maxCol; c++) {
      for (let r = rect.minRow; r <= rect.maxRow; r++) {
        const key = tileKey(c, r);
        const list = ownership.get(key);
        if (list) list.push(street);
        else ownership.set(key, [street]);
        covered.add(key);
      }
    }
  }

  return { streets, ownership };
}
