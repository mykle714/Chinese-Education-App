import React, { useCallback, useEffect, useRef } from "react";
import { Box } from "@mui/material";
import { CardFaceSide } from "../../card/CardFace";
import { CARD_DISMISS_THRESHOLD_VW, CARD_FLY_OUT_MS, FLY_OUT_ROTATION, FLY_OUT_X } from "../../constants";
import { CARD_SURFACE } from "../../../../theme/surfaces";
import { useSwipeCommit, type SwipeDirection } from "../../../../hooks/useSwipeCommit";
import { cardThrowSteps } from "../cardThrow";

/** The results card springing back from a swipe that didn't commit. */
const SNAP_BACK_TRANSITION = `transform ${CARD_FLY_OUT_MS / 2}ms ease`;

function prefersReducedMotion(): boolean {
    return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** The card's pose `dx` along a swipe; the tilt reaches FLY_OUT_ROTATION at FLY_OUT_X. */
function swipePose(dx: number): string {
    return `translate(${dx}px, 0px) rotate(${(dx / FLY_OUT_X) * FLY_OUT_ROTATION}deg)`;
}

/**
 * The game break's card in the stack (docs/FLP_GAME_BREAKS.md § 5). A layer over the two
 * card slots rather than a third slot: the slots hold `VocabEntry`s and the break is never
 * one (§ 1).
 *
 *   due       — z 1, the back position: revealed as the last card is swiped off.
 *   title     — z 2, later in the DOM than the front slot, so it covers the next word card.
 *               A flying slot (z 3) still passes over it, and it takes every touch, so the
 *               word card under it can't be dragged.
 *   skipping  — flies off that word card, which needs no swap to appear.
 *   growing   — stays put under the circle growing over it (GameBreakArea), so it goes when
 *               it is covered rather than the moment Play is tapped.
 *   shrinking — back under the closing circle, now showing the run's results. It takes every
 *               touch, as `title` does, but acts on none until `results`.
 *   results   — a swipe either way flies it off from there, and a tap throws it off, the
 *               writing flp's "grab and throw" (cardThrow.ts). No mark, no undo: this card
 *               was never a word.
 *
 * The title card never takes a swipe: Skip and Play are its only ways on.
 *
 * Layer: feature component (features/flashcards). Rendered by FlashCardSection.
 */
const BreakCardLayer: React.FC<{
    hold: "due" | "title" | "skipping" | "growing" | "shrinking" | "results";
    /** The front card is edge-on mid-flip: blank this face, as for a back word card. */
    contentHidden: boolean;
    onGone?: () => void;
    /** The results card was swiped or tapped off: the parent moves the hold on to `skipping`. */
    onSwiped?: () => void;
    children: React.ReactNode;
}> = ({ hold, contentHidden, onGone, onSwiped, children }) => {
    const layerRef = useRef<HTMLDivElement | null>(null);
    // Where a swipe let go, so the fly-off carries on from there. Skip starts at rest.
    const releaseRef = useRef<{ dx: number; direction: SwipeDirection } | null>(null);
    // The results card was tapped, so it throws instead of flying straight.
    const tappedRef = useRef(false);

    // Imperative `paint`, not state: `children` is one memoized element, and a drag needn't
    // re-render the stack. The release paint leaves a committing card where it is, for the
    // fly-off below to pick up.
    const paint = useCallback((card: HTMLElement, dx: number | null, commit?: SwipeDirection) => {
        if (dx !== null) {
            card.style.transition = "none";
            card.style.transform = swipePose(dx);
        } else if (!commit) {
            card.style.transition = SNAP_BACK_TRANSITION;
            card.style.transform = "";
        }
    }, []);
    const { handlers: swipeHandlers, wasDrag } = useSwipeCommit({
        axisLock: false,
        threshold: () => CARD_DISMISS_THRESHOLD_VW * (layerRef.current?.offsetWidth ?? window.innerWidth),
        disabled: hold !== "results",
        paint,
        onCommit: (_id, direction, release) => {
            releaseRef.current = { dx: release.dx, direction };
            onSwiped?.();
        },
    });

    useEffect(() => {
        if (hold !== "skipping") return;
        const el = layerRef.current;
        if (!el || prefersReducedMotion() || typeof el.animate !== "function") {
            onGone?.();
            return;
        }
        const release = releaseRef.current;
        const animation = el.animate(
            // A throw's easing is per segment, on its steps.
            tappedRef.current
                ? cardThrowSteps(1).map((step) => ({ ...step }))
                : [
                    { transform: swipePose(release?.dx ?? 0) },
                    { transform: swipePose(release?.direction === "left" ? -FLY_OUT_X : FLY_OUT_X) },
                ],
            { duration: CARD_FLY_OUT_MS, easing: tappedRef.current ? "linear" : "ease", fill: "forwards" },
        );
        // A cancelled flight (unmount mid-way) is still the end of the break.
        animation.finished.then(() => onGone?.(), () => onGone?.());
        // Once per fly-off; `onGone` changes identity as the break's phase moves.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hold]);

    return (
        <Box
            ref={layerRef}
            className={`flp-break-card flp-break-card--${hold}`}
            data-swipe-id="break-card"
            {...swipeHandlers}
            onClick={() => {
                // A drag that sprang back ends in a click too, on the captured card.
                if (hold !== "results" || wasDrag()) return;
                tappedRef.current = true;
                onSwiped?.();
            }}
            sx={{
                position: "absolute",
                inset: 0,
                zIndex: hold === "due" ? 1 : 2,
                borderRadius: CARD_SURFACE.borderRadius,
                // On the tower's card stock: no drop shadow, it lies flush on the deck (a `due`
                // card lies flush under the front one too, like any back card).
                boxShadow: "none",
                // `shrinking` takes touches and does nothing with them (the swipe and the tap
                // both wait for `results`). The game area has stopped taking input by then,
                // so without this a learner reaching for the results card as the circle
                // closes reaches the next word card under it: a tap flips it unseen, a swipe
                // then marks it, and it flies (z 3) over this card in its green wash.
                pointerEvents: hold === "title" || hold === "shrinking" || hold === "results" ? "auto" : "none",
                touchAction: "none",
            }}
        >
            <CardFaceSide
                rotated={false}
                contentGap={1}
                showIcon={false}
                inert={false}
                contentHidden={contentHidden}
                fill={children}
            />
        </Box>
    );
};

export default BreakCardLayer;
