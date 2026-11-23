import { useLayoutEffect, useRef, useState } from "react";
import { COLORS } from "../../../../theme";

/**
 * PawnBubbleTail — the hint pawn's speech-bubble tail: a short wedge on the bubble's
 * LEFT edge, angled to point at the pawn's head (docs/HINT_PAWN.md § "Layout and hit area").
 *
 * Why not the shared bubble's rotated-square tail: that one only points straight out of an
 * edge. The pawn's head sits up and to the left of the bubble (the bubble is held to the
 * space below the card, the head reaches up beside the card), so the tail has to lean.
 *
 * Drawn as a child of the bubble body (HintBubbleSurface `tailSide="custom"`), positioned
 * against the body's top-left corner. The head is given relative to an ANCHOR's bottom-left
 * corner (the bubble slot, `anchorSelector`): the body is centred vertically in that slot, so
 * where it sits moves with its own height and the slot's. Both are measured (ResizeObserver
 * on the body and the anchor) in LAYOUT px — offsetTop/clientHeight, which ignore transforms,
 * so neither the grow-in scale nor the dive camera skews the aim — to turn the head into a
 * direction from the base.
 *
 * The wedge's fill reaches 1px inside the body, over the body's 1px left border, between
 * its two base points (the border is hidden there), and its stroke runs only along the two
 * slanted sides (the path is left open), so tail and body read as one outline.
 *
 * Layer: flp page presentation (client).
 *
 * Depended on by: hintPawn/HintPawn.tsx.
 */

/** Base midpoint, px down from the body's top edge. Low enough that the tip stays below the card's clearance line. */
const BASE_FROM_TOP = 17;
/** Half the base's width along the edge, px. */
const BASE_HALF = 5;
/** Base-to-tip length, px (short: it must fit in the gap beside the stage). */
const LENGTH = 14;

interface PawnBubbleTailProps {
    /**
     * The pawn head's centre, px from the anchor's bottom-left corner (x right, y UP; x is
     * negative — left of the bubble). The body must span the anchor's left edge (width 100%).
     */
    head: { x: number; y: number };
    /** CSS selector for the anchor: the body's nearest ancestor matching it (the bubble slot). */
    anchorSelector: string;
}

/** The body's top edge, px down from the anchor's padding-box top, summed over offsetParents. */
function topWithin(el: HTMLElement, anchor: HTMLElement): number {
    let top = 0;
    let node: HTMLElement | null = el;
    while (node && node !== anchor) {
        top += node.offsetTop;
        node = node.offsetParent as HTMLElement | null;
    }
    return top;
}

export default function PawnBubbleTail({ head, anchorSelector }: PawnBubbleTailProps) {
    const ref = useRef<SVGSVGElement | null>(null);
    // The anchor's bottom, px down from the body's top (body coords, y down). 0 = unmeasured.
    const [anchorBottom, setAnchorBottom] = useState(0);

    useLayoutEffect(() => {
        const body = ref.current?.parentElement;
        const anchor = body?.closest<HTMLElement>(anchorSelector);
        if (!body || !anchor) return;
        const measure = () => {
            const next = anchor.clientHeight - topWithin(body, anchor);
            setAnchorBottom((prev) => (prev === next ? prev : next));
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(body);
        ro.observe(anchor);
        return () => ro.disconnect();
    }, [anchorSelector]);

    // Direction from the base midpoint (0, BASE_FROM_TOP) to the head, in body coords (y down).
    const headY = anchorBottom - head.y;
    const dx = head.x;
    const dy = headY - BASE_FROM_TOP;
    const dist = Math.hypot(dx, dy) || 1;
    const tipX = (dx / dist) * LENGTH;
    const tipY = BASE_FROM_TOP + (dy / dist) * LENGTH;
    // The svg's origin is the body's PADDING-box corner, so the 1px border occupies
    // x ∈ [-1, 0]. The outline's open ends sit on the border's outer edge (x = -1); the
    // fill reaches 1px further in (x = +1), so it paints over the whole border strip
    // between the base points and the body reads as one unbroken shape into the tail.
    const baseX = -1;
    const fillInnerX = 1;

    return (
        <svg
            ref={ref}
            className="pawn-bubble-tail"
            aria-hidden
            width={1}
            height={1}
            style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none", visibility: anchorBottom ? undefined : "hidden" }}
        >
            <path
                className="pawn-bubble-tail__fill"
                d={`M ${fillInnerX} ${BASE_FROM_TOP - BASE_HALF} L ${baseX} ${BASE_FROM_TOP - BASE_HALF} L ${tipX} ${tipY} L ${baseX} ${BASE_FROM_TOP + BASE_HALF} L ${fillInnerX} ${BASE_FROM_TOP + BASE_HALF} Z`}
                fill={COLORS.white}
                stroke="none"
            />
            <path
                className="pawn-bubble-tail__outline"
                d={`M ${baseX} ${BASE_FROM_TOP - BASE_HALF} L ${tipX} ${tipY} L ${baseX} ${BASE_FROM_TOP + BASE_HALF}`}
                fill="none"
                stroke={COLORS.border}
                strokeWidth={1}
                strokeLinejoin="round"
            />
        </svg>
    );
}
