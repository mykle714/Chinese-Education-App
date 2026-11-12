import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, ButtonBase, Typography } from "@mui/material";
import { CardFaceSide } from "../card/CardFace";
import DelayedCircularProgress from "../../../components/DelayedCircularProgress";
import { CARD_DISMISS_THRESHOLD_VW, CARD_FLY_OUT_MS, FLY_OUT_X } from "../constants";
import { CARD_SURFACE } from "../../../theme/surfaces";
import { COLORS, RAMP } from "../../../theme/colors";
import { LEADING, SIZE, WEIGHT } from "../../../theme/scale";
import { LEARNING_HUE } from "../../../utils/categoryColors";
import { useSwipeCommit, type SwipeDirection } from "../../../hooks/useSwipeCommit";
import { cardThrowSteps, swipePose } from "./cardThrow";
import { hueTones, plateButtonSx } from "./gameBreak/interimCardPlate";

/**
 * Which interim card is on the stack once the learner's own off-cooldown cards are spent
 * (docs/DECK_TOWER.md § "Running out of ready cards"):
 *
 *   pending — the session's lend switch has just come on and the re-deal is in flight, so
 *          it is not yet known whether lent words are coming (`lend`) or nothing is
 *          (`done`). A blank card, with a spinner only if the deal is slow.
 *   lend — "You're out of ready cards": the session's lend switch has just come on and
 *          the loop under this card is lent words. "Got it!", a tap or a swipe sends it
 *          off and study carries on.
 *   done — "Done for the day": nothing more to deal (a focused world, which never lends,
 *          or a dictionary with nothing left to lend). It stays put; the learner leaves
 *          with Back or a tap off the card.
 */
export type ReadyOutKind = "pending" | "lend" | "done";

/** Copy per worded kind. Kept here, with the face, so the doc can cite one place. */
const COPY: Record<Exclude<ReadyOutKind, "pending">, { title: string; body: string }> = {
    lend: {
        title: "You're out of ready cards",
        body: "From here on we'll show you words you haven't added yet.",
    },
    done: {
        title: "Done for the day",
        body: "Every card you have is resting. Tap outside the card to leave.",
    },
};

/** Clear space between the panel's edge and the card's content (GameBreakCard's PANEL_PAD). */
const PANEL_PAD = "calc(var(--card-stock-inset, 0px) + 16px)";
/** The snap-back of a swipe that didn't commit (BreakCardLayer's). */
const SNAP_BACK_TRANSITION = `transform ${CARD_FLY_OUT_MS / 2}ms ease`;

function prefersReducedMotion(): boolean {
    return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * ReadyOutCardLayer — the flp's out-of-ready-cards card, a layer OVER the two word-card
 * slots (like the game break's card, BreakCardLayer): the slots hold `VocabEntry`s and
 * this card is never a word. It is drawn in the same card stock, so it reads as one of
 * the deck's cards, and it marks nothing: no mark, no undo, no tower count.
 *
 * `lend`: takes every touch over the stack (the lent card under it cannot be dragged
 * while it is up). A swipe either way flies it off from where the finger let go; a tap
 * anywhere on it — "Got it!" included — throws it off (cardThrow.ts). `onGone` fires
 * when the flight ends.
 * `done` and `pending`: static. Taps on them do nothing, so the flp's tap-off-the-card
 * Back still works around them (FlashcardsLearnPage → `handleTowerOffCardTap`).
 *
 * Layer: feature component (features/flashcards). Rendered by FlashCardSection; the kind
 * is decided by FlashcardsLearnPage (§ "Running out of ready cards").
 * Docs: docs/DECK_TOWER.md § "Running out of ready cards".
 */
const ReadyOutCardLayer: React.FC<{
    kind: ReadyOutKind;
    /** The `lend` card has finished flying off. */
    onGone: () => void;
}> = ({ kind, onGone }) => {
    const layerRef = useRef<HTMLDivElement | null>(null);
    // Set once the card is on its way: a second tap or swipe mid-flight does nothing.
    const [leaving, setLeaving] = useState<null | { dx: number; direction: SwipeDirection } | "thrown">(null);

    // Imperative paint during the drag, as BreakCardLayer does: a drag needn't re-render.
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
        disabled: kind !== "lend" || leaving !== null,
        paint,
        onCommit: (_id, direction, release) => setLeaving({ dx: release.dx, direction }),
    });

    // The fly-off: from the release point for a swipe, the grab-and-throw for a tap.
    useEffect(() => {
        if (leaving === null) return;
        const el = layerRef.current;
        if (!el || prefersReducedMotion() || typeof el.animate !== "function") {
            onGone();
            return;
        }
        const thrown = leaving === "thrown";
        const animation = el.animate(
            thrown
                ? cardThrowSteps(1).map((step) => ({ ...step }))
                : [
                    { transform: swipePose(leaving.dx) },
                    { transform: swipePose(leaving.direction === "left" ? -FLY_OUT_X : FLY_OUT_X) },
                ],
            { duration: CARD_FLY_OUT_MS, easing: thrown ? "linear" : "ease", fill: "forwards" },
        );
        // A cancelled flight (unmount mid-way) still ends the card.
        animation.finished.then(onGone, onGone);
        // Once per departure; `onGone` is stable on the page side.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [leaving]);

    const throwOff = () => {
        // A drag that sprang back ends in a click too.
        if (kind !== "lend" || leaving !== null || wasDrag()) return;
        setLeaving("thrown");
    };

    const copy = kind === "pending" ? null : COPY[kind];
    return (
        <Box
            ref={layerRef}
            className={`flp-ready-out-card flp-ready-out-card--${kind}`}
            data-swipe-id="ready-out-card"
            {...(kind === "lend" ? swipeHandlers : {})}
            onClick={throwOff}
            sx={{
                position: "absolute",
                inset: 0,
                // Over both word slots and a flying one (z 3): it is the top card.
                zIndex: 4,
                borderRadius: CARD_SURFACE.borderRadius,
                // Tower card stock: no drop shadow, it lies flush on the deck.
                boxShadow: "none",
                pointerEvents: "auto",
                touchAction: "none",
            }}
        >
            <CardFaceSide
                rotated={false}
                contentGap={1}
                showIcon={false}
                inert={false}
                contentHidden={false}
                fill={copy === null ? (
                    <Box className="flp-ready-out-card__pending" sx={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <DelayedCircularProgress className="flp-ready-out-card__spinner" size={28} />
                    </Box>
                ) : (
                    <Box
                        className="flp-ready-out-card__panel"
                        sx={{ width: "100%", height: "100%", boxSizing: "border-box", padding: PANEL_PAD, display: "flex", flexDirection: "column", textAlign: "center" }}
                    >
                        <Box
                            className="flp-ready-out-card__info"
                            sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1.5 }}
                        >
                            <Typography className="flp-ready-out-card__title" sx={{ fontSize: SIZE.heading, fontWeight: WEIGHT.bold, lineHeight: LEADING.tight, color: COLORS.onSurface }}>
                                {copy.title}
                            </Typography>
                            <Typography className="flp-ready-out-card__body" sx={{ fontSize: SIZE.body, lineHeight: LEADING.normal, color: COLORS.onSurface }}>
                                {copy.body}
                            </Typography>
                        </Box>
                        {kind === "lend" && (
                            // A tap here is a tap on the card (it bubbles to `throwOff`); the
                            // plate is the affordance, the whole card is the target.
                            <ButtonBase
                                className="flp-ready-out-card__got-it"
                                sx={{ ...plateButtonSx(hueTones(RAMP[LEARNING_HUE].mid)), width: "100%" }}
                            >
                                Got it!
                            </ButtonBase>
                        )}
                    </Box>
                )}
            />
        </Box>
    );
};

export default ReadyOutCardLayer;
