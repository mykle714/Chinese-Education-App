import React, { useEffect, useRef } from "react";
import { Box } from "@mui/material";
import { CardFaceSide } from "../../card/CardFace";
import { CARD_FLY_OUT_MS, FLY_OUT_ROTATION, FLY_OUT_X } from "../../constants";
import { CARD_SURFACE } from "../../../../theme/surfaces";

/** A plain flp's back-card pose (FlashCardSection's back slot). The tower's lies flush. */
const PLAIN_BACK_CARD_SX = { transform: "scale(0.97)", opacity: 0.9 } as const;

function prefersReducedMotion(): boolean {
    return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The game break's card in the stack (docs/FLP_GAME_BREAKS.md § 5). A layer over the two
 * card slots rather than a third slot: the slots hold `VocabEntry`s and the break is never
 * one (§ 1).
 *
 *   due      — z 1, the back position: revealed as the last card is swiped off.
 *   title    — z 2, later in the DOM than the front slot, so it covers the next word card.
 *              A flying slot (z 3) still passes over it, and it takes every touch, so the
 *              word card under it can't be dragged.
 *   skipping — flies off that word card, which needs no swap to appear.
 *
 * It never takes a swipe: Skip and Play are the only ways on.
 *
 * Layer: feature component (features/flashcards). Rendered by FlashCardSection.
 */
const BreakCardLayer: React.FC<{
    hold: "due" | "title" | "skipping";
    towerStock: boolean;
    /** The front card is edge-on mid-flip: blank this face, as for a back word card. */
    contentHidden: boolean;
    onGone?: () => void;
    children: React.ReactNode;
}> = ({ hold, towerStock, contentHidden, onGone, children }) => {
    const layerRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (hold !== "skipping") return;
        const el = layerRef.current;
        if (!el || prefersReducedMotion() || typeof el.animate !== "function") {
            onGone?.();
            return;
        }
        const animation = el.animate(
            [
                { transform: "translate(0px, 0px) rotate(0deg)" },
                { transform: `translate(${FLY_OUT_X}px, 0px) rotate(${FLY_OUT_ROTATION}deg)` },
            ],
            { duration: CARD_FLY_OUT_MS, easing: "ease", fill: "forwards" },
        );
        // A cancelled flight (unmount mid-way) is still the end of the break.
        animation.finished.then(() => onGone?.(), () => onGone?.());
        // Once per Skip; `onGone` changes identity as the break's phase moves.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hold]);

    return (
        <Box
            ref={layerRef}
            className={`flp-break-card flp-break-card--${hold}`}
            sx={{
                position: "absolute",
                inset: 0,
                zIndex: hold === "due" ? 1 : 2,
                borderRadius: CARD_SURFACE.borderRadius,
                boxShadow: towerStock ? "none" : CARD_SURFACE.boxShadow,
                pointerEvents: hold === "title" ? "auto" : "none",
                ...(hold === "due" && !towerStock && PLAIN_BACK_CARD_SX),
            }}
        >
            <CardFaceSide
                rotated={false}
                contentGap={1}
                showIcon={false}
                inert={false}
                contentHidden={contentHidden}
                towerStock={towerStock}
                fill={children}
            />
        </Box>
    );
};

export default BreakCardLayer;
