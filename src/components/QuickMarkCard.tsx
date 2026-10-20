import { memo, useState } from "react";
import { Box } from "@mui/material";
import MiniCard, { MiniCardFrequencyBadge } from "./MiniCard";
import DelayedCircularProgress from "./DelayedCircularProgress";
import { MINI_CARD_WIDTH, MINI_CARD_HEIGHT } from "./miniCardFace";
import { stripParentheses } from "../utils/definitionUtils";
import type { DiscoverCard } from "../types";
import type { SwipeCommit, SwipeDirection } from "../hooks/useSwipeCommit";
import { QUICK_MARK_COLOR, QUICK_MARK_FACE_CLASS, QUICK_MARK_SWIPE_LAYER_CLASS } from "./quickMarkSwipe";
import { CARD_FLY_OUT_MS } from "../features/flashcards/constants";

/** How far past its slot a committed card flies (clears the 364px grid either way). */
const FLY_OUT_PX = 480;
/** Snap-back duration when a drag is released short of the threshold. */
const SNAP_BACK_MS = 200;

interface QuickMarkCardProps {
    card: DiscoverCard;
    /** Set once a swipe commits: the card is flying off this way (then leaves the grid). */
    leaving: SwipeDirection | null;
    /** The page's shared `useSwipeCommit` handlers; omitted while the card is leaving. */
    swipeHandlers?: SwipeCommit["handlers"];
    /** Whether the press that just ended was a drag (so its click isn't a tap). */
    wasDrag: () => boolean;
    /** Tap → open the eip for this word. */
    onOpenInfo: (card: DiscoverCard) => void;
    /** True while this card's eip lookup is in flight. */
    infoLoading: boolean;
    // Optional staggered pop-in on mount — the grid passes index * step for the first
    // CASCADE_LIMIT cards, undefined thereafter.
    animationDelayMs?: number;
    // Held invisible (still laid out, so its cell can be measured) while the scp panel's
    // morph ghost flies to or from this cell (QuickMarkPanel → MorphGhost).
    hidden?: boolean;
}

// A Quick Mark triage card: the shared MiniCard (src/components/MiniCard.tsx), driven by
// a raw DiscoverCard (not a saved VocabEntry), that the learner SWIPES — left = Add to
// Learning, right = Mastered (docs/QUICK_MARK.md § 3) — and TAPS to read about in the eip.
// The swipe is axis-locked (`touch-action: pan-y` + `useSwipeCommit({ axisLock: true })`),
// so a vertical drag that starts on a card still scrolls the page.
//
// THE DRAG IS NOT RENDERED HERE. While the finger is down, `paintQuickMarkDrag`
// (quickMarkSwipe.ts) writes the swipe layer's transform and the face's fill straight to
// the DOM, so a drag never re-renders anything. React only draws the two settled states:
// at rest, and `leaving` (fly-off, face in the destination colour).
//
// Three nested layers, each owning ONE transform so none overwrites another:
//   outer      — the grid's flex item. `useScrollStretch` writes its row-spread transform
//                here, directly on the DOM node; it is also the gesture target (stays
//                put, so pointer capture and `data-swipe-id` never move).
//   swipe      — follows the finger / flies off (translateX + tilt).
//   MiniCard   — its own pop-in keyframe (a keyframe on the swipe layer would pin its
//                end transform over the drag's).
const QuickMarkCardComponent: React.FC<QuickMarkCardProps> = ({
    card, leaving, swipeHandlers, wasDrag, onOpenInfo, infoLoading, animationDelayMs, hidden = false,
}) => {
    const flyX = leaving === "right" ? FLY_OUT_PX : leaving === "left" ? -FLY_OUT_PX : 0;
    // The pop-in delay is fixed at MOUNT. The grid assigns it by list POSITION (the first
    // 15 slots), so once swipes shift the list, a card sliding up into slot 14 would
    // otherwise gain the animation and replay its pop-in mid-triage.
    const [mountDelayMs] = useState(animationDelayMs);
    return (
        <Box
            className="quick-mark-card"
            data-swipe-id={card.id}
            {...swipeHandlers}
            sx={{
                position: "relative",
                width: MINI_CARD_WIDTH,
                height: MINI_CARD_HEIGHT,
                flex: "none",
                // Vertical pans stay the page's (native scroll); horizontal drags reach
                // the swipe handlers. See useSwipeCommit's axis-lock note.
                touchAction: "pan-y",
                // Lifted while flying so it passes over its neighbours (while dragged, the
                // painter lifts it inline).
                zIndex: leaving ? 3 : undefined,
                visibility: hidden ? "hidden" : undefined,
            }}
        >
            <Box
                className={QUICK_MARK_SWIPE_LAYER_CLASS}
                sx={{
                    width: "100%",
                    height: "100%",
                    transform: `translateX(${flyX}px) rotate(${flyX / 24}deg)`,
                    // The snap-back (released short) and the fly-off (committed, fading).
                    // While dragging, the painter overrides this inline with `none`.
                    transition: leaving
                        ? `transform ${CARD_FLY_OUT_MS}ms ease, opacity ${CARD_FLY_OUT_MS}ms ease`
                        : `transform ${SNAP_BACK_MS}ms ease`,
                    opacity: leaving ? 0 : 1,
                    // No `willChange`: on ~100 cards it would promote ~100 compositor
                    // layers up front — itself a source of jank.
                }}
            >
                <MiniCard
                    className={QUICK_MARK_FACE_CLASS}
                    onClick={() => { if (!leaving && !wasDrag()) onOpenInfo(card); }}
                    language={card.language}
                    entryKey={card.entryKey}
                    pronunciation={card.pronunciation}
                    definition={stripParentheses(card.definition ?? "")}
                    iconId={card.iconId}
                    // A committed card keeps the destination colour the drag faded it to.
                    background={leaving ? QUICK_MARK_COLOR[leaving] : undefined}
                    // NO `hoverLift`: the card's main action is a swipe, and a lifting hover
                    // would read as "this tile navigates somewhere".
                    animationDelayMs={mountDelayMs}
                    sx={{
                        cursor: "grab",
                        // Overrides miniCardFaceSx's `content-visibility: auto` (whose
                        // margin each browser picks): drawn by default, and the page's
                        // draw window (quickMarkSwipe.ts → observeCardDrawWindow) hides
                        // only cards more than two rows off screen — so a card sliding up
                        // into a swiped card's slot is always painted already.
                        contentVisibility: "visible",
                    }}
                >
                    <MiniCardFrequencyBadge score={card.frequencyScore} className="quick-mark-card__frequency-badge" />
                    {infoLoading && (
                        <Box className="quick-mark-card__info-loading" sx={{ position: "absolute", top: 6, right: 6, pointerEvents: "none" }}>
                            <DelayedCircularProgress className="quick-mark-card__info-spinner" size={14} />
                        </Box>
                    )}
                </MiniCard>
            </Box>
        </Box>
    );
};

// Memoized: with the drag painted imperatively, a card re-renders only when its own
// `leaving` / `infoLoading` / `hidden` changes. Every other prop is stable (`card` per fetch; the
// swipe handlers, `wasDrag` and `onOpenInfo` are stable in the page).
const QuickMarkCard = memo(QuickMarkCardComponent);

export default QuickMarkCard;
