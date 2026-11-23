import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, ButtonBase, Typography } from "@mui/material";
import { CardFaceSide } from "../card/CardFace";
import DelayedCircularProgress from "../../../components/DelayedCircularProgress";
import ConfettiBurst from "../../../components/ConfettiBurst";
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
 *   lend — "You're out of cards!": the session's lend switch has just come on and
 *          the loop under this card is lent words. "Got it!", a tap or a swipe sends it
 *          off and study carries on.
 *   done — "Done for the day!": nothing more to deal (a focused world, which never lends,
 *          or a dictionary with nothing left to lend). Title only, celebrated with a
 *          confetti burst as it lands (ConfettiBurst). It stays put; the learner leaves
 *          with the back arrow.
 */
export type ReadyOutKind = "pending" | "lend" | "done";

/** Copy per worded kind. Kept here, with the face, so the doc can cite one place.
 *  `done` is title-only by design: the confetti carries the moment, no subtext. */
const COPY: Record<Exclude<ReadyOutKind, "pending">, { title: string; body?: string }> = {
    lend: {
        title: "You're out of cards!",
        // "The green rectangle" is the Deck Tower's sort platform (the acp's way in).
        body: "We'll show you some new words for now. Tap on the green rectangle on the home screen to add more cards.",
    },
    done: {
        title: "Done for the day!",
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
 * `done` and `pending`: static. Taps on them do nothing; the learner leaves with the
 * header's back arrow.
 *
 * `backing`: the same card drawn UNDER the stack instead of over it, behind the loop's
 * last card, so the learner sees what comes after it (FlashcardsLearnPage →
 * `readyOutBacking`). Static, takes no touches, no confetti: it is only a preview, and the
 * real card (this layer on top) takes over once the loop runs dry.
 * `look`: what a `pending` card shows — the kind the backing card promised, so the hand-over
 * from backing to top card does not blank to a spinner. Still static until the deal lands.
 *
 * Layer: feature component (features/flashcards). Rendered by FlashCardSection; the kind
 * is decided by FlashcardsLearnPage (§ "Running out of ready cards").
 * Docs: docs/DECK_TOWER.md § "Running out of ready cards".
 */
const ReadyOutCardLayer: React.FC<{
    kind: ReadyOutKind;
    /** The `lend` card has finished flying off. */
    onGone: () => void;
    /** Drawn under the stack, as the card behind the last card (see above). */
    backing?: boolean;
    /** A `pending` card's face; absent = blank, with the slow-deal spinner. */
    look?: Exclude<ReadyOutKind, "pending">;
}> = ({ kind, onGone, backing = false, look }) => {
    // Only a real (top) `lend` card can be sent off.
    const sendable = kind === "lend" && !backing;
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
        disabled: !sendable || leaving !== null,
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
        if (!sendable || leaving !== null || wasDrag()) return;
        setLeaving("thrown");
    };

    const face = kind === "pending" ? look ?? null : kind;
    const copy = face === null ? null : COPY[face];
    return (
        <Box
            ref={layerRef}
            className={`flp-ready-out-card flp-ready-out-card--${kind}${backing ? " flp-ready-out-card--backing" : ""}`}
            data-swipe-id={backing ? undefined : "ready-out-card"}
            {...(sendable ? swipeHandlers : {})}
            onClick={backing ? undefined : throwOff}
            sx={{
                position: "absolute",
                inset: 0,
                // Over the word slots and a flying one (z 3): it is the top card — except the
                // last card still flying off as this one comes up, which is lifted to 5. As the
                // backing card, under every slot (they start at 0 and come later in the DOM).
                zIndex: backing ? 0 : 4,
                borderRadius: CARD_SURFACE.borderRadius,
                // Tower card stock: no drop shadow, it lies flush on the deck.
                boxShadow: "none",
                pointerEvents: backing ? "none" : "auto",
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
                            {copy.body && (
                                <Typography className="flp-ready-out-card__body" sx={{ fontSize: SIZE.body, lineHeight: LEADING.normal, color: COLORS.onSurface }}>
                                    {copy.body}
                                </Typography>
                            )}
                        </Box>
                        {face === "lend" && (
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
            {/* Mounts when the card turns `done` (pending → done), so the burst plays
                once as the card lands. Over the card face; taps pass through. */}
            {kind === "done" && !backing && <ConfettiBurst className="flp-ready-out-card__confetti" zIndex={1} />}
        </Box>
    );
};

export default ReadyOutCardLayer;
