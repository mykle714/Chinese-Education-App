import { describe, it, expect } from 'vitest';
import { buildMarketWorld } from '../marketWorld';
import { tileKey } from '../tileGraph';
import { makeAmbientPedestrian } from '../tileRegistry';
import {
  tickPedestrian,
  ensureAmbientAgenda,
  computeDrawable,
  updateTileOccupancy,
  type PedestrianTickContext,
} from '../pedestrianAgent';
import type { PlacedTemplate } from '../templateStitch';
import type { TemplateDefinitionPayload } from '../../../features/nightmarket/templateEditorApi';

/**
 * Headless smoke test for the slice-2 pedestrian wiring: assemble a MarketWorld from a small
 * street mask, seed an ambient (Wander) pedestrian, and tick it for a few simulated seconds.
 * Proves the runtime path (buildMarketWorld → graphs → tickPedestrian → computeDrawable) runs
 * end-to-end without throwing and that the walker actually moves off its start tile. This is
 * the browser-independent proxy for "pedestrians walk the hub".
 */
describe('pedestrian simulation on a recovered market world', () => {
  function rectCells(c0: number, c1: number, r0: number, r1: number): string[] {
    const out: string[] = [];
    for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) out.push(tileKey(c, r));
    return out;
  }

  it('an ambient pedestrian walks the recovered graph without error and changes position', () => {
    // A 2-wide + crossing so the tile graph is well-connected (room to wander).
    const street = [...rectCells(4, 5, 0, 12), ...rectCells(0, 12, 6, 7)];
    const def = { street } as unknown as TemplateDefinitionPayload;
    const placed: PlacedTemplate = { name: 'test', activeVersion: 0, offsetCol: 0, offsetRow: 0, def };
    const world = buildMarketWorld([placed]);

    // Seed a walker on a known tile.
    const startTile = { isoX: 4, isoY: 0 };
    let ped = makeAmbientPedestrian('ped-0', startTile);

    const ctx: PedestrianTickContext = {
      graph: world.tileGraph,
      streetGraph: world.streetGraph,
      stands: new Map(),
      tMs: 0,
      allPedestrians: [ped],
    };

    // Tick ~5 s at 60fps. Should never throw and should produce a valid drawable each frame.
    let moved = false;
    for (let i = 0; i < 300; i++) {
      const tMs = i * 16.7;
      const refilled = ensureAmbientAgenda(ped, 2000);
      ped = tickPedestrian(refilled, 16.7, { ...ctx, tMs, allPedestrians: [ped] });
      updateTileOccupancy([ped], world.tileGraph.tiles);
      const d = computeDrawable(ped, world.tileGraph, tMs, new Map());
      expect(d).not.toBeNull();
      if (ped.currentTile.isoX !== startTile.isoX || ped.currentTile.isoY !== startTile.isoY) {
        moved = true;
      }
      // The walker must never leave the walkable graph.
      expect(world.tileGraph.tiles.has(tileKey(ped.currentTile.isoX, ped.currentTile.isoY))).toBe(true);
    }
    expect(moved).toBe(true);
  });
});
