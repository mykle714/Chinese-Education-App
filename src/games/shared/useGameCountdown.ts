import { useEffect, useRef, useState } from "react";
import { playCountdownSound } from "../../services/sfx/countdownSounds";

/**
 * The pre-run countdown's TIMING and SOUND — 3 · 2 · 1, then the release. The picture is
 * `<GameCountdown>` (./GameCountdown.tsx, whose header explains the whole mechanism);
 * this file is kept apart from it only so the component file exports components alone
 * (React Fast Refresh).
 *
 * Callers: every flp break game's Stage — Match Speed, Word Search, Writing Grid,
 * Superposition, Speed Reading, Memory Map.
 * Documented in: docs/GAMES_FEATURE.md § "The countdown", docs/AUDIO_PLAYBACK.md
 * § "Sound effects".
 */

/** The steps, in order. The release follows the last one; it has no card of its own. */
export const COUNTDOWN_STEPS = ["3", "2", "1"] as const;
/** How long each step stays up, ms. The run goes live this long after "1" appears. */
export const COUNTDOWN_STEP_MS = 700;

export interface UseGameCountdownOptions {
    /**
     * True while the countdown should be running. Turning it on starts at "3"; the
     * caller turns it off from `onRelease` (or to abandon the count).
     */
    active: boolean;
    /**
     * Freezes the count without resetting it — the app in the background
     * (docs/GAMES_FEATURE.md § Backgrounding pauses the clock). A popup that opens with the
     * board (the lent-cards notice) is NOT a pause: keep `active` false until it is
     * dismissed, because the dim would cover it (GameCountdown.tsx → COUNTDOWN_DIM_Z_INDEX). The step that
     * was up when the pause began gets its full time again on resume, and its tick is not
     * replayed.
     */
    paused?: boolean;
    /** The last step has run out: start the clock, unlock the board. */
    onRelease: () => void;
}

/**
 * Drive a countdown. Returns the index into `COUNTDOWN_STEPS` to show, or null when no
 * countdown is running — pass it straight to `<GameCountdown step={…} />`.
 *
 * One timeout per step, re-armed by `step` changing, rather than an interval whose
 * callback inspects the step inside a state updater: an updater must stay a pure function
 * of previous state (StrictMode runs it twice), and releasing from inside one is exactly
 * the side effect that rule exists to prevent.
 */
export function useGameCountdown({ active, paused = false, onRelease }: UseGameCountdownOptions): number | null {
    const [step, setStep] = useState(0);
    // Latest-ref: the release fires from a timeout armed several renders earlier.
    const onReleaseRef = useRef(onRelease);
    onReleaseRef.current = onRelease;
    // The step whose tick already sounded. A ref, not state, so StrictMode's effect
    // re-run and a pause/resume do not tick the same digit twice.
    const tickedStepRef = useRef<number | null>(null);

    // Each activation starts from "3". React's "adjust state on a prop change" pattern
    // (set during render, guarded) so the first frame of a new count already shows "3".
    const [wasActive, setWasActive] = useState(active);
    if (active !== wasActive) {
        setWasActive(active);
        if (active) setStep(0);
    }

    useEffect(() => {
        if (!active) tickedStepRef.current = null;
    }, [active]);

    useEffect(() => {
        if (!active || paused) return;
        if (tickedStepRef.current !== step) {
            tickedStepRef.current = step;
            playCountdownSound("tick");
        }
        const isLastStep = step >= COUNTDOWN_STEPS.length - 1;
        const id = window.setTimeout(() => {
            if (isLastStep) {
                playCountdownSound("release");
                onReleaseRef.current();
            } else {
                setStep((current) => current + 1);
            }
        }, COUNTDOWN_STEP_MS);
        return () => window.clearTimeout(id);
    }, [active, paused, step]);

    return active ? step : null;
}

