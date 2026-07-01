import { useState, useLayoutEffect, type RefObject } from "react";
import { CARD_SLOT_TOP_PAD, CARD_SLOT_VPAD_SUM } from "./styled";
import { CARD_EDIT_ANIM_MS } from "./CardEditToolbar";

// Breathing room (px) required between the advanced toolbar's bottom edge and the card's top
// before we consider them "overlapping" — so we push slightly BEFORE they literally touch.
const OVERLAP_GAP = 8;

/**
 * useToolbarOverlap — decides whether the advanced-edit card push-down is actually needed.
 *
 * The push-down (see `DraggableCardContainer.pushDown`) slides the card down to clear the
 * three-row advanced toolbar. On large viewports the card is small relative to the screen, so
 * the toolbar sits comfortably above it and no shift is needed; we only want to push when the
 * toolbar would otherwise overlap the card.
 *
 * We compare the toolbar's bottom edge against where the card's TOP would sit in its
 * NON-pushed (vertically centered) layout. The key that makes this stable (no oscillation): the
 * card's on-screen size is INVARIANT to the push (the fie size guarantee — see
 * docs/CARD_ICON_LAYOUT.md), so the card's measured height equals its centered-layout height
 * whether or not it is currently pushed. The centered top is therefore derived purely from the
 * ContentArea box + that invariant height, and does NOT move when `overlaps` flips — so pushing
 * the card can never feed back and un-trigger itself.
 *
 * Geometry: the card slot fills `ContentArea`; the card centers inside the slot's content box
 * (ContentArea height minus the constant vertical padding), offset from the top by the top pad.
 *
 * @param enabled     only measure while advanced edit mode is active
 * @param contentRef  the ContentArea element (the card slot's containing block)
 * @param toolbarRef  the advanced toolbar wrapper (absolute at ContentArea top:0)
 * @param cardRef     the rendered card element (its height is the push-invariant card height)
 */
export function useToolbarOverlap(
    enabled: boolean,
    contentRef: RefObject<HTMLElement | null>,
    toolbarRef: RefObject<HTMLElement | null>,
    cardRef: RefObject<HTMLElement | null>,
): boolean {
    const [overlaps, setOverlaps] = useState(false);

    useLayoutEffect(() => {
        if (!enabled) {
            setOverlaps(false);
            return;
        }
        const measure = () => {
            const content = contentRef.current;
            const toolbar = toolbarRef.current;
            const card = cardRef.current;
            if (!content || !toolbar || !card) return;
            const c = content.getBoundingClientRect();
            const t = toolbar.getBoundingClientRect();
            const cardH = card.getBoundingClientRect().height; // invariant to the push
            // Card top in the centered (non-pushed) layout, in screen coords.
            const freeSpace = Math.max(0, c.height - CARD_SLOT_VPAD_SUM - cardH);
            const centeredCardTop = c.top + CARD_SLOT_TOP_PAD + freeSpace / 2;
            setOverlaps(t.bottom + OVERLAP_GAP > centeredCardTop);
        };
        measure();

        // Re-measure whenever the layout that feeds the decision changes: the ContentArea
        // resizes (viewport), the toolbar's height changes (advanced-menu Collapse reveal /
        // wrapping), or the card resizes. The card MOVING (the push itself) changes neither
        // element's size, so this observer never re-fires from the push — no oscillation.
        const ro = new ResizeObserver(measure);
        const contentEl = contentRef.current;
        const toolbarEl = toolbarRef.current;
        const cardEl = cardRef.current;
        if (contentEl) ro.observe(contentEl);
        if (toolbarEl) ro.observe(toolbarEl);
        if (cardEl) ro.observe(cardEl);
        window.addEventListener("resize", measure);

        // The toolbar reveals via <Slide> (a transform) as well as the advanced-menu <Collapse>
        // (a height change). ResizeObserver catches the height change but NOT the transform
        // settling, so re-measure once the entry animation finishes to lock in the toolbar's
        // final resting position.
        const settleTimer = window.setTimeout(measure, CARD_EDIT_ANIM_MS + 60);

        return () => {
            ro.disconnect();
            window.removeEventListener("resize", measure);
            window.clearTimeout(settleTimer);
        };
        // contentRef/toolbarRef/cardRef are stable ref objects; `enabled` is the real trigger.
    }, [enabled, contentRef, toolbarRef, cardRef]);

    return overlaps;
}
