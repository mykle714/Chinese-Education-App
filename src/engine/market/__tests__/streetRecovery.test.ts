import { describe, it, expect } from 'vitest';
import { recoverStreets } from '../streetRecovery';
import { buildMarketWorld } from '../marketWorld';
import { tileKey } from '../tileGraph';
import type { PlacedTemplate } from '../templateStitch';
import type { TemplateDefinitionPayload } from '../../../features/nightmarket/templateEditorApi';

/** Build a cell set from an inclusive rectangle [c0,c1]×[r0,r1]. */
function rectCells(c0: number, c1: number, r0: number, r1: number): string[] {
  const out: string[] = [];
  for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) out.push(tileKey(c, r));
  return out;
}

describe('recoverStreets', () => {
  it('recovers a single N–S street (taller than wide) with correct extent', () => {
    // 2 wide (cols 3..4), 10 tall (rows 0..9).
    const cells = new Set(rectCells(3, 4, 0, 9));
    const { streets, ownership } = recoverStreets(cells);
    expect(streets).toHaveLength(1);
    const s = streets[0];
    expect(s.isNorthSouth).toBe(true);
    expect(s.offset).toBe(3);
    expect(s.width).toBe(2);
    expect(s.start).toBe(0);
    expect(s.end).toBe(9);
    // Every cell owned by exactly one street.
    for (const c of cells) expect(ownership.get(c)).toHaveLength(1);
  });

  it('recovers a single E–W street (wider than tall)', () => {
    const cells = new Set(rectCells(0, 9, 5, 6)); // 10 wide, 2 tall
    const { streets } = recoverStreets(cells);
    expect(streets).toHaveLength(1);
    expect(streets[0].isNorthSouth).toBe(false);
    expect(streets[0].width).toBe(2);
    expect(streets[0].start).toBe(0);
    expect(streets[0].end).toBe(9);
    expect(streets[0].offset).toBe(5);
  });

  it('recovers a crossing (+) into two streets and marks the overlap as an intersection', () => {
    // N–S street: col 5, rows 0..10. E–W street: row 5, cols 0..10. Overlap at (5,5).
    const cells = new Set<string>([...rectCells(5, 5, 0, 10), ...rectCells(0, 10, 5, 5)]);
    const { streets, ownership } = recoverStreets(cells);
    expect(streets).toHaveLength(2);
    const ns = streets.find((s) => s.isNorthSouth);
    const ew = streets.find((s) => !s.isNorthSouth);
    expect(ns).toBeDefined();
    expect(ew).toBeDefined();
    expect(ns!.width).toBe(1);
    expect(ew!.width).toBe(1);
    // The crossing cell belongs to BOTH streets → intersection.
    expect(ownership.get(tileKey(5, 5))).toHaveLength(2);
    // A body cell of each arm belongs to only one.
    expect(ownership.get(tileKey(5, 0))).toHaveLength(1);
    expect(ownership.get(tileKey(0, 5))).toHaveLength(1);
  });

  it('throws loudly on a street wider than the width=8 authoring bound', () => {
    const cells = new Set(rectCells(0, 8, 0, 8)); // 9×9 block → width 9
    expect(() => recoverStreets(cells)).toThrow(/width 9/);
  });
});

describe('buildMarketWorld', () => {
  /** Minimal placed template carrying only a street + communal mask. */
  function placedWith(street: string[], communal: string[] = []): PlacedTemplate {
    const def = { street, communal } as unknown as TemplateDefinitionPayload;
    return { name: 'test', activeVersion: 0, offsetCol: 0, offsetRow: 0, def };
  }

  it('builds a connected tile graph over street + communal cells and a street graph with an intersection node', () => {
    const street = [...rectCells(5, 5, 0, 10), ...rectCells(0, 10, 5, 5)];
    const communal = rectCells(0, 2, 0, 2); // a detached plaza (not connected to the streets)
    const world = buildMarketWorld([placedWith(street, communal)]);

    // Tile graph = all walkable tiles (street ∪ communal), no duplicates.
    expect(world.tileGraph.tiles.size).toBe(new Set([...street, ...communal]).size);
    // The intersection cell has 4 street neighbors → degree 4 in the tile graph.
    expect(world.tileGraph.neighbors.get(tileKey(5, 5))).toHaveLength(4);
    // Communal cells carry no street ownership.
    const communalTile = world.tiles.find((t) => t.isoX === 0 && t.isoY === 0);
    expect(communalTile?.intersectingStreets).toBeUndefined();
    // Street graph recovered a node at the crossing.
    expect(world.streets).toHaveLength(2);
    expect(world.streetGraph.nodes.size).toBeGreaterThanOrEqual(1);
    expect(world.streetGraph.tileToNode.has(tileKey(5, 5))).toBe(true);
  });

  it('does not duplicate a cell authored as both street and communal', () => {
    const shared = rectCells(0, 3, 0, 1);
    const world = buildMarketWorld([placedWith(shared, shared)]);
    // No throw from buildTileGraph's duplicate guard, and the tile count equals the mask size.
    expect(world.tileGraph.tiles.size).toBe(new Set(shared).size);
  });
});
