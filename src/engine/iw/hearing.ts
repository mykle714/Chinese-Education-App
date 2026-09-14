import { cellKey, parseCellKey, type SceneCell, type SceneGraph } from './sceneGraph';

/**
 * iw hearing model — who can hear an utterance, decided by geometry alone (§ 4).
 *
 * LAYER: engine (pure). No React, no Pixi, no fetch, no clock.
 *
 * ⚠️ THIS IS THE BUDGET, NOT JUST REALISM (§ 4.1). Since every NPC that hears an utterance
 * decides for ITSELF whether to answer, each audible NPC is one model call. This gate is
 * therefore the primary cost control in the whole feature: it runs BEFORE any model call and
 * is the only thing standing between a six-NPC room and six calls per player utterance.
 * Widening a radius is a spend, not a polish.
 *
 * It is also deliberately dumb. Nothing about audibility is ever a model's decision, so the
 * answer to "why didn't he hear me?" is always a number you can print — which is the whole
 * reason to keep it here rather than in a prompt.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 4, § 4.1, § 8.
 */

/** How loud an utterance is. The learner picks this; it is not inferred from the text. */
export const IW_VOLUMES = ['whisper', 'talk', 'shout'] as const;
export type IWVolume = (typeof IW_VOLUMES)[number];

/**
 * Chebyshev radius in cells, per volume.
 *
 * Chebyshev (not Manhattan, not Euclidean) because the board is a grid a character moves
 * across in 4 directions but *sees and hears* across diagonally — a diagonal neighbour is
 * plainly "right there" even though it is two steps away. Manhattan would make the corners
 * of a room deaf for no reason a player could perceive.
 */
export const HEARING_RADIUS: Record<IWVolume, number> = {
  whisper: 2,
  talk: 5,
  shout: 12,
};

/**
 * Cells of range lost per blocking cell on the line — the "a stand between you muffles" half
 * of § 4's occlusion rule.
 */
export const OCCLUSION_PENALTY = 2;

/**
 * More blocking cells than this on the line and the utterance does not arrive at all — the
 * "a building wall stops" half. Two is the value § 4 leaves as `k`: one prop between two
 * people is a muffle, a run of them is a wall.
 */
export const MAX_OCCLUDERS = 2;

/** A listener as the gate sees them — a cell, and whether they are available to hear. */
export interface HearingListener {
  id: string;
  col: number;
  row: number;
  /**
   * True when this NPC is mid-exchange with someone else in a way that consumes their
   * attention (§ 4 condition 3). Busy NPCs are excluded from the audible set, which is what
   * stops a player interrupting a scripted conversation by shouting across the room.
   */
  busy?: boolean;
}

/** One audible listener and why — every number the debug overlay needs. */
export interface HearingResult {
  id: string;
  /** Chebyshev distance in cells. */
  distance: number;
  /** Blocking cells strictly between speaker and listener. */
  occluders: number;
  /** The radius after {@link OCCLUSION_PENALTY} is charged; the number `distance` beat. */
  effectiveRadius: number;
}

/**
 * The cells a straight line from `from` to `to` passes through, excluding BOTH endpoints.
 *
 * Endpoints are excluded because a speaker or listener standing on a cell does not occlude
 * themselves, and — more practically — an NPC's own cell is walkable so it would never count
 * anyway, while a listener standing *beside* a prop should not be deafened by it.
 *
 * ⚠️ WRITTEN HERE, NOT IMPORTED. `docs/IMMERSIVE_WORLD.md` § 4 claimed `tileTraversal.ts`
 * "already walks tile lines for the pedestrian FSM"; it does not — that file interpolates
 * between two adjacent tiles for the movement lerp and has no line rasterizer. The doc has
 * been corrected.
 *
 * Bresenham-style supercover, stepping the dominant axis: enough for a gate whose whole job
 * is to count props, and stable in both directions.
 */
export function cellsOnLine(from: SceneCell, to: SceneCell): SceneCell[] {
  const dCol = to.col - from.col;
  const dRow = to.row - from.row;
  const steps = Math.max(Math.abs(dCol), Math.abs(dRow));
  if (steps <= 1) return []; // adjacent or identical: nothing in between

  const cells: SceneCell[] = [];
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const col = Math.round(from.col + dCol * t);
    const row = Math.round(from.row + dRow * t);
    // Rounding can land twice on the same cell for a shallow diagonal; keep it unique so a
    // single prop is never charged twice.
    const last = cells[cells.length - 1];
    if (last && last.col === col && last.row === row) continue;
    cells.push({ col, row });
  }
  return cells;
}

/** Chebyshev distance in cells — see {@link HEARING_RADIUS} for why this metric. */
export const chebyshev = (a: SceneCell, b: SceneCell): number =>
  Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));

/**
 * How many blocking cells sit strictly between two cells.
 *
 * "Blocking" is read off the graph's walkable set, so it is the SAME predicate that stops a
 * character walking through a prop — sound and movement are occluded by exactly the same
 * things, and there is no second list to keep in step. Out-of-bounds cells on the line count
 * as blocking, which only arises for a listener the caller has already placed off-board.
 */
export function countOccluders(graph: SceneGraph, from: SceneCell, to: SceneCell): number {
  let count = 0;
  for (const cell of cellsOnLine(from, to)) {
    if (!graph.walkable.has(cellKey(cell.col, cell.row))) count++;
  }
  return count;
}

/**
 * Whether one listener hears an utterance, with the numbers that decided it.
 *
 * Returns `null` for "did not hear", rather than a result with a false flag, so the caller
 * cannot accidentally treat a miss as a hit by forgetting to read the flag.
 */
export function hears(
  graph: SceneGraph,
  speaker: SceneCell,
  listener: HearingListener,
  volume: IWVolume,
): HearingResult | null {
  if (listener.busy) return null;

  const at: SceneCell = { col: listener.col, row: listener.row };
  const distance = chebyshev(speaker, at);
  const occluders = countOccluders(graph, speaker, at);
  if (occluders > MAX_OCCLUDERS) return null;

  const effectiveRadius = HEARING_RADIUS[volume] - occluders * OCCLUSION_PENALTY;
  if (distance > effectiveRadius) return null;

  return { id: listener.id, distance, occluders, effectiveRadius };
}

/**
 * Every listener who hears an utterance at `speaker`, NEAREST FIRST.
 *
 * The ordering is not cosmetic: § 4.1 caps how many audible NPCs may actually *speak* in one
 * beat, and this is the order that cap is applied in — so ties must be stable. Equal
 * distances fall back to the caller's listener order, which is the scene's authored cast
 * order, which is stable across reloads.
 */
export function audibleListeners(
  graph: SceneGraph,
  speaker: SceneCell,
  listeners: readonly HearingListener[],
  volume: IWVolume,
): HearingResult[] {
  const heard: HearingResult[] = [];
  for (const listener of listeners) {
    const result = hears(graph, speaker, listener, volume);
    if (result) heard.push(result);
  }
  return heard.sort((a, b) => a.distance - b.distance);
}

/**
 * Every cell an utterance of this volume could reach from `speaker` — the debug overlay's
 * data (§ 4: "worth building on day one").
 *
 * Walkable cells only: an unwalkable cell has nobody standing on it by construction, and
 * painting the props as "audible" would make the overlay unreadable exactly where the
 * occlusion it is meant to explain happens.
 */
export function audibleCells(
  graph: SceneGraph,
  speaker: SceneCell,
  volume: IWVolume,
): Set<string> {
  const reach = new Set<string>();
  const radius = HEARING_RADIUS[volume];
  for (let row = speaker.row - radius; row <= speaker.row + radius; row++) {
    for (let col = speaker.col - radius; col <= speaker.col + radius; col++) {
      const key = cellKey(col, row);
      if (!graph.walkable.has(key)) continue;
      const cell = parseCellKey(key);
      if (!cell) continue;
      if (hears(graph, speaker, { id: key, col: cell.col, row: cell.row }, volume)) {
        reach.add(key);
      }
    }
  }
  return reach;
}
