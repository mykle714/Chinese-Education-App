/**
 * usePixiPedestrians — pedestrian simulation driven by Pixi's useTick.
 *
 * Owns ref-backed pedestrian state and exposes a `tick(dtMs, tMs)` to advance
 * the FSM each frame. Doesn't touch React state on tick — `getDrawables()`
 * is safe to call inline during render.
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
  TILE_GRAPH,
  DEMO_STALLS,
  makeDemoPedestrians,
} from '../config/tileRegistry';

/** Per-tick dt cap — prevents large jumps if the tab was backgrounded. */
const MAX_DT_MS = 100;

/** How long an ambient pedestrian dwells at a destination before wandering again. */
const WANDER_DWELL_MS = 1500;

const STAND_MAP = new Map(DEMO_STALLS.map(s => [s.assetId, s]));

export interface UsePixiPedestriansHandle {
  tick: (dtMs: number, tMs: number) => void;
  getDrawables: () => PedestrianDrawable[];
  getStates: () => PedestrianState[];
  /** Stable list of every sprite image path used by the initial pedestrian set. */
  spriteImagePaths: string[];
}

export function usePixiPedestrians(count?: number): UsePixiPedestriansHandle {
  const pedestriansRef = useRef<PedestrianState[]>([]);
  if (pedestriansRef.current.length === 0) {
    pedestriansRef.current = makeDemoPedestrians(count);
  }

  const lastTMsRef = useRef<number>(performance.now());

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
  }, []);

  const tick = (dtMs: number, tMs: number) => {
    const dt = Math.min(dtMs, MAX_DT_MS);
    lastTMsRef.current = tMs;
    const ctx: PedestrianTickContext = {
      graph: TILE_GRAPH,
      stands: STAND_MAP,
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
      const d = computeDrawable(p, TILE_GRAPH, tMs, STAND_MAP);
      if (d) out.push(d);
    }
    return out;
  };

  const getStates = () => pedestriansRef.current;

  return { tick, getDrawables, getStates, spriteImagePaths };
}
