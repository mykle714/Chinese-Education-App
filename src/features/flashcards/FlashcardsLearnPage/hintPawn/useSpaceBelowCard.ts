import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * useSpaceBelowCard — the free height between the card's bottom edge and ContentArea's
 * bottom edge, in ContentArea's own (layout) px. The hint pawn's bubble is clipped to this
 * band so it never overlaps the card (docs/HINT_PAWN.md § "Layout and hit area").
 *
 * Measured from client rects, then divided by ContentArea's rendered scale
 * (`rect.height / offsetHeight`), so a camera transform on an ancestor (the Deck Tower's
 * dive) doesn't skew it. The rect difference includes ContentArea's safe-area strip; the
 * caller subtracts SAFE_BOTTOM itself.
 *
 * Re-measured on: either box resizing (ResizeObserver), a window resize, and every change
 * of `remeasureKey` (the caller passes what moves the card without resizing it — the card
 * being uncovered after the dive).
 *
 * Layer: flp page presentation hook (client). 0 until the first measure.
 *
 * Depended on by: hintPawn/HintPawn.tsx. Docs: docs/HINT_PAWN.md.
 */
export function useSpaceBelowCard(
    contentRef: RefObject<HTMLElement | null>,
    cardFrameRef: RefObject<HTMLElement | null>,
    remeasureKey: unknown,
): number {
    const [space, setSpace] = useState(0);

    useLayoutEffect(() => {
        const measure = () => {
            const content = contentRef.current;
            const frame = cardFrameRef.current;
            if (!content || !frame || content.offsetHeight === 0) return;
            const contentRect = content.getBoundingClientRect();
            const scale = contentRect.height / content.offsetHeight || 1;
            const next = Math.max(0, Math.round((contentRect.bottom - frame.getBoundingClientRect().bottom) / scale));
            setSpace((prev) => (prev === next ? prev : next));
        };
        measure();
        // Once more after the next frame: an uncover can land mid-transition.
        const raf = requestAnimationFrame(measure);
        const ro = new ResizeObserver(measure);
        for (const el of [contentRef.current, cardFrameRef.current]) if (el) ro.observe(el);
        window.addEventListener("resize", measure);
        return () => {
            cancelAnimationFrame(raf);
            ro.disconnect();
            window.removeEventListener("resize", measure);
        };
    }, [contentRef, cardFrameRef, remeasureKey]);

    return space;
}
