import { describe, it, expect } from 'vitest';
import {
  packCell, unpackCell, packCellKey, CELL_COORD_MIN, CELL_COORD_MAX,
} from '../cellKey';
import { compileMasks, type EditorMasks } from '../farmTerrain';

/**
 * Tests for the packed cell-id encoding that the terrain render loop keys its masks by
 * ({@link ../cellKey}, consumed by {@link ../farmTerrain buildEditorField} — see
 * docs/NIGHT_MARKET_FEATURE.md § "Terrain performance").
 *
 * The property that matters is INJECTIVITY: two distinct cells must never share an id. An
 * aliasing collision would not crash — it would silently paint one cell's terrain onto another,
 * which is exactly the class of bug that is invisible in a screenshot.
 */

describe('packCell / unpackCell', () => {
  it('round-trips positive, negative, zero and mixed-sign coordinates', () => {
    const samples: Array<[number, number]> = [
      [0, 0], [1, 0], [0, 1], [5, 7], [-1, 0], [0, -1], [-1, -1],
      [-30, 12], [12, -30], [1000, -1000], [CELL_COORD_MIN, CELL_COORD_MAX],
      [CELL_COORD_MAX, CELL_COORD_MIN], [CELL_COORD_MIN, CELL_COORD_MIN],
      [CELL_COORD_MAX, CELL_COORD_MAX],
    ];
    for (const [col, row] of samples) {
      expect(unpackCell(packCell(col, row))).toEqual([col, row]);
    }
  });

  it('is injective across a dense block spanning the origin (no aliasing)', () => {
    // Straddles the sign boundary in both axes, which is where a bad bias/span would collide.
    const seen = new Map<number, string>();
    for (let col = -40; col <= 40; col++) {
      for (let row = -40; row <= 40; row++) {
        const id = packCell(col, row);
        const clash = seen.get(id);
        expect(clash, `(${col},${row}) collided with ${clash}`).toBeUndefined();
        seen.set(id, `${col},${row}`);
      }
    }
    expect(seen.size).toBe(81 * 81);
  });

  it('stays inside the SMI range, which is the point of the encoding', () => {
    // Above 2^31 V8 boxes the value as a heap number and the optimisation is undone.
    for (const [col, row] of [[CELL_COORD_MIN, CELL_COORD_MIN], [CELL_COORD_MAX, CELL_COORD_MAX]]) {
      const id = packCell(col, row);
      expect(id).toBeGreaterThanOrEqual(0);
      expect(id).toBeLessThan(2 ** 31);
    }
  });

  it('rejects out-of-range and non-integral cells rather than aliasing them', () => {
    expect(() => packCell(CELL_COORD_MAX + 1, 0)).toThrow(RangeError);
    expect(() => packCell(0, CELL_COORD_MIN - 1)).toThrow(RangeError);
    expect(() => packCell(1.5, 0)).toThrow(RangeError);
  });

  it('packCellKey matches packCell for the persisted "col,row" form, including negatives', () => {
    expect(packCellKey('0,0')).toBe(packCell(0, 0));
    expect(packCellKey('12,-30')).toBe(packCell(12, -30));
    expect(packCellKey('-7,-8')).toBe(packCell(-7, -8));
  });
});

describe('compileMasks', () => {
  it('carries every painted cell across, re-keyed but otherwise unchanged', () => {
    const masks = {
      terrain1: new Set(['0,0', '1,0', '-2,3']),
      terrain2: new Set(['1,0']),
      street: new Set(['9,9']),          // dropped: not read by the render loop
      communal: new Set<string>(),
      placeholder: [],
      condition: new Set<string>(),
      decor: new Map([['0,0', '/tree.png'], ['-2,3', '/rock.png']]),
    } as unknown as EditorMasks;

    const compiled = compileMasks(masks);

    expect(compiled.terrain1.size).toBe(3);
    for (const cell of ['0,0', '1,0', '-2,3']) {
      expect(compiled.terrain1.has(packCellKey(cell))).toBe(true);
    }
    expect([...compiled.terrain2]).toEqual([packCell(1, 0)]);
    expect(compiled.decor.get(packCell(0, 0))).toBe('/tree.png');
    expect(compiled.decor.get(packCell(-2, 3))).toBe('/rock.png');
    expect(compiled.decor.size).toBe(2);
    // The spriteless walkability layers are deliberately not compiled.
    expect('street' in compiled).toBe(false);
  });
});
