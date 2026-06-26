# Pedestrian Walking Algorithm

Defines how a pedestrian translates a high-level street-graph route (`[node₀, edge₀₁, node₁, edge₁₂, …, nodeₙ]`) into concrete tile-by-tile movement. The model deliberately *abstracts away the concept of a fixed "lane"* — pedestrians do axial walks irrespective of which perpendicular row/column they are currently in, and lane changes happen freely both inside nodes and mid-edge.

This document describes the intended behavior. The graph guarantees that make it sound are listed in [NIGHT_MARKET_GRAPH_ASSUMPTIONS.md](./NIGHT_MARKET_GRAPH_ASSUMPTIONS.md) — the algorithm assumes those invariants hold.

> **Not yet modeled:** the template system ([NIGHT_MARKET_TEMPLATES.md](./NIGHT_MARKET_TEMPLATES.md), DESIGN stage) introduces a `communal-walkable` tile tier (walkable open space that is *not* a street and is excluded from the street graph). This algorithm has no defined behavior for those cells yet — see that doc's Open Questions.

---

## Core primitive: axial walk along an edge

Each `StreetEdge` runs along its street's **primary axis** (Y for N–S streets, X for E–W). An axial walk on edge `E` means:

1. Compute the sign of `targetPrimary − currentPrimary` along `E`'s primary axis.
2. Step one tile in that direction every commit. The perpendicular coord (the "lane") is **whatever the pedestrian's current tile already has** — it is read freshly each step, never pinned.
3. Stop when the pedestrian reaches a tile belonging to the target node (or, for the last leg, the target tile).

Because the pedestrian's perpendicular coord may have shifted due to a sidestep or a node traversal in the previous leg, every step recomputes the next tile from `currentTile` rather than from any stored leg state.

## What counts as "on this edge"

For the purpose of axial walking, the pedestrian treats two kinds of tiles as walkable:

- **Body tiles** of the current edge — `intersectingStreets.length === 1` and the street is the edge's street.
- **Intersection tiles of any node that is *not* the leg's target node** — pedestrians walk *through* such nodes as if they were edge tiles, in the same axial direction.

Intersection tiles of the **target node** end the leg the moment the pedestrian first touches one. This is the only place a leg terminates.

> **Why this matters:** when two consecutive edges share an orientation (both N–S, or both E–W), the intermediate node is just "more straight road" from the walker's perspective. By treating non-target node tiles as edge-equivalent, the same axial walk handles aligned-edge handoffs without any special case.

## Node entry behavior (lane change happens here, optionally)

When a pedestrian first crosses into the target node along an axial walk:

1. Pick a **random depth** within the node along the *incoming* edge's primary axis — i.e. how many tiles deep into the node to walk before turning. Range: any value from "stop at the entry tile" up to "exit the far side."
2. Continue the axial walk until that depth is reached.
3. The pedestrian's perpendicular coord at that point becomes the starting perpendicular for the next leg. No explicit assignment is needed — the next leg's axial walk simply reads `currentTile`.

If the next leg's edge is **perpendicular** to the incoming edge, the random depth directly determines the new lane on the new edge.

If the next leg's edge is **parallel** to the incoming edge (same orientation), the random depth is along the *new* edge's primary axis, and the pedestrian simply has more straight road to walk before reaching the next node. Lane is inherited unchanged. This Just Works because the new leg's first axial step also recomputes from `currentTile`.

## Leg-by-leg execution

Given a route `[N₀, E₀, N₁, E₁, N₂, …]`:

| Situation | Action |
|---|---|
| Ped is in the middle of edge `Eᵢ` | Axial walk along `Eᵢ` toward `Nᵢ₊₁`. Direction is the sign that takes the ped's current primary coord toward `Nᵢ₊₁`. |
| Ped first touches `Nᵢ₊₁` | Pick random depth; finish walking that depth into `Nᵢ₊₁`; advance to leg `Eᵢ₊₁`. |
| Ped is starting from inside a node | Begin the first edge's axial walk in whatever lane `currentTile` happens to be in. No special seeding. |
| Ped is starting mid-edge | Same — read direction from `currentTile` toward the first target node and start walking. |

The leg index advances *only* on touching the target node's tile set (or the goal tile for the last leg). Walking through a non-target node never advances the leg.

## Last-mile to a stand (POI)

Stand access tiles are guaranteed to be on a street edge body **or inside a node** ([NIGHT_MARKET_GRAPH_ASSUMPTIONS.md](./NIGHT_MARKET_GRAPH_ASSUMPTIONS.md#stand-access)). Two sub-cases — both use only the axial-walk primitive plus a final perpendicular hop, no `toPoi` BFS:

### Case A — access tile on an edge body
1. Treat the access tile's owning edge as the final edge of the route.
2. Axial-walk along it until the pedestrian's primary coord equals the access tile's primary coord.
3. Turn perpendicular and walk the (one or few) remaining tiles to the access tile.

### Case B — access tile inside a node
1. Treat the access tile's owning node as the final target node of the route. The leg arrives via whichever edge the high-level plan chose.
2. **Override the random-depth step**: instead of sampling a depth and stopping, axial-walk to the depth whose primary coord matches the access tile's primary coord.
3. Turn perpendicular and walk to the access tile's exact column/row (still inside the node).
4. Perpendicular hop to the stand footprint.

In both cases the pedestrian's lane while walking the final edge does not need to match the access tile's perpendicular coord — the "turn perpendicular" step bridges whatever gap exists.

## Mid-leg start (ped is already on the target edge)

If `currentTile` is a body tile of the target edge when the leg begins, no prelude is needed. The axial walk starts from `currentTile` in whatever lane it happens to be in. The direction is computed toward the target node.

## Collision avoidance (sidesteps)

Sidesteps are the *other* mechanism that changes a pedestrian's lane and are orthogonal to node handoff:

- When the forward tile is occupied, the pedestrian attempts an instant teleport to the right tile (90° CW from heading), falling back to the left.
- A wall-clock cooldown (`SIDESTEP_COOLDOWN_MS`, 1 s) prevents repeat teleports.
- After a sidestep, the next axial step recomputes its perpendicular from the new `currentTile` — no leg state needs patching. This is the core payoff of the lane-free design: sidesteps cost zero bookkeeping.

If neither side is available, the pedestrian stands still and re-tries next tick.

### Stuck recovery: forward jump

Two pedestrians nose-to-nose on a 1-wide leg can't sidestep (both sides are off-edge) and would otherwise deadlock until external state changed. To break this:

- When `isWaiting` flips from false → true, the ped stamps `waitingSinceMs = ctx.tMs`. Subsequent consecutive waiting ticks preserve the original stamp; any successful step (sidestep, forward commit, or the jump itself) clears it.
- Once `ctx.tMs - waitingSinceMs >= STUCK_FORWARD_JUMP_DELAY_MS` (3 s), on every tick the ped additionally attempts a **forward jump**: an instant teleport to the tile two steps ahead — i.e. directly in front of the blocker.
- The jump is allowed only if that tile exists in the tile graph, is unoccupied, and lies on the current leg's edge body or one of its endpoint nodes' tile sets (same on-leg predicate as sidestep). Tile-graph adjacency is *not* required (it's a 2-step teleport).
- The jump runs both when sidestep is on cooldown and when sidestep failed outright — both produce the waiting state the recovery is designed to escape. There is no separate cooldown on the jump itself.

## What this design intentionally does *not* do

- **No `laneIsoCoord` on legs.** Legs carry only the edge identity and target. The perpendicular coord at any step is whatever `currentTile` has right now.
- **No `inheritLane` plumbing in the planner.** Plan emits a sequence of `(edge, targetNode)` pairs and nothing else.
- **No intra-node BFS.** Nodes are walked through using the same axial primitive.
- **No `toPoi` leg kind.** Last-mile is folded into the final edge walk plus a one-shot perpendicular step.

## Invariants the algorithm relies on

These are stated and enforced in [NIGHT_MARKET_GRAPH_ASSUMPTIONS.md](./NIGHT_MARKET_GRAPH_ASSUMPTIONS.md). At a glance:

- Nodes are rectangular and span the full width of every edge that meets them.
- Edge body widths match their node widths (so a chosen depth in one node is always a valid lane on every connected edge).
- Stand access tiles sit on a street edge body *or* inside a node — never off-street.
- Every street is axis-aligned and every edge body is a contiguous straight strip.

If any of these are violated the algorithm may produce off-graph steps or fail to terminate a leg.
