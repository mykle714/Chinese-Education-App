import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  analyzeConditions,
  borderStreetCells,
  placeholderAreaId,
} from '../conditionAnalysis';
import { tileKey } from '../tileGraph';
import type { PlaceholderArea } from '../placeholderArea';

/** Build a cell set from an inclusive rectangle [c0,c1]×[r0,r1]. */
function rectCells(c0: number, c1: number, r0: number, r1: number): string[] {
  const out: string[] = [];
  for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) out.push(tileKey(c, r));
  return out;
}

describe('borderStreetCells', () => {
  it('keeps only street cells on the outer edge of a width×height board', () => {
    // 5×5 board. A street ring on the edge + one interior street cell.
    const street = new Set([
      ...rectCells(0, 4, 0, 0), // top row
      ...rectCells(0, 4, 4, 4), // bottom row
      tileKey(2, 2), // interior — must be excluded
    ]);
    const border = borderStreetCells(street, 5, 5);
    expect(border.has(tileKey(0, 0))).toBe(true);
    expect(border.has(tileKey(4, 4))).toBe(true);
    expect(border.has(tileKey(2, 2))).toBe(false);
    expect(border.size).toBe(10);
  });
});

describe('placeholderAreaId', () => {
  it('derives a stable anchor id from an area', () => {
    expect(placeholderAreaId({ col: 7, row: 3, w: 5, h: 5 })).toBe('7_3');
  });
});

describe('analyzeConditions', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => errSpy.mockRestore());

  const area: PlaceholderArea = { col: 3, row: 3, w: 5, h: 5 }; // cells cols 3..7 rows 3..7

  it('classifies a manual placeholder-cell island and maps it to its authored area', () => {
    // Board 12×12, no streets → no border conditions. One condition island inside the area.
    const result = analyzeConditions({
      condition: new Set(rectCells(4, 5, 4, 5)), // inside the area footprint
      placeholderAreas: [area],
      street: new Set(),
      width: 12,
      height: 12,
    });
    expect(result.conditionCount).toBe(1);
    expect(result.islands[0].kind).toBe('placeholder');
    expect(result.islands[0].placeholderAreaId).toBe('3_3');
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('re-derives border-street conditions from outer-edge street cells (not the persisted mask)', () => {
    // 6×6 board. A street runs along the whole top edge → one border-street island.
    // No manual conditions at all — the border island is derived, proving we don't trust
    // the persisted condition mask for border conditions.
    const result = analyzeConditions({
      condition: new Set(),
      placeholderAreas: [],
      street: new Set(rectCells(0, 5, 0, 0)),
      width: 6,
      height: 6,
    });
    expect(result.conditionCount).toBe(1);
    expect(result.islands[0].kind).toBe('border-street');
    expect(result.islands[0].cells.size).toBe(6);
  });

  it('counts a placeholder island and a separate border-street island as two conditions', () => {
    const result = analyzeConditions({
      condition: new Set(rectCells(4, 5, 4, 5)), // placeholder-substrate, interior
      placeholderAreas: [area],
      street: new Set(rectCells(0, 11, 0, 0)), // top-edge street → border island
      width: 12,
      height: 12,
    });
    expect(result.conditionCount).toBe(2);
    const kinds = result.islands.map((i) => i.kind).sort();
    expect(kinds).toEqual(['border-street', 'placeholder']);
  });

  it('coerces a mixed-substrate island to placeholder and logs an error', () => {
    // Place the area against the top edge so a single condition island can touch BOTH a
    // placeholder cell (row 1) and a border-street cell (row 0). Area at rows 0..4.
    const topArea: PlaceholderArea = { col: 3, row: 0, w: 5, h: 5 };
    const result = analyzeConditions({
      // A vertical strip col 3 rows 0..1: (3,0) is a border-street cell, (3,1) a placeholder cell.
      condition: new Set([tileKey(3, 0), tileKey(3, 1)]),
      placeholderAreas: [topArea],
      street: new Set(rectCells(0, 11, 0, 0)), // makes (3,0) a border-street cell
      width: 12,
      height: 12,
    });
    // (3,0) is shared between the manual strip and the derived border row → one merged island.
    const mixed = result.islands.find((i) => i.mixedFallback);
    expect(mixed).toBeDefined();
    expect(mixed!.kind).toBe('placeholder');
    expect(errSpy).toHaveBeenCalled();
  });

  it('flags a manual condition cell on neither substrate as unsatisfiable + logs', () => {
    const result = analyzeConditions({
      condition: new Set([tileKey(9, 9)]), // not in the area, not a street/border cell
      placeholderAreas: [area],
      street: new Set(),
      width: 12,
      height: 12,
    });
    expect(result.conditionCount).toBe(1);
    expect(result.islands[0].kind).toBe('placeholder');
    expect(result.islands[0].placeholderAreaId).toBeUndefined(); // never satisfiable
    expect(errSpy).toHaveBeenCalled();
  });

  it('returns zero conditions for a base version (no conditions, no border streets)', () => {
    const result = analyzeConditions({
      condition: new Set(),
      placeholderAreas: [area],
      street: new Set(rectCells(4, 6, 4, 6)), // interior street only, no outer edge
      width: 12,
      height: 12,
    });
    expect(result.conditionCount).toBe(0);
    expect(result.islands).toEqual([]);
  });
});
