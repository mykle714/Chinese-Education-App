import { useCallback, useRef } from "react";

/**
 * Minimal per-frame state every game actor carries.
 * Games extend this for their own actor types via the `TActor` generic.
 */
export interface BaseActor {
    id: string;
    x: number;
    y: number;
}

/**
 * Snapshot a game emits each frame for rendering. Returned in z-sorted order
 * (smaller `z` drawn first). Games can ignore `z` for non-depth-sorted scenes.
 */
export interface ActorDrawable {
    id: string;
    x: number;
    y: number;
    z: number;
    /** Texture lookup key — matches `GameAsset.assetId`. */
    textureKey: string;
    /** Optional per-actor render scale. */
    scale?: number;
}

export interface UseGameActorsOptions<TActor extends BaseActor> {
    /** Initial actor set. Optional — start empty and add via setter if preferred. */
    initial?: TActor[];
    /**
     * Per-frame advancement. Receives the previous actor list and frame deltas;
     * returns the next list. Pure-ish — runs inside the Pixi tick loop.
     */
    advance: (actors: TActor[], dtMs: number, tMs: number) => TActor[];
    /** Maps an actor to a render drawable. */
    toDrawable: (actor: TActor) => ActorDrawable;
}

export interface UseGameActorsHandle<TActor extends BaseActor> {
    /** Drive the actor list one tick forward. Wire to `GameStage`'s `onTick`. */
    tick: (dtMs: number, tMs: number) => void;
    /** Current drawables snapshot, z-sorted. */
    getDrawables: () => ActorDrawable[];
    /** Direct access to the live actor list (for game-specific writes). */
    getActors: () => TActor[];
    /** Replace the actor list (e.g. on level start / reset). */
    setActors: (next: TActor[]) => void;
    /** Pause/slow/speed-up the simulation. 1.0 = real time, 0 = paused. */
    setSpeedMultiplier: (multiplier: number) => void;
}

/**
 * Generic actor-list handle. Mirrors the `tick + getDrawables` pattern used by
 * `usePixiPedestrians` in the night market engine but decoupled from any
 * specific actor type.
 *
 * Games own their actor type via the `TActor` generic and pass an `advance`
 * function that progresses the world by one frame. Render the result by
 * iterating `getDrawables()` inside the game's pixi JSX.
 */
export function useGameActors<TActor extends BaseActor>(
    options: UseGameActorsOptions<TActor>
): UseGameActorsHandle<TActor> {
    const actorsRef = useRef<TActor[]>(options.initial ?? []);
    const speedRef = useRef(1);
    const advanceRef = useRef(options.advance);
    const toDrawableRef = useRef(options.toDrawable);
    advanceRef.current = options.advance;
    toDrawableRef.current = options.toDrawable;

    const tick = useCallback((dtMs: number, tMs: number) => {
        const speed = speedRef.current;
        if (speed === 0) return;
        const scaledDt = dtMs * speed;
        actorsRef.current = advanceRef.current(actorsRef.current, scaledDt, tMs);
    }, []);

    const getDrawables = useCallback((): ActorDrawable[] => {
        const out = actorsRef.current.map((a) => toDrawableRef.current(a));
        out.sort((a, b) => a.z - b.z);
        return out;
    }, []);

    const getActors = useCallback(() => actorsRef.current, []);

    const setActors = useCallback((next: TActor[]) => {
        actorsRef.current = next;
    }, []);

    const setSpeedMultiplier = useCallback((multiplier: number) => {
        speedRef.current = multiplier;
    }, []);

    return { tick, getDrawables, getActors, setActors, setSpeedMultiplier };
}
