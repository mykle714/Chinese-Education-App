import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import { prefersReducedMotion } from "./iso";

/**
 * usePlatePress — the Deck Tower floor plate's push-button behaviour
 * (docs/DECK_TOWER_TRANSITIONS.md § "The plate button").
 *
 * Layer: page logic (feature module `src/features/deckTower`). It owns the press state and
 * the plate's animated height; it draws nothing. DeckTowerPlatform spreads `handlers` on
 * the plate's button and hands `raised` to IsoFloorLabel.
 *
 * At rest the plate stands slightly raised off the floor (`raised` = 1) so it reads as a
 * button. Pressing it (pointer down, or Enter / Space down) sinks it flush with the floor
 * (`raised` → 0). RELEASING it over the plate fires `onRelease` — the deck switch — and
 * the plate pops straight back up, its colour and label already cut to the other deck. Sliding off, a scroll taking the pointer (pointercancel) or
 * losing focus lets it back up without firing.
 *
 * A quick tap still shows the whole press: the release waits for the plate to bottom out
 * before firing, so the switch never starts from a half-sunk plate.
 *
 * `raised` is React state ticked by rAF only while it moves (~0.1–0.2 s). Under
 * prefers-reduced-motion it jumps instead of easing.
 */

/** Ms for the plate to sink flush when pressed. */
const PRESS_MS = 80;
/** Ms for it to pop back up (with a slight overshoot, see `easeOutBack`). */
const POP_MS = 220;

/** Ease-out with a small overshoot past 1 before settling — the button's spring. */
const easeOutBack = (u: number) => {
    const k = 1.6;
    return 1 + (k + 1) * Math.pow(u - 1, 3) + k * Math.pow(u - 1, 2);
};
const easeOut = (u: number) => 1 - (1 - u) * (1 - u);

interface PlatePressOptions {
    /** Presses are accepted (false mid-swap, or while the camera is panning between worlds). */
    enabled: boolean;
    /** Fired on a release over the plate. */
    onRelease: () => void;
}

export interface PlatePress {
    /** 0 = flush with the floor, 1 = at rest raised (briefly above 1 as it springs back). */
    raised: number;
    handlers: {
        onPointerDown: (e: React.PointerEvent<SVGGElement>) => void;
        onPointerUp: (e: React.PointerEvent<SVGGElement>) => void;
        onPointerLeave: () => void;
        onPointerCancel: () => void;
        onKeyDown: (e: React.KeyboardEvent<SVGGElement>) => void;
        onKeyUp: (e: React.KeyboardEvent<SVGGElement>) => void;
        onBlur: () => void;
    };
}

const isActivationKey = (e: React.KeyboardEvent) => e.key === "Enter" || e.key === " ";

export function usePlatePress({ enabled, onRelease }: PlatePressOptions): PlatePress {
    const [pressed, setPressed] = useState(false);
    // 'down' = held; 'releasing' = let go over the plate, waiting for it to bottom out
    // before firing. A ref, so the pointerleave that touch fires right after pointerup
    // cannot cancel a release already under way.
    const phase = useRef<"idle" | "down" | "releasing">("idle");
    const pressedAt = useRef(0);
    const releaseTimer = useRef<number | undefined>(undefined);
    // Latest callback, so the handlers never go stale between renders.
    const onReleaseRef = useRef(onRelease);
    onReleaseRef.current = onRelease;

    useEffect(() => () => window.clearTimeout(releaseTimer.current), []);

    // A swap starting (or the camera panning to another world) drops a held press.
    useEffect(() => {
        if (!enabled && phase.current === "down") {
            phase.current = "idle";
            setPressed(false);
        }
    }, [enabled]);

    const press = useCallback(() => {
        if (!enabled || phase.current !== "idle") return;
        phase.current = "down";
        pressedAt.current = performance.now();
        setPressed(true);
    }, [enabled]);

    const cancel = useCallback(() => {
        if (phase.current !== "down") return;
        phase.current = "idle";
        setPressed(false);
    }, []);

    const release = useCallback(() => {
        if (phase.current !== "down") return;
        phase.current = "releasing";
        const wait = prefersReducedMotion() ? 0 : Math.max(0, PRESS_MS - (performance.now() - pressedAt.current));
        releaseTimer.current = window.setTimeout(() => {
            phase.current = "idle";
            // Same tick: the swap's start (the plate's new face) and the un-press batch
            // into one render, so the face cuts over as the plate starts popping up. If the page ignores the tap, it
            // just pops up.
            onReleaseRef.current();
            setPressed(false);
        }, wait);
    }, []);

    const raised = useRaisedTween(pressed ? 0 : 1);

    return {
        raised,
        handlers: {
            onPointerDown: (e) => {
                if (e.button !== 0) return;
                press();
            },
            onPointerUp: (e) => {
                // Touch pointers are implicitly captured, so pointerup reaches the plate even
                // when the finger has slid off it: check where it actually lifted.
                const under = document.elementFromPoint(e.clientX, e.clientY);
                if (under && e.currentTarget.contains(under)) release();
                else cancel();
            },
            onPointerLeave: cancel,
            onPointerCancel: cancel,
            onKeyDown: (e) => {
                if (!isActivationKey(e)) return;
                e.preventDefault();
                if (!e.repeat) press();
            },
            onKeyUp: (e) => {
                if (!isActivationKey(e)) return;
                e.preventDefault();
                release();
            },
            onBlur: cancel,
        },
    };
}

/** Eases a 0–1 height toward `target`: a quick sink on the way down, a spring on the way up. */
function useRaisedTween(target: number): number {
    const [value, setValue] = useState(target);
    const valueRef = useRef(value);
    valueRef.current = value;

    useEffect(() => {
        if (prefersReducedMotion()) {
            setValue(target);
            return;
        }
        const from = valueRef.current;
        if (from === target) return;
        const sinking = target < from;
        const ms = sinking ? PRESS_MS : POP_MS;
        const ease = sinking ? easeOut : easeOutBack;
        const start = performance.now();
        let frame = 0;
        const tick = (t: number) => {
            const u = Math.min(1, (t - start) / ms);
            setValue(from + (target - from) * ease(u));
            if (u < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [target]);

    return value;
}
