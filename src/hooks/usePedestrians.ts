/**
 * @deprecated Used by the legacy Canvas2D MarketViewer at /night-market-legacy.
 * For the Pixi renderer, use usePixiPedestrians instead.
 *
 * usePedestrians — owns the array of PedestrianState and ticks them every
 * animation frame. The tick loop is independent from MarketViewer's render
 * loop so simulation runs even if the canvas hasn't repainted.
 *
 * Returns a ref-backed getter so MarketViewer's render callback can read
 * the latest drawables without causing React re-renders on each tick.
 */

import { useEffect, useRef } from 'react';
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

/** Per-frame cap — we don't want giant dt spikes if the tab was backgrounded. */
const MAX_DT_MS = 100;

/** Refill agenda with Wander goals forever for ambient crowd. */
const WANDER_DWELL_MS = 1500;

export interface UsePedestriansOptions {
  /** Initial pedestrian count (ambient crowd). */
  count?: number;
  /** Disable the tick loop entirely (e.g. when the page is hidden). */
  enabled?: boolean;
}

export interface UsePedestriansHandle {
  /** Snapshot of current pedestrian drawables. Safe to call each frame. */
  getDrawables: () => PedestrianDrawable[];
  /** Raw state snapshot (for debugging/tools). */
  getStates: () => PedestrianState[];
}

export function usePedestrians(options: UsePedestriansOptions = {}): UsePedestriansHandle {
  const { count, enabled = true } = options;

  // Ref-held state so ticks don't trigger re-renders.
  const pedestriansRef = useRef<PedestrianState[]>([]);
  if (pedestriansRef.current.length === 0) {
    pedestriansRef.current = makeDemoPedestrians(count);
  }

  const lastTickMsRef = useRef<number>(performance.now());

  useEffect(() => {
    if (!enabled) return;
    let rafId = 0;

    const tick = () => {
      const now = performance.now();
      const rawDt = now - lastTickMsRef.current;
      lastTickMsRef.current = now;
      const dt = Math.min(rawDt, MAX_DT_MS);

      const ctx: PedestrianTickContext = {
        graph: WALKWAY_GRAPH,
        walkways: WALKWAY_MAP,
        pois: POI_MAP,
        routeStrategy: DEFAULT_ROUTE_STRATEGY,
        tMs: now,
        allPedestrians: pedestriansRef.current,
      };

      // Tick all pedestrians. ensureAmbientAgenda refills Wander goals for idle
      // pedestrians so the crowd never goes static.
      pedestriansRef.current = pedestriansRef.current.map(p => {
        const refilled = ensureAmbientAgenda(p, WANDER_DWELL_MS);
        return tickPedestrian(refilled, dt, ctx);
      });

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [enabled]);

  const getDrawables = (): PedestrianDrawable[] => {
    const out: PedestrianDrawable[] = [];
    for (const p of pedestriansRef.current) {
      const d = computeDrawable(p, WALKWAY_MAP, POI_MAP);
      if (d) out.push(d);
    }
    return out;
  };

  const getStates = () => pedestriansRef.current;

  return { getDrawables, getStates };
}
