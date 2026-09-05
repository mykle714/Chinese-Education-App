import { describe, it, expect } from 'vitest';
import {
  buildEditorField, compileMasks, type BoardFloor, type EditorMasks,
} from '../../../engine/market/farmTerrain';
import { PLANK_SKIRT_PX } from '../../../engine/market/freeFarmTileset';
import { buildDraws, WOOD_FLOOR_Y_OFFSET } from '../terrainDraws';
import { ORIGIN_ZERO } from '../../../engine/market/isometric';

/**
 * The DRAW-LIST half of the board floor (docs/NIGHT_MARKET_FEATURE.md § "Board floor"): a wood
 * floor REPLACES the dirt slab rather than stacking on it, and it carries its own downward
 * offset. Both are properties the engine cannot assert on its own — they live in `buildDraws`
 * and in the two views that consume it.
 */

const masks = (floor: BoardFloor) => compileMasks({
  terrain1: new Set<string>(), terrain2: new Set<string>(), street: new Set<string>(),
  communal: new Set<string>(), placeholder: [], condition: new Set<string>(),
  decor: new Map<string, string>(), floor,
} as EditorMasks);

/** A rim cell — its slab would be VISIBLE on a dirt board, so it proves the skip is unconditional. */
const RIM = '0,0';
const draws = (floor: BoardFloor) => {
  const tiles = buildEditorField(5, 5, masks(floor));
  return buildDraws(tiles, ORIGIN_ZERO, false).draws;
};
const at = (list: ReturnType<typeof draws>, key: string) => list.find((d) => d.key === key)!;

describe('buildDraws — wood floor', () => {
  it('draws the dirt slab on a rim cell of a DIRT board', () => {
    const d = at(draws({ kind: 'dirt', seed: 1 }), RIM);
    expect(d.hideSlab).toBe(false);
    expect(d.dirtUrl).not.toBeNull();
    expect(d.floorUrl).toBeNull();
  });

  it('REPLACES that slab on a wood board — no dirt is drawn under a deck', () => {
    const d = at(draws({ kind: 'wood', seed: 1 }), RIM);
    expect(d.hideSlab).toBe(true);
    expect(d.dirtUrl).toBeNull();
    expect(d.floorUrl).not.toBeNull();
  });

  it('drops the grass surface stack on a decked cell', () => {
    const d = at(draws({ kind: 'wood', seed: 1 }), '2,2');
    expect(d.surfaceUrls).toEqual([]);
    expect(d.darkSurfaceUrls).toEqual([]);
  });

  it('offsets the plank by its own 3px skirt, not the slab’s 16px', () => {
    expect(WOOD_FLOOR_Y_OFFSET).toBe(PLANK_SKIRT_PX);
    expect(WOOD_FLOOR_Y_OFFSET).toBe(3);
  });
});
