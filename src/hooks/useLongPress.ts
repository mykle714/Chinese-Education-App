import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useLongPress — one press gesture with two outcomes: a SHORT tap or a HOLD.
 *
 * Three outcomes by press length:
 *   - released within `tapMaxMs`          → `onTap`
 *   - released after that but before `delayMs` → NOTHING (a hold the user gave up on;
 *     cancelling a hold must not fall through to the tap action — letting go of a
 *     half-held Skip button must not skip the pack)
 *   - held for `delayMs`                  → `onLongPress`
 *
 * Never tap AND hold: after a hold has fired, the browser's `click` (which still arrives
 * when the finger lifts) is swallowed, so a hidden long-press can sit on a button whose
 * tap means something else entirely (scp's Skip button: tap = skip the pack, hold = open
 * the skipped-cards sheet — and a hold must NOT also skip).
 *
 * A press is abandoned (neither outcome) when the pointer travels more than
 * `moveTolerancePx` from where it went down, leaves the element, or is cancelled — which
 * is what a native scroll does to a press that started on a card inside a scrollable
 * list (`pointercancel`), so scrolling never recycles or opens anything.
 *
 * `pressing` is true for the life of a live hold, for callers that draw hold progress
 * (the skipped-card recycle ring); it drops back to false on release, cancel, or fire.
 *
 * Spread `handlers` onto the pressable element. They include `onClick` (the tap path —
 * keyboard activation also arrives here, so Enter/Space still taps) and `onContextMenu`
 * (suppressed, so a mobile long-press doesn't raise the OS callout/menu).
 *
 * Layer: shared hook (src/hooks), no feature knowledge.
 * Referenced by: docs/SORT_CARDS_REQUIREMENTS.md §5.1a (SortCardsPage's Skip button,
 * SkippedCardsSheet's hold-to-recycle cards).
 */
interface UseLongPressOptions {
    delayMs: number;
    onLongPress: () => void;
    /** A press released before `delayMs`. Omit when a tap should do nothing. */
    onTap?: () => void;
    /**
     * The longest press (ms) that still counts as a tap. Anything longer that is released
     * before `delayMs` is an abandoned hold and does nothing.
     */
    tapMaxMs?: number;
    /** How far (px) the pointer may drift before the press is abandoned. */
    moveTolerancePx?: number;
    disabled?: boolean;
}

export function useLongPress({ delayMs, onLongPress, onTap, tapMaxMs = 250, moveTolerancePx = 10, disabled = false }: UseLongPressOptions) {
    const [pressing, setPressing] = useState(false);
    const timerRef = useRef<number | null>(null);
    const startRef = useRef<{ x: number; y: number } | null>(null);
    // Set when the hold fires; the click that follows the finger lifting reads and
    // clears it, so that click is not also treated as a tap.
    const firedRef = useRef(false);
    // When the current press went down (performance.now()), read by the click to tell a
    // tap from an abandoned hold. NOT reset by `clear` — the click arrives AFTER
    // pointerup has already cleared the press. Null for a keyboard click (no pointer).
    const pressStartedAtRef = useRef<number | null>(null);

    // Latest callbacks through refs: the timer is armed with whatever was current at
    // pointerdown, but the caller's handlers can change identity mid-hold (a re-render),
    // and the hold should run the CURRENT one.
    const onLongPressRef = useRef(onLongPress);
    const onTapRef = useRef(onTap);
    onLongPressRef.current = onLongPress;
    onTapRef.current = onTap;

    const clear = useCallback(() => {
        if (timerRef.current != null) {
            window.clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        startRef.current = null;
        setPressing(false);
    }, []);

    // Unmounting mid-hold must not fire the hold afterwards.
    useEffect(() => clear, [clear]);

    const onPointerDown = useCallback((e: React.PointerEvent) => {
        if (disabled || e.button !== 0) return;
        firedRef.current = false;
        pressStartedAtRef.current = performance.now();
        startRef.current = { x: e.clientX, y: e.clientY };
        setPressing(true);
        timerRef.current = window.setTimeout(() => {
            timerRef.current = null;
            startRef.current = null;
            firedRef.current = true;
            setPressing(false);
            onLongPressRef.current();
        }, delayMs);
    }, [delayMs, disabled]);

    const onPointerMove = useCallback((e: React.PointerEvent) => {
        const start = startRef.current;
        if (!start) return;
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > moveTolerancePx) clear();
    }, [moveTolerancePx, clear]);

    const onClick = useCallback(() => {
        const startedAt = pressStartedAtRef.current;
        pressStartedAtRef.current = null;
        // The click after a fired hold belongs to the hold — swallow it.
        if (firedRef.current) {
            firedRef.current = false;
            return;
        }
        // Released too late to be a tap but before the hold fired: an abandoned hold.
        // Swallow it. (startedAt is null for keyboard activation, which always taps.)
        if (startedAt != null && performance.now() - startedAt > tapMaxMs) return;
        onTapRef.current?.();
    }, [tapMaxMs]);

    const onContextMenu = useCallback((e: React.MouseEvent) => e.preventDefault(), []);

    return {
        pressing,
        handlers: {
            onPointerDown,
            onPointerMove,
            onPointerUp: clear,
            onPointerLeave: clear,
            onPointerCancel: clear,
            onClick,
            onContextMenu,
        },
    };
}
