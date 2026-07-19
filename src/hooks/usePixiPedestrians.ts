/**
 * usePixiPedestrians — pedestrian simulation driven by Pixi's useTick.
 *
 * Owns ref-backed pedestrian state and exposes a `tick(dtMs, tMs)` to advance the FSM each
 * frame. Doesn't touch React state on tick — `getDrawables()` is safe to call inline during
 * render.
 *
 * SLICE 2 (docs/NIGHT_MARKET_TEMPLATE_RUNTIME_PLAN.md § "Pedestrian wiring"): the hook now
 * takes the RUNTIME graphs assembled by {@link ../features/nightmarket/useMarketWorld} from
 * the authored template mask, instead of the empty static `tileRegistry` graphs. When the
 * graph arrives (or changes identity — e.g. a version switch), the hook re-seeds `count`
 * ambient walkers on random walkable tiles. A null graph (still loading) spawns nothing.
 */

import { useRef } from 'react';
import type {
  NightMarketAssetDef,
  PedestrianState,
  TileCoord,
  TileDef,
} from '../engine/market/nightMarketRegistry';
import {
  tickPedestrian,
  ensureAmbientAgenda,
  computeDrawable,
  updateTileOccupancy,
  type PedestrianDrawable,
  type PedestrianTickContext,
} from '../engine/market/pedestrianAgent';
import { makeAmbientPedestrian } from '../engine/market/tileRegistry';
import type { TileGraph } from '../engine/market/tileGraph';
import type { StreetGraph } from '../engine/market/streetGraph';

/** Per-tick dt cap — prevents large jumps if the tab was backgrounded. */
const MAX_DT_MS = 100;

/** How long an ambient pedestrian pauses between random-walk bursts. */
const WANDER_DWELL_MS = 2000;

/** Default ambient walker count when a caller doesn't specify one. */
const DEFAULT_PEDESTRIAN_COUNT = 8;

export interface UsePixiPedestriansParams {
  /** Discrete walkable-tile graph; null while the world is still loading. */
  tileGraph: TileGraph | null;
  /** Coarse street graph for high-level planning; null while loading. */
  streetGraph: StreetGraph | null;
  /** Stand definitions occupying placeholder slots (for travel-target labels). Slice 2: none. */
  stands?: NightMarketAssetDef[];
  /** Ambient walker count. */
  count?: number;
}

export interface UsePixiPedestriansHandle {
  tick: (dtMs: number, tMs: number) => void;
  getDrawables: () => PedestrianDrawable[];
  getStates: () => PedestrianState[];
  /** Global simulation speed multiplier. Pass 0 to freeze all pedestrians in place. */
  setSpeedMultiplier: (multiplier: number) => void;
}

/** Pick a random walkable tile from the graph, or null when there are none. */
function randomTile(tiles: TileDef[]): TileCoord | null {
  if (tiles.length === 0) return null;
  const t = tiles[Math.floor(Math.random() * tiles.length)];
  return { isoX: t.isoX, isoY: t.isoY };
}

export function usePixiPedestrians(params: UsePixiPedestriansParams): UsePixiPedestriansHandle {
  const { tileGraph, streetGraph, stands, count = DEFAULT_PEDESTRIAN_COUNT } = params;

  const pedestriansRef = useRef<PedestrianState[]>([]);
  const lastTMsRef = useRef<number>(performance.now());
  // Ref-backed speed multiplier so external toggles (freeze button) scale progression
  // without a React re-render per tick.
  const speedMultiplierRef = useRef<number>(1);
  // Identity of the tileGraph the current walkers were seeded from. Re-seed when it changes
  // (first non-null load, or a version switch that rebuilds the world).
  const seededGraphRef = useRef<TileGraph | null>(null);

  // Keep the latest graphs + stand map in refs so tick/getDrawables read fresh values
  // without re-subscribing. Rebuilding STAND_MAP each render is cheap (few entries).
  const graphRef = useRef<TileGraph | null>(tileGraph);
  graphRef.current = tileGraph;
  const streetGraphRef = useRef<StreetGraph | null>(streetGraph);
  streetGraphRef.current = streetGraph;
  const standMapRef = useRef<Map<string, NightMarketAssetDef>>(new Map());
  standMapRef.current = new Map((stands ?? []).map((s) => [s.assetId, s]));

  // (Re)seed walkers when the graph identity changes. Runs during render (ref writes only),
  // so the first frame after the world loads already has populated pedestrians.
  if (tileGraph && tileGraph !== seededGraphRef.current) {
    seededGraphRef.current = tileGraph;
    const tiles = [...tileGraph.tiles.values()];
    const next: PedestrianState[] = [];
    for (let i = 0; i < count; i++) {
      const start = randomTile(tiles);
      if (start) next.push(makeAmbientPedestrian(`ped-${i}`, start));
    }
    pedestriansRef.current = next;
  } else if (!tileGraph && seededGraphRef.current) {
    // World unloaded (error/logout) — clear walkers so we don't render stale positions.
    seededGraphRef.current = null;
    pedestriansRef.current = [];
  }

  const tick = (dtMs: number, tMs: number) => {
    lastTMsRef.current = tMs;
    const graph = graphRef.current;
    const streetG = streetGraphRef.current;
    if (!graph || !streetG) return; // nothing to walk yet
    // Speed multiplier of 0 = fully paused. Skip the FSM entirely — passing dt=0 would still
    // let the Traveling "between steps" branch teleport peds forward each frame.
    if (speedMultiplierRef.current === 0) return;
    const dt = Math.min(dtMs, MAX_DT_MS) * speedMultiplierRef.current;
    const ctx: PedestrianTickContext = {
      graph,
      streetGraph: streetG,
      stands: standMapRef.current,
      tMs,
      allPedestrians: pedestriansRef.current,
    };
    pedestriansRef.current = pedestriansRef.current.map((p) => {
      const refilled = ensureAmbientAgenda(p, WANDER_DWELL_MS);
      return tickPedestrian(refilled, dt, ctx);
    });
    updateTileOccupancy(pedestriansRef.current, graph.tiles);
  };

  const getDrawables = (): PedestrianDrawable[] => {
    const graph = graphRef.current;
    if (!graph) return [];
    const out: PedestrianDrawable[] = [];
    const tMs = lastTMsRef.current;
    for (const p of pedestriansRef.current) {
      const d = computeDrawable(p, graph, tMs, standMapRef.current);
      if (d) out.push(d);
    }
    return out;
  };

  const getStates = () => pedestriansRef.current;

  const setSpeedMultiplier = (multiplier: number) => {
    speedMultiplierRef.current = multiplier;
  };

  return { tick, getDrawables, getStates, setSpeedMultiplier };
}
