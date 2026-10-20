import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "./iso";

/**
 * useLeverMotion — the focus lever's three animated numbers (docs/FOCUS_MODE.md § 5,
 * docs/DECK_TOWER.md § "Focus lever"). Layer: page logic; it draws nothing — IsoLever
 * takes `pull`, `sink` and `hatch`.
 *
 *   visible false → true : the hatch's flaps swing down open, THEN the lever rises out on its lift,
 *                          which stops flush with the floor.
 *   visible true → false : the lever recedes into the platform, THEN the flaps swing up
 *                          and shut over the hole it left.
 *   pulled               : the stick tips toward the viewer (it holds there while focus is
 *                          on, or while the popup it opened is up); released, it springs
 *                          back past rest and settles.
 *
 * Each number is its own tween; the visibility sequence is two tweens with the second
 * started by a timer, so a reversal mid-sequence simply retargets whatever is moving.
 * Under prefers-reduced-motion every change jumps.
 */

const PULL_MS = 200;
const RELEASE_MS = 420;
const HATCH_MS = 260;
const RISE_MS = 460;
const RECEDE_MS = 380;
const SHUT_MS = 320;

const easeOut = (u: number) => 1 - (1 - u) * (1 - u);
const easeIn = (u: number) => u * u;
/** Ease-out with a small overshoot past the target — the stick's and the flaps' spring. */
const easeOutBack = (u: number) => {
    const k = 1.4;
    return 1 + (k + 1) * Math.pow(u - 1, 3) + k * Math.pow(u - 1, 2);
};

/** A number that eases to `target` over `ms` whenever `target` changes; starts AT it. */
function useTween(target: number, ms: number, ease: (u: number) => number): number {
    const [value, setValue] = useState(target);
    const valueRef = useRef(target);
    useEffect(() => {
        const from = valueRef.current;
        if (from === target) return;
        if (prefersReducedMotion() || ms <= 0) {
            valueRef.current = target;
            setValue(target);
            return;
        }
        const start = performance.now();
        let frame = 0;
        const tick = (now: number) => {
            const u = Math.min(1, (now - start) / ms);
            const next = from + (target - from) * ease(u);
            valueRef.current = u >= 1 ? target : next;
            setValue(valueRef.current);
            if (u < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
        // `ease` and `ms` are fixed per call site; only a new target restarts the tween.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [target]);
    return value;
}

export interface LeverMotion {
    pull: number;
    sink: number;
    hatch: number;
}

export function useLeverMotion({ visible, pulled }: { visible: boolean; pulled: boolean }): LeverMotion {
    // The visibility sequence's two targets. The SECOND step of each direction waits for
    // the first to finish (a timer), so the lever never rises through shut flaps and the
    // flaps never shut on a lever still standing.
    const [sinkTarget, setSinkTarget] = useState(visible ? 0 : 1);
    const [hatchTarget, setHatchTarget] = useState(visible ? 1 : 0);
    useEffect(() => {
        const reduced = prefersReducedMotion();
        if (visible) {
            setHatchTarget(1);
            const timer = window.setTimeout(() => setSinkTarget(0), reduced ? 0 : HATCH_MS);
            return () => window.clearTimeout(timer);
        }
        setSinkTarget(1);
        const timer = window.setTimeout(() => setHatchTarget(0), reduced ? 0 : RECEDE_MS);
        return () => window.clearTimeout(timer);
    }, [visible]);

    // The rise eases out without overshoot: the lift stops flush with the floor.
    const sink = useTween(sinkTarget, sinkTarget === 0 ? RISE_MS : RECEDE_MS, sinkTarget === 0 ? easeOut : easeIn);
    const hatch = useTween(hatchTarget, hatchTarget === 1 ? HATCH_MS : SHUT_MS, hatchTarget === 1 ? easeOut : easeOutBack);
    const pull = useTween(pulled ? 1 : 0, pulled ? PULL_MS : RELEASE_MS, pulled ? easeOut : easeOutBack);
    return { pull, sink, hatch };
}
