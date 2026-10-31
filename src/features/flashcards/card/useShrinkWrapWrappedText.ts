import React from "react";

/**
 * Shrink-wraps a WRAPPED text element to the narrowest width that keeps its line count.
 *
 * ── Why ───────────────────────────────────────────────────────────────────────────────
 * CSS cannot shrink-wrap wrapped text: once a gloss breaks onto two lines its box stays
 * as wide as the space it was given, not as wide as its longest line. On the card face
 * (`CardFace.EnglishBlock`) the sense chip sits against that box, so without this it would
 * sit beside empty width rather than beside the text. Giving the text an explicit width
 * equal to its wrapped content width makes the text row hug the lines.
 *
 * ── How ───────────────────────────────────────────────────────────────────────────────
 * Clear the width, read the natural wrap's height, and if it is more than one line, binary
 * search the smallest width with the same height. Uses `offsetWidth`/`offsetHeight` only
 * (layout values), never `getBoundingClientRect` — the card faces are rotateY-flipped,
 * scaled and rotated, and client rects would measure those transforms rather than layout.
 * Searching on height instead of reading line boxes means the result is also BALANCED
 * (lines as even as the line count allows), the same effect as `text-wrap: balance`.
 *
 * Re-measures when `text` changes, when the observed container resizes, and once the
 * web fonts have loaded (a late font changes line widths without resizing anything).
 * Single-line text is left untouched (inline width cleared), so this is a no-op whenever
 * the gloss fits — including the `width: max-content` movable-text back face.
 *
 * The width is written imperatively to `style.width` (not React state) so the search does
 * not render; the element must therefore NOT get `width` from props/sx.
 *
 * Referenced by docs/CARD_ICON_LAYOUT.md ("Movable text" → EnglishBlock grid) and
 * docs/DEFINITION_CLUSTERS.md (sense-picker "Layout on the card face").
 */
export function useShrinkWrapWrappedText(
    textRef: React.RefObject<HTMLElement | null>,
    containerRef: React.RefObject<HTMLElement | null>,
    text: string,
): void {
    React.useLayoutEffect(() => {
        const textEl = textRef.current;
        const containerEl = containerRef.current;
        if (!textEl || !containerEl) return;

        // Last container width we measured at — the ResizeObserver also fires for height
        // changes, which cannot change the wrap, so those are skipped.
        let lastContainerWidth = -1;

        const measure = () => {
            textEl.style.width = '';
            const naturalWidth = textEl.offsetWidth;
            const naturalHeight = textEl.offsetHeight;
            // Hidden (display:none ancestor) or not laid out yet → nothing to measure.
            if (naturalWidth === 0 || naturalHeight === 0) return;
            const lineHeight = parseFloat(getComputedStyle(textEl).lineHeight);
            // Single line → leave the natural (centered) layout alone.
            if (!Number.isFinite(lineHeight) || naturalHeight < lineHeight * 1.5) return;

            // Smallest integer width whose height does not grow (i.e. no extra line).
            // `hi` always satisfies the invariant; `lo` never does.
            let lo = 0;
            let hi = Math.ceil(naturalWidth);
            while (hi - lo > 1) {
                const mid = (lo + hi) >> 1;
                textEl.style.width = `${mid}px`;
                if (textEl.offsetHeight <= naturalHeight) hi = mid;
                else lo = mid;
            }
            textEl.style.width = `${hi}px`;
        };

        measure();
        lastContainerWidth = containerEl.offsetWidth;

        const observer = new ResizeObserver(() => {
            const width = containerEl.offsetWidth;
            if (width === lastContainerWidth) return;
            lastContainerWidth = width;
            measure();
        });
        observer.observe(containerEl);

        let cancelled = false;
        document.fonts?.ready
            .then(() => { if (!cancelled) measure(); })
            .catch(() => { /* font loading failure leaves the last measurement in place */ });

        return () => {
            cancelled = true;
            observer.disconnect();
            textEl.style.width = '';
        };
    }, [textRef, containerRef, text]);
}
