import { isBlockingDecorUrl } from '../market/farmTerrain';
import { freeFarmTileset } from '../market/freeFarmTileset';

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
 * neither: it has a width × height rectangle and a decor map, and its walkable set is the
 * INVERSE of the market's — every in-bounds cell is walkable except those carrying a
 * blocking asset. Feeding a scene through the market builder would mean synthesizing a
 * `TileDef` per cell purely to satisfy a validator about stands that do not exist.
 *
 *   walkable(scene) = { every cell in width × height } − { cells whose decor blocks }
 *
 * COORDINATES. Scene cells are `"col,row"` integer strings, the same spelling the authoring
 * layout stores. They are NOT the market's `isoX,isoY` in `TILE_SIZE` units, and the two key
 * formats must never be mixed — hence a local {@link cellKey} rather than an import of
 * `tileGraph.tileKey`, which multiplies by `TILE_SIZE`.
 *
 * ⚠️ IT DOES NOT IMPORT `server/contracts/iw`, and must not. `src/engine/` imports nothing
 * outside itself (`src/engine/__tests__/enginePurity.test.ts`), so the wire type is INVERTED
 * into {@link SceneBoard} — the three fields of a scene this module actually reads. The
 * feature layer adapts an `IWScene` into it, which is also where `scenePlaces()` is called,
 * so the `places`/`locations` fallback stays in exactly one place.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 3a, § 8.
 */

/**
 * What the graph builder needs from a scene — structurally compatible with `IWScene` +
 * `IWSceneLayout` but declared here so the engine stays free of the server contract.
 *
 * `places` is passed already-resolved (the caller reads it through `scenePlaces`), because
 * the pre-rename `locations` fallback is a wire-compatibility concern and has no business
 * inside the simulation.
 */
export interface SceneBoard {
  width: number;
  height: number;
  /** Per-cell decor: `"col,row"` → sprite stem. Only blocking stems matter here. */
  decor: Record<string, string>;
  /** Place tag → the one `"col,row"` cell it names. */
  places: Record<string, string>;
}

/** A scene cell in board coordinates. Integer col/row, origin top-left. */
export interface SceneCell {
  col: number;
  row: number;
}

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
 * Whether a stored decor STEM blocks movement.
 *
 * The layout stores stems (stable across asset re-fingerprinting); `isBlockingDecorUrl`
 * answers for URLs. Resolving here rather than duplicating the bucket lists keeps the
 * single-sourcing that function's header insists on. An unresolvable stem — an asset
 * renamed out from under a stored scene — is treated as NON-blocking, because the sprite
 * will not render either, and a cell that shows nothing but refuses to be walked on is the
 * worse of the two failures.
 */
export function isBlockingDecorStem(stem: string): boolean {
  const url = freeFarmTileset.get(stem);
  return url ? isBlockingDecorUrl(url) : false;
}

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
  /** Every walkable cell key. In-bounds minus blocking decor. */
  walkable: Set<string>;
  /** cellKey → walkable 4-neighbour cell keys, in N/E/S/W order. */
  neighbors: Map<string, string[]>;
  /**
   * Place tag → the one cell it names. **Kept whether or not that cell is walkable.**
   *
   * ⚠️ A PLACE USUALLY NAMES A THING, NOT A STANDING SPOT — and an authored thing is
   * blocking decor, so its cell is unwalkable by construction. In the first real scene, 9 of
   * 26 places are of this kind ("cash register", "self-serve water station", the six
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
 * Place tags are kept verbatim, INCLUDING ones naming an unwalkable cell — see
 * {@link SceneGraph.places} for why that is the normal case rather than an authoring fault.
 */
export function buildSceneGraph(board: SceneBoard): SceneGraph {
  const { width, height } = board;
  const blocked = new Set<string>();
  for (const [cell, stem] of Object.entries(board.decor ?? {})) {
    if (isBlockingDecorStem(stem)) blocked.add(cell);
  }

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

  const places = new Map<string, string>(Object.entries(board.places ?? {}));

  return { width, height, walkable, neighbors, places };
}

/** Whether a cell is inside the board AND not blocked. */
export function isWalkable(graph: SceneGraph, col: number, row: number): boolean {
  return graph.walkable.has(cellKey(col, row));
}

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

/**
 * Shortest 4-directional path from `fromKey` to `goalKey`, inclusive of both ends.
 *
 * Returns `null` when no path exists — including when `fromKey` itself is unwalkable, which
 * happens for real: an NPC authored onto a cell that later grew a tree. A zero-length hop
 * (from === goal) returns the single-cell path, not null, so callers can treat "already
 * there" and "one step away" the same way.
 *
 * BFS rather than A*: a scene is at most 60×60 = 3600 cells (`IW_MAX_SCENE_DIM`), so the
 * worst case is a few thousand queue operations, and BFS has no heuristic to get subtly
 * wrong. Neighbour order is fixed, so the chosen path among equals is stable — an NPC does
 * not pick a different route around a table each time it is asked.
 */
export function planScenePath(
  graph: SceneGraph,
  fromKey: string,
  goalKey: string,
  options: PlanPathOptions = {},
): string[] | null {
  if (!graph.walkable.has(fromKey) || !graph.walkable.has(goalKey)) return null;
  if (fromKey === goalKey) return [fromKey];

  const occupied = options.occupied;
  const cameFrom = new Map<string, string>();
  const seen = new Set<string>([fromKey]);
  // A plain array + head index: shift() on a 3600-element array is O(n) per pop.
  const queue: string[] = [fromKey];
  let head = 0;

  while (head < queue.length) {
    const current = queue[head++];
    for (const next of graph.neighbors.get(current) ?? []) {
      if (seen.has(next)) continue;
      // The goal is reachable even when occupied — see PlanPathOptions.occupied.
      if (next !== goalKey && occupied?.has(next)) continue;
      seen.add(next);
      cameFrom.set(next, current);
      if (next === goalKey) return tracePath(cameFrom, fromKey, goalKey);
      queue.push(next);
    }
  }
  return null;
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
 * The walkable cells adjacent to `targetKey`, nearest-first from `fromKey`.
 *
 * This is what "walk TO an NPC" actually means — you stop beside somebody, not on top of
 * them. Ordering by path length rather than by straight-line distance matters around a
 * table: the seat on the far side may be one cell away and twenty steps around.
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
  const scored: Array<{ key: string; steps: number }> = [];
  for (const [dc, dr] of NEIGHBOR_OFFSETS) {
    const key = cellKey(target.col + dc, target.row + dr);
    if (!graph.walkable.has(key)) continue;
    if (options.occupied?.has(key)) continue;
    const path = planScenePath(graph, fromKey, key, options);
    if (path) scored.push({ key, steps: path.length });
  }
  // Stable: ties break on the fixed N/E/S/W order the cells were generated in.
  return scored.sort((a, b) => a.steps - b.steps).map(s => s.key);
}

/**
 * Every walkable cell reachable from `fromKey`, itself included.
 *
 * The authoring-time use is the reachability audit ("can the player actually get to the
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
 * | unwalkable (a counter, a table, a water station) | the nearest reachable cell beside it |
 *
 * ⚠️ THE SECOND ROW IS THE COMMON ONE. A place tag normally names an OBJECT, and an object
 * is blocking decor. Treating an unwalkable place as an error — which an earlier version of
 * this module did — breaks `walk_to_tag "cash register"`, which is exactly what the first
 * authored scene contains.
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
