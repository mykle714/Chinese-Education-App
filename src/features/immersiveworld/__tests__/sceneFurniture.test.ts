/**
 * Furniture survives a SCENE save. `masksToSceneLayout` / `sceneLayoutToMasks` are the only
 * path between an authored scene board and its stored `layout` jsonb, so a piece dropped here
 * is what makes the Immersive World scene editor's Furniture tool worth anything.
 *
 * The night market has the same seam and its own copy of these tests
 * (`src/features/nightmarket/__tests__/furniturePersistence.test.ts`) — the two boards are
 * saved through DIFFERENT functions into different columns, so one passing says nothing
 * about the other.
 */
import { describe, it, expect } from 'vitest';
import { masksToSceneLayout, sceneLayoutToMasks } from '../immersiveWorldSceneApi';
import type { EditorMasks } from '../../../engine/market/farmTerrain';
import { DIRT_FLOOR } from '../../../engine/market/farmTerrain';
import { lumeishTileset } from '../../../engine/market/lumeishTileset';
import type { FurniturePlacement } from '../../../engine/market/furniture';

const ID_A = lumeishTileset.ids()[0];
const ID_B = lumeishTileset.ids()[1];

const emptyMasks = (): EditorMasks => ({
  terrain1: new Set<string>(),
  terrain2: new Set<string>(),
  street: new Set<string>(),
  communal: new Set<string>(),
  placeholder: [],
  condition: new Set<string>(),
  decor: new Map<string, string>(),
  floor: DIRT_FLOOR,
  furniture: [],
});

describe('scene furniture round-trips through the stored layout', () => {
  it('serializes placements and reads them back unchanged', () => {
    const masks = emptyMasks();
    masks.furniture = [{ col: 4, row: 1, id: ID_A }, { col: 0, row: 3, id: ID_B }];
    const layout = masksToSceneLayout(masks, {});
    // Sorted by anchor so an unchanged board produces an unchanged jsonb blob.
    expect(layout.furniture).toEqual([
      { col: 0, row: 3, id: ID_B },
      { col: 4, row: 1, id: ID_A },
    ]);
    expect(sceneLayoutToMasks(layout).furniture).toEqual(layout.furniture);
  });

  it('opens a scene authored before the Furniture tool with an empty layer', () => {
    expect(sceneLayoutToMasks({ terrain1: [], terrain2: [], decor: {} }).furniture).toEqual([]);
    // A scene with no layout at all (a brand-new draft) must not throw either.
    expect(sceneLayoutToMasks(undefined).furniture).toEqual([]);
  });

  it('drops stale and malformed placements on load', () => {
    const layout = masksToSceneLayout(emptyMasks(), {});
    layout.furniture = [
      { col: 1, row: 1, id: ID_A },
      { col: 0, row: 0, id: 999_999 }, // sprite the pack no longer ships
      ...([{ col: 'x', row: 1, id: ID_A }, null] as unknown as FurniturePlacement[]),
    ];
    expect(sceneLayoutToMasks(layout).furniture).toEqual([{ col: 1, row: 1, id: ID_A }]);
  });
});
