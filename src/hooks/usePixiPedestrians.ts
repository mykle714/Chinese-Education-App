/**
 * usePixiPedestrians — pedestrian simulation driven by Pixi's useTick instead
 * of a standalone requestAnimationFrame loop.
 *
 * The FSM, routing, and traversal logic are identical to usePedestrians. The
 * only difference is that the caller owns the tick cadence by calling
 * `tick(dtMs, tMs)` from inside a useTick callback. This means there is one
 * RAF loop (Pixi's) instead of two running in parallel.
 *
 * Does NOT touch React state on each tick — state lives in refs, same pattern
 * as usePedestrians. getDrawables() is safe to call each frame.
 */

import { useRef, useMemo } from 'react';
import type { PedestrianState } from '../config/nightMarketRegistry';
import {
  tickPedestrian,
  ensureAmbientAgenda,
  computeDrawable,
  type PedestrianDrawable,
  type PedestrianTickContext,
} from '../utils/pedestrianAgent';
import {
  WALKWAY_GRAPH,
  WALKWAY_MAP,
  POI_MAP,
  DEFAULT_ROUTE_STRATEGY,
  makeDemoPedestrians,
} from '../config/walkwayRegistry';

/** Per-tick dt cap — prevents large jumps if the tab was backgrounded. */
const MAX_DT_MS = 100;

/** How long an ambient pedestrian dwells at a POI before wandering again. */
const WANDER_DWELL_MS = 1500;

export interface UsePixiPedestriansHandle {
  /**
   * Advance all pedestrians by dtMs. Call once per Pixi tick inside useTick.
   * tMs is the wall-clock time used for dwell-until comparisons (pass performance.now()).
   */
  tick: (dtMs: number, tMs: number) => void;
  /** Current drawables — safe to read each frame after calling tick. */
  getDrawables: () => PedestrianDrawable[];
  /** Raw state snapshot (for debugging). */
  getStates: () => PedestrianState[];
  /**
   * All unique sprite image paths used by the initial pedestrian set.
   * Stable reference — use to pre-load textures before the Application mounts.
   */
  spriteImagePaths: string[];
}

export function usePixiPedestrians(count?: number): UsePixiPedestriansHandle {
  // Pedestrian state lives in a ref — ticking never triggers React re-renders.
  const pedestriansRef = useRef<PedestrianState[]>([]);
  if (pedestriansRef.current.length === 0) {
    pedestriansRef.current = makeDemoPedestrians(count);
  }

  // Latest tick time — used by getDrawables to pick the current walk-cycle
  // frame without needing its own RAF or clock. Updated every tick.
  const lastTMsRef = useRef<number>(performance.now());

  // Stable list of sprite paths derived from the initial pedestrian set.
  // Includes every directional-walk frame so Pixi preloads all textures before
  // the ped first appears in that pose — otherwise the first frame shown in
  // each direction would flash blank while its texture loads on demand.
  const spriteImagePaths = useMemo(() => {
    const paths = new Set<string>();
    for (const p of pedestriansRef.current) {
      paths.add(p.sprite.imagePath);
      const walk = p.sprite.directionalWalk;
      if (walk) {
        for (const f of walk.north) paths.add(f);
        for (const f of walk.east) paths.add(f);
        for (const f of walk.south) paths.add(f);
        for (const f of walk.west) paths.add(f);
      }
    }
    return Array.from(paths);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tick = (dtMs: number, tMs: number) => {
    const dt = Math.min(dtMs, MAX_DT_MS);
    lastTMsRef.current = tMs;
    const ctx: PedestrianTickContext = {
      graph: WALKWAY_GRAPH,
      walkways: WALKWAY_MAP,
      pois: POI_MAP,
      routeStrategy: DEFAULT_ROUTE_STRATEGY,
      tMs,
      allPedestrians: pedestriansRef.current,
    };
    pedestriansRef.current = pedestriansRef.current.map(p => {
      const refilled = ensureAmbientAgenda(p, WANDER_DWELL_MS);
      return tickPedestrian(refilled, dt, ctx);
    });
  };

  const getDrawables = (): PedestrianDrawable[] => {
    const out: PedestrianDrawable[] = [];
    const tMs = lastTMsRef.current;
    for (const p of pedestriansRef.current) {
      const d = computeDrawable(p, WALKWAY_MAP, tMs, POI_MAP);
      if (d) out.push(d);
    }
    return out;
  };

  const getStates = () => pedestriansRef.current;

  return { tick, getDrawables, getStates, spriteImagePaths };
}
