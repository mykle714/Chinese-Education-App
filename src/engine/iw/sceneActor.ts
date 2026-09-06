import { advanceLocalProgress, headingBetweenTiles, lerpTile } from '../market/tileTraversal';
import { headingToIsoDir, type IsoDir } from '../market/pedestrianAgent';
import type { Direction } from '../market/freeFarmTileset';
import { cellKey, parseCellKey, planScenePath, type SceneGraph } from './sceneGraph';

/**
 * iw scene actor — a body that walks a planned path, one cell at a time.
 *
 * LAYER: engine (pure). Every function is (state, dt, context) → new state; no clock, no
 * randomness, no I/O. The host calls {@link tickSceneActor} from its rAF loop.
 *
 * ⚠️ WHY THIS IS NOT `tickPedestrian` WITH A DIFFERENT MOVEMENT SOURCE. § 3 proposed the
 * player avatar be "a `PedestrianAgent` with its movement source swapped", and that is not
 * what shipped. `tickPedestrian`'s context requires a `StreetGraph` — a nodes-and-edges
 * structure describing streets and their junctions — and its whole `Traveling` state walks
 * `NavLeg`s across it, sampling a random depth on entering a target node. **A scene has no
 * streets and no junctions**: it is one open floor, and § 3a deleted the very masks the
 * night market derives its street graph from. Reusing that FSM would mean synthesizing a
 * fake one-node street graph purely to satisfy a code path that would then be told to
 * ignore it, plus an `AgendaGoal` describing shopping behaviour no scene has.
 *
 * What IS reused is everything that made the proposal attractive in the first place — and
 * it is reused directly, not reimplemented:
 *
 * | Behaviour | Source |
 * |---|---|
 * | Smooth per-step lerp, speed in cells/sec | `tileTraversal.ts` (`advanceLocalProgress`, `lerpTile`) |
 * | Heading, and heading → sprite direction | `headingBetweenTiles`, `headingToIsoDir` |
 * | Destination-ownership occupancy | reimplemented here in ~10 lines; see {@link occupiedCells} |
 * | Pathfinding | `sceneGraph.planScenePath` (§ 3a's cell set, not the street graph) |
 *
 * The night market's sidestep / forward-jump deadlock recovery is deliberately NOT carried
 * over. It exists because dozens of ambient peds share 1-wide streets; a scene has 2–4
 * bodies on an open floor (§ 4.1 caps the cast for cost reasons anyway), where the failure
 * it recovers from does not arise. What replaces it is simpler and more honest: an actor
 * blocked for {@link BLOCKED_GIVE_UP_MS} abandons its path and says so, and the caller —
 * which knows what the walk was FOR — decides whether to re-plan or to give up in character.
 *
 * COORDINATES. `isoX = col`, `isoY = row`, because `TILE_SIZE` is 1 and `isoToScreen` is
 * already called with `(col, row)` by the scene editor's viewer. There is no conversion.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 3, § 8.
 */

/** Sprite-facing direction. Same four values as the tileset's `Direction`. */
export type SceneFacing = Direction;

/** Cells per second. Matches `PEDESTRIAN_SPEED_ISO_PER_SEC` in feel, slowed for an interior. */
export const SCENE_ACTOR_SPEED = 3;

/**
 * How long an actor waits for a blocked next cell before abandoning its path.
 *
 * Three seconds is the night market's `STUCK_FORWARD_JUMP_DELAY_MS`, kept deliberately: it
 * is long enough that ordinary passing traffic clears first, and short enough that a learner
 * watching an NPC stand still notices the give-up rather than assuming a freeze.
 */
export const BLOCKED_GIVE_UP_MS = 3000;

export interface SceneActorState {
  id: string;
  /**
   * The cell the actor is walking TOWARD and OWNS. Equal to {@link fromCell} when standing
   * still.
   *
   * Ownership attaches to the destination, not the origin — the same rule the night market
   * uses — because it is the only version that cannot produce a collision: two actors can
   * never both be walking into the same cell, whereas "own the cell you are leaving" lets
   * two bodies converge on one square and overlap for a step.
   */
  cell: string;
  /** The cell the current step started from. Render position lerps from here to {@link cell}. */
  fromCell: string;
  /** 0..1 progress along the current step. 0 when standing still. */
  progress: number;
  /** Cells still to walk AFTER {@link cell}, in order. Empty when the actor has arrived. */
  path: string[];
  facing: SceneFacing;
  /** Cells per second. */
  speed: number;
  /** How long the actor has been unable to take its next step. Resets on every move. */
  blockedMs: number;
}

/** What a tick did, so the caller can react without diffing state. */
export type SceneActorEvent =
  /** Still walking, or standing still with nothing to do. */
  | { kind: 'none' }
  /** The last cell of the path was reached on this tick. */
  | { kind: 'arrived'; cell: string }
  /** The next cell stayed occupied past {@link BLOCKED_GIVE_UP_MS}; the path was dropped. */
  | { kind: 'blocked'; at: string };

export interface SceneActorTickContext {
  graph: SceneGraph;
  /**
   * Cells owned by OTHER actors this tick. The caller builds it with {@link occupiedCells},
   * excluding the actor being ticked — an actor is never blocked by itself.
   */
  occupied: ReadonlySet<string>;
}

/**
 * Direction from a step, as a sprite facing.
 *
 * ⚠️ IT DELEGATES TO `headingToIsoDir` ON PURPOSE, rather than mapping col/row deltas to
 * compass letters directly. That function plus `DirectionalWalkAnimation`'s documented
 * axis semantics (north = isoY increasing, east = isoX increasing) is the ONLY facing
 * convention in this codebase that has been visually verified — it is what the night market
 * renders in production. iw matching it by construction means the two features cannot drift.
 *
 * ⚠️ KNOWN DISCREPANCY, NEEDS A VISUAL CHECK. `IW_FACING_LABELS` in `server/contracts/iw.ts`
 * describes the same four letters as n = "away, up-right", e = "down-right", s = "toward
 * camera, down-left", w = "up-left". The engine's convention is n = up-left, e = up-right,
 * s = down-right, w = down-left — the labels are rotated one quadrant from it. The labels
 * are author-facing prose in a picker and the engine mapping is what actually renders, so
 * the engine wins here; but somebody should look at a scene and say which set of words is
 * right, because an author picking "South (toward camera)" is currently being told something
 * this code does not do.
 */
export function facingForStep(fromCell: string, toCell: string): SceneFacing | null {
  const from = parseCellKey(fromCell);
  const to = parseCellKey(toCell);
  if (!from || !to || (from.col === to.col && from.row === to.row)) return null;
  const heading = headingBetweenTiles(
    { isoX: from.col, isoY: from.row },
    { isoX: to.col, isoY: to.row },
  );
  return ISO_DIR_TO_FACING[headingToIsoDir(heading)];
}

const ISO_DIR_TO_FACING: Record<IsoDir, SceneFacing> = { N: 'n', E: 'e', S: 's', W: 'w' };

/** A standing actor at `cell`. */
export function createSceneActor(
  id: string,
  cell: string,
  facing: SceneFacing,
  speed: number = SCENE_ACTOR_SPEED,
): SceneActorState {
  return { id, cell, fromCell: cell, progress: 0, path: [], facing, speed, blockedMs: 0 };
}

/** Whether the actor is mid-walk — the walk-cycle animation's gate. */
export const isWalking = (actor: SceneActorState): boolean =>
  actor.path.length > 0 || actor.progress > 0;

/**
 * Give the actor a path, as returned by `planScenePath` (which INCLUDES the actor's current
 * cell as its first element).
 *
 * ⚠️ IGNORED MID-STEP, and that is the point. An actor whose `progress` is between 0 and 1
 * is physically between two cells and has already committed to arriving at `cell`; letting a
 * new path take effect there would teleport it. The new path is instead queued to start from
 * the cell it is walking into, so re-planning always looks like a person changing their mind
 * at the next step rather than sliding sideways.
 *
 * Returns the actor unchanged when the path does not start where the actor is going, which
 * is how a stale plan (computed before the actor moved) fails safe.
 */
export function setActorPath(actor: SceneActorState, path: readonly string[]): SceneActorState {
  if (path.length === 0) return { ...actor, path: [], blockedMs: 0 };
  if (path[0] !== actor.cell) return actor;
  return { ...actor, path: path.slice(1), blockedMs: 0 };
}

/** Plan and assign in one call. Returns the actor unchanged when no path exists. */
export function walkActorTo(
  actor: SceneActorState,
  graph: SceneGraph,
  goalCell: string,
  occupied?: ReadonlySet<string>,
): SceneActorState {
  const path = planScenePath(graph, actor.cell, goalCell, { occupied });
  return path ? setActorPath(actor, path) : actor;
}

/** Stop where the actor is going — it finishes the step it is in, then stands. */
export const stopActor = (actor: SceneActorState): SceneActorState =>
  ({ ...actor, path: [], blockedMs: 0 });

/**
 * Advance one actor by `dtMs`.
 *
 * The step loop is deliberately NOT a while-loop over leftover progress: at 3 cells/sec a
 * 16 ms frame covers 5% of a cell, so consuming more than one step per tick can only happen
 * on a frame so long that teleporting the actor across several cells would look worse than
 * dropping the surplus. Surplus progress is discarded at the cell boundary.
 */
export function tickSceneActor(
  actor: SceneActorState,
  dtMs: number,
  ctx: SceneActorTickContext,
): { actor: SceneActorState; event: SceneActorEvent } {
  // Mid-step: just advance. The destination is already owned, so nothing can block it.
  if (actor.progress > 0) {
    const { progress, completed } = advanceLocalProgress(actor.progress, dtMs, actor.speed);
    if (!completed) return { actor: { ...actor, progress }, event: { kind: 'none' } };
    const landed: SceneActorState = { ...actor, fromCell: actor.cell, progress: 0, blockedMs: 0 };
    if (landed.path.length === 0) {
      return { actor: landed, event: { kind: 'arrived', cell: landed.cell } };
    }
    return { actor: landed, event: { kind: 'none' } };
  }

  // Standing still with nothing planned.
  if (actor.path.length === 0) return { actor, event: { kind: 'none' } };

  const next = actor.path[0];
  if (!ctx.graph.walkable.has(next) || ctx.occupied.has(next)) {
    // Waiting for the cell to clear. A path that stays blocked is abandoned rather than
    // held forever, so a caller polling `path.length` is never lied to.
    const blockedMs = actor.blockedMs + dtMs;
    if (blockedMs >= BLOCKED_GIVE_UP_MS) {
      return { actor: { ...actor, path: [], blockedMs: 0 }, event: { kind: 'blocked', at: next } };
    }
    return { actor: { ...actor, blockedMs }, event: { kind: 'none' } };
  }

  // Commit: ownership transfers to `next` on this tick, before any movement is rendered.
  const facing = facingForStep(actor.cell, next) ?? actor.facing;
  const committed: SceneActorState = {
    ...actor,
    fromCell: actor.cell,
    cell: next,
    path: actor.path.slice(1),
    facing,
    blockedMs: 0,
    progress: 0,
  };
  // Consume this tick's movement immediately so a step never costs an idle frame.
  return tickSceneActor({ ...committed, progress: Number.EPSILON }, dtMs, ctx);
}

/**
 * Render position in iso units — `isoX = col`, `isoY = row`.
 *
 * Returns a float between the two cells of the current step, which is what makes the walk
 * smooth rather than a sequence of jumps.
 */
export function sceneActorPosition(actor: SceneActorState): [number, number] {
  const from = parseCellKey(actor.fromCell);
  const to = parseCellKey(actor.cell);
  if (!from || !to) return [0, 0];
  return lerpTile(
    { isoX: from.col, isoY: from.row },
    { isoX: to.col, isoY: to.row },
    actor.progress,
  );
}

/**
 * The cells owned by a set of actors — what a tick context's `occupied` is built from.
 *
 * `exclude` is the actor about to be ticked: an actor must not be blocked by its own
 * destination, which it already owns.
 */
export function occupiedCells(
  actors: readonly SceneActorState[],
  exclude?: string,
): Set<string> {
  const owned = new Set<string>();
  for (const a of actors) {
    if (a.id === exclude) continue;
    owned.add(a.cell);
    // An actor mid-step is physically across two cells; both are impassable until it lands.
    if (a.progress > 0) owned.add(a.fromCell);
  }
  return owned;
}

/**
 * Tick every actor, each seeing the others' occupancy.
 *
 * ⚠️ ORDER MATTERS AND IS THE CALLER'S. Actors are ticked in array order and each sees the
 * ALREADY-UPDATED positions of those before it, so the first actor in the list wins a
 * contested cell. That is a real bias, and the fix is not to randomize it — a stable order
 * is what makes a replay reproducible. Keep the player first: a learner who is blocked by an
 * NPC that moved "at the same time" reads it as the game stealing their step.
 */
export function tickSceneActors(
  actors: readonly SceneActorState[],
  dtMs: number,
  graph: SceneGraph,
): { actors: SceneActorState[]; events: Array<{ id: string; event: SceneActorEvent }> } {
  const next: SceneActorState[] = [...actors];
  const events: Array<{ id: string; event: SceneActorEvent }> = [];
  for (let i = 0; i < next.length; i++) {
    const occupied = occupiedCells(next, next[i].id);
    const result = tickSceneActor(next[i], dtMs, { graph, occupied });
    next[i] = result.actor;
    if (result.event.kind !== 'none') events.push({ id: result.actor.id, event: result.event });
  }
  return { actors: next, events };
}

/** Convenience for callers that only have col/row to hand. */
export const actorCellKey = cellKey;
