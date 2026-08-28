import { useState, useEffect, useLayoutEffect, useRef, useCallback, type RefObject } from "react";

/**
 * useWindowedRows — render only the rows of a fixed lattice grid that are near the
 * viewport, and replace the rest with two spacers of exactly the right height.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────
 * `MiniVocabCardGrid` used to mount EVERY card. Two earlier fixes attacked the cost
 * of that mount without removing it — `memo` on the card (so unrelated state doesn't
 * re-render them all) and `content-visibility: auto` (so offscreen cards skip layout
 * and paint) — and a third, `useIncrementalList`, spread the mount over time so it
 * never blocked in one commit. None of them stops React from CREATING the elements:
 * on a 470-card library that is ~470 components and several `sx` objects each, and
 * `content-visibility` cannot help with work that happens before the browser sees a
 * box. Windowing removes the work instead of pacing it: ~20 cards are mounted at any
 * moment, whatever the deck's size, so the cost stops scaling with the library.
 *
 * ── What it assumes ───────────────────────────────────────────────────────────
 * A FIXED LATTICE: every item is the same height, `perRow` items sit on a row, and
 * rows are separated by the container's flex `gap`. That is the only geometry it can
 * do arithmetic on — a grid whose items differ in height must not use this hook,
 * because the spacer heights would be wrong and the scroll position would jump as
 * rows entered the window.
 *
 * ── The band it measures against ──────────────────────────────────────────────
 * The nearest SCROLLABLE ancestor, not the viewport: on a surface like the decks
 * sheet the grid and its scroller move together while the sheet is resized, so a
 * band expressed relative to the scroller is unaffected by the resize and needs no
 * recomputation during the drag. When there is no scrollable ancestor (a plain page)
 * it falls back to the window.
 *
 * Used by: `src/components/MiniVocabCardGrid.tsx`.
 * Docs: docs/DECKS_FEATURE.md § "Why the card grid is windowed".
 */
export interface WindowedRowsOptions {
    /** Total number of items in the list. */
    itemCount: number;
    /** Items per row — must match what the container's width actually fits. */
    perRow: number;
    /** Height of one row, in px. */
    rowHeight: number;
    /** Vertical gap between rows, in px (the container's flex `gap`). */
    rowGap: number;
    /** The container's own top padding — the offset of row 0 inside its border box. */
    padTop: number;
    /**
     * Extra px rendered above and below the visible band. Buys the scroll a margin of
     * already-mounted rows so a fast fling doesn't outrun the measurement and expose
     * a blank strip; too large and the window stops being a window.
     */
    overscanPx?: number;
    /**
     * When false the hook reports the whole list and no spacers, so a caller can turn
     * windowing off for a short list (where it costs more than it saves) or for a grid
     * whose items are not a fixed lattice.
     */
    enabled?: boolean;
}

export interface RowWindow {
    /** First item index to render (inclusive). */
    start: number;
    /** One past the last item index to render. */
    end: number;
    /** Height of the spacer standing in for the rows above `start`. 0 = no spacer. */
    leadingPx: number;
    /** Height of the spacer standing in for the rows below `end`. 0 = no spacer. */
    trailingPx: number;
}

/** The first ancestor that actually scrolls, or null when the page itself does. */
const scrollParentOf = (el: HTMLElement | null): HTMLElement | null => {
    let node = el?.parentElement ?? null;
    while (node) {
        const overflowY = window.getComputedStyle(node).overflowY;
        if (overflowY === "auto" || overflowY === "scroll") return node;
        node = node.parentElement;
    }
    return null;
};

const FULL_WINDOW: RowWindow = { start: 0, end: 0, leadingPx: 0, trailingPx: 0 };

/**
 * The pure arithmetic behind the hook: which rows fall inside a band, and how tall the
 * two spacers must be to stand in for the ones that don't.
 *
 * `from`/`to` are the band's edges in the container's CONTENT-box coordinates (0 = the
 * top of row 0), already widened by any overscan. Exported for its unit tests — the
 * invariant that matters is that the rendered rows plus the spacers always add up to
 * the height the full list would have had, and that is testable without a DOM.
 */
export const computeRowWindow = (
    from: number,
    to: number,
    { itemCount, perRow, rowHeight, rowGap }: Pick<WindowedRowsOptions, "itemCount" | "perRow" | "rowHeight" | "rowGap">,
): RowWindow => {
    const totalRows = Math.ceil(itemCount / perRow);
    const stride = rowHeight + rowGap; // one row plus the gap that follows it

    const startRow = Math.min(Math.max(0, Math.floor(from / stride)), totalRows);
    const endRow = Math.min(totalRows, Math.max(startRow, Math.ceil(to / stride)));

    return {
        // Both clamped to `itemCount`: the last row is often partial, so the row
        // arithmetic can name an index past the end of the list (row 157 of a 470-card
        // grid starts at item 471). A slice would shrug that off; a caller reading
        // `start` as a real index would not.
        start: Math.min(itemCount, startRow * perRow),
        end: Math.min(itemCount, endRow * perRow),
        // A spacer is itself a flex item, so the container's `gap` supplies the
        // separation between it and the first rendered row — hence the `- rowGap`.
        // That is what keeps the total honest:
        //   leading + gap + rendered rows + gap + trailing
        //     == totalRows*rowHeight + (totalRows-1)*rowGap.
        leadingPx: startRow > 0 ? startRow * stride - rowGap : 0,
        trailingPx: endRow < totalRows ? (totalRows - endRow) * stride - rowGap : 0,
    };
};

/**
 * The window to use before anything has been measured.
 *
 * It cannot be the whole list: a caller that hands the hook a complete list on its
 * FIRST render would then mount all of it once, which is the exact commit this hook
 * exists to prevent. (Today's only caller reveals its list incrementally, so its
 * first render is three cards — but that is the caller's property, not the hook's.)
 *
 * So the seed is an upper bound instead: the viewport is at least as tall as any
 * scroller inside it, so a window of that many rows plus the overscan is guaranteed
 * to cover the real band, and the first measurement only ever narrows it. The
 * trailing spacer is included so the grid is the right HEIGHT on that first paint
 * and the scrollbar doesn't jump when the measurement lands.
 */
const seedWindow = (
    { itemCount, perRow, rowHeight, rowGap, overscanPx = 400, enabled = true }: WindowedRowsOptions,
): RowWindow => {
    if (!enabled) return { ...FULL_WINDOW, end: itemCount };
    const viewportH = typeof window === "undefined" ? 0 : window.innerHeight;
    return computeRowWindow(0, viewportH + overscanPx, { itemCount, perRow, rowHeight, rowGap });
};

export function useWindowedRows(
    containerRef: RefObject<HTMLElement | null>,
    { itemCount, perRow, rowHeight, rowGap, padTop, overscanPx = 400, enabled = true }: WindowedRowsOptions,
): RowWindow {
    // The window can only be MEASURED once the element exists, so the first render runs
    // on a conservative over-estimate (see seedWindow) rather than on the whole list.
    const [win, setWin] = useState<RowWindow>(() =>
        seedWindow({ itemCount, perRow, rowHeight, rowGap, padTop, overscanPx, enabled }));

    // rAF-coalesced: scroll fires far more often than the window can meaningfully
    // change, and every measurement costs two forced layouts.
    const frameRef = useRef<number | null>(null);
    // Resolved ONCE per effect run rather than per measurement: finding it walks the
    // ancestor chain calling getComputedStyle, which is the last thing a scroll frame
    // should be doing. It cannot change without the grid being re-parented, and that
    // remounts the effect anyway.
    const scrollerRef = useRef<HTMLElement | null>(null);

    const measure = useCallback(() => {
        const el = containerRef.current;
        if (!el) return;

        // The visible band, in the container's own content-box coordinates.
        const gridRect = el.getBoundingClientRect();
        const scroller = scrollerRef.current;
        const scrollerRect = scroller?.getBoundingClientRect();
        const bandTop = scrollerRect ? scrollerRect.top - gridRect.top : -gridRect.top;
        const bandBottom = scrollerRect
            ? scrollerRect.bottom - gridRect.top
            : window.innerHeight - gridRect.top;

        const next = computeRowWindow(
            bandTop - overscanPx - padTop,
            bandBottom + overscanPx - padTop,
            { itemCount, perRow, rowHeight, rowGap },
        );

        setWin((prev) =>
            prev.start === next.start && prev.end === next.end
                && prev.leadingPx === next.leadingPx && prev.trailingPx === next.trailingPx
                ? prev
                : next
        );
    }, [containerRef, itemCount, perRow, rowHeight, rowGap, padTop, overscanPx]);

    const schedule = useCallback(() => {
        if (frameRef.current !== null) return;
        frameRef.current = requestAnimationFrame(() => {
            frameRef.current = null;
            measure();
        });
    }, [measure]);

    // Subscriptions. Deliberately NOT keyed on itemCount: the list's length changes
    // repeatedly while the grid reveals itself, and tearing down three listeners and a
    // ResizeObserver on each of those steps is pure churn.
    useEffect(() => {
        if (!enabled) return;

        const el = containerRef.current;
        const scroller = scrollParentOf(el);
        scrollerRef.current = scroller;

        // `capture: true` because a scroll event does not bubble: the capture phase is
        // the only way one listener can hear every nested scroller on the page.
        window.addEventListener("scroll", schedule, true);
        window.addEventListener("resize", schedule);

        // The scroller's HEIGHT is half the band, and on the decks sheet it changes
        // without any scroll or resize event (the sheet is dragged taller).
        const observer = new ResizeObserver(schedule);
        if (el) observer.observe(el);
        if (scroller) observer.observe(scroller);

        return () => {
            window.removeEventListener("scroll", schedule, true);
            window.removeEventListener("resize", schedule);
            observer.disconnect();
            scrollerRef.current = null;
            if (frameRef.current !== null) {
                cancelAnimationFrame(frameRef.current);
                frameRef.current = null;
            }
        };
    }, [enabled, schedule, containerRef]);

    // Re-measure whenever the list itself changes — BEFORE paint, so the frame that
    // adds cards is already the windowed frame. Measured here rather than in a plain
    // effect because the alternative is a visible one-frame flash of the previous
    // window (most obviously when the list crosses the caller's `enabled` threshold
    // and the stale un-windowed state would paint once).
    useLayoutEffect(() => {
        if (!enabled) {
            setWin({ ...FULL_WINDOW, end: itemCount });
            return;
        }
        if (!scrollerRef.current) scrollerRef.current = scrollParentOf(containerRef.current);
        measure();
    }, [enabled, itemCount, measure, containerRef]);

    return enabled ? win : { ...FULL_WINDOW, end: itemCount };
}
