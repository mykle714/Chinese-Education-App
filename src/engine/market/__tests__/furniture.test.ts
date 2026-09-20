/**
 * Furniture PLACEMENT — the join between the shared occupancy system and the lumeish pack.
 *
 * The rules under test are the ones the editor's Furniture tool enforces on every click, so a
 * regression here shows up as pieces that overlap, hang off the board, or cannot be erased.
 * They run against the REAL generated manifest deliberately: a placement rule that only holds
 * for a hand-built fixture would not tell us the shipped pack behaves.
 */
import { describe, it, expect } from 'vitest';
import {
  isFurniturePlacement,
  furnitureSpriteExists,
  furnitureFootprint,
  furnitureFitsBoard,
  furnitureOverlapsAny,
  furnitureAt,
  furnitureBuriedDecorCells,
  type FurniturePlacement,
} from '../furniture';
import { lumeishTileset } from '../lumeishTileset';

/** A sprite the pack actually ships, and one that spans more than a single cell. */
const ANY_ID = lumeishTileset.ids()[0];
const MULTI_CELL = lumeishTileset.all().find((s) => s.isoSpan.w > 1 || s.isoSpan.h > 1)!;

describe('placement validation', () => {
  it('accepts a structurally valid record and rejects malformed ones', () => {
    expect(isFurniturePlacement({ col: 1, row: 2, id: ANY_ID })).toBe(true);
    expect(isFurniturePlacement({ col: 1, row: 2 })).toBe(false);
    expect(isFurniturePlacement({ col: '1', row: 2, id: ANY_ID })).toBe(false);
    expect(isFurniturePlacement(null)).toBe(false);
    expect(isFurniturePlacement('4,5')).toBe(false);
  });

  it('separates structural validity from the sprite actually existing', () => {
    // A stale id survives isFurniturePlacement (it IS a number) and is caught only by the
    // pack lookup — this is exactly the load-time drop in definitionToMasks.
    const stale = { col: 0, row: 0, id: 999_999 };
    expect(isFurniturePlacement(stale)).toBe(true);
    expect(furnitureSpriteExists(stale)).toBe(false);
    expect(furnitureSpriteExists({ col: 0, row: 0, id: ANY_ID })).toBe(true);
  });
});

describe('footprints', () => {
  it('takes its span from the sprite ISO footprint, not its padded pixel box', () => {
    const fp = furnitureFootprint({ col: 3, row: 4, id: MULTI_CELL.id });
    expect(fp).toEqual({
      col: 3, row: 4, w: MULTI_CELL.isoSpan.w, h: MULTI_CELL.isoSpan.h,
    });
  });

  it('falls back to one cell for an unknown id, so a stale piece stays erasable', () => {
    expect(furnitureFootprint({ col: 2, row: 2, id: 999_999 }))
      .toEqual({ col: 2, row: 2, w: 1, h: 1 });
  });

  it('bounds-checks the whole footprint, not just the foot cell', () => {
    const span = MULTI_CELL.isoSpan;
    const board = 10;
    // Foot cell on the board but the far corner exactly at the edge → fits.
    const flush: FurniturePlacement = {
      col: board - span.w, row: board - span.h, id: MULTI_CELL.id,
    };
    expect(furnitureFitsBoard(flush, board, board)).toBe(true);
    // One cell further out → the foot cell is still on the board, the footprint is not.
    expect(furnitureFitsBoard({ ...flush, col: flush.col + 1 }, board, board)).toBe(false);
    expect(furnitureFitsBoard({ ...flush, row: flush.row + 1 }, board, board)).toBe(false);
    expect(furnitureFitsBoard({ col: -1, row: 0, id: ANY_ID }, board, board)).toBe(false);
  });
});

describe('collision', () => {
  it('refuses a piece that overlaps a placed one, and allows a shared edge', () => {
    const span = MULTI_CELL.isoSpan;
    const placed: FurniturePlacement[] = [{ col: 4, row: 4, id: MULTI_CELL.id }];
    expect(furnitureOverlapsAny({ col: 4, row: 4, id: ANY_ID }, placed)).toBe(true);
    // Directly abutting along +isoX: the next free cell after the placed span. Touching is
    // not overlapping — furniture must be placeable flush against furniture.
    expect(furnitureOverlapsAny({ col: 4 + span.w, row: 4, id: ANY_ID }, placed)).toBe(false);
    expect(furnitureOverlapsAny({ col: 4, row: 4 + span.h, id: ANY_ID }, placed)).toBe(false);
  });

  it('reports no collision against an empty board', () => {
    expect(furnitureOverlapsAny({ col: 0, row: 0, id: ANY_ID }, [])).toBe(false);
  });
});

describe('picking', () => {
  it('finds a piece from ANY cell of its footprint, not only its foot cell', () => {
    const piece: FurniturePlacement = { col: 2, row: 3, id: MULTI_CELL.id };
    const placed = [piece];
    const { w, h } = MULTI_CELL.isoSpan;
    for (let dx = 0; dx < w; dx++) {
      for (let dy = 0; dy < h; dy++) {
        expect(furnitureAt(placed, 2 + dx, 3 + dy)).toBe(piece);
      }
    }
    expect(furnitureAt(placed, 2 + w, 3)).toBeUndefined();
    expect(furnitureAt(placed, 2, 3 + h)).toBeUndefined();
    expect(furnitureAt([], 2, 3)).toBeUndefined();
  });
});

describe('solid-object displacement (furniture vs props/trees)', () => {
  // A prop or a tree and a piece of furniture are both solid objects standing on the ground,
  // so a cell cannot hold both: whichever is placed second REPLACES the first. These are the
  // cells the furniture side of that pair has to clear.
  const SOLID = 'tree_1.png';
  const FLUSH = 'lightGrassDecor_3.png';
  const isSolid = (url: string) => url === SOLID;

  it('reports every footprint cell holding solid decor, and only those', () => {
    const piece: FurniturePlacement = { col: 2, row: 2, id: MULTI_CELL.id };
    const { w, h } = MULTI_CELL.isoSpan;
    const decor = new Map<string, string>([
      ['2,2', SOLID],                       // under the foot cell
      [`${2 + w},2`, SOLID],                // just outside the footprint along isoX
      [`2,${2 + h}`, SOLID],                // just outside along isoY
      ['0,0', SOLID],                       // elsewhere entirely
    ]);
    expect(furnitureBuriedDecorCells(piece, decor, isSolid)).toEqual(['2,2']);
  });

  it('leaves FLUSH decor alone — furniture stands on the ground, tufts and all', () => {
    const decor = new Map<string, string>([['3,3', FLUSH]]);
    expect(furnitureBuriedDecorCells({ col: 3, row: 3, id: ANY_ID }, decor, isSolid)).toEqual([]);
  });

  it('sweeps the WHOLE footprint of a multi-cell piece, not just the clicked cell', () => {
    // The failure this guards: a 2-cell sofa dropped over two trees clearing only one of them,
    // leaving a tree standing inside the sofa.
    const { w, h } = MULTI_CELL.isoSpan;
    const decor = new Map<string, string>();
    for (let dx = 0; dx < w; dx++) for (let dy = 0; dy < h; dy++) decor.set(`${5 + dx},${5 + dy}`, SOLID);
    const buried = furnitureBuriedDecorCells({ col: 5, row: 5, id: MULTI_CELL.id }, decor, isSolid);
    expect(buried.length).toBe(w * h);
    expect(new Set(buried)).toEqual(new Set(decor.keys()));
  });

  it('reports nothing on a clean board', () => {
    expect(furnitureBuriedDecorCells({ col: 0, row: 0, id: ANY_ID }, new Map(), isSolid)).toEqual([]);
  });

  // The other direction of the same rule — a prop dropped on a piece removes that piece — is
  // `furnitureAt`, covered by the picking tests above: both editors erase whatever it returns.
});

describe('the pack the tool pages through', () => {
  it('offers every sprite, both facings included', () => {
    const ids = lumeishTileset.ids();
    expect(ids.length).toBe(lumeishTileset.all().length);
    // Both facings are separately selectable — the whole reason the tool lists all() rather
    // than canonical() (mirrored art is independently shaded; a flip would light it wrongly).
    expect(ids.length).toBeGreaterThan(lumeishTileset.canonical().length);
    for (const id of ids) expect(furnitureSpriteExists({ col: 0, row: 0, id })).toBe(true);
  });
});
