/**
 * Smoke + connectivity tests for the tile registry. Verifies that the demo
 * builds cleanly, every stand is reachable, and the graph stays connected
 * across the variable-thickness regions.
 */
import { describe, it, expect } from 'vitest';
import { TILES, TILE_GRAPH, DEMO_STALLS } from '../../config/tileRegistry';
import { TILE_SIZE } from '../../config/nightMarketRegistry';
import { bfsTilePath, tileKey } from '../../utils/tileGraph';

describe('tileRegistry', () => {
  it('produces a non-empty tile set', () => {
    expect(TILES.length).toBeGreaterThan(20);
  });

  it('every tile coordinate is a TILE_SIZE multiple', () => {
    for (const t of TILES) {
      // Use abs to coalesce -0 / +0 (toBe uses Object.is).
      expect(Math.abs(t.isoX % TILE_SIZE), `tile (${t.isoX},${t.isoY}) misaligned on X`).toBe(0);
      expect(Math.abs(t.isoY % TILE_SIZE), `tile (${t.isoX},${t.isoY}) misaligned on Y`).toBe(0);
    }
  });

  it('every demo stand has exactly one access tile', () => {
    for (const stand of DEMO_STALLS) {
      const access = TILE_GRAPH.standAccessTiles.get(stand.assetId);
      expect(access, `stand ${stand.assetId} unreachable`).toBeDefined();
      expect(access!.length).toBe(1);
    }
  });

  it('hub at (0,0) is walkable', () => {
    expect(TILE_GRAPH.tiles.has('0,0')).toBe(true);
  });

  it('every walkable tile is reachable from the hub (single connected component)', () => {
    const start = '0,0';
    const allKeys = new Set(TILE_GRAPH.tiles.keys());
    const visited = new Set<string>([start]);
    const queue: string[] = [start];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const next of TILE_GRAPH.neighbors.get(cur) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    const unreachable = [...allKeys].filter(k => !visited.has(k));
    expect(unreachable, `unreachable tiles: ${unreachable.slice(0, 10).join(', ')}`).toEqual([]);
  });

  it('plaza adjacency: hub center (0,0) has all 4 neighbors inside the plaza', () => {
    // The 3×3 plaza spans (-5,-5)..(5,5). Only the center is fully interior;
    // edge plaza tiles only border 2-3 walkable neighbors. We assert the
    // center sees its 4 plaza neighbors.
    const adj = new Set(TILE_GRAPH.neighbors.get('0,0') ?? []);
    expect(adj.has(tileKey(TILE_SIZE, 0))).toBe(true);
    expect(adj.has(tileKey(-TILE_SIZE, 0))).toBe(true);
    expect(adj.has(tileKey(0, TILE_SIZE))).toBe(true);
    expect(adj.has(tileKey(0, -TILE_SIZE))).toBe(true);
  });

  it('plaza corners exist as walkable tiles', () => {
    for (const x of [-TILE_SIZE, TILE_SIZE]) {
      for (const y of [-TILE_SIZE, TILE_SIZE]) {
        expect(TILE_GRAPH.tiles.has(tileKey(x, y)), `corner (${x},${y}) missing`).toBe(true);
      }
    }
  });

  it('south-ext widened section: side-step across the 3-wide corridor', () => {
    // SOUTH_EXT_WIDE = rect(-5,25,5,45). A pedestrian on (-5,30) can reach (5,30)
    // by stepping east through the spine without going around.
    const path = bfsTilePath(TILE_GRAPH, '-5,30', new Set(['5,30']));
    expect(path).not.toBeNull();
    expect(path!.length).toBeLessThanOrEqual(3);
  });

  it('every stand has a 2×2 footprint and none of those tiles are walkable', () => {
    for (const stand of DEMO_STALLS) {
      const fp = TILE_GRAPH.standFootprint.get(stand.assetId);
      expect(fp, `stand ${stand.assetId} missing from standFootprint map`).toBeDefined();
      expect(fp!.length, `stand ${stand.assetId} footprint not 2×2`).toBe(4);
      for (const k of fp!) {
        expect(TILE_GRAPH.tiles.has(k), `footprint tile ${k} of ${stand.assetId} overlaps walkable`).toBe(false);
      }
    }
  });

  it('cross-region routing: north spoke tip → market row east end is reachable', () => {
    const path = bfsTilePath(TILE_GRAPH, '0,-40', new Set(['80,60']));
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(0);
  });
});
