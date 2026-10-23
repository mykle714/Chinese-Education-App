import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion, type PawnEntranceCue, type PawnEntranceFrame } from "./iso";

/**
 * usePopUpMotion — the animated numbers of a fixture that rises out of a floor hatch and
 * sinks back into it (IsoHatch's `sink`, `hatch` and `air`): the focus lever
 * (useLeverMotion).
 * Layer: page logic; it draws nothing (docs/DECK_TOWER.md § "Floor fixtures").
 *
 *   visible false → true : the hatch's flaps swing down open, THEN the fixture rises out on
 *                          its lift, which stops flush with the floor.
 *                          OR, with a `skyEntrance` cue at that moment (a deck swap
 *                          arriving at Learn Now), it FALLS FROM THE SKY on the pawn's own
 *                          entrance timeline (pawnEntrances.ts → `FALL_FROM_SKY`), its
 *                          start shifted so it lands a staggered beat after the pawn
 *                          (DeckTowerPage → `fixtureArgs`). It falls already standing (sink 0,
 *                          hatch 1 — the hatch hidden under its flush lift), so once it has
 *                          landed it is in the ordinary standing state.
 *   visible true → false : the fixture recedes into the platform, THEN the flaps swing up
 *                          and shut over the hole it left.
 *
 * Each number is its own tween; the visibility sequence is two tweens with the second
 * started by a timer, so a reversal mid-sequence simply retargets whatever is moving.
 * Under prefers-reduced-motion every change jumps — and so does a visibility change made
 * while `instant` is set (the fixture has just fallen out of sight with a trap-door swap's
 * old tower, so it is put away sunk and shut without a visible recede).
 */

const HATCH_MS = 260;
const RISE_MS = 460;
const RECEDE_MS = 380;
const SHUT_MS = 320;

export const easeOut = (u: number) => 1 - (1 - u) * (1 - u);
export const easeIn = (u: number) => u * u;
/** Ease-out with a small overshoot past the target — a spring (a lever's stick, the flaps). */
export const easeOutBack = (u: number) => {
    const k = 1.4;
    return 1 + (k + 1) * Math.pow(u - 1, 3) + k * Math.pow(u - 1, 2);
};

/** A number that eases to `target` over `ms` whenever `target` changes; starts AT it. */
export function useTween(target: number, ms: number, ease: (u: number) => number): number {
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

export interface PopUpMotion {
    sink: number;
    hatch: number;
    /**
     * A sky-fall entrance in progress: "waiting" before its start (draw nothing — it is not
     * here yet), then the pose to draw it in; null when there is none.
     */
    skyFall: PawnEntranceFrame | "waiting" | null;
}

export function usePopUpMotion({
    visible,
    instant = false,
    skyEntrance,
}: {
    visible: boolean;
    instant?: boolean;
    /** Read when `visible` turns true: arrive by falling from the sky on this cue instead of rising from the hatch. */
    skyEntrance?: PawnEntranceCue;
}): PopUpMotion {
    // The visibility sequence's two targets. The SECOND step of each direction waits for
    // the first to finish (a timer), so the fixture never rises through shut flaps and the
    // flaps never shut on a fixture still standing.
    const [sinkTarget, setSinkTarget] = useState(visible ? 0 : 1);
    const [hatchTarget, setHatchTarget] = useState(visible ? 1 : 0);
    // `instant` is read when `visible` changes, not tracked: it only decides HOW that change plays.
    const jump = useRef(instant);
    jump.current = instant;
    const skyCue = useRef(skyEntrance);
    skyCue.current = skyEntrance;
    // The sky fall's clock: ms since its start (negative while waiting), null when none is playing.
    const [skyT, setSkyT] = useState<number | null>(null);
    const [skyAnim, setSkyAnim] = useState<PawnEntranceCue["animation"] | null>(null);
    useEffect(() => {
        const reduced = prefersReducedMotion();
        const cue = visible && !reduced ? skyCue.current : undefined;
        if (cue) {
            // Standing from the start; only the fall's pose moves it.
            setHatchTarget(1);
            setSinkTarget(0);
            setSkyAnim(cue.animation);
            let frame = 0;
            const tick = (now: number) => {
                const t = now - cue.startAt;
                if (t >= cue.animation.durationMs) {
                    setSkyT(null);
                    return;
                }
                setSkyT(t);
                frame = requestAnimationFrame(tick);
            };
            setSkyT(performance.now() - cue.startAt);
            frame = requestAnimationFrame(tick);
            return () => {
                cancelAnimationFrame(frame);
                setSkyT(null);
            };
        }
        const skip = reduced || jump.current;
        if (skip) {
            setHatchTarget(visible ? 1 : 0);
            setSinkTarget(visible ? 0 : 1);
            return;
        }
        if (visible) {
            setHatchTarget(1);
            const timer = window.setTimeout(() => setSinkTarget(0), HATCH_MS);
            return () => window.clearTimeout(timer);
        }
        setSinkTarget(1);
        const timer = window.setTimeout(() => setHatchTarget(0), RECEDE_MS);
        return () => window.clearTimeout(timer);
    }, [visible]);

    // The rise eases out without overshoot: the lift stops flush with the floor.
    // A sky fall's targets jump too: it arrives standing, not through the hatch.
    const jumpNow = instant || skyT !== null;
    const sink = useTween(sinkTarget, jumpNow ? 0 : sinkTarget === 0 ? RISE_MS : RECEDE_MS, sinkTarget === 0 ? easeOut : easeIn);
    const hatch = useTween(hatchTarget, jumpNow ? 0 : hatchTarget === 1 ? HATCH_MS : SHUT_MS, hatchTarget === 1 ? easeOut : easeOutBack);
    // Put away instantly: report it sunk and shut in this very render, not after the tween's
    // effects catch up — the frame the fall's translate drops would otherwise flash the
    // fixture standing back on the floor.
    if (instant && !visible) return { sink: 1, hatch: 0, skyFall: null };
    const skyFall = skyT === null || !skyAnim ? null : skyT < 0 ? "waiting" : skyAnim.frame(skyT);
    return { sink, hatch, skyFall };
}
