import { useState, useEffect } from "react";

/**
 * Progressively reveal a large list in small batches, spaced by a timer, instead
 * of mounting every item in a single blocking render.
 *
 * Two goals at once:
 *  1. Responsiveness — each batch is a tiny commit and the `intervalMs` gap
 *     between batches leaves the main thread free, so taps on surrounding
 *     buttons run immediately while the list fills in.
 *  2. A visible sequential cascade — the gap is paced (not one-per-frame), so
 *     each batch's pop-in animation reads as a distinct step rather than every
 *     card popping at once. (At ~16ms/frame the batches overlap the 400ms pop
 *     completely and look simultaneous; a perceptible interval fixes that.)
 *
 * Returns the slice of `items` mounted so far. The reveal resets and restarts
 * whenever the `items` reference changes (e.g. a fresh fetch), so callers must
 * pass a referentially stable array (state set once from a fetch — not a new
 * array literal each render, which would restart the cascade every render).
 *
 * @param items      The full list to reveal.
 * @param batchSize  How many items to add per step (and how many show instantly).
 * @param intervalMs Delay between steps. Tune against the pop-in duration so the
 *                   cascade is visible without dragging on for large lists.
 */
export function useIncrementalList<T>(items: T[], batchSize = 3, intervalMs = 70): T[] {
    const [count, setCount] = useState(() => Math.min(items.length, batchSize));

    useEffect(() => {
        // Show the first batch immediately, then add one batch per interval.
        setCount(Math.min(items.length, batchSize));
        if (items.length <= batchSize) return;

        let current = batchSize;
        let timer = setTimeout(function step() {
            current = Math.min(current + batchSize, items.length);
            setCount(current);
            if (current < items.length) {
                timer = setTimeout(step, intervalMs);
            }
        }, intervalMs);
        return () => clearTimeout(timer);
    }, [items, batchSize, intervalMs]);

    // Avoid an extra array allocation once everything is mounted.
    return count >= items.length ? items : items.slice(0, count);
}
