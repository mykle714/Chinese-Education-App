import { useState, useLayoutEffect, type RefObject } from "react";
import { CARD_EDIT_ANIM_MS } from "./CardEditToolbar";

/**
 * The vertical translation currently applied to the toolbar wrapper (MUI's <Slide> animates
 * the toolbar in with a transform). Returns 0 for an untransformed element, and for any
 * browser/value the matrix parser can't read — measurements then simply fall back to the
 * as-drawn position, which is what they used to be.
 */
function slideOffsetY(el: HTMLElement): number {
    const t = getComputedStyle(el).transform;
    if (!t || t === "none") return 0;
    try {
        return new DOMMatrixReadOnly(t).m42;
    } catch {
        return 0;
    }
}

// Breathing room (px) required between the advanced toolbar's bottom edge and the top of what
// it has to clear — so the card clears the toolbar rather than kissing it.
const OVERLAP_GAP = 8;

/**
 * useToolbarInset — how many EXTRA px a surface must reserve at the top for the advanced-edit
 * toolbar. Shared by both fie surfaces: the flp (`FlashcardsLearnPage`, where the reservation
 * is the card slot's top padding) and the cdp (`VocabCardDetailPage`, where it is the content
 * column's). See docs/CARD_ICON_LAYOUT.md.
 *
 * The toolbar is an absolute overlay at the top of its page's `ContentArea`, so it takes no
 * flow height; without a reservation it paints over whatever is beneath it. Rather than MOVING
 * the content by a fixed amount, we shrink the box from the top by exactly the amount the
 * toolbar intrudes and let the surface's ordinary layout re-place its contents. Consequences:
 *
 *  - **Zero when the toolbar already clears the target** — on a roomy viewport the toolbar
 *    sits in whitespace nothing was using, so nothing moves at all.
 *  - **Only ever as much as the intrusion** — content is not slammed downward by a fixed
 *    toolbar height; it settles wherever the reduced box puts it.
 *
 * @param enabled       only measure while advanced edit mode is active
 * @param targetRef     the box the toolbar must clear (flp: the card slot; cdp: the hero card)
 * @param toolbarRef    the advanced toolbar wrapper (absolute at ContentArea top:0)
 * @param targetTopPad  px inside the target, above the content that must be cleared (flp: the
 *                      card slot's top padding; cdp: 0, the hero card IS the content)
 * @param clearSelector optional CSS selector for the PART of the toolbar whose bottom edge has
 *                      to be cleared, instead of the whole toolbar. The cdp passes
 *                      `.card-edit-toolbar__row` (the primary row): the column reserves the
 *                      basic toolbar's band, and the advanced rows below it are then MEANT to
 *                      land on the word-tools rail rather than push the page down a second
 *                      time. Because the toolbar is anchored at its top, that row's bottom
 *                      edge doesn't move when the advanced menu opens — so the reservation is
 *                      the same in both modes and nothing shifts on the adv toggle.
 *
 * Both callers measure a box whose OWN top edge is fixed (the reservation is padding inside it),
 * so a measurement never sees the shift it caused and the hook cannot chase its own output. Any
 * future caller that pads something ABOVE its target has to subtract the applied inset itself.
 */
export function useToolbarInset(
    enabled: boolean,
    targetRef: RefObject<HTMLElement | null>,
    toolbarRef: RefObject<HTMLElement | null>,
    targetTopPad = 0,
    clearSelector?: string,
): number {
    const [inset, setInset] = useState(0);

    useLayoutEffect(() => {
        if (!enabled) {
            setInset(0);
            return;
        }
        const measure = () => {
            const target = targetRef.current;
            const toolbar = toolbarRef.current;
            if (!target || !toolbar) return;
            // The band to clear: either the whole toolbar or just the named part of it.
            const clearEl = clearSelector
                ? toolbar.querySelector<HTMLElement>(clearSelector) ?? toolbar
                : toolbar;
            const s = target.getBoundingClientRect();
            // Rects INCLUDE transforms, and the toolbar enters under a <Slide> — so during the
            // entry animation the measured bottom is somewhere above its resting place, and a
            // reservation computed from it would be too small (then corrected a beat later by
            // the settle timer, making the content visibly lurch after the toolbar landed).
            // Read the wrapper's live translateY and subtract it, so every measurement — including
            // the first, taken mid-slide — describes the toolbar AT REST.
            const t = clearEl.getBoundingClientRect();
            const slideY = slideOffsetY(toolbar);
            // Top of what must be cleared. `s.top` is the target's own (fixed) top edge, so this
            // is unaffected by the reservation currently applied inside it.
            const contentTop = s.top + targetTopPad;
            setInset(Math.max(0, Math.round(t.bottom - slideY + OVERLAP_GAP - contentTop)));
        };
        measure();

        // Re-measure whenever the geometry that feeds the decision changes: the target resizes
        // (viewport) or the toolbar's height changes (advanced-menu Collapse reveal / row
        // wrapping). The CARD is deliberately not observed — it is an OUTPUT of the inset, not
        // an input, so observing it would be the one path back to oscillation.
        const ro = new ResizeObserver(measure);
        const targetEl = targetRef.current;
        const toolbarEl = toolbarRef.current;
        if (targetEl) ro.observe(targetEl);
        if (toolbarEl) ro.observe(toolbarEl);
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
        // targetRef/toolbarRef are stable ref objects; `enabled` and `targetTopPad` are the real
        // triggers (a viewport change re-pads the slot, which moves its content-box top).
    }, [enabled, targetRef, toolbarRef, targetTopPad, clearSelector]);

    return inset;
}
