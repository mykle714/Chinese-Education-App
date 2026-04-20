/**
 * Walkway macro-layer navigation.
 *
 * Builds a graph where nodes = walkway endpoints (merged by exact coordinate
 * match) and edges = walkways. Pedestrians consult this only when they need to
 * choose between multiple walkways at a junction — per-walkway movement is
 * handled by walkwayTraversal.ts.
 *
 * Assumption: all walkway segments are axis-aligned (orthogonal). Endpoints
 * that share the same iso coordinate pair always merge into one junction node.
 *
 * The RouteStrategy interface is intentionally narrow so we can swap in A*,
 * weighted costs, or flow-fields later without touching pedestrian code.
 */

import type { WalkwayDef } from '../config/nightMarketRegistry';

/** A junction / endpoint in the walkway graph. */
export interface GraphNode {
  nodeId: string;
  /** Iso-space position (averaged across merged endpoints). */
  isoX: number;
  isoY: number;
  /** Walkway IDs that touch this node. */
  walkwayIds: string[];
}

export interface WalkwayGraph {
  nodes: Map<string, GraphNode>;
  /** walkwayId → [startNodeId, endNodeId]. Order matches polyline[0] / polyline[N-1]. */
  walkwayEndpoints: Map<string, [string, string]>;
  /** For each nodeId, the walkways incident to it. Derived from walkwayEndpoints. */
  adjacency: Map<string, string[]>;
}

/** Canonical string key for an iso endpoint — used for exact junction merging. */
const endpointKey = (isoX: number, isoY: number): string => `${isoX},${isoY}`;

/**
 * Build a graph from a flat list of walkways.
 * Endpoints at identical iso coordinates merge into one junction node.
 */
export function buildGraph(walkways: WalkwayDef[]): WalkwayGraph {
  const nodes = new Map<string, GraphNode>();
  const walkwayEndpoints = new Map<string, [string, string]>();
  // Maps endpointKey → nodeId so lookups are O(1) instead of O(n).
  const keyToNodeId = new Map<string, string>();

  let nextNodeId = 0;
  const findOrCreateNode = (isoX: number, isoY: number, walkwayId: string): string => {
    const key = endpointKey(isoX, isoY);
    const existing = keyToNodeId.get(key);
    if (existing) {
      nodes.get(existing)!.walkwayIds.push(walkwayId);
      return existing;
    }
    const nodeId = `n${nextNodeId++}`;
    nodes.set(nodeId, { nodeId, isoX, isoY, walkwayIds: [walkwayId] });
    keyToNodeId.set(key, nodeId);
    return nodeId;
  };

  for (const w of walkways) {
    if (w.polyline.length < 2) {
      console.warn(`[walkwayGraph] Walkway ${w.walkwayId} has <2 points; skipping.`);
      continue;
    }
    // Dev-time guard: each segment must be axis-aligned (dx=0 or dy=0).
    if (import.meta.env.DEV) {
      for (let i = 1; i < w.polyline.length; i++) {
        const [x0, y0] = w.polyline[i - 1];
        const [x1, y1] = w.polyline[i];
        if (x0 !== x1 && y0 !== y1) {
          console.warn(
            `[walkwayGraph] ${w.walkwayId} segment ${i - 1}→${i} is not axis-aligned ` +
            `([${x0},${y0}]→[${x1},${y1}]). Non-orthogonal walkways are not supported.`
          );
        }
      }
    }
    const [sx, sy] = w.polyline[0];
    const [ex, ey] = w.polyline[w.polyline.length - 1];
    const startNodeId = findOrCreateNode(sx, sy, w.walkwayId);
    const endNodeId = findOrCreateNode(ex, ey, w.walkwayId);
    walkwayEndpoints.set(w.walkwayId, [startNodeId, endNodeId]);
  }

  // Derive adjacency from node.walkwayIds (already populated during merge).
  const adjacency = new Map<string, string[]>();
  for (const node of nodes.values()) {
    adjacency.set(node.nodeId, [...node.walkwayIds]);
  }

  return { nodes, walkwayEndpoints, adjacency };
}

/** Given a walkway and one of its endpoints, return the opposite endpoint node. */
export function otherEndpoint(graph: WalkwayGraph, walkwayId: string, nodeId: string): string | null {
  const ends = graph.walkwayEndpoints.get(walkwayId);
  if (!ends) return null;
  if (ends[0] === nodeId) return ends[1];
  if (ends[1] === nodeId) return ends[0];
  return null;
}

/** A route: the ordered walkways to traverse from `fromNode` to `toNode`. */
export interface Route {
  walkways: string[];
  /** Equivalent node sequence (length = walkways.length + 1). */
  nodes: string[];
}

/**
 * Pluggable routing strategy. Given a graph and endpoints, return a Route or null.
 *
 * Extension points: A*, Dijkstra (weighted by walkway length or congestion),
 * multi-agent flow fields. None require changes to the pedestrian FSM.
 */
export interface RouteStrategy {
  name: string;
  findRoute(graph: WalkwayGraph, fromNodeId: string, toNodeId: string): Route | null;
}

/** Breadth-first search — shortest route by number of walkways. v1 default. */
export const bfsRouteStrategy: RouteStrategy = {
  name: 'bfs',
  findRoute(graph, fromNodeId, toNodeId) {
    if (fromNodeId === toNodeId) {
      return { walkways: [], nodes: [fromNodeId] };
    }

    // Standard BFS on nodes; edges are walkways incident to each node.
    // parent maps: nodeId → { prevNode, viaWalkway } so we can reconstruct the path.
    const parent = new Map<string, { prev: string; via: string }>();
    const queue: string[] = [fromNodeId];
    const visited = new Set<string>([fromNodeId]);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const incidentWalkways = graph.adjacency.get(current) ?? [];
      for (const walkwayId of incidentWalkways) {
        const next = otherEndpoint(graph, walkwayId, current);
        if (!next || visited.has(next)) continue;
        visited.add(next);
        parent.set(next, { prev: current, via: walkwayId });
        if (next === toNodeId) {
          // Reconstruct path by walking parents back to the start.
          const walkways: string[] = [];
          const nodes: string[] = [next];
          let cursor = next;
          while (cursor !== fromNodeId) {
            const p = parent.get(cursor);
            if (!p) return null;
            walkways.unshift(p.via);
            nodes.unshift(p.prev);
            cursor = p.prev;
          }
          return { walkways, nodes };
        }
        queue.push(next);
      }
    }
    return null;
  },
};

/**
 * Convenience: find a route given walkway IDs plus a target POI's attachment walkway.
 * Picks the closer endpoint of the source walkway to the target as the route start
 * (so pedestrians finish their current walkway's local traversal before routing).
 */
export function routeBetweenWalkways(
  graph: WalkwayGraph,
  fromWalkwayId: string,
  fromNodeId: string,
  toWalkwayId: string,
  strategy: RouteStrategy = bfsRouteStrategy
): Route | null {
  // Target can be entered from either endpoint of the destination walkway.
  // Try both and pick the shorter route.
  const toEnds = graph.walkwayEndpoints.get(toWalkwayId);
  if (!toEnds) return null;

  // Same walkway — no macro routing needed.
  if (fromWalkwayId === toWalkwayId) {
    return { walkways: [], nodes: [fromNodeId] };
  }

  let best: Route | null = null;
  for (const toNodeId of toEnds) {
    const r = strategy.findRoute(graph, fromNodeId, toNodeId);
    if (!r) continue;
    if (!best || r.walkways.length < best.walkways.length) best = r;
  }
  return best;
}
