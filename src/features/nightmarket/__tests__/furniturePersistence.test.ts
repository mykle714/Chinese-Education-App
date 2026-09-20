/**
 * Furniture SURVIVES A SAVE. `masksToDefinition` / `definitionToMasks` are the only path
 * between an authored board and the stored JSONB, so a piece dropped here is what makes
 * furniture placement worth anything at all — and the two functions are easy to add a layer
 * to on one side only.
 *
 * Covers the wire shape (docs/NIGHT_MARKET_TEMPLATES.md), the back-compat path for every
 * template saved before the Furniture tool existed, and the stale-sprite drop.
 */
import { describe, it, expect } from 'vitest';
import { masksToDefinition, definitionToMasks } from '../templateEditorApi';
import type { EditorMasks } from '../../../engine/market/farmTerrain';
import type { TemplateDefinitionPayload } from '../../../engine/market/templateDefinition';
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
  furniture: [],
});

describe('furniture round-trips through the stored definition', () => {
  it('serializes placements and reads them back unchanged', () => {
    const masks = emptyMasks();
    masks.furniture = [{ col: 5, row: 2, id: ID_A }, { col: 1, row: 7, id: ID_B }];
    const def = masksToDefinition(masks);
    expect(def.furniture).toEqual([
      { col: 1, row: 7, id: ID_B },
      { col: 5, row: 2, id: ID_A },
    ]);
    // Sorted by anchor so an unchanged board produces an unchanged JSON blob (stable diffs),
    // which is why the read-back is compared as a SET-like sorted list rather than by order.
    expect(definitionToMasks(def).furniture).toEqual(def.furniture);
  });

  it('loads a pre-furniture template as an empty layer, not a crash', () => {
    // Every template saved before the tool shipped has no `furniture` key at all.
    const legacy = {
      terrain1: [], terrain2: [], street: [], communal: [],
      placeholder: [], condition: [], decor: {},
    } as TemplateDefinitionPayload;
    expect(definitionToMasks(legacy).furniture).toEqual([]);
  });

  it('drops a placement whose sprite the pack no longer ships', () => {
    // A stale id would otherwise render as nothing while still occupying cells — invisible
    // and un-erasable.
    const def = masksToDefinition(emptyMasks());
    def.furniture = [{ col: 0, row: 0, id: 999_999 }, { col: 1, row: 1, id: ID_A }];
    expect(definitionToMasks(def).furniture).toEqual([{ col: 1, row: 1, id: ID_A }]);
  });

  it('ignores structurally malformed records', () => {
    const def = masksToDefinition(emptyMasks());
    // Hand-edited / older-shape JSON: the load path must not hand the renderer a NaN anchor.
    def.furniture = [
      { col: 2, row: 2, id: ID_A },
      ...([{ col: 'x', row: 1, id: ID_A }, null, 'nope'] as unknown as FurniturePlacement[]),
    ];
    expect(definitionToMasks(def).furniture).toEqual([{ col: 2, row: 2, id: ID_A }]);
  });
});
