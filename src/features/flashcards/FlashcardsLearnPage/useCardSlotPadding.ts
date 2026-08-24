import { useLayoutEffect, useState, type RefObject } from "react";
import { cardSlotPadding, CARD_SLOT_BOTTOM_INSET_FALLBACK, type CardSlotPadding } from "./styled";

/**
 * useCardSlotPadding — measures the flp card slot and the eip affordance sitting at the
 * bottom of ContentArea (the More Info pill), and returns the slot's vertical padding.
 *
 * Why measured rather than hard-coded: the padding has to RESERVE the affordance's band so
 * a height-bound card stops above it instead of clipping into it (see `cardSlotPadding` in
 * styled.ts). Hard-coding that band means a second copy of the pill's `bottom` + height that
 * silently rots the next time the pill's padding or font changes; measuring it cannot drift.
 *
 * Geometry note — we use `offsetTop`/`offsetHeight`/`clientHeight`, NOT
 * `getBoundingClientRect()`. The pill carries a pulse animation that translates it ±4px, and
 * rects include transforms: reading a rect would sample a random animation frame and feed a
 * jittering reservation into the card's size. The offset properties are layout-based and so
 * ignore the transform entirely.
 *
 * No feedback loop: the slot's height comes from the ContentArea flex layout and the
 * affordance is absolutely positioned, so neither one moves when the padding this hook
 * returns changes.
 *
 * @param slotRef       the card slot (FlashCardSection's outer flex:1 Box)
 * @param contentRef    ContentArea — the affordance's offsetParent
 * @param affordanceRef the More Info pill (null on a surface that has none)
 */
export function useCardSlotPadding(
    slotRef: RefObject<HTMLElement | null>,
    contentRef: RefObject<HTMLElement | null>,
    affordanceRef: RefObject<HTMLElement | null>,
): CardSlotPadding {
    const [pad, setPad] = useState<CardSlotPadding>(() => cardSlotPadding(0));

    useLayoutEffect(() => {
        const measure = () => {
            const slot = slotRef.current;
            const content = contentRef.current;
            const affordance = affordanceRef.current;
            if (!slot || !content) return;
            // The band from the affordance's top edge down to the bottom of ContentArea —
            // its own height PLUS its offset from the bottom, in one subtraction.
            const inset = affordance
                ? Math.max(0, content.clientHeight - affordance.offsetTop)
                : CARD_SLOT_BOTTOM_INSET_FALLBACK;
            const next = cardSlotPadding(slot.offsetHeight, inset);
            // Identity-stable when nothing changed, so this never re-renders the card stack
            // on an incidental resize notification.
            setPad((prev) => (prev.top === next.top && prev.bottom === next.bottom ? prev : next));
        };
        measure();

        const ro = new ResizeObserver(measure);
        for (const el of [slotRef.current, contentRef.current, affordanceRef.current]) {
            if (el) ro.observe(el);
        }
        // Rotation / browser-chrome changes can alter the slot height without any observed
        // element resizing on some mobile browsers, so keep the window listener too.
        window.addEventListener("resize", measure);
        return () => {
            ro.disconnect();
            window.removeEventListener("resize", measure);
        };
        // All three are stable ref objects — this effect is mount-scoped.
    }, [slotRef, contentRef, affordanceRef]);

    return pad;
}

export default useCardSlotPadding;
