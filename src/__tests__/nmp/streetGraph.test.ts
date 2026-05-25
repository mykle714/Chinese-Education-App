/**
 * Street-graph invariants and end-to-end routing checks.
 *
 * The street graph is built from the same STREETS authoring list that drives
 * the tile graph, so any change to street layout should be caught here.
 */
import { describe, it, expect } from 'vitest';
import { STREETS, TILES, STREET_GRAPH } from '../../config/tileRegistry';
import { bfsStreetPath, findEdge } from '../../utils/streetGraph';
import { tileKey } from '../../utils/tileGraph';

describe('streetGraph nodes', () => {
  it('produces at least one node', () => {
    expect(STREET_GRAPH.nodes.size).toBeGreaterThan(0);
  });

  it('groups the West Spoke × North Spoke overlap into a single node', () => {
    // Authored overlap is x∈[0..3], y∈[0..4] = 4 × 5 = 20 tiles; SHIFT moves
    // it to x∈[25..28], y∈[-25..-21].
    const hubKey = tileKey(25, -25);
    const node = STREET_GRAPH.tileToNode.get(hubKey);
    expect(node).toBeDefined();
    expect(node!.tileKeys.size).toBe(20);
    for (let x = 25; x <= 28; x++) {
      for (let y = -25; y <= -21; y++) {
        expect(STREET_GRAPH.tileToNode.get(tileKey(x, y))).toBe(node);
      }
    }
    const names = new Set(node!.streets.map(s => s.name));
    expect(names.has('West Spoke')).toBe(true);
    expect(names.has('North Spoke')).toBe(true);
  });

  it('every node tile is claimed by at least one street in the node', () => {
    // Note: after projection, a node tile may be claimed by only one street
    // (the wide street whose lanes were projected over). Dead-end nodes are
    // single-street by construction. The invariant we still want: every tile
    // in a node belongs to at least one of the node's participating streets.
    for (const node of STREET_GRAPH.nodes.values()) {
      const nodeStreetNames = new Set(node.streets.map(s => s.name));
      for (const k of node.tileKeys) {
        const tile = TILES.find(t => tileKey(t.isoX, t.isoY) === k);
        expect(tile, `node tile ${k} missing from TILES`).toBeDefined();
        const claimNames = (tile!.intersectingStreets ?? []).map(s => s.name);
        expect(
          claimNames.some(n => nodeStreetNames.has(n)),
          `node tile ${k} not claimed by any of node's streets`
        ).toBe(true);
      }
    }
  });

  it('every non-intersection tile has intersectingStreets.length === 1', () => {
    for (const tile of TILES) {
      const k = tileKey(tile.isoX, tile.isoY);
      if (STREET_GRAPH.tileToNode.has(k)) continue;
      expect(tile.intersectingStreets?.length ?? 0).toBe(1);
    }
  });
});

describe('streetGraph edges', () => {
  it('produces at least one edge', () => {
    expect(STREET_GRAPH.edges.length).toBeGreaterThan(0);
  });

  it('every edge body tile belongs to its street and to no node', () => {
    for (const edge of STREET_GRAPH.edges) {
      for (const k of edge.bodyTileSet) {
        const tile = TILES.find(t => tileKey(t.isoX, t.isoY) === k);
        expect(tile, `edge body tile ${k} missing from TILES`).toBeDefined();
        expect(STREET_GRAPH.tileToNode.has(k)).toBe(false);
        const streetNames = new Set((tile!.intersectingStreets ?? []).map(s => s.name));
        expect(streetNames.has(edge.street.name)).toBe(true);
      }
    }
  });

  it('every edge body contains tiles, except dead-end edges whose stub has none', () => {
    // Edges between two real intersections must have at least one body tile.
    // Dead-end edges may have zero body when the synthetic dead-end node
    // sits immediately adjacent to the real intersection (short stub).
    for (const edge of STREET_GRAPH.edges) {
      const isDeadEnd =
        edge.nodeA.id.includes('dead-end') || edge.nodeB.id.includes('dead-end');
      if (isDeadEnd) continue;
      expect(edge.bodyTileSet.size,
        `edge ${edge.street.name}: ${edge.nodeA.id}↔${edge.nodeB.id} has empty body`
      ).toBeGreaterThan(0);
    }
  });

  it('adjacency is symmetric: every edge appears on both endpoints', () => {
    for (const edge of STREET_GRAPH.edges) {
      const aAdj = STREET_GRAPH.adjacency.get(edge.nodeA.id) ?? [];
      const bAdj = STREET_GRAPH.adjacency.get(edge.nodeB.id) ?? [];
      expect(aAdj.some(e => e.edge === edge && e.other.id === edge.nodeB.id)).toBe(true);
      expect(bAdj.some(e => e.edge === edge && e.other.id === edge.nodeA.id)).toBe(true);
    }
  });
});

describe('streetGraph routing', () => {
  it('hub node reaches Market Row east-end node via street-graph BFS', () => {
    const startNode = STREET_GRAPH.tileToNode.get(tileKey(25, -25));
    const goalNode = STREET_GRAPH.tileToNode.get(tileKey(105, 35));
    expect(startNode).toBeDefined();
    expect(goalNode).toBeDefined();
    const path = bfsStreetPath(STREET_GRAPH, startNode!.id, goalNode!.id);
    expect(path).not.toBeNull();
    expect(path![0]).toBe(startNode!.id);
    expect(path![path!.length - 1]).toBe(goalNode!.id);
    // Sanity check: every consecutive pair has an edge between them.
    for (let i = 0; i < path!.length - 1; i++) {
      expect(findEdge(STREET_GRAPH, path![i], path![i + 1])).toBeDefined();
    }
  });

  it('every node is reachable from the hub (single connected component over streets that intersect)', () => {
    const hub = STREET_GRAPH.tileToNode.get(tileKey(25, -25));
    expect(hub).toBeDefined();
    for (const node of STREET_GRAPH.nodes.values()) {
      const path = bfsStreetPath(STREET_GRAPH, hub!.id, node.id);
      expect(path, `node ${node.id} unreachable from hub`).not.toBeNull();
    }
  });

  it('each street with >=2 intersections shows up as an edge street at least once', () => {
    // Count nodes per street by membership.
    const nodesByStreet = new Map<string, number>();
    for (const node of STREET_GRAPH.nodes.values()) {
      for (const s of node.streets) {
        nodesByStreet.set(s.name, (nodesByStreet.get(s.name) ?? 0) + 1);
      }
    }
    const edgeStreets = new Set(STREET_GRAPH.edges.map(e => e.street.name));
    for (const s of STREETS) {
      if ((nodesByStreet.get(s.name) ?? 0) >= 2) {
        expect(edgeStreets.has(s.name), `street "${s.name}" has >=2 intersections but no edge`).toBe(true);
      }
    }
  });
});
