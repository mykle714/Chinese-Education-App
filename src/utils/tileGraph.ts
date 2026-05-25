/**
 * Tile graph — discrete walkable-tile adjacency for the night market.
 *
 * The night market's walkable space is a set of 1×1 iso-unit tiles. Two tiles
 * are connected iff they are 4-directional neighbors (Manhattan distance 1)
 * and both are present in the registry. Stand access lives on the tile: a
 * stand is reachable only from a tile that names it in `connections[]`.
 *
 * Validation enforced at build time (throws on violation):
 *   - `connections` must reference known stand assetIds.
 *   - The stand's footprint tile (rounded isoX, isoY) must be a 4-neighbor
 *     of the connecting tile.
 *   - A stand may be referenced by at most one tile (single access point).
 *   - Walkable tiles must not collide with stand footprint tiles.
 *   - No duplicate tile coordinates.
 */

import { TILE_SIZE, type NightMarketAssetDef, type TileCoord, type TileDef } from '../config/nightMarketRegistry';

/** Canonical key for a tile coordinate. */
export const tileKey = (isoX: number, isoY: number): string => `${isoX},${isoY}`;

/** Snap an iso coordinate to the nearest TILE_SIZE multiple. */
export const snapToTile = (iso: number): number =>
  Math.round(iso / TILE_SIZE) * TILE_SIZE;

/**
 * Tiles occupied by a stand in the navigation graph.
 * Returns the explicit `footprint` list when present; otherwise falls back to
 * a single tile at the stand's snapped iso position.
 */
export function standFootprintTiles(stand: NightMarketAssetDef): TileCoord[] {
  if (stand.footprint && stand.footprint.length > 0) return stand.footprint;
  return [{ isoX: snapToTile(stand.isoX), isoY: snapToTile(stand.isoY) }];
}

const NEIGHBOR_OFFSETS: Array<[number, number]> = [
  [TILE_SIZE, 0],
  [-TILE_SIZE, 0],
  [0, TILE_SIZE],
  [0, -TILE_SIZE],
];

export interface TileGraph {
  /** All walkable tiles, keyed by `tileKey`. */
  tiles: Map<string, TileDef>;
  /** tileKey → list of 4-neighbor walkable tileKeys. */
  neighbors: Map<string, string[]>;
  /** assetId → list of tileKeys whose `connections` include that asset. */
  standAccessTiles: Map<string, string[]>;
  /** assetId → list of footprint tileKeys for every stand that has at least one connection. */
  standFootprint: Map<string, string[]>;
}

export interface BuildTileGraphOptions {
  /** Disable adjacency / single-access validation. Off by default. */
  skipValidation?: boolean;
}

/**
 * Build the tile graph from a flat tile list and the stand definitions.
 * Stands without any incoming `connections` are simply unreachable; they are
 * not validated for footprint placement.
 */
export function buildTileGraph(
  tiles: TileDef[],
  stands: NightMarketAssetDef[],
  options: BuildTileGraphOptions = {},
): TileGraph {
  const tileMap = new Map<string, TileDef>();
  for (const t of tiles) {
    const key = tileKey(t.isoX, t.isoY);
    if (tileMap.has(key)) {
      throw new Error(`[tileGraph] Duplicate tile at (${t.isoX}, ${t.isoY})`);
    }
    tileMap.set(key, t);
  }

  // Index stand footprints. Throw if two stands share any footprint tile.
  const standsById = new Map<string, NightMarketAssetDef>();
  /** Every footprint tile across all stands → owning assetId. */
  const footprintToAsset = new Map<string, string>();
  /** assetId → list of footprint tileKeys (for adjacency checks below). */
  const standFootprintKeys = new Map<string, string[]>();
  for (const s of stands) {
    standsById.set(s.assetId, s);
    const tiles = standFootprintTiles(s);
    const keys: string[] = [];
    for (const fp of tiles) {
      const fpKey = tileKey(fp.isoX, fp.isoY);
      if (footprintToAsset.has(fpKey) && !options.skipValidation) {
        throw new Error(
          `[tileGraph] Stands ${footprintToAsset.get(fpKey)} and ${s.assetId} both occupy footprint tile (${fp.isoX}, ${fp.isoY})`,
        );
      }
      footprintToAsset.set(fpKey, s.assetId);
      keys.push(fpKey);
    }
    standFootprintKeys.set(s.assetId, keys);
  }

  // Validate: walkable tiles must not coincide with any stand footprint tile.
  if (!options.skipValidation) {
    for (const key of tileMap.keys()) {
      const collidesWith = footprintToAsset.get(key);
      if (collidesWith) {
        throw new Error(
          `[tileGraph] Walkable tile ${key} collides with footprint of stand ${collidesWith}`,
        );
      }
    }
  }

  // Build adjacency over walkable tiles only.
  const neighbors = new Map<string, string[]>();
  for (const [key, tile] of tileMap) {
    const list: string[] = [];
    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      const nKey = tileKey(tile.isoX + dx, tile.isoY + dy);
      if (tileMap.has(nKey)) list.push(nKey);
    }
    neighbors.set(key, list);
  }

  // Build connection indices and validate adjacency / single-access invariant.
  const standAccessTiles = new Map<string, string[]>();
  const standFootprint = new Map<string, string[]>();
  for (const [key, tile] of tileMap) {
    if (!tile.connections?.length) continue;
    for (const assetId of tile.connections) {
      const stand = standsById.get(assetId);
      if (!stand && !options.skipValidation) {
        throw new Error(
          `[tileGraph] Tile ${key} references unknown stand assetId "${assetId}"`,
        );
      }
      if (!stand) continue;

      // Connection tile must be 4-adjacent to AT LEAST ONE of the stand's
      // footprint tiles. Distance == TILE_SIZE on exactly one axis.
      const fpTiles = standFootprintTiles(stand);
      const isFourNeighbor = fpTiles.some(fp => {
        const dx = Math.abs(fp.isoX - tile.isoX);
        const dy = Math.abs(fp.isoY - tile.isoY);
        return (dx === TILE_SIZE && dy === 0) || (dx === 0 && dy === TILE_SIZE);
      });
      if (!isFourNeighbor && !options.skipValidation) {
        const fpDesc = fpTiles.map(t => `(${t.isoX},${t.isoY})`).join(', ');
        throw new Error(
          `[tileGraph] Tile ${key} declares connection to stand "${assetId}" but no footprint tile [${fpDesc}] is a 4-neighbor`,
        );
      }

      // Single-access invariant: assetId may appear in at most one tile.
      if (standAccessTiles.has(assetId) && !options.skipValidation) {
        throw new Error(
          `[tileGraph] Stand "${assetId}" is referenced by multiple tiles (${standAccessTiles.get(assetId)![0]} and ${key}). Each stand has exactly one access tile.`,
        );
      }
      const arr = standAccessTiles.get(assetId) ?? [];
      arr.push(key);
      standAccessTiles.set(assetId, arr);
      standFootprint.set(assetId, standFootprintKeys.get(assetId) ?? []);
    }
  }

  return { tiles: tileMap, neighbors, standAccessTiles, standFootprint };
}

/**
 * Breadth-first shortest path from `fromKey` to any tile in `goalKeys`.
 * Returns an inclusive list of tileKeys [fromKey, ..., goalKey], or null if
 * unreachable. Returns [fromKey] when the start is already a goal.
 *
 * If `allowedKeys` is provided, BFS expansion is restricted to keys in that
 * set (the start key is always allowed). Use this to constrain pathfinding to
 * a specific street-graph edge body + its two intersection nodes.
 */
export function bfsTilePath(
  graph: TileGraph,
  fromKey: string,
  goalKeys: Set<string>,
  allowedKeys?: Set<string>,
): string[] | null {
  if (goalKeys.has(fromKey)) return [fromKey];
  if (!graph.tiles.has(fromKey)) return null;

  const visited = new Set<string>([fromKey]);
  const parent = new Map<string, string>();
  const queue: string[] = [fromKey];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const adj = graph.neighbors.get(cur) ?? [];
    for (const next of adj) {
      if (visited.has(next)) continue;
      if (allowedKeys && !allowedKeys.has(next)) continue;
      visited.add(next);
      parent.set(next, cur);
      if (goalKeys.has(next)) {
        // Reconstruct path back to fromKey.
        const path: string[] = [next];
        let cursor = next;
        while (cursor !== fromKey) {
          const prev = parent.get(cursor);
          if (prev === undefined) return null;
          path.unshift(prev);
          cursor = prev;
        }
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

/** Parse a tileKey back into a coordinate. */
export function parseTileKey(key: string): TileCoord {
  const [x, y] = key.split(',');
  return { isoX: Number(x), isoY: Number(y) };
}
