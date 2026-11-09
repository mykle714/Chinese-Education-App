import { useCallback, useEffect, useRef, useState } from "react";
import { takeHintLineIndex } from "./hintPawnVisit";
import { OUCH_LINE_BAG, OUCH_LINES } from "./pawnHintLines";

/**
 * usePawnOuch — the hint pawn's "ouch" bubbles: which are up, and their lifetimes
 * (docs/HINT_PAWN.md § "Tap reactions"). The look is PawnOuchBubble's.
 *
 * `say()` (a tap the pawn answers with a flinch) inflates a new bubble with the next line
 * from the ouch bag; any bubble already up starts leaving at once — one at a time (owner,
 * 2026-11-08: a re-tap replaces it). Each lives OUCH_TTL_MS, then leaves (fade + drop,
 * OUCH_EXIT_MS) and is removed. `hush()` sends every bubble away (the pawn hidden, leaving
 * or parked).
 *
 * Layer: flp page presentation hook (client). Depended on by: hintPawn/HintPawn.tsx.
 */

/** How long an ouch bubble stays up ("a couple seconds", owner 2026-11-08), counted from its spawn. */
export const OUCH_TTL_MS = 2200;
/** The leave: fade away while dropping (PawnOuchBubble's `ouchLeave`). */
export const OUCH_EXIT_MS = 280;

export interface OuchBubble {
    id: number;
    line: string;
    phase: "in" | "out";
}

export function usePawnOuch(): { ouches: OuchBubble[]; say: () => void; hush: () => void } {
    const [ouches, setOuches] = useState<OuchBubble[]>([]);
    const ids = useRef(0);
    const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

    const later = useCallback((ms: number, fn: () => void) => {
        const t = setTimeout(() => {
            timers.current.delete(t);
            fn();
        }, ms);
        timers.current.add(t);
    }, []);
    useEffect(() => {
        const pending = timers.current;
        return () => pending.forEach(clearTimeout);
    }, []);

    // The ids still up (not yet leaving). Kept beside the state so the handlers below can
    // read it without scheduling timers from inside a state updater (StrictMode runs those
    // twice).
    const upIds = useRef(new Set<number>());

    /** Starts `id`'s leave (no-op if it is already leaving or gone), and removes it once played. */
    const leave = useCallback(
        (id: number) => {
            if (!upIds.current.delete(id)) return;
            setOuches((list) => list.map((o) => (o.id === id ? { ...o, phase: "out" } : o)));
            later(OUCH_EXIT_MS, () => setOuches((list) => list.filter((o) => o.id !== id)));
        },
        [later]
    );

    const hush = useCallback(() => [...upIds.current].forEach(leave), [leave]);

    const say = useCallback(() => {
        hush();
        ids.current += 1;
        const id = ids.current;
        // The line is taken HERE, in the tap's handler — never during a render — so the
        // bag advances once per tap.
        const line = OUCH_LINES[takeHintLineIndex(OUCH_LINE_BAG, OUCH_LINES.length)] ?? OUCH_LINES[0];
        upIds.current.add(id);
        setOuches((list) => [...list, { id, line, phase: "in" }]);
        later(OUCH_TTL_MS, () => leave(id));
    }, [hush, later, leave]);

    return { ouches, say, hush };
}
