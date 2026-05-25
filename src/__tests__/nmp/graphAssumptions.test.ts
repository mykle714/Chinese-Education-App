/**
 * Graph assumptions test — invariants the simplified pedestrian walking
 * algorithm relies on. See docs/NIGHT_MARKET_GRAPH_ASSUMPTIONS.md and
 * docs/PEDESTRIAN_WALKING_ALGORITHM.md.
 *
 * If any of these fail, the lane-free axial walking algorithm may produce
 * off-graph steps or never terminate a leg. Fix the underlying registry/data
 * before touching the algorithm.
 */
import { describe, it, expect } from 'vitest';
import { STREET_GRAPH, TILE_GRAPH } from '../../config/tileRegistry';
import { parseTileKey } from '../../utils/tileGraph';

// Pull perpendicular-axis coords (i.e. lane coords) from a set of tile keys.
function perpCoordsOf(tileKeys: Iterable<string>, isNorthSouth: boolean): Set<number> {
  const out = new Set<number>();
  for (const k of tileKeys) {
    const t = parseTileKey(k);
    out.add(isNorthSouth ? t.isoX : t.isoY);
  }
  return out;
}

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function sortedNums(s: Set<number>): number[] {
  return Array.from(s).sort((a, b) => a - b);
}

// ===========================================================================
// Nodes — N1: rectangularity
// ===========================================================================
describe('N1: every node is a filled axis-aligned rectangle', () => {
  it('node tileKeys fill the bounding rectangle exactly', () => {
    for (const node of STREET_GRAPH.nodes.values()) {
      const xs = new Set<number>();
      const ys = new Set<number>();
      for (const k of node.tileKeys) {
        const t = parseTileKey(k);
        xs.add(t.isoX);
        ys.add(t.isoY);
      }
      const sortedX = sortedNums(xs);
      const sortedY = sortedNums(ys);
      // Each axis must be a contiguous run.
      for (let i = 1; i < sortedX.length; i++) {
        expect(
          sortedX[i] - sortedX[i - 1],
          `node ${node.id}: x axis has a gap at ${sortedX[i - 1]}→${sortedX[i]}`,
        ).toBe(1);
      }
      for (let i = 1; i < sortedY.length; i++) {
        expect(
          sortedY[i] - sortedY[i - 1],
          `node ${node.id}: y axis has a gap at ${sortedY[i - 1]}→${sortedY[i]}`,
        ).toBe(1);
      }
      // Every (x, y) in the bounding box must be present.
      expect(
        node.tileKeys.size,
        `node ${node.id}: not a filled rectangle (have ${node.tileKeys.size}, expected ${xs.size * ys.size})`,
      ).toBe(xs.size * ys.size);
    }
  });
});

// ===========================================================================
// Nodes — N2 / E3: node width matches connected edge width
// ===========================================================================
describe('N2/E3: node width == connected edge width on the shared perpendicular axis', () => {
  it('every (node, connected edge) pair shares the same lane-axis range', () => {
    for (const edge of STREET_GRAPH.edges) {
      // Dead-end edges may have an empty body — skip those for this check.
      if (edge.bodyTileSet.size === 0) continue;
      const isNS = edge.street.isNorthSouth;
      const bodyPerp = perpCoordsOf(edge.bodyTileSet, isNS);
      for (const node of [edge.nodeA, edge.nodeB]) {
        // Dead-end synthetic nodes are single-tile stubs; not a real intersection.
        if (node.id.includes('dead-end')) continue;
        const nodePerp = perpCoordsOf(node.tileKeys, isNS);
        expect(
          setsEqual(bodyPerp, nodePerp),
          `node ${node.id} perp=${sortedNums(nodePerp)} != edge "${edge.street.name}" body perp=${sortedNums(bodyPerp)}`,
        ).toBe(true);
      }
    }
  });
});

// ===========================================================================
// Edges — E2: body width is uniform along the edge
// ===========================================================================
describe('E2: edge body is a rectangle (uniform lane-axis range at every primary slice)', () => {
  it('every primary slice of bodyTileSet has the same perpendicular coords', () => {
    for (const edge of STREET_GRAPH.edges) {
      if (edge.bodyTileSet.size === 0) continue;
      const isNS = edge.street.isNorthSouth;
      const slices = new Map<number, Set<number>>();
      for (const k of edge.bodyTileSet) {
        const t = parseTileKey(k);
        const prim = isNS ? t.isoY : t.isoX;
        const perp = isNS ? t.isoX : t.isoY;
        if (!slices.has(prim)) slices.set(prim, new Set());
        slices.get(prim)!.add(perp);
      }
      const slicesArr = Array.from(slices.values());
      const ref = slicesArr[0];
      for (let i = 1; i < slicesArr.length; i++) {
        expect(
          setsEqual(ref, slicesArr[i]),
          `edge "${edge.street.name}" ${edge.nodeA.id}↔${edge.nodeB.id}: non-uniform body width`,
        ).toBe(true);
      }
    }
  });
});

// ===========================================================================
// Stand access — A2: every access tile sits on a street edge body
// ===========================================================================
describe('A2: every stand access tile is on a street edge body or inside a node', () => {
  it('access tiles are reachable via the street graph (edge body or node tile)', () => {
    for (const [assetId, accessKeys] of TILE_GRAPH.standAccessTiles) {
      for (const key of accessKeys) {
        const onEdge = STREET_GRAPH.tileToEdge.has(key);
        const inNode = STREET_GRAPH.tileToNode.has(key);
        expect(
          onEdge || inNode,
          `stand "${assetId}" access tile ${key} is off-street (neither in a node nor on an edge body)`,
        ).toBe(true);
      }
    }
  });
});
