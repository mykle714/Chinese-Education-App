import { useState, useLayoutEffect, type RefObject } from "react";
import type { CardSlotPadding } from "./styled";
import { CARD_EDIT_ANIM_MS } from "../../../cardIcons/editor/CardEditToolbar";

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
 * slot box + that invariant height, and does NOT move when `overlaps` flips — so pushing
 * the card can never feed back and un-trigger itself.
 *
 * Geometry: the card centers inside the SLOT's content box (slot height minus its vertical
 * padding), offset from the slot's top by the top pad. We measure the slot itself rather than
 * ContentArea because the word-tools rail sits above it — ContentArea's top is not the slot's.
 *
 * @param enabled     only measure while advanced edit mode is active
 * @param slotRef     the card slot (the card's containing block)
 * @param toolbarRef  the advanced toolbar wrapper (absolute at ContentArea top:0)
 * @param cardRef     the rendered card element (its height is the push-invariant card height)
 * @param pad         the slot's current vertical padding (useCardSlotPadding) — the same
 *                    numbers the slot is actually styled with, so the two can't disagree
 */
export function useToolbarOverlap(
    enabled: boolean,
    slotRef: RefObject<HTMLElement | null>,
    toolbarRef: RefObject<HTMLElement | null>,
    cardRef: RefObject<HTMLElement | null>,
    pad: CardSlotPadding,
): boolean {
    const [overlaps, setOverlaps] = useState(false);

    useLayoutEffect(() => {
        if (!enabled) {
            setOverlaps(false);
            return;
        }
        const measure = () => {
            const slot = slotRef.current;
            const toolbar = toolbarRef.current;
            const card = cardRef.current;
            if (!slot || !toolbar || !card) return;
            const s = slot.getBoundingClientRect();
            const t = toolbar.getBoundingClientRect();
            const cardH = card.getBoundingClientRect().height; // invariant to the push
            // Card top in the centered (non-pushed) layout, in screen coords.
            const freeSpace = Math.max(0, s.height - pad.sum - cardH);
            const centeredCardTop = s.top + pad.top + freeSpace / 2;
            setOverlaps(t.bottom + OVERLAP_GAP > centeredCardTop);
        };
        measure();

        // Re-measure whenever the layout that feeds the decision changes: the ContentArea
        // resizes (viewport), the toolbar's height changes (advanced-menu Collapse reveal /
        // wrapping), or the card resizes. The card MOVING (the push itself) changes neither
        // element's size, so this observer never re-fires from the push — no oscillation.
        const ro = new ResizeObserver(measure);
        const slotEl = slotRef.current;
        const toolbarEl = toolbarRef.current;
        const cardEl = cardRef.current;
        if (slotEl) ro.observe(slotEl);
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
        // slotRef/toolbarRef/cardRef are stable ref objects; `enabled` and `pad` are the
        // real triggers (a viewport change re-pads the slot, which moves the centered top).
    }, [enabled, slotRef, toolbarRef, cardRef, pad]);

    return overlaps;
}
