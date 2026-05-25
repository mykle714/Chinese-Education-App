/**
 * Smoke + connectivity tests for the tile registry. Verifies that the demo
 * builds cleanly, every stand is reachable, and the graph stays connected
 * across the variable-thickness regions.
 */
import { describe, it, expect } from 'vitest';
import { TILES, TILE_GRAPH, DEMO_STALLS, STREETS, streetTiles } from '../../config/tileRegistry';
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

  it('hub center (0,0) sees its four cardinal strip neighbors', () => {
    // With the plaza removed, (0,0) is the junction of four 1-wide strips:
    // STRIP_NORTH (south side), STRIP_EAST_TO_BEND, STRIP_WEST, STRIP_SOUTH_TO_NODE.
    const adj = new Set(TILE_GRAPH.neighbors.get('0,0') ?? []);
    expect(adj.has(tileKey(TILE_SIZE, 0))).toBe(true);
    expect(adj.has(tileKey(-TILE_SIZE, 0))).toBe(true);
    expect(adj.has(tileKey(0, TILE_SIZE))).toBe(true);
    expect(adj.has(tileKey(0, -TILE_SIZE))).toBe(true);
  });

  it('every stand has an 8×8 square footprint and none of those tiles are walkable', () => {
    for (const stand of DEMO_STALLS) {
      const fp = TILE_GRAPH.standFootprint.get(stand.assetId);
      expect(fp, `stand ${stand.assetId} missing from standFootprint map`).toBeDefined();
      expect(fp!.length, `stand ${stand.assetId} footprint not 8×8`).toBe(64);
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

  it('every tile in TILES has a street reference', () => {
    for (const t of TILES) {
      expect(t.street, `tile (${t.isoX},${t.isoY}) missing street`).toBeDefined();
    }
  });

  it('at an intersection, the thicker street owns the tile', () => {
    // West Spoke (EW, w=5) overlaps North Spoke (NS, w=4) at the hub region.
    // West Spoke is processed first (width 5 > 4) → it owns (0,0).
    const hub = TILES.find(t => t.isoX === 0 && t.isoY === 0);
    expect(hub?.street?.name).toBe('West Spoke');
  });

  it('at equal-width intersections, NS street wins over EW', () => {
    // South Spur (NS, w=2) and South Cross (EW, w=2) overlap at isoX=20..21, isoY=20..21.
    // South Spur (NS) wins the tiebreak → it owns (20,20).
    const tile = TILES.find(t => t.isoX === 20 && t.isoY === 20);
    expect(tile?.street?.name).toBe('South Spur');
  });
});

describe('streetTiles', () => {
  it('N–S street expands to a width×length block in the +offset direction', () => {
    // offset=5, width=3 → spans isoX ∈ {5,6,7} (TILE_SIZE=1).
    const tiles = streetTiles({
      name: 'test-ns', isNorthSouth: true, start: 0, end: 2, offset: 5, width: 3,
    });
    const keys = new Set(tiles.map(t => `${t.isoX},${t.isoY}`));
    expect(tiles.length).toBe(9);
    for (const x of [5, 6, 7]) {
      for (const y of [0, 1, 2]) {
        expect(keys.has(`${x},${y}`), `missing (${x},${y})`).toBe(true);
      }
    }
  });

  it('E–W street with negative offset still expands toward positive', () => {
    // offset=-10, width=2 → spans isoY ∈ {-10,-9}.
    const tiles = streetTiles({
      name: 'test-ew', isNorthSouth: false, start: 0, end: 0, offset: -10, width: 2,
    });
    const keys = new Set(tiles.map(t => `${t.isoX},${t.isoY}`));
    expect(tiles.length).toBe(2);
    expect(keys.has('0,-10')).toBe(true);
    expect(keys.has('0,-9')).toBe(true);
  });

  it('endpoints are inclusive on both ends', () => {
    const tiles = streetTiles({
      name: 'test-incl', isNorthSouth: true, start: -2, end: 2, offset: 0, width: 1,
    });
    expect(tiles.length).toBe(5); // -2,-1,0,1,2
  });

  it('throws on width < 1', () => {
    expect(() =>
      streetTiles({ name: 'bad', isNorthSouth: true, start: 0, end: 0, offset: 0, width: 0 }),
    ).toThrow(/width=0/);
  });

  it('every Street in STREETS expands entirely into the TILES set', () => {
    const tileKeys = new Set(TILES.map(t => `${t.isoX},${t.isoY}`));
    for (const s of STREETS) {
      for (const t of streetTiles(s)) {
        const k = `${t.isoX},${t.isoY}`;
        expect(tileKeys.has(k), `street "${s.name}" tile ${k} missing from TILES`).toBe(true);
      }
    }
  });
});
