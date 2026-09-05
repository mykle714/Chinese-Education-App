import { describe, it, expect } from 'vitest';
import {
  buildEditorField, compileMasks, woodFloorDirection,
  type BoardFloor, type EditorMasks,
} from '../farmTerrain';
import { freeFarmTileset } from '../freeFarmTileset';

/**
 * Tests for the board-wide WOOD FLOOR — the iw scene editor's Dirt/Wood row
 * (docs/IMMERSIVE_WORLD.md § 12 phase 1d, docs/NIGHT_MARKET_FEATURE.md § "Board floor").
 *
 * The properties that matter are (a) only BARE cells deck over, (b) the grain is frozen by
 * the seed rather than by iteration order, and (c) a run caps where it stops.
 */

const masks = (floor: BoardFloor, painted?: Partial<EditorMasks>) => compileMasks({
  terrain1: new Set<string>(), terrain2: new Set<string>(), street: new Set<string>(),
  communal: new Set<string>(), placeholder: [], condition: new Set<string>(),
  decor: new Map<string, string>(), floor, ...painted,
});

const WOOD: BoardFloor = { kind: 'wood', seed: 12345 };
const DIRT: BoardFloor = { kind: 'dirt', seed: 12345 };

/** The tile at (col,row) of a 5×5 board. */
const at = (tiles: ReturnType<typeof buildEditorField>, col: number, row: number) =>
  tiles.find((t) => t.isoX === col && t.isoY === row)!;

describe('buildEditorField — wood floor', () => {
  it('leaves every tile on a dirt board undecked', () => {
    const tiles = buildEditorField(5, 5, masks(DIRT));
    expect(tiles.every((t) => t.floorUrl === null)).toBe(true);
  });

  it('decks every bare cell of a wood board', () => {
    const tiles = buildEditorField(5, 5, masks(WOOD));
    expect(tiles.every((t) => t.floorUrl !== null)).toBe(true);
    expect(tiles.every((t) => freeFarmTileset.stemOf(t.floorUrl!)?.startsWith('plank_'))).toBe(true);
  });

  it('leaves terrain cells to their grass caps — a plank under grass is invisible work', () => {
    const tiles = buildEditorField(5, 5, masks(WOOD, {
      terrain1: new Set(['1,1']),
      terrain2: new Set(['2,2']),
    }));
    expect(at(tiles, 1, 1).floorUrl).toBeNull();
    expect(at(tiles, 2, 2).floorUrl).toBeNull();
    expect(at(tiles, 3, 3).floorUrl).not.toBeNull();
  });

  it('freezes the grain on the seed, not on iteration order', () => {
    const a = buildEditorField(5, 5, masks(WOOD)).map((t) => t.floorUrl);
    const b = buildEditorField(5, 5, masks(WOOD)).map((t) => t.floorUrl);
    expect(a).toEqual(b);
    // A window that culls to one cell must still hand that cell its whole-board plank.
    const culled = buildEditorField(5, 5, masks(WOOD), undefined, {
      minCol: 2, maxCol: 2, minRow: 2, maxRow: 2,
      minDiag: -99, maxDiag: 99, minSum: -99, maxSum: 99,
    });
    expect(culled[0].floorUrl).toBe(at(buildEditorField(5, 5, masks(WOOD)), 2, 2).floorUrl);
  });

  it('runs one direction board-wide and varies only the board pattern', () => {
    const dir = woodFloorDirection(WOOD.seed);
    const tiles = buildEditorField(5, 5, masks(WOOD));
    expect(tiles.every((t) => freeFarmTileset.stemOf(t.floorUrl!)?.startsWith(`plank_${dir}_`))).toBe(true);
    const variations = new Set(
      tiles.map((t) => freeFarmTileset.stemOf(t.floorUrl!)!.split('_')[2]),
    );
    expect(variations.size).toBeGreaterThan(1);
  });

  it('caps the far end of a run and keeps mid-run cells flat', () => {
    const dir = woodFloorDirection(WOOD.seed);
    const tiles = buildEditorField(5, 5, masks(WOOD));
    // The capped face is east for `ew` (+isoX) and north for `ns` (+isoY).
    const [lastCol, lastRow] = dir === 'ew' ? [4, 2] : [2, 4];
    const [midCol, midRow] = dir === 'ew' ? [1, 2] : [2, 1];
    expect(freeFarmTileset.stemOf(at(tiles, lastCol, lastRow).floorUrl!)).toMatch(/_(east|north)Edge$/);
    expect(freeFarmTileset.stemOf(at(tiles, midCol, midRow).floorUrl!)).toMatch(/_center$/);
  });

  it('caps where the deck meets grass, not just at the board edge', () => {
    const dir = woodFloorDirection(WOOD.seed);
    const [grassCol, grassRow] = dir === 'ew' ? [3, 2] : [2, 3];
    const tiles = buildEditorField(5, 5, masks(WOOD, { terrain1: new Set([`${grassCol},${grassRow}`]) }));
    // (2,2) is the cell whose CAPPED face — east for `ew`, north for `ns` — is now grass.
    expect(freeFarmTileset.stemOf(at(tiles, 2, 2).floorUrl!)).toMatch(/_(east|north)Edge$/);
  });

  it('hides the slab under an interior deck cell, as it does under grass', () => {
    const tiles = buildEditorField(5, 5, masks(WOOD));
    expect(at(tiles, 2, 2).slabHidden).toBe(true);   // S, W and SW all in-field
    expect(at(tiles, 0, 0).slabHidden).toBe(false);  // the near corner has neither
  });
});
