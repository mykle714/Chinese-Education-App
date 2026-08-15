import { describe, it, expect } from 'vitest';
import {
  globalOccupied,
  globalOccupiedRects,
  boardCells,
  cellAbutsOthers,
  outerEdgesOf,
  type PlacementRect,
} from '../dal/shared/versionSelection.js';

/**
 * Tests for the continent occupancy union used by version selection
 * (`server/dal/shared/versionSelection.ts`), consumed by the layout read
 * (`NightMarketWorldService.getUserLayout`), the seal simulation (`continentSeal.ts`) and the
 * spawn planner (`templatePlacement.ts`).
 *
 * The load-bearing property here is the ONE described at {@link globalOccupiedRects}: callers pass
 * a single full union — this placement INCLUDED — instead of rebuilding an "everyone but me" union
 * per placement, which is what made the layout read O(N² · cells). That is only sound because the
 * union is exclusively probed OUTWARD from board-edge cells, so a placement can never see its own
 * footprint. If a future change probes inward, or introduces a non-rectangular footprint, these
 * tests are what should fail.
 */

const rect = (offsetCol: number, offsetRow: number, width: number, height: number): PlacementRect =>
  ({ offsetCol, offsetRow, width, height });

describe('globalOccupiedRects', () => {
  it('agrees exactly with the boardCells + globalOccupied path it replaced', () => {
    const rects = [rect(0, 0, 3, 4), rect(3, 0, 2, 2), rect(-4, -6, 5, 3)];

    const viaRects = globalOccupiedRects(rects);
    const viaCells = globalOccupied(
      rects.map((r) => ({
        offsetCol: r.offsetCol,
        offsetRow: r.offsetRow,
        cells: boardCells(r.width, r.height),
      })),
    );

    expect([...viaRects].sort()).toEqual([...viaCells].sort());
  });

  it('translates by the placement offset, including negative offsets', () => {
    const occ = globalOccupiedRects([rect(-2, -3, 2, 2)]);
    expect([...occ].sort()).toEqual(['-1,-2', '-1,-3', '-2,-2', '-2,-3'].sort());
  });

  it('unions overlapping and disjoint placements without double-counting', () => {
    const occ = globalOccupiedRects([rect(0, 0, 2, 2), rect(1, 1, 2, 2)]);
    // 4 + 4 cells with exactly one shared cell (1,1) → 7 distinct.
    expect(occ.size).toBe(7);
  });

  it('is empty for no placements', () => {
    expect(globalOccupiedRects([]).size).toBe(0);
  });
});

describe('the self-inclusion invariant that lets callers share one union', () => {
  /**
   * The substitution's precondition, asserted directly: for EVERY cell of a rectangular board and
   * every outward edge direction that cell lies on, the probed neighbour falls outside that same
   * board. If this holds, including a placement's own cells in the union it is scored against
   * cannot change any abutment result.
   */
  it('never probes a cell back into its own footprint, for any cell of any board', () => {
    const OUTWARD = { n: [0, 1], s: [0, -1], e: [1, 0], w: [-1, 0] } as const;

    for (const [width, height] of [[1, 1], [1, 5], [5, 1], [3, 4], [7, 6]]) {
      for (const [offsetCol, offsetRow] of [[0, 0], [10, -20], [-13, 7]]) {
        for (let col = 0; col < width; col++) {
          for (let row = 0; row < height; row++) {
            for (const dir of outerEdgesOf(col, row, width, height)) {
              const [dc, dr] = OUTWARD[dir];
              const probedCol = col + dc;
              const probedRow = row + dr;
              const insideOwnBoard =
                probedCol >= 0 && probedCol < width && probedRow >= 0 && probedRow < height;
              expect(
                insideOwnBoard,
                `board ${width}x${height} at (${offsetCol},${offsetRow}): cell (${col},${row}) ` +
                `probing '${dir}' reached (${probedCol},${probedRow}), inside its own footprint`,
              ).toBe(false);
            }
          }
        }
      }
    }
  });

  it('scores a lone placement identically against the full union and against an empty one', () => {
    // End-to-end version of the property above: with only one placement on the continent, the
    // "others" union is empty, so sharing the full union (which contains this placement's own
    // cells) must still report NO abutment on any of its edges.
    const solo = rect(4, 4, 3, 3);
    const full = globalOccupiedRects([solo]);
    const empty = new Set<string>();

    for (let col = 0; col < solo.width; col++) {
      for (let row = 0; row < solo.height; row++) {
        const dirs = outerEdgesOf(col, row, solo.width, solo.height);
        if (dirs.length === 0) continue;
        const gCol = col + solo.offsetCol;
        const gRow = row + solo.offsetRow;
        expect(cellAbutsOthers(gCol, gRow, full, dirs))
          .toBe(cellAbutsOthers(gCol, gRow, empty, dirs));
      }
    }
  });

  it('still detects a genuine neighbour across the shared edge', () => {
    // Two boards flush against each other: the east edge of A abuts B.
    const a = rect(0, 0, 3, 3);
    const b = rect(3, 0, 3, 3);
    const occupied = globalOccupiedRects([a, b]);

    // A's east-edge cell (col = 2) probing 'e' lands on B.
    expect(cellAbutsOthers(2, 1, occupied, ['e'])).toBe(true);
    // A's west-edge cell probing 'w' lands on void.
    expect(cellAbutsOthers(0, 1, occupied, ['w'])).toBe(false);
  });
});
