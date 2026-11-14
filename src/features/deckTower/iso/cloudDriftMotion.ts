import { useEffect, useMemo, type RefObject } from "react";
import type { Projector } from "./geometry";
import { prefersReducedMotion } from "./skyTraffic";
import type { CloudDrift } from "./useCloudDrifts";

/**
 * cloudDriftMotion.ts — what a cloud and its shadows share: where the drift starts, and the
 * requestAnimationFrame slide + fade that carries a drawing along it
 * (docs/ISO_ART_FRAMEWORK.md § "IsoCloud").
 *
 * The cloud (IsoCloud) and each of its shadows (IsoCloudShadow, one per receiving surface)
 * live in different places in the draw order, so each runs its own loop. They stay in
 * lockstep because they share the same inputs: every one mounts in the same commit (from
 * the one sky-traffic store), so their start times differ by microseconds, and they read
 * the same rAF timestamp each frame.
 *
 * The projection is affine and a drift is level, so ONE screen delta moves a drawing at
 * any height: the cloud at its own z and its shadow on the floor slide by the same px.
 *
 * Depended on by: IsoCloud.tsx, IsoCloudShadow.tsx.
 */

/**
 * A drift fades in over this long. For a natural cloud it is a safety net (it starts off
 * screen); it is what you SEE for the tester's mid-sky starts (a weather pin's cloud fill,
 * the balloon chip), so they appear at once without popping in.
 */
const FADE_MS = 1600;

/**
 * The cloud origin's world x/y where this drift begins (`startT` of the way along the whole
 * crossing), and the screen delta from there to the crossing's end.
 */
export function useDriftGeometry(proj: Projector, drift: CloudDrift) {
    return useMemo(() => {
        const { from, to, startT, z } = drift;
        const ox = from.x + (to.x - from.x) * startT;
        const oy = from.y + (to.y - from.y) * startT;
        const start = proj.project(ox, oy, z);
        const end = proj.project(to.x, to.y, z);
        return { ox, oy, dx: end.x - start.x, dy: end.y - start.y };
    }, [proj, drift]);
}

/**
 * Slides `ref`'s group by `dx`/`dy` over the drift's duration and fades it in. Under
 * prefers-reduced-motion it does nothing: the caller draws it opaque where it starts.
 */
export function useDriftMotion(ref: RefObject<SVGGElement | null>, durationMs: number, dx: number, dy: number) {
    const reduced = prefersReducedMotion();
    useEffect(() => {
        if (reduced) return;
        const t0 = performance.now();
        let frame = 0;
        const tick = (now: number) => {
            const elapsed = now - t0;
            const t = Math.min(1, elapsed / durationMs);
            const el = ref.current;
            if (el) {
                // CSS px on SVG elements are user units, so these are scene units.
                el.style.transform = `translate(${dx * t}px, ${dy * t}px)`;
                el.style.opacity = String(Math.min(1, elapsed / FADE_MS));
            }
            if (t < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [ref, durationMs, dx, dy, reduced]);
    /** The group's initial opacity: hidden until the loop fades it in, or opaque when still. */
    return reduced ? 1 : 0;
}
