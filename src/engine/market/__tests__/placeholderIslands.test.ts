import { describe, it, expect } from 'vitest';
import { labelIslands, computePlaceholderAreas } from '../placeholderIslands';
import { tileKey } from '../tileGraph';

/** Build a cell set from an inclusive rectangle [c0,c1]×[r0,r1]. */
function rectCells(c0: number, c1: number, r0: number, r1: number): string[] {
  const out: string[] = [];
  for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) out.push(tileKey(c, r));
  return out;
}

describe('labelIslands', () => {
  it('returns no islands for an empty mask', () => {
    expect(labelIslands(new Set())).toEqual([]);
  });

  it('labels a single connected rectangle as one island with correct bbox + id', () => {
    const cells = new Set(rectCells(2, 4, 3, 5)); // cols 2..4, rows 3..5
    const islands = labelIslands(cells);
    expect(islands).toHaveLength(1);
    expect(islands[0].cells.size).toBe(9);
    expect(islands[0].bbox).toEqual({ minCol: 2, minRow: 3, maxCol: 4, maxRow: 5 });
    // id derives from the min cell (col 2, row 3).
    expect(islands[0].id).toBe('2_3');
  });

  it('separates two diagonally-touching cells into TWO islands (4-connectivity, not 8)', () => {
    // (0,0) and (1,1) touch only at a corner → not connected under 4-connectivity.
    const cells = new Set([tileKey(0, 0), tileKey(1, 1)]);
    const islands = labelIslands(cells);
    expect(islands).toHaveLength(2);
  });

  it('keeps orthogonally-adjacent cells in one island', () => {
    const cells = new Set([tileKey(0, 0), tileKey(1, 0)]); // share an edge
    expect(labelIslands(cells)).toHaveLength(1);
  });

  it('labels three disjoint blocks and returns them in deterministic id order', () => {
    const a = rectCells(0, 1, 0, 1); // min cell (0,0)
    const b = rectCells(5, 6, 0, 1); // min cell (5,0)
    const c = rectCells(0, 1, 5, 6); // min cell (0,5)
    // Intentionally interleave insertion order to prove ordering is by id, not insertion.
    const islands = labelIslands(new Set([...b, ...c, ...a]));
    expect(islands.map((i) => i.id)).toEqual(['0_0', '0_5', '5_0']);
  });

  it('is stable regardless of input set build order (same ids + cells)', () => {
    const cells = rectCells(3, 4, 3, 4);
    const forward = labelIslands(new Set(cells));
    const reversed = labelIslands(new Set([...cells].reverse()));
    expect(forward.map((i) => i.id)).toEqual(reversed.map((i) => i.id));
    expect([...forward[0].cells].sort()).toEqual([...reversed[0].cells].sort());
  });

  it('handles a large connected mask without recursion overflow', () => {
    // A 200×200 filled block (40k cells) — an explicit stack must not blow up.
    const big = new Set(rectCells(0, 199, 0, 199));
    const islands = labelIslands(big);
    expect(islands).toHaveLength(1);
    expect(islands[0].cells.size).toBe(40000);
  });
});

describe('computePlaceholderAreas', () => {
  it('is a thin wrapper that recovers areas from a raw placeholder mask', () => {
    const twoBlocks = new Set([...rectCells(0, 1, 0, 1), ...rectCells(10, 11, 10, 11)]);
    const areas = computePlaceholderAreas(twoBlocks);
    expect(areas.map((a) => a.id)).toEqual(['0_0', '10_10']);
    expect(areas[0].cells.size).toBe(4);
    expect(areas[1].bbox).toEqual({ minCol: 10, minRow: 10, maxCol: 11, maxRow: 11 });
  });
});
