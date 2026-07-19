import { describe, it, expect } from 'vitest';
import {
  outerEdgesOf,
  globalOccupied,
  cellAbutsOthers,
  abuttingBorderIslandIds,
} from '../seamAdjacency';
import { tileKey } from '../tileGraph';
import type { ConditionIsland } from '../conditionAnalysis';

/** A border-street ConditionIsland from a bare cell list (bbox/id are not exercised here). */
function borderIsland(id: string, cells: string[]): ConditionIsland {
  return {
    id,
    kind: 'border-street',
    cells: new Set(cells),
    bbox: { minCol: 0, minRow: 0, maxCol: 0, maxRow: 0 },
  };
}

describe('outerEdgesOf', () => {
  it('reports the edges a cell lies on, two for a corner (+isoY = north, so row 0 = south)', () => {
    expect(outerEdgesOf(0, 0, 6, 6).sort()).toEqual(['s', 'w']); // min-iso = SW corner
    expect(outerEdgesOf(5, 5, 6, 6).sort()).toEqual(['e', 'n']); // max-iso = NE corner
    expect(outerEdgesOf(3, 0, 6, 6)).toEqual(['s']); // row 0 = south edge
    expect(outerEdgesOf(3, 3, 6, 6)).toEqual([]); // interior
  });
});

describe('globalOccupied', () => {
  it('translates each placement by its offset into one global set', () => {
    const occ = globalOccupied([
      { offsetCol: 0, offsetRow: 0, cells: new Set([tileKey(0, 0)]) },
      { offsetCol: 10, offsetRow: 5, cells: new Set([tileKey(1, 1)]) },
    ]);
    expect(occ.has(tileKey(0, 0))).toBe(true);
    expect(occ.has(tileKey(11, 6))).toBe(true);
    expect(occ.size).toBe(2);
  });
});

describe('cellAbutsOthers', () => {
  const others = new Set([tileKey(5, 5)]);
  it('detects an orthogonal neighbor in the given directions', () => {
    // (4,5) has (5,5) to its east.
    expect(cellAbutsOthers(4, 5, others, ['e'])).toBe(true);
    // ...but not to its north.
    expect(cellAbutsOthers(4, 5, others, ['n'])).toBe(false);
  });
  it('defaults to all four directions', () => {
    expect(cellAbutsOthers(6, 5, others)).toBe(true); // (5,5) is to the west
  });
});

describe('abuttingBorderIslandIds', () => {
  // A 6×6 template at global origin. Row 0 is the SOUTH edge (+isoY = north, so min row =
  // south). Cells (1,0)..(3,0) are strictly south-edge (NOT corners), so the island tests
  // only the south outward normal (row − 1).
  const southEdgeIsland = borderIsland('1_0', [tileKey(1, 0), tileKey(2, 0), tileKey(3, 0)]);

  it('marks a south-edge island satisfied when a neighbor sits directly south', () => {
    // A neighbor occupying global row -1 (just south of our row-0 edge, since -row = south).
    const occupiedByOthers = new Set([tileKey(1, -1)]);
    const satisfied = abuttingBorderIslandIds({
      islands: [southEdgeIsland],
      offsetCol: 0,
      offsetRow: 0,
      width: 6,
      height: 6,
      occupiedByOthers,
    });
    expect(satisfied.has('1_0')).toBe(true);
  });

  it('does NOT satisfy a (non-corner) south-edge island from a neighbor on a different side', () => {
    // Neighbor to the WEST (global col -1) — not across the south seam. None of the island's
    // cells are on the west edge, so the west neighbor must not satisfy it.
    const occupiedByOthers = new Set([tileKey(-1, 0), tileKey(0, 0)]);
    const satisfied = abuttingBorderIslandIds({
      islands: [southEdgeIsland],
      offsetCol: 0,
      offsetRow: 0,
      width: 6,
      height: 6,
      occupiedByOthers,
    });
    expect(satisfied.has('1_0')).toBe(false);
  });

  it('respects the placement offset when translating island cells to global', () => {
    // Same south-edge island, but the template is placed at offset (10, 10). Its row-0 edge is
    // global row 10; a neighbor must sit at row 9 (one step south) to abut.
    const occupiedByOthers = new Set([tileKey(11, 9)]);
    const satisfied = abuttingBorderIslandIds({
      islands: [southEdgeIsland],
      offsetCol: 10,
      offsetRow: 10,
      width: 6,
      height: 6,
      occupiedByOthers,
    });
    expect(satisfied.has('1_0')).toBe(true);
  });

  it('ignores non-border-street islands', () => {
    const placeholderIsland: ConditionIsland = {
      id: '2_2',
      kind: 'placeholder',
      cells: new Set([tileKey(2, 2)]),
      bbox: { minCol: 2, minRow: 2, maxCol: 2, maxRow: 2 },
    };
    const satisfied = abuttingBorderIslandIds({
      islands: [placeholderIsland],
      offsetCol: 0,
      offsetRow: 0,
      width: 6,
      height: 6,
      occupiedByOthers: new Set([tileKey(2, -1), tileKey(3, 2)]),
    });
    expect(satisfied.size).toBe(0);
  });

  it('returns empty when nothing abuts', () => {
    const satisfied = abuttingBorderIslandIds({
      islands: [southEdgeIsland],
      offsetCol: 0,
      offsetRow: 0,
      width: 6,
      height: 6,
      occupiedByOthers: new Set(),
    });
    expect(satisfied.size).toBe(0);
  });
});
