import type { NightMarketAssetDef, Street, TileDef } from './nightMarketRegistry';
import { buildTileGraph, tileKey, type TileGraph } from './tileGraph';
import { buildStreetGraph, type StreetGraph } from './streetGraph';
import { recoverStreets } from './streetRecovery';
import {
  stitchWorld,
  type PlacedTemplate,
  type PlacedPlaceholder,
  type StitchedWorld,
} from './templateStitch';

/**
 * marketWorld — the graph assembler: turn the user's PLACED templates into the navigation
 * graphs the pedestrian engine walks (docs/NIGHT_MARKET_TEMPLATE_RUNTIME_PLAN.md §
 * marketWorld, docs/NIGHT_MARKET_TEMPLATES.md § "Feeding TILE_GRAPH / STREET_GRAPH", slice 2).
 *
 * LAYER: pure engine. No React, no DB, no assets. Replaces the static, hand-authored
 * `tileRegistry` graphs (TILE_GRAPH / STREET_GRAPH built from an empty `STREETS`) with graphs
 * derived at load time from the stitched template mask.
 *
 * Pipeline:
 *   1. {@link ./templateStitch stitchWorld} → a global cell world (street/communal/terrain/…).
 *   2. Build a walkable {@link TileDef} per STREET **and** COMMUNAL cell — the tile graph is
 *      all walkable tiles, 4-connected by {@link buildTileGraph}. Communal tiles carry no
 *      street/intersectingStreets (they're plaza space, never traffic — see the doc), so they
 *      never become street-graph nodes.
 *   3. {@link ./streetRecovery recoverStreets} on the STREET cells only → `Street[]` +
 *      per-cell ownership; stamp each street tile's `intersectingStreets` from ownership.
 *   4. Feed the recovered `Street[]` + stamped tiles to the **existing, unchanged**
 *      {@link buildStreetGraph}. The legacy `buildTilesFromStreets` is NOT used.
 *
 * DEPENDS ON: {@link ./streetRecovery}, {@link ./templateStitch}, {@link ./tileGraph},
 * {@link ./streetGraph}. Consumed by the runtime hook
 * {@link ../../features/nightmarket/useMarketWorld}.
 */

export interface MarketWorld {
  /** Recovered street rectangles (from the street mask). */
  streets: Street[];
  /** Every walkable tile (street + communal), street tiles stamped with `intersectingStreets`. */
  tiles: TileDef[];
  /** Discrete walkable-tile adjacency + stand access, from {@link buildTileGraph}. */
  tileGraph: TileGraph;
  /** Coarse intersection/segment graph, from {@link buildStreetGraph}. */
  streetGraph: StreetGraph;
  /** Grass/decor/houses + placeholder slots for the render layers (terrain reuse). */
  terrain: StitchedWorld;
  /** Placeholder occupant slots in global coords (for stand placement + version conditions). */
  placeholderAreas: PlacedPlaceholder[];
}

/** Parse a "isoX,isoY" cell key into a numeric coordinate pair. */
function parseCell(key: string): [number, number] {
  const [x, y] = key.split(',').map(Number);
  return [x, y];
}

/**
 * Assemble the full {@link MarketWorld} (terrain + graphs) from the placed templates.
 *
 * `stands` are the unlocked stall/POI definitions occupying placeholder slots; they're passed
 * straight to {@link buildTileGraph} for access-tile / footprint validation. Slice 2 has none
 * placed yet (the occupant pipeline is slice 3), so an empty list is the normal case.
 */
export function buildMarketWorld(
  placed: PlacedTemplate[],
  stands: NightMarketAssetDef[] = [],
): MarketWorld {
  const terrain = stitchWorld(placed);

  // Recover street rectangles + ownership from the STREET cells only (communal excluded).
  const { streets, ownership } = recoverStreets(terrain.street);

  // Build the walkable tile list: one TileDef per street cell (stamped with its owners) +
  // one per communal cell (plaza space, no street ownership → never a street-graph node).
  const tiles: TileDef[] = [];
  for (const key of terrain.street) {
    const [isoX, isoY] = parseCell(key);
    const owners = ownership.get(key);
    tiles.push({
      isoX,
      isoY,
      // `street` (singular winner) is unused by buildStreetGraph but kept for debugging: the
      // first-stamped owner. Node/edge construction reads `intersectingStreets` only.
      street: owners?.[0],
      intersectingStreets: owners,
    });
  }
  for (const key of terrain.communal) {
    // A cell authored as BOTH street and communal would double-insert (duplicate tile →
    // buildTileGraph throws). Authoring keeps the classes disjoint; guard defensively.
    if (terrain.street.has(key)) continue;
    const [isoX, isoY] = parseCell(key);
    tiles.push({ isoX, isoY });
  }

  const tileGraph = buildTileGraph(tiles, stands);
  const streetGraph = buildStreetGraph(streets, tiles);

  return {
    streets,
    tiles,
    tileGraph,
    streetGraph,
    terrain,
    placeholderAreas: terrain.placeholders,
  };
}

/** Re-export {@link tileKey} so runtime callers building spawn tiles don't reach into tileGraph. */
export { tileKey };
