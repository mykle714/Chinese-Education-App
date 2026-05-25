/**
 * Street graph — coarse traversal graph layered on top of the tile grid.
 *
 * Nodes are intersections: contiguous regions of tiles claimed by 2+ streets
 * (see `Street` in `nightMarketRegistry.ts` and `buildTilesFromStreets` in
 * `tileRegistry.ts`). Edges are street segments between two intersections.
 *
 * The street graph is the **planning** layer for pedestrians. A high-level
 * path is a list of node ids; movement between nodes still happens
 * tile-by-tile on the underlying tile graph, but constrained to the chosen
 * edge's body tiles (optionally restricted to a single lane for visual
 * variety on wide streets).
 *
 * Stand access tiles are NOT nodes. The last-mile from a goal node to the
 * stand's connection tile is handled by a regular tile-graph BFS.
 *
 * Street design constraints (load-bearing assumption):
 *   - Every Street is axis-aligned: either purely north–south or purely
 *     east–west, per the `isNorthSouth` flag. There are no diagonal or
 *     curved streets.
 *   - Every StreetEdge.bodyTileSet is therefore a straight axial strip of
 *     tiles between two intersection nodes.
 *   - As a consequence, traversal along an edge is reducible to monotonic
 *     motion along the street's primary axis; no per-step search is needed.
 *     The pedestrian agent relies on this invariant for axial leg
 *     navigation and sidestep recovery (see pedestrianAgent.ts).
 */

import {
  TILE_SIZE,
  type Street,
  type TileCoord,
  type TileDef,
} from '../config/nightMarketRegistry';
import { tileKey } from './tileGraph';

/** One contiguous overlap region; a stopping point in the high-level plan. */
export interface StreetNode {
  id: string;
  /** Every tile coord (as tileKey) belonging to this intersection. */
  tileKeys: Set<string>;
  /** Distinct streets that meet at this node. */
  streets: Street[];
  /** Centroid in iso units; for debug labels only. */
  centerIsoX: number;
  centerIsoY: number;
}

/** A walkable segment of one street between two intersection nodes. */
export interface StreetEdge {
  street: Street;
  nodeA: StreetNode;
  nodeB: StreetNode;
  /**
   * Union of every body tile key (across all lanes) strictly between `nodeA`
   * and `nodeB` on this street. Body tiles are the tiles that belong only to
   * this street (i.e. `tile.intersectingStreets.length === 1`) and sit between the two
   * intersection regions.
   *
   * Per-lane partitioning is intentionally not modeled: a lane-restricted
   * subset is unreachable for lanes that don't directly touch both endpoint
   * nodes (e.g. lane 7 of an 8-wide street that only intersects another street
   * on lane 0). Pedestrians walk the full body and lane variety is induced by
   * randomizing the goal tile within the destination node.
   */
  bodyTileSet: Set<string>;
}

/** Adjacency entry: another node reachable via a specific edge. */
export interface StreetAdjEntry {
  edge: StreetEdge;
  /** The other endpoint (not the entry's owner). */
  other: StreetNode;
}

/**
 * A single leg of a pedestrian journey. Each leg is an axial walk along
 * one street edge toward a target. The pedestrian walks monotonically
 * along the street's primary axis, keeping whatever perpendicular coord
 * `currentTile` happens to have — there is no fixed lane.
 *
 * Target variants:
 *   - `{ kind: 'node', node }` — leg ends when the ped first enters any
 *     tile of `node`, plus a random extra depth into the node (sampled
 *     at entry, see `tickPedestrian`).
 *   - `{ kind: 'tile', tile }` — leg ends when `currentTile === tile`.
 *     Used for the last leg when the goal is a specific tile (stand
 *     access). The ped walks axially along `edge` until its primary
 *     coord matches `tile`'s, then steps perpendicularly to reach it.
 *     Works whether `tile` is on the edge body or inside a node.
 *
 * See docs/PEDESTRIAN_WALKING_ALGORITHM.md for the full algorithm.
 */
export interface NavLeg {
  edge: StreetEdge;
  target:
    | { kind: 'node'; node: StreetNode }
    | { kind: 'tile'; tile: TileCoord };
}

export interface StreetGraph {
  nodes: Map<string, StreetNode>;
  edges: StreetEdge[];
  /** nodeId → list of (edge, neighbor) pairs. */
  adjacency: Map<string, StreetAdjEntry[]>;
  /** Any intersection tile → the node that contains it. */
  tileToNode: Map<string, StreetNode>;
  /**
   * Body-tile key → the edge whose body contains it. Built once at graph
   * construction. Lets the pedestrian planner classify the start/goal tile
   * as on-edge vs in-node in O(1), and lets sidestep validity checks
   * resolve the current edge in O(1).
   *
   * Body tiles belong to exactly one edge by construction (a body tile
   * has `tile.intersectingStreets.length === 1` and sits strictly between two
   * intersection nodes on that street).
   */
  tileToEdge: Map<string, StreetEdge>;
}

// ---------------------------------------------------------------------------
// Node construction — 4-connected components of intersection tiles.
// ---------------------------------------------------------------------------

const NEIGHBOR_OFFSETS: Array<[number, number]> = [
  [TILE_SIZE, 0],
  [-TILE_SIZE, 0],
  [0, TILE_SIZE],
  [0, -TILE_SIZE],
];

/**
 * Build the set of nodes by finding 4-connected components among tiles whose
 * `intersectingStreets` list has length >= 2. Each component becomes one StreetNode.
 */
function buildNodes(tiles: TileDef[]): {
  nodes: Map<string, StreetNode>;
  tileToNode: Map<string, StreetNode>;
} {
  // Index intersection tiles by key for fast lookup during BFS flood fill.
  const intersectionTiles = new Map<string, TileDef>();
  for (const t of tiles) {
    if ((t.intersectingStreets?.length ?? 0) >= 2) {
      intersectionTiles.set(tileKey(t.isoX, t.isoY), t);
    }
  }

  const tileToNode = new Map<string, StreetNode>();
  const nodes = new Map<string, StreetNode>();

  for (const [seedKey, seedTile] of intersectionTiles) {
    if (tileToNode.has(seedKey)) continue;
    // Flood fill over 4-neighbors that are also intersection tiles.
    const componentKeys = new Set<string>([seedKey]);
    const streetSet = new Map<string, Street>(); // dedupe by name
    const queue: TileDef[] = [seedTile];
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    while (queue.length > 0) {
      const cur = queue.shift()!;
      sumX += cur.isoX;
      sumY += cur.isoY;
      count += 1;
      for (const s of cur.intersectingStreets ?? []) streetSet.set(s.name, s);
      for (const [dx, dy] of NEIGHBOR_OFFSETS) {
        const nKey = tileKey(cur.isoX + dx, cur.isoY + dy);
        if (componentKeys.has(nKey)) continue;
        const nTile = intersectionTiles.get(nKey);
        if (!nTile) continue;
        componentKeys.add(nKey);
        queue.push(nTile);
      }
    }

    const streetList = Array.from(streetSet.values());
    // Build a stable, readable id from the street names + seed coordinate.
    const namesSorted = streetList.map(s => s.name).sort().join('|');
    const id = `node:${namesSorted}@${seedTile.isoX},${seedTile.isoY}`;
    const node: StreetNode = {
      id,
      tileKeys: componentKeys,
      streets: streetList,
      centerIsoX: sumX / count,
      centerIsoY: sumY / count,
    };
    nodes.set(id, node);
    for (const k of componentKeys) tileToNode.set(k, node);
  }

  return { nodes, tileToNode };
}

// ---------------------------------------------------------------------------
// Node projection — extend each detected intersection node across the full
// width of every participating street.
// ---------------------------------------------------------------------------

/**
 * A narrow cross-street can touch a wide street at only some of its lanes
 * (e.g. a width-1 spoke ending at the south edge of a width-8 Market Row
 * only physically claims the southernmost lane). Without expansion, the
 * other lanes at that primary-axis column would be orphan tiles — claimed
 * by only one street, not part of any node, and (because the lane-by-lane
 * edge walk never enters a node on those lanes) not part of any edge body.
 *
 * Projection rule: for every street S that participates in a node, find the
 * primary-axis positions of node tiles that S physically claims, then add
 * every tile of S at those positions across S's full width to the node. The
 * result is that an intersection always spans the full perpendicular width
 * of every street that meets it, even when the crossing street is narrower.
 *
 * Projected tiles may have `intersectingStreets.length === 1` (only the
 * wide street claims them), which is fine — the projection makes the node
 * a structural concept on the street graph, not a literal "tiles claimed
 * by 2+ streets" filter.
 */
function expandNodesByProjection(
  nodes: Map<string, StreetNode>,
  tileToNode: Map<string, StreetNode>,
  tileMap: Map<string, TileDef>,
): void {
  for (const node of nodes.values()) {
    // For each participating street, gather the primary-axis positions at
    // which this node's tiles are claimed by that street.
    const primPositionsByStreet = new Map<
      string,
      { street: Street; positions: Set<number> }
    >();
    const participatingNames = new Set(node.streets.map(s => s.name));
    for (const k of node.tileKeys) {
      const tile = tileMap.get(k);
      if (!tile) continue;
      for (const s of tile.intersectingStreets ?? []) {
        if (!participatingNames.has(s.name)) continue;
        const prim = s.isNorthSouth ? tile.isoY : tile.isoX;
        let entry = primPositionsByStreet.get(s.name);
        if (!entry) {
          entry = { street: s, positions: new Set<number>() };
          primPositionsByStreet.set(s.name, entry);
        }
        entry.positions.add(prim);
      }
    }

    // Project across each street's full width at every claimed prim position.
    for (const { street, positions } of primPositionsByStreet.values()) {
      for (const prim of positions) {
        for (let laneIdx = 0; laneIdx < street.width; laneIdx++) {
          const perp = street.offset + laneIdx * TILE_SIZE;
          const isoX = street.isNorthSouth ? perp : prim;
          const isoY = street.isNorthSouth ? prim : perp;
          const k = tileKey(isoX, isoY);
          if (!tileMap.has(k)) continue;
          if (node.tileKeys.has(k)) continue;
          node.tileKeys.add(k);
          tileToNode.set(k, node);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Dead-end node creation — synthesize a node at each unterminated street end
// so stub segments can still be edges.
// ---------------------------------------------------------------------------

/**
 * Walkable model invariant: every walkable tile is either a node tile or an
 * edge-body tile. Streets that physically end without meeting another street
 * (dead ends) would otherwise produce trailing/leading body tiles with no
 * second endpoint to anchor an edge.
 *
 * For each street, find the primary-axis range covered by existing nodes
 * (after projection). If a stub exists before the first node or after the
 * last node, synthesize a 1-column-wide node at the street's `start`/`end`
 * across all lanes. These nodes are graph leaves: pedestrians never plan a
 * route that ends at one, but they let stub tiles become a normal edge body
 * between the dead-end node and the nearest real intersection.
 *
 * A street with zero real intersections gets dead-end nodes at BOTH ends —
 * its whole length becomes one orphan edge (useful only for tile-graph
 * last-mile routing, but at least all tiles are accounted for).
 */
function addDeadEndNodes(
  streets: Street[],
  nodes: Map<string, StreetNode>,
  tileToNode: Map<string, StreetNode>,
  tileMap: Map<string, TileDef>,
): void {
  for (const street of streets) {
    const lo = Math.min(street.start, street.end);
    const hi = Math.max(street.start, street.end);

    // Find the primary-axis extent of THIS street's existing node tiles.
    let minNodePrim = Infinity;
    let maxNodePrim = -Infinity;
    for (let prim = lo; prim <= hi; prim += TILE_SIZE) {
      for (let laneIdx = 0; laneIdx < street.width; laneIdx++) {
        const perp = street.offset + laneIdx * TILE_SIZE;
        const isoX = street.isNorthSouth ? perp : prim;
        const isoY = street.isNorthSouth ? prim : perp;
        const k = tileKey(isoX, isoY);
        if (!tileMap.has(k)) continue;
        if (!tileToNode.has(k)) continue;
        if (prim < minNodePrim) minNodePrim = prim;
        if (prim > maxNodePrim) maxNodePrim = prim;
        break; // any lane having a node at this prim is enough
      }
    }

    const createDeadEnd = (prim: number) => {
      const tileKeys = new Set<string>();
      let sumX = 0;
      let sumY = 0;
      let count = 0;
      for (let laneIdx = 0; laneIdx < street.width; laneIdx++) {
        const perp = street.offset + laneIdx * TILE_SIZE;
        const isoX = street.isNorthSouth ? perp : prim;
        const isoY = street.isNorthSouth ? prim : perp;
        const k = tileKey(isoX, isoY);
        if (!tileMap.has(k)) continue;
        // Skip tiles already claimed by another node (shouldn't happen at a
        // true dead end, but stay defensive).
        if (tileToNode.has(k)) continue;
        tileKeys.add(k);
        sumX += isoX;
        sumY += isoY;
        count += 1;
      }
      if (tileKeys.size === 0) return;
      const id = `node:dead-end:${street.name}@${prim}`;
      const node: StreetNode = {
        id,
        tileKeys,
        streets: [street],
        centerIsoX: sumX / count,
        centerIsoY: sumY / count,
      };
      nodes.set(id, node);
      for (const k of tileKeys) tileToNode.set(k, node);
    };

    if (minNodePrim === Infinity) {
      // No nodes on this street — bookend with two dead-ends.
      createDeadEnd(lo);
      createDeadEnd(hi);
    } else {
      if (minNodePrim > lo) createDeadEnd(lo);
      if (maxNodePrim < hi) createDeadEnd(hi);
    }
  }
}

// ---------------------------------------------------------------------------
// Edge construction — walk each street lane-by-lane, splice node visits.
// ---------------------------------------------------------------------------

/** Canonical edge key (order-independent in node ids; street name disambiguates). */
function edgeKey(streetName: string, nodeIdA: string, nodeIdB: string): string {
  const [a, b] = nodeIdA < nodeIdB ? [nodeIdA, nodeIdB] : [nodeIdB, nodeIdA];
  return `${streetName}::${a}::${b}`;
}

/**
 * Walk every lane of every street in primary-axis order and emit edges every
 * time we transition between two distinct intersection nodes. The body tiles
 * collected between the two nodes (per lane) form the edge body.
 *
 * This per-lane walk relies on two upstream invariants enforced before edge
 * construction:
 *   1. Projection: intersection nodes span the full width of every street
 *      that participates in them, so every lane of a street physically
 *      enters/exits a node tile when the street crosses or touches another.
 *      See `expandNodesByProjection`.
 *   2. Dead-end nodes: every street has a node at each of its primary-axis
 *      ends, either a real intersection or a synthetic dead-end node, so
 *      that stub segments still become edges. See `addDeadEndNodes`.
 *
 * Notes:
 * - A lane segment that exits one node and re-enters the same node produces
 *   no edge (it's a U-turn within the same intersection — shouldn't happen
 *   in practice for axis-aligned streets but we guard anyway).
 */
function buildEdges(
  streets: Street[],
  tileMap: Map<string, TileDef>,
  tileToNode: Map<string, StreetNode>,
): { edges: StreetEdge[]; adjacency: Map<string, StreetAdjEntry[]> } {
  const edgeMap = new Map<string, StreetEdge>();

  for (const street of streets) {
    for (let laneIdx = 0; laneIdx < street.width; laneIdx++) {
      const perp = street.offset + laneIdx * TILE_SIZE;
      const lo = Math.min(street.start, street.end);
      const hi = Math.max(street.start, street.end);

      // Walk the lane primary-axis ascending.
      let prevNode: StreetNode | null = null;
      let buffer: string[] = [];
      for (let prim = lo; prim <= hi; prim += TILE_SIZE) {
        const isoX = street.isNorthSouth ? perp : prim;
        const isoY = street.isNorthSouth ? prim : perp;
        const k = tileKey(isoX, isoY);
        const tile = tileMap.get(k);
        if (!tile) continue;
        const node = tileToNode.get(k);
        if (node) {
          if (prevNode && prevNode.id !== node.id) {
            // Close out the segment prev → node with the buffered body tiles.
            const ek = edgeKey(street.name, prevNode.id, node.id);
            let edge = edgeMap.get(ek);
            if (!edge) {
              edge = {
                street,
                nodeA: prevNode,
                nodeB: node,
                bodyTileSet: new Set<string>(),
              };
              edgeMap.set(ek, edge);
            }
            for (const t of buffer) edge.bodyTileSet.add(t);
          }
          buffer = [];
          prevNode = node;
        } else {
          // Body tile — only meaningful once we've entered a node.
          if (prevNode) buffer.push(k);
        }
      }
    }
  }

  const edges = Array.from(edgeMap.values());
  const adjacency = new Map<string, StreetAdjEntry[]>();
  for (const edge of edges) {
    const a = adjacency.get(edge.nodeA.id) ?? [];
    a.push({ edge, other: edge.nodeB });
    adjacency.set(edge.nodeA.id, a);
    const b = adjacency.get(edge.nodeB.id) ?? [];
    b.push({ edge, other: edge.nodeA });
    adjacency.set(edge.nodeB.id, b);
  }
  return { edges, adjacency };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildStreetGraph(
  streets: Street[],
  tiles: TileDef[],
): StreetGraph {
  const tileMap = new Map<string, TileDef>();
  for (const t of tiles) tileMap.set(tileKey(t.isoX, t.isoY), t);

  const { nodes, tileToNode } = buildNodes(tiles);
  expandNodesByProjection(nodes, tileToNode, tileMap);
  addDeadEndNodes(streets, nodes, tileToNode, tileMap);
  const { edges, adjacency } = buildEdges(streets, tileMap, tileToNode);

  // Body tile → owning edge (each body tile belongs to exactly one edge).
  const tileToEdge = new Map<string, StreetEdge>();
  for (const edge of edges) {
    for (const k of edge.bodyTileSet) tileToEdge.set(k, edge);
  }

  return { nodes, edges, adjacency, tileToNode, tileToEdge };
}

/**
 * BFS over the street-node adjacency map. Returns the inclusive list of node
 * ids from `fromNodeId` to `toNodeId`, or null if unreachable.
 */
export function bfsStreetPath(
  graph: StreetGraph,
  fromNodeId: string,
  toNodeId: string,
): string[] | null {
  if (fromNodeId === toNodeId) return [fromNodeId];
  if (!graph.nodes.has(fromNodeId) || !graph.nodes.has(toNodeId)) return null;

  const visited = new Set<string>([fromNodeId]);
  const parent = new Map<string, string>();
  const queue: string[] = [fromNodeId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const { other } of graph.adjacency.get(cur) ?? []) {
      if (visited.has(other.id)) continue;
      visited.add(other.id);
      parent.set(other.id, cur);
      if (other.id === toNodeId) {
        const path: string[] = [other.id];
        let cursor: string | undefined = other.id;
        while (cursor !== fromNodeId) {
          cursor = parent.get(cursor!);
          if (!cursor) return null;
          path.unshift(cursor);
        }
        return path;
      }
      queue.push(other.id);
    }
  }
  return null;
}

/**
 * Resolve the edge between two adjacent nodes on a planned path. Returns
 * undefined if the two nodes aren't connected (which shouldn't happen for a
 * path produced by `bfsStreetPath`).
 */
export function findEdge(
  graph: StreetGraph,
  fromNodeId: string,
  toNodeId: string,
): StreetEdge | undefined {
  for (const entry of graph.adjacency.get(fromNodeId) ?? []) {
    if (entry.other.id === toNodeId) return entry.edge;
  }
  return undefined;
}

/**
 * Walkable tile-key set for a single edge leg: union of both endpoint nodes
 * and the edge's body. Use this as the `allowedKeys` filter when running
 * tile-BFS for one leg of a journey — it forces the pedestrian to traverse
 * the edge rather than cutting across other streets.
 */
export function edgeWalkableSet(edge: StreetEdge): Set<string> {
  const out = new Set<string>();
  for (const k of edge.bodyTileSet) out.add(k);
  for (const k of edge.nodeA.tileKeys) out.add(k);
  for (const k of edge.nodeB.tileKeys) out.add(k);
  return out;
}
