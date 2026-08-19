# Night Market Graph Assumptions

Structural invariants the tile graph, street graph, and stand layout must satisfy. These are *load-bearing* — the pedestrian walking algorithm ([PEDESTRIAN_WALKING_ALGORITHM.md](./PEDESTRIAN_WALKING_ALGORITHM.md)) assumes all of them and will misbehave (off-graph steps, never-terminating legs, sidestep math failures) if any are violated.

Each assumption should be enforced by a test against the built graphs (`TILE_GRAPH`, `STREET_GRAPH`). Engine tests live in `src/engine/market/__tests__/` (the old `src/utils/__tests__/` location moved with the engine).

> **Layout source — this has now landed.** The graphs are computed from **tiled templates**, not from the hand-authored tile registry: `marketWorld.ts` runs `streetRecovery.ts#recoverStreets` over the stitched STREET cells and builds `TILE_GRAPH`/`STREET_GRAPH` from that. `tileRegistry.ts`'s own `STREETS`/`TILES`/`DEMO_STALLS` are empty and its module-level graphs are vestigial. The stitched-template result must still satisfy *every* invariant below — the edge-signature matching rule is what keeps cross-seam streets contiguous enough to do so.

> ⚠️ **Nothing currently asserts S1–T2.** The single test file this document asks for
> (`graphAssumptions.test.ts`) was deleted along with the demo layout in commit `9bedfb5`
> and never re-created against the recovered graphs. Live neighbours:
> `src/engine/market/__tests__/streetRecovery.test.ts` and `seamAdjacency.test.ts`, which
> cover recovery output and cross-seam contiguity but not the invariants below.

---

## Streets

### S1. Every street is axis-aligned
A `Street` is either north–south (`isNorthSouth: true`) or east–west (`isNorthSouth: false`). Diagonal streets are not supported.

### S2. Every street's body is a contiguous straight strip
The tiles a street owns along its primary axis form an unbroken run between its `start` and `end`. No gaps, no branches.

### S3. Every street's width is in `[1, 8]`
A `Street.width` (perpendicular extent, in tiles) is at least 1 and at most 8. This is an authoring bound the lane logic and N2 assume. It doubles as a recovery guard: [street recovery](./NIGHT_MARKET_TEMPLATES.md#street-recovery-mask--street) **fails loudly** if it emits a street with `width > 8`, since that means it sampled across an intersection or the authored mask is malformed.

---

## Nodes (intersections)

### N1. Every node is rectangular
A `StreetNode`'s `tileKeys` form a filled axis-aligned rectangle. No L-shapes, no holes, no scattered components within a single node.

> **Why:** the walking algorithm picks a "random depth" into a node along the incoming edge's primary axis. A non-rectangular node would have gaps at some depths, producing off-graph next-steps.

### N2. Node width equals connected edge width
For every node `N` and every edge `E` that meets `N`:
- If `E` is N–S: the set of `isoX` values in `N.tileKeys` is identical to the set of `isoX` values in `E.bodyTileSet`.
- If `E` is E–W: the set of `isoY` values in `N.tileKeys` is identical to the set of `isoY` values in `E.bodyTileSet`.

> **Why:** when a pedestrian exits a node into a connected edge at any lane (perpendicular coord) chosen inside the node, that lane must be a valid lane on the new edge. Equal widths are the simplest sufficient condition.

### N3. Nodes are 4-connected components of intersection tiles
A node is the flood-fill of contiguous tiles with `intersectingStreets.length >= 2`. This is how `buildNodes` constructs them (`streetGraph.ts`) and is the definition the walking algorithm assumes when it treats node tiles differently from body tiles.

---

## Edges

### E1. Each edge's body is a single straight strip between two nodes
`bodyTileSet` is every tile of the edge's street with `intersectingStreets.length === 1` lying strictly between `nodeA` and `nodeB` along the street's primary axis.

### E2. Body width is uniform along the edge
Every primary-axis slice of `bodyTileSet` has the same set of perpendicular coords. Equivalent: the body is a rectangle of size `length × width` aligned to the street.

### E3. Body width matches both endpoint nodes' widths
Direct consequence of N2 applied to both endpoints. Stated separately because it's worth a dedicated test.

---

## Stand access tiles

### A1. Every stand has exactly one access tile
A stand's `assetId` appears in exactly one tile's `connections[]`. Enforced today in `buildTileGraph` validation (`tileGraph.ts`).

### A2. Every access tile is on an edge body **or inside a node**
An access tile must satisfy `intersectingStreets.length >= 1` — i.e. it is either a body tile of a street edge *or* an intersection tile of a node. It may **not** be off-street.

> **Why:** the last-mile walk needs a street-graph element it can reach.
> - **Edge-body access tile:** axial-walk along that edge until primary coords match, then a perpendicular hop to the access tile.
> - **In-node access tile:** the leg's target node *is* the access tile's owning node. Skip the random-depth step and walk to the specific access tile within the node instead, then make the perpendicular hop.
>
> Off-street access tiles would leave the algorithm with no edge or node to anchor the final approach.

### A3. The access tile is 4-adjacent to its stand's footprint
Existing invariant; restated for completeness.

---

## Tile graph

### T1. The tile graph is 4-connected within each reachable component
Standard. Already true by construction: edges in the tile graph are pure 4-neighbor adjacencies (`tileGraph.ts`).

### T2. Every tile referenced by a node or edge body exists in the tile graph
`StreetNode.tileKeys` and `StreetEdge.bodyTileSet` are subsets of `tileGraph.tiles.keys()`. Already true by construction; worth a regression test.

---

## Suggested test layout

A single test file `src/engine/market/__tests__/graphAssumptions.test.ts` covering all of S1–T2 against the `TILE_GRAPH` / `STREET_GRAPH` that `marketWorld.ts` builds from a stitched world (NOT the empty `tileRegistry` ones — those would pass every invariant vacuously). Tests should run as part of normal CI so any template/recovery change that breaks an invariant fails loudly. **Status: deleted, not currently present** (existed until commit `9bedfb5`) — see the warning at the top.
