import type { Direction } from '../market/freeFarmTileset';

/**
 * iw scene graph — the walkable cell set of an authored scene, and pathfinding over it.
 *
 * LAYER: engine (pure). No React, no Pixi, no fetch, no clock. Everything here is a
 * function of its arguments, which is the point: `docs/IMMERSIVE_WORLD.md` § 8 draws the
 * line at "everything that decides *whether* an NPC may move or speak is pure and
 * unit-testable; only the words come from the model".
 *
 * ⚠️ WHY THIS IS NOT `tileGraph.buildTileGraph` (§ 3a). The night market's builder takes a
 * list of walkable `TileDef`s and validates stand `connections` against them. A scene has
 * neither: it has a width × height rectangle and two painted masks, and its walkable set is
 * the INVERSE of the market's — every in-bounds cell is walkable except the ones an author
 * painted UNWALKABLE. Feeding a scene through the market builder would mean synthesizing a
 * `TileDef` per cell purely to satisfy a validator about stands that do not exist.
 *
 *   walkable(scene) = { every cell in width × height } − { cells in the unwalkable mask }
 *
 * ⚠️ **WALKABILITY IS NO LONGER A PROPERTY OF THE OBJECTS ON THE BOARD** (2026-09-19). It
 * used to be derived: a cell was impassable iff it carried BLOCKING decor (a tree or a
 * common prop). That coupling is gone. An author paints an `unwalkable` mask, and the
 * editor merely STAMPS that mask for them when they drop a blocking prop or a furniture
 * piece (`useIWSceneDraft.paintCell`) — a convenience at authoring time, not a rule at
 * runtime. Two things that were impossible before are now ordinary: a wall with no sprite
 * on it, and a tree the learner may walk under.
 *
 * THE SECOND MASK, `forcedDirection`, is a cell that OWNS the facing of whoever settles on
 * it (a stool at a counter, a spot in front of a window). It is walkable, and it is a legal
 * destination and a legal starting cell — but walking THROUGH one is discouraged rather
 * than forbidden: each such cell costs {@link FORCED_TILE_COST} ordinary steps, so a short
 * detour around it is taken and an absurd one is not. Passing through does NOT turn the
 * body; only settling does (see `sceneActor.forcedFacingFor`).
 *
 * COORDINATES. Scene cells are `"col,row"` integer strings, the same spelling the authoring
 * layout stores. They are NOT the market's `isoX,isoY` in `TILE_SIZE` units, and the two key
 * formats must never be mixed — hence a local {@link cellKey} rather than an import of
 * `tileGraph.tileKey`, which multiplies by `TILE_SIZE`.
 *
 * ⚠️ IT DOES NOT IMPORT `server/contracts/iw`, and must not. `src/engine/` imports nothing
 * outside itself (`src/engine/__tests__/enginePurity.test.ts`), so the wire type is INVERTED
 * into {@link SceneBoard} — the four fields of a scene this module actually reads. The
 * feature layer adapts an `IWScene` into it, which is also where `scenePlaces()` is called,
 * so the `places`/`locations` fallback stays in exactly one place.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 3a, § 8.
 */

/**
 * What the graph builder needs from a scene — structurally compatible with `IWScene` +
 * `IWSceneLayout` but declared here so the engine stays free of the server contract.
 *
 * ⚠️ **THERE IS NO `decor` HERE ANY MORE.** The graph used to read the decor map and resolve
 * each stem through the tileset to ask whether it blocked; walkability is painted now, so
 * the simulation no longer needs to know what the board LOOKS like at all. That also buys
 * back a little purity: this module imports nothing but a type.
 *
 * `places` is passed already-resolved (the caller reads it through `scenePlaces`), because
 * the pre-rename `locations` fallback is a wire-compatibility concern and has no business
 * inside the simulation.
 */
export interface SceneBoard {
  width: number;
  height: number;
  /** Cells nobody may stand on or walk through, each `"col,row"`. */
  unwalkable: string[];
  /** `"col,row"` → the facing forced on whoever settles there. */
  forcedDirection: Record<string, Direction>;
  /** Place tag → the one `"col,row"` cell it names. */
  places: Record<string, string>;
}

/** A scene cell in board coordinates. Integer col/row, origin top-left. */
export interface SceneCell {
  col: number;
  row: number;
}

/**
 * What one step onto a forced-direction cell costs, in ordinary steps.
 *
 * The tuning knob behind "avoid these, but do not be silly about it". At 8, a body takes a
 * detour of up to seven extra steps to keep off a forced cell and cuts straight through when
 * the alternative is longer — so a forced cell in the middle of a doorway still works as a
 * doorway, while one on an open floor is given a wide berth. The alternative rule considered
 * and rejected was ABSOLUTE avoidance (a clean route always wins), which sends a body the
 * long way round an entire room to dodge a single tile.
 */
export const FORCED_TILE_COST = 8;

/** Canonical key for a scene cell — the same `"col,row"` spelling `IWSceneLayout` stores. */
export const cellKey = (col: number, row: number): string => `${col},${row}`;

/**
 * Parse a `"col,row"` key, or `null` when it is not one.
 *
 * Returns null rather than throwing because the input is AUTHORED DATA reaching us from a
 * jsonb column — a malformed key is a scene to warn about, not a crash to take the whole
 * runtime down with. Callers that genuinely cannot proceed check for null themselves.
 */
export function parseCellKey(key: string): SceneCell | null {
  const parts = key.split(',');
  if (parts.length !== 2) return null;
  const col = Number(parts[0]);
  const row = Number(parts[1]);
  if (!Number.isInteger(col) || !Number.isInteger(row)) return null;
  return { col, row };
}

/**
 * Chebyshev (chessboard) distance in cells — how far apart two bodies "read" on this board.
 *
 * Chebyshev, not Manhattan and not Euclidean, because a character walks the grid in four
 * directions but *sees* across it diagonally: a diagonal neighbour is plainly "right there"
 * even though it is two steps away. Manhattan would make the corners of a room feel further
 * than they look.
 *
 * ⚠️ **THIS USED TO LIVE IN THE ORIGINAL `hearing.ts`**, the earshot module deleted on
 * 2026-09-07. Distance is a property of the BOARD, so it moved here beside the board's other
 * geometry, and every caller imports it from here: the `nearby` block of an NPC's prompt
 * (`useIWSceneRuntime.contextFor`), § 4c's rebuilt volume gate (`play/hearing.ts`), and the
 * distance hints on an `ai_walk`'s candidates (`actionPlayer.ts` → `destinationCandidates`).
 */
export const chebyshev = (a: SceneCell, b: SceneCell): number =>
  Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));

/** The 4-directional neighbours, in a fixed order so every path is deterministic. */
const NEIGHBOR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, -1], // north
  [1, 0], // east
  [0, 1], // south
  [-1, 0], // west
] as const;

export interface SceneGraph {
  width: number;
  height: number;
  /** Every walkable cell key. In-bounds minus the unwalkable mask. */
  walkable: Set<string>;
  /** cellKey → walkable 4-neighbour cell keys, in N/E/S/W order. */
  neighbors: Map<string, string[]>;
  /**
   * cellKey → the facing forced on a body that SETTLES there. Every key is also in
   * {@link walkable}: a forced cell is somewhere you may stand, just somewhere the
   * pathfinder would rather not route you through ({@link FORCED_TILE_COST}).
   *
   * Only cells the author actually painted appear here, so `forced.size` is normally 0 and
   * the weighted search degenerates to a plain BFS.
   */
  forced: Map<string, Direction>;
  /**
   * Place tag → the one cell it names. **Kept whether or not that cell is walkable.**
   *
   * ⚠️ A PLACE USUALLY NAMES A THING, NOT A STANDING SPOT — and an authored thing normally
   * has the unwalkable mask under it, so its cell is unwalkable. In the first real scene, 9
   * of 26 places are of this kind ("cash register", "self-serve water station", the six
   * tables), and BOTH the `walk_to_tag` targets an author actually used are among them. An
   * earlier draft of this builder dropped unwalkable places as authoring mistakes; that
   * would have silently broken the only place interaction in the only authored scene.
   *
   * Resolve one with {@link resolvePlaceTarget}, which stands ON a walkable place and BESIDE
   * an unwalkable one — the same distinction as walking to a cell versus walking to an NPC.
   */
  places: Map<string, string>;
}

/**
 * Build the walkable graph for a scene.
 *
 * `width`/`height` come from the `iw_scenes` columns, not from the layout — the layout is
 * a set of sparse masks and cannot say how big the board is.
 *
 * A forced-direction cell on an unwalkable cell is dropped from {@link SceneGraph.forced}:
 * nobody can settle there, so a facing for it would be a rule that can never fire. The
 * editor lets both masks touch the same cell (they are independent paint layers), so this is
 * a real shape to normalize rather than a theoretical one.
 *
 * Place tags are kept verbatim, INCLUDING ones naming an unwalkable cell — see
 * {@link SceneGraph.places} for why that is the normal case rather than an authoring fault.
 */
export function buildSceneGraph(board: SceneBoard): SceneGraph {
  const { width, height } = board;
  const blocked = new Set<string>(board.unwalkable ?? []);

  const walkable = new Set<string>();
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const key = cellKey(col, row);
      if (!blocked.has(key)) walkable.add(key);
    }
  }

  const neighbors = new Map<string, string[]>();
  for (const key of walkable) {
    const cell = parseCellKey(key);
    if (!cell) continue; // unreachable: every key here was built by cellKey
    const adjacent: string[] = [];
    for (const [dc, dr] of NEIGHBOR_OFFSETS) {
      const nk = cellKey(cell.col + dc, cell.row + dr);
      if (walkable.has(nk)) adjacent.push(nk);
    }
    neighbors.set(key, adjacent);
  }

  const forced = new Map<string, Direction>();
  for (const [cell, facing] of Object.entries(board.forcedDirection ?? {})) {
    if (walkable.has(cell)) forced.set(cell, facing);
  }

  const places = new Map<string, string>(Object.entries(board.places ?? {}));

  return { width, height, walkable, neighbors, forced, places };
}

/** Whether a cell is inside the board AND not masked unwalkable. */
export function isWalkable(graph: SceneGraph, col: number, row: number): boolean {
  return graph.walkable.has(cellKey(col, row));
}

/**
 * The facing this cell forces on a body that settles on it, or `null` for an ordinary cell.
 *
 * The ONE read path for the forced mask at runtime, so "what does this tile do to me" is
 * answered in one place by the actor tick, the runtime's `face`, and the tap handler alike.
 */
export function forcedFacingAt(graph: SceneGraph, cell: string): Direction | null {
  return graph.forced.get(cell) ?? null;
}

/** What entering `cell` costs. Ordinary cells are 1; see {@link FORCED_TILE_COST}. */
const stepCost = (graph: SceneGraph, cell: string): number =>
  (graph.forced.has(cell) ? FORCED_TILE_COST : 1);

export interface PlanPathOptions {
  /**
   * Cells that are walkable terrain but OCCUPIED right now — other pedestrians. Kept out of
   * the graph rather than in it because occupancy changes every frame while the graph is a
   * property of the scene; rebuilding the graph per step would be the only alternative.
   *
   * The GOAL is exempt: pathing to a cell somebody is standing on is how "walk to that NPC"
   * is expressed, and the caller stops one short. Without the exemption every approach to a
   * character would fail to plan.
   */
  occupied?: ReadonlySet<string>;
}

/** A planned route and what it cost, in {@link stepCost} units. */
interface PlannedPath {
  path: string[];
  cost: number;
}

/**
 * A tiny binary min-heap over (cost, seq).
 *
 * `seq` is the insertion counter, and it is what keeps the search DETERMINISTIC: among cells
 * of equal cost the heap pops the one queued first, which — since neighbours are generated in
 * a fixed N/E/S/W order — reproduces exactly the route the old FIFO BFS chose. Without it,
 * ties would break on heap-array order, and an NPC would pick a different way around a table
 * depending on which cells happened to sift where.
 */
class CellHeap {
  private items: Array<{ key: string; cost: number; seq: number }> = [];
  private seq = 0;

  push(key: string, cost: number): void {
    this.items.push({ key, cost, seq: this.seq++ });
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): { key: string; cost: number } | null {
    if (this.items.length === 0) return null;
    const top = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let smallest = i;
        if (l < this.items.length && this.less(l, smallest)) smallest = l;
        if (r < this.items.length && this.less(r, smallest)) smallest = r;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return { key: top.key, cost: top.cost };
  }

  private less(a: number, b: number): boolean {
    const x = this.items[a];
    const y = this.items[b];
    return x.cost !== y.cost ? x.cost < y.cost : x.seq < y.seq;
  }

  private swap(a: number, b: number): void {
    const t = this.items[a];
    this.items[a] = this.items[b];
    this.items[b] = t;
  }
}

/**
 * Cheapest 4-directional route from `fromKey` to `goalKey`, inclusive of both ends, with the
 * cost it came to.
 *
 * Dijkstra rather than BFS because the two masks give the board two edge weights: an ordinary
 * step costs 1 and a step onto a forced-direction cell costs {@link FORCED_TILE_COST}. With no
 * forced cells painted — the common case — every edge costs 1 and this behaves exactly like
 * the BFS it replaced, including which of several equal routes it picks (see {@link CellHeap}).
 *
 * A scene is at most 60×60 = 3600 cells (`IW_MAX_SCENE_DIM`), so the worst case is a few
 * thousand heap operations and A*'s heuristic is not worth the chance of getting it subtly
 * wrong.
 */
function searchPath(
  graph: SceneGraph,
  fromKey: string,
  goalKey: string,
  options: PlanPathOptions,
): PlannedPath | null {
  if (!graph.walkable.has(fromKey) || !graph.walkable.has(goalKey)) return null;
  if (fromKey === goalKey) return { path: [fromKey], cost: 0 };

  const occupied = options.occupied;
  const cameFrom = new Map<string, string>();
  const best = new Map<string, number>([[fromKey, 0]]);
  const settled = new Set<string>();
  const heap = new CellHeap();
  heap.push(fromKey, 0);

  for (;;) {
    const top = heap.pop();
    if (!top) return null;
    if (settled.has(top.key)) continue; // a stale entry left by a cheaper re-push
    settled.add(top.key);
    // Popping the goal means its cost is final — every remaining entry costs at least as much.
    if (top.key === goalKey) return { path: tracePath(cameFrom, fromKey, goalKey), cost: top.cost };

    for (const next of graph.neighbors.get(top.key) ?? []) {
      if (settled.has(next)) continue;
      // The goal is reachable even when occupied — see PlanPathOptions.occupied.
      if (next !== goalKey && occupied?.has(next)) continue;
      const cost = top.cost + stepCost(graph, next);
      const known = best.get(next);
      if (known !== undefined && known <= cost) continue;
      best.set(next, cost);
      cameFrom.set(next, top.key);
      heap.push(next, cost);
    }
  }
}

/**
 * Cheapest 4-directional path from `fromKey` to `goalKey`, inclusive of both ends.
 *
 * Returns `null` when no path exists — including when `fromKey` itself is unwalkable, which
 * happens for real: an NPC authored onto a cell that was later painted unwalkable. A
 * zero-length hop (from === goal) returns the single-cell path, not null, so callers can
 * treat "already there" and "one step away" the same way.
 *
 * "Cheapest" and "shortest" differ only where forced-direction cells are painted; see
 * {@link searchPath}.
 */
export function planScenePath(
  graph: SceneGraph,
  fromKey: string,
  goalKey: string,
  options: PlanPathOptions = {},
): string[] | null {
  return searchPath(graph, fromKey, goalKey, options)?.path ?? null;
}

/** Walk `cameFrom` backwards from the goal and reverse it. */
function tracePath(cameFrom: Map<string, string>, fromKey: string, goalKey: string): string[] {
  const path = [goalKey];
  let cursor = goalKey;
  while (cursor !== fromKey) {
    const prev = cameFrom.get(cursor);
    if (!prev) break; // unreachable: every enqueued cell has a parent
    path.push(prev);
    cursor = prev;
  }
  return path.reverse();
}

/**
 * The walkable cells adjacent to `targetKey`, cheapest-first from `fromKey`.
 *
 * This is what "walk TO an NPC" actually means — you stop beside somebody, not on top of
 * them. Ordering by ROUTE COST rather than by straight-line distance matters around a table:
 * the seat on the far side may be one cell away and twenty steps around. It is also what
 * keeps a forced-direction cell from being chosen as a parking spot unless it is by far the
 * best one — arriving there would override the very facing the approach existed to set, so
 * its {@link FORCED_TILE_COST} penalty is exactly the deterrent wanted.
 *
 * Cells with no path from `fromKey` are omitted entirely rather than sorted last, so an
 * empty result means "cannot get beside them" rather than "here are some cells you cannot
 * reach".
 */
export function approachCells(
  graph: SceneGraph,
  fromKey: string,
  targetKey: string,
  options: PlanPathOptions = {},
): string[] {
  const target = parseCellKey(targetKey);
  if (!target) return [];
  const scored: Array<{ key: string; cost: number }> = [];
  for (const [dc, dr] of NEIGHBOR_OFFSETS) {
    const key = cellKey(target.col + dc, target.row + dr);
    if (!graph.walkable.has(key)) continue;
    if (options.occupied?.has(key)) continue;
    const planned = searchPath(graph, fromKey, key, options);
    // The route's cost, which already includes the target cell's own penalty — a forced cell
    // beside the target therefore sorts behind an ordinary one. `fromKey` itself costs 0 and
    // so still wins outright: "you are already beside it" must never become a step.
    if (planned) scored.push({ key, cost: planned.cost });
  }
  // Stable: ties break on the fixed N/E/S/W order the cells were generated in.
  return scored.sort((a, b) => a.cost - b.cost).map(s => s.key);
}

/**
 * Every walkable cell reachable from `fromKey`, itself included.
 *
 * Forced-direction cells count as reachable: they are expensive to cross, not closed. The
 * authoring-time use is the reachability audit ("can the player actually get to the
 * counter?"); the runtime use is refusing to plan into a walled-off pocket before the
 * animation starts.
 */
export function reachableFrom(graph: SceneGraph, fromKey: string): Set<string> {
  const seen = new Set<string>();
  if (!graph.walkable.has(fromKey)) return seen;
  seen.add(fromKey);
  const queue = [fromKey];
  let head = 0;
  while (head < queue.length) {
    for (const next of graph.neighbors.get(queue[head++]) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

/**
 * Where a character should STAND in order to be at a named place.
 *
 * The two cases, and why one function covers both:
 *
 * | The tagged cell is | Result |
 * |---|---|
 * | walkable (a doorway, a seat, a spot on the floor) | the cell itself — you stand on it |
 * | unwalkable (a counter, a table, a water station) | the cheapest reachable cell beside it |
 *
 * ⚠️ THE SECOND ROW IS THE COMMON ONE. A place tag normally names an OBJECT, and an object
 * normally has the unwalkable mask under it. Treating an unwalkable place as an error —
 * which an earlier version of this module did — breaks `walk_to_tag "cash register"`, which
 * is exactly what the first authored scene contains.
 *
 * A tag on a FORCED-DIRECTION cell resolves to the cell itself (it is walkable), which is how
 * an author makes "go and face the window" a single authored step.
 *
 * Returns `null` when the tag is unknown, or when the place exists but nothing beside it can
 * be reached from `fromKey`. Both are worth surfacing rather than silently standing still,
 * so the caller gets one nullable answer instead of a fallback it did not ask for.
 */
export function resolvePlaceTarget(
  graph: SceneGraph,
  fromKey: string,
  tag: string,
  options: PlanPathOptions = {},
): string | null {
  const cell = graph.places.get(tag);
  if (!cell) return null;
  if (graph.walkable.has(cell)) {
    // Still has to be reachable — a walkable place inside a walled-off pocket is no good.
    return planScenePath(graph, fromKey, cell, options) ? cell : null;
  }
  return approachCells(graph, fromKey, cell, options)[0] ?? null;
}
