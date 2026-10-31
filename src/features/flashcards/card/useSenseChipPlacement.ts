import React from "react";

/**
 * Places the sense chip around an already-centered gloss.
 *
 * The chip takes no part in the gloss's layout: `CardFace.EnglishBlock` positions it
 * absolutely against the text row, so the gloss centers and wraps as if the chip did not
 * exist. This hook then picks one of two spots, written to the chip's `data-placement`:
 *
 *   "right" — beside the gloss, when the chip fits before the card's content boundary.
 *   "below" — centered under the gloss otherwise.
 *
 * The boundary is `.card-face__panel-bounds` (CardFaceSide): the printed panel on Deck Tower
 * stock, the whole face elsewhere. Hosts with no card face use the block's own width.
 *
 * "below" can run past the panel's bottom, because the default back-face gloss sits low on
 * the card and grows downward. Only then is the text row lifted by the overrun: the chip has
 * to stay tappable, and the gap under the foreign word has room for it.
 *
 * Everything is written imperatively, so a measurement never re-renders the card. Horizontal
 * values use layout metrics, unaffected by the face's rotateY flip. The vertical overrun uses
 * client rects, which rotateY leaves unchanged at rest. A text block's own rotation is not
 * accounted for; the face's clip remains the backstop there.
 *
 * Referenced by docs/CARD_ICON_LAYOUT.md ("Movable text") and docs/DEFINITION_CLUSTERS.md
 * (sense-picker "Layout on the card face").
 */

/** Whether a chip fits between a gloss and the right boundary. All values are face px;
 *  `scale` is the text block's font scale, which also scales the gloss, gap and chip. */
export function senseChipFitsRight(args: {
    centerX: number;
    textWidth: number;
    chipWidth: number;
    gap: number;
    scale: number;
    boundaryRight: number;
}): boolean {
    const { centerX, textWidth, chipWidth, gap, scale, boundaryRight } = args;
    return centerX + scale * (textWidth / 2 + gap + chipWidth) <= boundaryRight;
}

/** A movable text block's scale, read from its transform (1 when it has none). */
function blockScale(block: HTMLElement | null): number {
    if (!block || typeof DOMMatrixReadOnly === "undefined") return 1;
    const transform = getComputedStyle(block).transform;
    if (!transform || transform === "none") return 1;
    const matrix = new DOMMatrixReadOnly(transform);
    return Math.hypot(matrix.a, matrix.b) || 1;
}

export function useSenseChipPlacement(
    textRef: React.RefObject<HTMLElement | null>,
    rowRef: React.RefObject<HTMLElement | null>,
    chipRef: React.RefObject<HTMLElement | null>,
    containerRef: React.RefObject<HTMLElement | null>,
    gap: number,
): void {
    const measure = React.useCallback(() => {
        const textEl = textRef.current;
        const rowEl = rowRef.current;
        const chipEl = chipRef.current;
        const containerEl = containerRef.current;
        if (!textEl || !rowEl || !chipEl || !containerEl) return;

        const textWidth = textEl.offsetWidth;
        const chipWidth = chipEl.offsetWidth;
        // Not laid out yet: the ResizeObserver re-runs this once it is.
        if (textWidth === 0 || chipWidth === 0) return;

        const face = containerEl.closest<HTMLElement>(".card-face");
        const panel = face?.querySelector<HTMLElement>(":scope > .card-face__panel-bounds") ?? null;
        // The two surfaces that position a movable block at its center; both set `left`.
        const block = containerEl.closest<HTMLElement>(".mobile-demo-flashcard-text-block, .card-icon-canvas__text");
        const blockLeft = block ? parseFloat(getComputedStyle(block).left) : NaN;

        const boundaryLeft = panel?.offsetLeft ?? 0;
        const boundaryWidth = panel?.offsetWidth ?? containerEl.offsetWidth;
        const centerX = Number.isFinite(blockLeft) ? blockLeft : boundaryLeft + boundaryWidth / 2;
        const scale = blockScale(block);

        const fitsRight = senseChipFitsRight({
            centerX,
            textWidth,
            chipWidth,
            gap,
            scale,
            boundaryRight: boundaryLeft + boundaryWidth,
        });
        chipEl.dataset.placement = fitsRight ? "right" : "below";

        // Measured unlifted, so a previous lift can't feed into this one.
        rowEl.style.transform = "";
        if (fitsRight || !panel) return;
        const panelRect = panel.getBoundingClientRect();
        const overrun = chipEl.getBoundingClientRect().bottom - panelRect.bottom;
        if (overrun <= 0 || panel.offsetHeight === 0) return;
        // Screen px → the row's own px: undo the camera's scale and the block's.
        const screenScale = panelRect.height / panel.offsetHeight;
        rowEl.style.transform = `translateY(${-overrun / (screenScale * scale)}px)`;
    }, [textRef, rowRef, chipRef, containerRef, gap]);

    // Every render, so a fie drag (which moves the block without resizing it) re-decides.
    React.useLayoutEffect(measure);

    // The gloss's width also changes outside a render: useShrinkWrapWrappedText re-measures
    // on font load and on container resize.
    React.useLayoutEffect(() => {
        const observer = new ResizeObserver(() => measure());
        [textRef.current, chipRef.current, containerRef.current].forEach((el) => {
            if (el) observer.observe(el);
        });
        return () => observer.disconnect();
    }, [measure, textRef, chipRef, containerRef]);
}
