import { useMemo, useState } from "react";
import { Box, Typography } from "@mui/material";
import Icon from "../../components/Icon";
import { COLORS, RAMP, type RampHue } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { WEIGHT } from "../../theme/scale";

/**
 * `StudyHand` — the design's `.fanw` (artboards 2 and 2b): the three ways into a study
 * session, held as a fanned HAND of cards with one played forward.
 *
 * ── What it replaced, and what the shape is saying ────────────────────────────
 * The page used to stack three separate buttons: a Review/Challenge row above a big
 * 3:4 "Study Mix" slab. Three buttons is three peers, which is not what these three
 * are. They are one choice — *which session am I starting* — and Study Mix is the
 * answer nine times out of ten. A hand of cards says that in its geometry: exactly one
 * is forward and readable, the other two are visibly present, named, and one tap from
 * taking its place. Nothing is hidden and nothing is repeated.
 *
 * Bringing a card forward is deliberately NOT starting the session. The front card
 * carries the figure and its own `Study now`, so choosing a mode and committing to it
 * are two taps — which matters because Review and Challenge are the two modes a
 * learner picks on purpose and wants to see the size of first.
 *
 * ── Slot assignment ───────────────────────────────────────────────────────────
 * Three fixed slots (`back-left`, `back-right`, `front`) and a deterministic rule: the
 * front is whatever the learner last chose, and the other two fall into the back slots
 * in the canonical order this component declares (`FAN_ORDER`). A rule rather than
 * remembered positions, so the hand cannot end up in a layout the learner didn't ask
 * for after two taps, and so the same mode always sits in the same place for a given
 * front card.
 *
 * ── Ineligibility is not disablement ──────────────────────────────────────────
 * A mode with no eligible cards (Review, whose bands are EARNED and cannot be filled
 * by provisioning — see docs/PROVISIONAL_CARDS.md) renders greyed but still fires
 * `onStudy`, so the host can explain why rather than leaving a dead card. The card can
 * always be brought forward; it is the commit that is refused.
 *
 * Referenced by docs/SHELF_REDESIGN.md (entry 2) and docs/DECKS_FEATURE.md.
 */

/** The three session modes, in the order they fill the back slots. */
export type StudyModeId = "challenge" | "review" | "mix";
const FAN_ORDER: readonly StudyModeId[] = ["challenge", "review", "mix"];

export interface StudyHandCard {
    id: StudyModeId;
    /** Name on the card — "Study Mix", "Review", "Challenge". */
    label: string;
    /**
     * The mode's own figure: how many cards it can draw from. `undefined` while its
     * count is in flight — the card then prints an em dash rather than a provisional 0,
     * because 0 is a real answer this figure can give.
     */
    figure: number | undefined;
    /** What the figure IS, in two or three words: "cards ready", "in rotation". */
    figureCaption: string;
    /** Ramp hue for the card's fill. */
    hue: RampHue;
    /**
     * Whether a session can actually be started. False greys the card and its button;
     * `onStudy` still fires so the host can say why.
     */
    eligible?: boolean;
}

export interface StudyHandProps {
    /** The three cards. Order here is irrelevant — `FAN_ORDER` decides the layout. */
    cards: StudyHandCard[];
    /** Which mode the hand opens on. */
    initialFront?: StudyModeId;
    /** Commit: start this mode's session (or explain why it can't be started). */
    onStudy: (id: StudyModeId) => void;
    className?: string;
}

/** Geometry of the three fan slots, straight off `.fc.l` / `.fc.r` / `.fc.f`. */
const SLOTS = {
    backLeft: { top: 40, inset: 20, zIndex: 1, transform: "rotate(-4.5deg) translateX(-14px)" },
    backRight: { top: 86, inset: 20, zIndex: 2, transform: "rotate(4.5deg) translateX(14px)" },
    front: { top: 132, inset: 2, zIndex: 3, transform: "none" },
} as const;

/** Grey fill for a mode with nothing to draw from — the card is present, not offered. */
const INELIGIBLE_FILL = COLORS.grey;

export const StudyHand: React.FC<StudyHandProps> = ({ cards, initialFront = "mix", onStudy, className }) => {
    const [front, setFront] = useState<StudyModeId>(initialFront);

    // Slot per card: the chosen one takes `front`, the rest fall into the two back
    // slots in FAN_ORDER. Derived every render rather than stored, so there is exactly
    // one source of truth for where a card sits.
    const slotOf = useMemo(() => {
        const back = FAN_ORDER.filter((id) => id !== front);
        return (id: StudyModeId): keyof typeof SLOTS =>
            id === front ? "front" : back.indexOf(id) === 0 ? "backLeft" : "backRight";
    }, [front]);

    return (
        <Box
            className={className ? `study-hand ${className}` : "study-hand"}
            // `flex: 1 1 0` + `minHeight: 0`: the hand takes whatever height the rows
            // above it leave and the cards are absolutely positioned inside it, so the
            // fan compresses on a short frame instead of overflowing.
            sx={{
                position: "relative",
                flex: "1 1 0",
                minHeight: 0,
                width: "100%",
                // SIZE CONTAINER for the front card's figure, which is sized in `cqh`
                // (see below). Safe here and not in `Spine`'s case: the cards are
                // absolutely positioned, so this box's size comes entirely from the flex
                // line and never from its contents — the self-query trap A3 hit does not
                // apply. See docs/SHELF_REDESIGN.md § A3 "The reference width is PER
                // VARIANT, and the scaling is JS, not cqw".
                containerType: "size",
            }}
        >
            {cards.map((card) => {
                const slot = slotOf(card.id);
                const isFront = slot === "front";
                const geometry = SLOTS[slot];
                const greyed = card.eligible === false;
                return (
                    <Box
                        key={card.id}
                        className={`study-hand__card study-hand__card--${card.id} study-hand__card--${isFront ? "front" : "back"}`}
                        role="button"
                        aria-label={isFront ? undefined : `Bring ${card.label} forward`}
                        // A back card's whole face is the "bring me forward" target; the
                        // front card's own face does nothing (its button commits), so a
                        // stray tap while reading the figure cannot start a session.
                        onClick={isFront ? undefined : () => setFront(card.id)}
                        sx={{
                            position: "absolute",
                            top: geometry.top,
                            left: geometry.inset,
                            right: geometry.inset,
                            bottom: 0,
                            zIndex: geometry.zIndex,
                            transform: geometry.transform,
                            // Rotation pivots at the TOP CENTRE, so a fanned card swings
                            // like a card held in a hand rather than spinning about its
                            // middle.
                            transformOrigin: "50% 0",
                            transition: "top 260ms ease, left 260ms ease, right 260ms ease, transform 260ms ease",
                            backgroundColor: greyed ? INELIGIBLE_FILL : RAMP[card.hue].fill,
                            borderRadius: "22px",
                            border: `1px solid ${COLORS.border}`,
                            padding: isFront ? "15px 16px 14px" : "10px 16px 14px",
                            boxShadow: isFront
                                // The front card carries a shadow ABOVE it as well, so it
                                // reads as lifted off the two behind rather than pasted on.
                                ? "0 -2px 5px rgba(20,18,26,0.05), 0 10px 26px rgba(20,18,26,0.16)"
                                : "0 5px 16px rgba(20,18,26,0.14)",
                            display: "flex",
                            flexDirection: "column",
                            cursor: isFront ? "default" : "pointer",
                            overflow: "hidden",
                            opacity: greyed ? 0.72 : 1,
                        }}
                    >
                        <Box
                            className="study-hand__head"
                            sx={{
                                display: "flex",
                                alignItems: "center",
                                // A back card's head is pushed to its right edge: its left
                                // side is the part the front card overlaps as the fan
                                // closes, and a name that slides under another card is
                                // worse than no name at all.
                                justifyContent: isFront ? "space-between" : "flex-end",
                                gap: "9px",
                            }}
                        >
                            <Typography
                                component="b"
                                className="study-hand__label"
                                sx={{
                                    fontFamily: FONTS.sans,
                                    fontSize: isFront ? 27 : 16,
                                    fontWeight: WEIGHT.bold,
                                    letterSpacing: isFront ? "-0.034em" : "-0.022em",
                                    color: COLORS.onSurface,
                                }}
                            >
                                {card.label}
                            </Typography>
                            {/* A back card names its own size here; the front card prints
                                the same number large below, so it says the CAPTION here to
                                avoid printing one figure twice. */}
                            <Typography
                                component="em"
                                className="study-hand__meta"
                                sx={{ fontStyle: "normal", fontFamily: FONTS.mono, fontSize: 10, color: COLORS.iconColor, whiteSpace: "nowrap" }}
                            >
                                {isFront
                                    ? card.figureCaption
                                    : `${card.figure === undefined ? "—" : card.figure.toLocaleString()} ${card.figureCaption}`}
                            </Typography>
                        </Box>

                        {isFront && (
                            <>
                                <Box
                                    className="study-hand__figure"
                                    sx={{
                                        flex: 1,
                                        minHeight: 0,
                                        display: "flex",
                                        flexDirection: "column",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        gap: "2px",
                                    }}
                                >
                                    <Typography
                                        component="b"
                                        sx={{
                                            fontFamily: FONTS.sans,
                                            // 118px is the artboard's size; `clamp` down to
                                            // the height the slot actually has, because the
                                            // hand shrinks when the Centers rail is present
                                            // and a fixed 118px numeral would clip.
                                            fontSize: "clamp(56px, 30cqh, 118px)",
                                            fontWeight: 800,
                                            letterSpacing: "-0.06em",
                                            lineHeight: 0.85,
                                            fontVariantNumeric: "tabular-nums",
                                            color: COLORS.onSurface,
                                        }}
                                    >
                                        {card.figure === undefined ? "—" : card.figure.toLocaleString()}
                                    </Typography>
                                    {/* The gold hairline under the figure — `.bignum:after`.
                                        It is the only rule on the card, and it exists to stop
                                        a 118px numeral floating in the middle of an empty
                                        panel. */}
                                    <Box sx={{ width: 34, height: 2, borderRadius: "1px", backgroundColor: RAMP[card.hue].ink, opacity: 0.5, marginTop: "11px" }} />
                                </Box>

                                <Box
                                    component="button"
                                    type="button"
                                    className="study-hand__go"
                                    onClick={() => onStudy(card.id)}
                                    sx={{
                                        marginTop: "auto",
                                        marginBottom: "13px",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        gap: "8px",
                                        backgroundColor: greyed ? COLORS.greyA : COLORS.onSurface,
                                        color: COLORS.white,
                                        border: "none",
                                        borderRadius: "14px",
                                        padding: "14px",
                                        fontFamily: FONTS.sans,
                                        fontSize: 14,
                                        fontWeight: WEIGHT.semibold,
                                        cursor: "pointer",
                                    }}
                                >
                                    <Icon name="play_arrow" size={18} color={COLORS.white} />
                                    Study now
                                </Box>
                            </>
                        )}
                    </Box>
                );
            })}
        </Box>
    );
};

export default StudyHand;
