/**
 * Pedestrian finite state machine — tile-graph edition.
 *
 *   Idle ──pop agenda──▶ Planning ──path found──▶ Traveling ──reached goal──▶ Interacting ──dwell──▶ Idle
 *
 * State transitions are pure functions of (prev state, dtMs, ctx). Pedestrians
 * walk tile-by-tile across a 4-neighbor adjacency graph; render position is
 * `lerp(currentTile, pendingPath[0], localProgress)`.
 */

import {
  PEDESTRIAN_SPEED_ISO_PER_SEC,
  RECENT_VISIT_HISTORY_LIMIT,
  type AgendaGoal,
  type NightMarketAssetDef,
  type PedestrianFsmState,
  type PedestrianState,
  type TileCoord,
  type TileDef,
} from '../config/nightMarketRegistry';
import {
  bfsTilePath,
  parseTileKey,
  tileKey,
  type TileGraph,
} from './tileGraph';
import {
  advanceLocalProgress,
  headingBetweenTiles,
  lerpTile,
} from './tileTraversal';

export interface PedestrianTickContext {
  graph: TileGraph;
  /** assetId → stand definition, used for display names on travel labels. */
  stands: Map<string, NightMarketAssetDef>;
  /** Current time in ms for dwell timing. */
  tMs: number;
  /** Optional: all pedestrians, for future collision. */
  allPedestrians?: PedestrianState[];
}

/** Visible output of a pedestrian at render time. */
export interface PedestrianDrawable {
  id: string;
  isoX: number;
  isoY: number;
  heading: [number, number];
  imagePath: string;
  scale: number;
  fsmState: PedestrianFsmState;
  /** Display name of the target stand when Traveling; undefined otherwise. */
  targetPoiDisplayName?: string;
}

/** Cardinal isometric direction used to pick a walk-cycle frame. */
export type IsoDir = 'N' | 'E' | 'S' | 'W';

/**
 * Quantize a heading vector to the nearest iso cardinal.
 *   +hx → E, -hx → W, +hy → N, -hy → S
 */
export function headingToIsoDir(heading: [number, number]): IsoDir {
  const [hx, hy] = heading;
  if (Math.abs(hx) >= Math.abs(hy)) return hx >= 0 ? 'E' : 'W';
  return hy >= 0 ? 'N' : 'S';
}

const DIR_KEY: Record<IsoDir, 'north' | 'east' | 'south' | 'west'> = {
  N: 'north',
  E: 'east',
  S: 'south',
  W: 'west',
};

/** Speed (iso/sec = tiles/sec) for a pedestrian leaving its current tile. */
function speedFor(tile: TileDef | undefined): number {
  return tile?.speedIsoPerSec ?? PEDESTRIAN_SPEED_ISO_PER_SEC;
}

/** Project a pedestrian's current state to a render-space drawable. */
export function computeDrawable(
  p: PedestrianState,
  graph: TileGraph,
  tMs: number,
  stands?: Map<string, NightMarketAssetDef>,
): PedestrianDrawable | null {
  const next = p.pendingPath[0];
  const [isoX, isoY] = next
    ? lerpTile(p.currentTile, next, p.localProgress)
    : [p.currentTile.isoX, p.currentTile.isoY];

  // Heading: toward the next tile while traveling; otherwise preserve last
  // step direction by looking back at the previous step. Default to E.
  let heading: [number, number] = [1, 0];
  if (next) heading = headingBetweenTiles(p.currentTile, next);

  // Resolve image path: directional walk frames if defined.
  let imagePath = p.sprite.imagePath;
  const walk = p.sprite.directionalWalk;
  if (walk) {
    const dir = headingToIsoDir(heading);
    const frames = walk[DIR_KEY[dir]];
    if (frames && frames.length > 0) {
      const moving = p.fsmState === 'Traveling';
      const idx = moving
        ? Math.floor((tMs * walk.fps) / 1000) % frames.length
        : 0;
      imagePath = frames[idx];
    }
  }

  // Suppress unused-var warning for `graph` — kept in the signature so a future
  // collision-aware drawable (e.g. avoidance offset) can read peer positions.
  void graph;

  const targetPoiDisplayName =
    p.fsmState === 'Traveling' && p.targetAssetId && stands
      ? stands.get(p.targetAssetId)?.displayName
      : undefined;

  return {
    id: p.id,
    isoX,
    isoY,
    heading,
    imagePath,
    scale: p.sprite.scale ?? 1.0,
    fsmState: p.fsmState,
    targetPoiDisplayName,
  };
}

/**
 * Resolve a Wander goal. Strategy:
 *  1. Prefer a connection tile (i.e. a tile whose `connections` is non-empty)
 *     reachable from the pedestrian, picking one whose linked stands are not
 *     in `recentlyVisitedAssetIds`.
 *  2. Fall back to any walkable tile.
 *
 * Returns the chosen goal-tile key and (if any) the assetId of the linked stand
 * for visit-history bookkeeping.
 */
function resolveWanderGoal(
  p: PedestrianState,
  ctx: PedestrianTickContext,
): { goalKey: string; assetId?: string } | null {
  const recent = new Set(p.recentlyVisitedAssetIds);
  const fromKey = tileKey(p.currentTile.isoX, p.currentTile.isoY);

  // Build candidate list of connection tiles whose stands aren't in recent.
  const candidates: Array<{ key: string; assetId: string }> = [];
  for (const [assetId, tileKeys] of ctx.graph.standAccessTiles) {
    if (recent.has(assetId)) continue;
    for (const key of tileKeys) candidates.push({ key, assetId });
  }
  if (candidates.length > 0) {
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    if (pick.key === fromKey) return { goalKey: pick.key, assetId: pick.assetId };
    return { goalKey: pick.key, assetId: pick.assetId };
  }

  // Fallback — any walkable tile.
  const allTiles = Array.from(ctx.graph.tiles.keys());
  if (allTiles.length === 0) return null;
  const pick = allTiles[Math.floor(Math.random() * allTiles.length)];
  return { goalKey: pick };
}

/** Plan a tile path to the current goal. Returns null if planning fails. */
function planPath(
  p: PedestrianState,
  ctx: PedestrianTickContext,
): { path: TileCoord[]; targetAssetId?: string } | null {
  const goal = p.agenda[0];
  if (!goal) return null;

  const fromKey = tileKey(p.currentTile.isoX, p.currentTile.isoY);

  let goalKeys: Set<string>;
  let targetAssetId: string | undefined;

  if (goal.kind === 'VisitStand') {
    const access = ctx.graph.standAccessTiles.get(goal.assetId);
    if (!access || access.length === 0) return null;
    goalKeys = new Set(access);
    targetAssetId = goal.assetId;
  } else {
    const wander = resolveWanderGoal(p, ctx);
    if (!wander) return null;
    goalKeys = new Set([wander.goalKey]);
    targetAssetId = wander.assetId;
  }

  const path = bfsTilePath(ctx.graph, fromKey, goalKeys);
  if (!path) return null;

  // Drop the start tile — it's where the ped already stands.
  const tilePath: TileCoord[] = path.slice(1).map(parseTileKey);
  return { path: tilePath, targetAssetId };
}

/** Advance a single pedestrian one tick. Returns a NEW state object. */
export function tickPedestrian(
  prev: PedestrianState,
  dtMs: number,
  ctx: PedestrianTickContext,
): PedestrianState {
  const p: PedestrianState = {
    ...prev,
    agenda: [...prev.agenda],
    pendingPath: [...prev.pendingPath],
    recentlyVisitedAssetIds: [...prev.recentlyVisitedAssetIds],
    currentTile: { ...prev.currentTile },
  };

  switch (p.fsmState) {
    case 'Idle': {
      if (p.agenda.length === 0) return p;
      p.fsmState = 'Planning';
      return p;
    }

    case 'Planning': {
      const plan = planPath(p, ctx);
      if (!plan) {
        p.agenda.shift();
        p.fsmState = 'Idle';
        return p;
      }
      // If already at the goal (empty path), go straight to Interacting.
      p.pendingPath = plan.path;
      p.targetAssetId = plan.targetAssetId;
      if (plan.path.length === 0) {
        const goal = p.agenda[0];
        const dwellMs = goal && (goal.kind === 'VisitStand' || goal.kind === 'Wander')
          ? goal.dwellMs
          : 0;
        p.fsmState = 'Interacting';
        p.interactUntilMs = ctx.tMs + dwellMs;
      } else {
        p.localProgress = 0;
        p.fsmState = 'Traveling';
      }
      return p;
    }

    case 'Traveling': {
      const next = p.pendingPath[0];
      if (!next) {
        // Path exhausted — enter Interacting.
        const goal = p.agenda[0];
        const dwellMs = goal && (goal.kind === 'VisitStand' || goal.kind === 'Wander')
          ? goal.dwellMs
          : 0;
        p.fsmState = 'Interacting';
        p.interactUntilMs = ctx.tMs + dwellMs;
        return p;
      }
      const tile = ctx.graph.tiles.get(tileKey(p.currentTile.isoX, p.currentTile.isoY));
      const speed = speedFor(tile);
      const step = advanceLocalProgress(p.localProgress, dtMs, speed);
      p.localProgress = step.progress;
      if (step.completed) {
        // Step onto the next tile; pop it from the path.
        p.currentTile = { ...next };
        p.pendingPath.shift();
        p.localProgress = 0;
        if (p.pendingPath.length === 0) {
          const goal = p.agenda[0];
          const dwellMs = goal && (goal.kind === 'VisitStand' || goal.kind === 'Wander')
            ? goal.dwellMs
            : 0;
          p.fsmState = 'Interacting';
          p.interactUntilMs = ctx.tMs + dwellMs;
        }
      }
      return p;
    }

    case 'Interacting': {
      if (p.interactUntilMs !== undefined && ctx.tMs >= p.interactUntilMs) {
        if (p.targetAssetId) {
          p.recentlyVisitedAssetIds.push(p.targetAssetId);
          if (p.recentlyVisitedAssetIds.length > RECENT_VISIT_HISTORY_LIMIT) {
            p.recentlyVisitedAssetIds.splice(
              0,
              p.recentlyVisitedAssetIds.length - RECENT_VISIT_HISTORY_LIMIT,
            );
          }
        }
        p.agenda.shift();
        p.interactUntilMs = undefined;
        p.targetAssetId = undefined;
        p.fsmState = 'Idle';
      }
      return p;
    }
  }
}

/** Refill a pedestrian's agenda with a Wander goal so it never stalls. */
export function ensureAmbientAgenda(p: PedestrianState, wanderDwellMs: number): PedestrianState {
  if (p.agenda.length > 0) return p;
  const goal: AgendaGoal = { kind: 'Wander', dwellMs: wanderDwellMs };
  return { ...p, agenda: [goal] };
}
