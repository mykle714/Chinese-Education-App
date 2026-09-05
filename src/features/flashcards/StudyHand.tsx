import { useCallback, useState } from "react";
import { Box, Typography } from "@mui/material";
import Icon from "../../components/Icon";
import { COLORS, RAMP, type RampHue } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { WEIGHT } from "../../theme/scale";
import { SHADOW } from "../../theme/shadows";
import { useHandSwipe } from "./useHandSwipe";
import { SlotNumber, SLOT_LINE_HEIGHT } from "./SlotNumber";

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
 * Three fixed slots — `back-left`, `back-right`, `front` — held as an ORDERED STACK
 * (`HandOrder`, bottom → top) rather than derived from which card is forward. The
 * distinction matters: a derived rule can only ever produce three arrangements (one per
 * possible front card), and the swipe gesture below is required to reach all six
 * permutations of the three cards. `FAN_ORDER` now seeds the opening stack only.
 *
 * ── Bringing a card forward ───────────────────────────────────────────────────
 * Two ways, and both promote a card without any card leaving the frame:
 *
 *   • TAP a back card — it goes to the front, the other two keep their relative order.
 *   • THROW the front card, in ANY direction (`useHandSwipe`). The card follows the finger
 *     on both axes — as an flp card does — and commits once it is far enough from where
 *     the gesture started, measured as straight-line distance, so the commit boundary is a
 *     circle rather than two side gates. Every direction is the same move: the thrown card
 *     goes to the back of the stack and the card directly behind it surfaces. Direction is
 *     only the path the card takes out of the frame — the hand is a cycle, and a cycle has
 *     no ends to steer toward.
 *
 * Between them the two gestures reach ALL SIX arrangements of the three cards, which is
 * why the fan is stored rather than derived (see `afterTap` / `afterSwipe`).
 *
 * ── The quantity tag ─────────────────────────────────────────────────────────
 * Every card carries its own figure as a small "N Cards" tag in its TOP-RIGHT corner,
 * with its name at the top-left — on the front card and on the card queued directly
 * behind it (`backRight`) alike. The tag is what lets a figure survive the trip to the
 * back of the fan and home again without ever appearing or moving: the number behind the
 * front card is already readable the moment a throw clears it, and it is already in its
 * final position when the promotion lands. The front card consequently states its figure
 * twice — once as the tag, once as the big numeral below — which is the cost of the tag
 * being continuous.
 *
 * `backLeft`, the bottom of the stack, is the exception and keeps its head right-clustered:
 * it is two promotions from the front, and its left edge is the part the fan overlaps.
 *
 * ── The full face is pre-rendered on the card behind ─────────────────────────
 * `backRight` — the card the next swipe promotes — renders the WHOLE front face while
 * still in the fan: tag, big numeral, hairline and commit button. At rest none of it
 * shows (the played card covers it), so it costs the fan nothing; it earns its keep the
 * moment a throw begins, because the number the learner is deciding on is uncovered
 * already drawn rather than appearing after the gesture resolves.
 *
 * The button is part of the pre-render even though it is inert there. It is what reserves
 * the space the numeral centres against — drop it and the numeral would centre in a taller
 * box and jump into place on arrival, which is exactly what pre-rendering is here to
 * prevent. On the queued card it is disabled, `aria-hidden`, out of the tab order and
 * `pointer-events: none`, so it can neither commit a mode that is not forward nor swallow
 * the tap that brings the card forward.
 *
 * ── Waiting for the counts ───────────────────────────────────────────────────
 * A figure in flight spins as a blurred slot-machine reel (`SlotNumber`) and lands when
 * its count arrives. The card's corner tag stays BLANK meanwhile and fades in behind it:
 * one thing moving on a card reads as "fetching", two read as noise, and four cramped mono
 * characters in a corner are too small for a placeholder to read as anything but a wrong
 * number.
 *
 * A promotion is a HARD content switch at commit time: the card's geometry animates over
 * `SLOT_TRANSITION_MS`, but its front/back layout swaps at t=0 rather than crossfading.
 * Deliberate — the two layouts are different compositions (a big numeral and a commit
 * button versus a single name row), not two states of one composition, so there is
 * nothing meaningful to interpolate between. The single exception is the card's NAME,
 * whose font-size travels with the slot: the head's height follows it and the numeral
 * centres against what the head leaves, so a 16→27px jump there would jolt the numeral the
 * pre-render exists to hold still.
 *
 * ── Ineligibility is not disablement, and a zero is not a fault ───────────────
 * A mode with no eligible cards (Review, whose bands are EARNED and cannot be filled
 * by provisioning — see docs/PROVISIONAL_CARDS.md) still fires `onStudy`, so the host
 * can explain why rather than leaving a dead card. The card can always be brought
 * forward; it is the commit that is refused.
 *
 * It is NOT greyed for it. A count of 0 is the ordinary end of a session — every card
 * marked, everything resting — and draining a card's colour turns that into a failure
 * state the learner reads as "something is wrong with this mode". The card keeps its
 * hue and swaps its corner tag for a plain-language `zeroMessage` ("All caught up!"),
 * which says the same thing in words the number cannot.
 *
 * Referenced by docs/SHELF_REDESIGN.md (entry 2) and docs/DECKS_FEATURE.md.
 */

/** The three session modes, in the order they seed the back slots. */
export type StudyModeId = "challenge" | "review" | "mix";
const FAN_ORDER: readonly StudyModeId[] = ["challenge", "review", "mix"];

/**
 * The live fan, BOTTOM → TOP: `[back-left, back-right, front]`. Stored rather than
 * derived so all six orderings of the three cards are representable.
 */
export type HandOrder = readonly [StudyModeId, StudyModeId, StudyModeId];

/** Stack index → slot name. Index 2 (top of the stack) is the played card. */
const SLOT_BY_DEPTH = ["backLeft", "backRight", "front"] as const;

export interface StudyHandCard {
    id: StudyModeId;
    /**
     * Name on the card — "Study Mix", "Review Mix", "Challenge Mix". DISPLAY TEXT: the
     * `id` beside it is the wire value and does not carry the "Mix" suffix.
     */
    label: string;
    /**
     * The mode's own figure: how many cards it can draw from. `undefined` while its count
     * is in flight — the big numeral then spins as a `SlotNumber` reel and the corner tag
     * stays blank. Never a provisional 0: 0 is a real answer this figure can give, so it
     * must not appear before it is known.
     */
    figure: number | undefined;
    /** What the figure IS, in a word or two — it follows the number in the tag ("Cards"). */
    figureCaption: string;
    /**
     * What the corner tag says INSTEAD of "0 Cards" when the figure lands on zero.
     * Display copy the host owns, because the right sentence is per-mode: an empty
     * Review pool means "All caught up!", an empty Challenge/Mix pool means the learner
     * needs more cards. Omit to keep the plain "0 Cards".
     */
    zeroMessage?: string;
    /** Ramp hue for the card's fill. */
    hue: RampHue;
    /**
     * Whether a session can actually be started. Three states, and the third matters:
     * `true`/`undefined` render identically (an offered card), `false` greys the COMMIT
     * BUTTON ONLY — never the card's fill or opacity, see "a zero is not a fault" above.
     *
     * Leave it `undefined` while the answer is still being fetched rather than passing a
     * provisional `false`: the strict `=== false` test below exists so a host with an
     * in-flight count cannot accidentally paint a loading state onto the card. `onStudy`
     * fires in every state, so the host can explain a refusal in its own words.
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

/** How long a card takes to travel between slots after a promotion. */
const SLOT_TRANSITION_MS = 260;
const SLOT_TRANSITION = `top ${SLOT_TRANSITION_MS}ms ease, left ${SLOT_TRANSITION_MS}ms ease, right ${SLOT_TRANSITION_MS}ms ease, transform ${SLOT_TRANSITION_MS}ms ease`;

/**
 * Promote `id` to the front, leaving the other two in their existing relative order.
 * This is the TAP path.
 */
function afterTap(order: HandOrder, id: StudyModeId): HandOrder {
    const rest = order.filter((x) => x !== id);
    return [rest[0], rest[1], id];
}

/**
 * Send the front card to the BACK of the stack and surface the one directly behind it.
 * This is the THROW path, and it is DIRECTION-AGNOSTIC by design — a throw left, right, up
 * or down produces the same result. The hand is a cycle of three, so there is no second
 * direction for a throw to mean; the direction only shows in the card's exit path, and in
 * the lean it takes from the horizontal component of the drag (`useHandSwipe`'s tilt).
 *
 * Writing the stack `[a, b, c]` (bottom → top): `[a, b, c] → [c, a, b]`, a 3-cycle.
 *
 * Swiping alone therefore reaches three of the six arrangements — the rotations. `afterTap`
 * supplies the rest: tapping the MIDDLE card is a transposition of the top two, and a
 * 3-cycle plus a transposition generate every ordering of three elements. That is why the
 * fan is a stored `HandOrder` and not derived from whichever card is forward: a derived
 * rule has only three states and could not represent the other three arrangements at all.
 */
function afterSwipe(order: HandOrder): HandOrder {
    const [a, b, c] = order;
    return [c, a, b];
}

export const StudyHand: React.FC<StudyHandProps> = ({ cards, initialFront = "mix", onStudy, className }) => {
    // The fan is the single source of truth for where every card sits. Seeded from
    // `initialFront` through FAN_ORDER so the hand opens in the same layout it always has.
    const [order, setOrder] = useState<HandOrder>(() => {
        const back = FAN_ORDER.filter((id) => id !== initialFront);
        return [back[0], back[1], initialFront];
    });

    const slotOf = useCallback(
        (id: StudyModeId): keyof typeof SLOTS => SLOT_BY_DEPTH[order.indexOf(id)],
        [order]
    );

    // Throwing the front card. The gesture reports NO direction, because every direction is
    // the same rotation of the hand (see `afterSwipe`). `setOrder` takes
    // the updater form because a fast second swipe can land before the first has
    // re-rendered, and each swipe must compose onto the stack the previous one produced.
    const handleSwipe = useCallback(() => {
        setOrder(afterSwipe);
    }, []);

    const swipe = useHandSwipe(handleSwipe);

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
                // Ineligibility dims the COMMIT only. The card's fill and opacity stay
                // put: a zero count is a normal, frequent outcome and must not read as a
                // broken card (see "a zero is not a fault" in the docblock).
                const greyed = card.eligible === false;
                // A landed zero speaks in words rather than printing "0 Cards" — the
                // number alone reads as a shortfall, the sentence reads as a state.
                const isZero = card.figure === 0;
                // The corner tag has nothing to say until the count lands, so it says
                // nothing — see the tag's own comment below.
                const figureKnown = card.figure !== undefined;
                // `backRight` is the card the next swipe promotes — the one uncovered as
                // the played card is thrown clear. It therefore renders the FULL front
                // face (quantity tag, big numeral, commit button) while still in the fan,
                // so the number is already legible mid-drag and already in its final
                // position when the promotion lands. See "The full face is pre-rendered"
                // in the docblock.
                const isNextUp = slot === "backRight";
                const showsFace = isFront || isNextUp;
                // Only the played card is draggable, so it alone carries the ref the
                // gesture measures its dismissal threshold against.
                const isBeingDragged = isFront && swipe.isDragging;
                return (
                    <Box
                        key={card.id}
                        ref={isFront ? swipe.cardRef : undefined}
                        className={`study-hand__card study-hand__card--${card.id} study-hand__card--${isFront ? "front" : "back"}`}
                        role="button"
                        aria-label={isFront ? undefined : `Bring ${card.label} forward`}
                        // A back card's whole face is the "bring me forward" target; the
                        // front card's own face does nothing (its button commits), so a
                        // stray tap while reading the figure cannot start a session.
                        onClick={isFront ? undefined : () => setOrder((current) => afterTap(current, card.id))}
                        // The throw gesture lives on the front card only. A back card is
                        // mostly covered by the front one, so a swipe starting there is far
                        // more likely to be a mis-grab than an intent to reorder the hand.
                        {...(isFront ? swipe.handlers : {})}
                        sx={{
                            position: "absolute",
                            top: geometry.top,
                            left: geometry.inset,
                            right: geometry.inset,
                            bottom: 0,
                            zIndex: geometry.zIndex,
                            // While the finger owns the card its transform IS the drag
                            // (the front slot's own transform is `none`, so nothing is
                            // being overridden). On release the drag offset returns to 0
                            // and the slot transform takes over WITH the transition back
                            // on — CSS interpolates from the currently-computed transform,
                            // so the card travels on from wherever it was let go instead
                            // of snapping to centre first.
                            transform: isBeingDragged ? swipe.dragTransform : geometry.transform,
                            // Rotation pivots at the TOP CENTRE, so a fanned card swings
                            // like a card held in a hand rather than spinning about its
                            // middle.
                            transformOrigin: "50% 0",
                            transition: isBeingDragged ? "none" : SLOT_TRANSITION,
                            // The throw is omnidirectional, so the played card claims the
                            // touch on BOTH axes once it clears the gesture's slop — the
                            // page/sheet beneath is scrolled from anywhere but this card.
                            ...(isFront ? { touchAction: "none" } : {}),
                            backgroundColor: RAMP[card.hue].fill,
                            borderRadius: "22px",
                            border: `1px solid ${COLORS.border}`,
                            padding: isFront ? "15px 16px 14px" : "10px 16px 14px",
                            boxShadow: isFront
                                // The front card carries a shadow ABOVE it as well, so it
                                // reads as lifted off the two behind rather than pasted on.
                                ? "0 -2px 5px rgba(20,18,26,0.05), 0 10px 26px rgba(20,18,26,0.16)"
                                : SHADOW.cardRest,
                            display: "flex",
                            flexDirection: "column",
                            cursor: isFront ? (isBeingDragged ? "grabbing" : "grab") : "pointer",
                            overflow: "hidden",
                        }}
                    >
                        <Box
                            className="study-hand__head"
                            sx={{
                                display: "flex",
                                alignItems: "center",
                                // Name LEFT, quantity RIGHT — on the front card and on the
                                // one queued directly behind it. `backLeft` keeps the old
                                // right-clustered head: it is two promotions away, and its
                                // left side is the part the fan's overlap eats first, so a
                                // name pinned there would slide under another card.
                                justifyContent: showsFace ? "space-between" : "flex-end",
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
                                    // The one thing on the card that is NOT a hard switch.
                                    // The head's height follows this size, and the numeral
                                    // below centres against what the head leaves — so an
                                    // instant 16→27px jump here would jolt the very numeral
                                    // the pre-render exists to hold still. Growing it over
                                    // the slot travel keeps that column continuous.
                                    transition: `font-size ${SLOT_TRANSITION_MS}ms ease, letter-spacing ${SLOT_TRANSITION_MS}ms ease`,
                                    color: COLORS.onSurface,
                                }}
                            >
                                {card.label}
                            </Typography>
                            {/* The QUANTITY TAG, and it reads the same on every card in the
                                fan: "N Cards", top-right.

                                Constant placement is the whole point. A card keeps this tag
                                as it is thrown to the back and cycled home again, so its
                                size is legible in every slot — including the instant the
                                front card clears the one behind it, which is the moment the
                                learner is deciding whether to keep swiping.

                                It also means the front card prints its figure TWICE: small
                                here and large below. That repetition is deliberate — a tag
                                that appeared only on back cards would have to materialise
                                out of nothing on the way down, and the promotion is a hard
                                content switch (no crossfade), so anything that moves or
                                appears between the two layouts moves visibly.

                                UNTIL THE COUNT ARRIVES THE TAG IS BLANK. It is four cramped
                                mono characters in a corner; a placeholder that small cannot
                                read as "loading" — it just reads as a wrong number. The big
                                numeral below is doing that job for the card already, so the
                                tag stays empty and fades in behind it. The element stays
                                mounted throughout so the fade has something to run on. */}
                            <Typography
                                component="em"
                                className="study-hand__meta"
                                sx={{
                                    fontStyle: "normal",
                                    fontFamily: FONTS.mono,
                                    fontSize: 10,
                                    color: COLORS.iconColor,
                                    whiteSpace: "nowrap",
                                    opacity: figureKnown ? 1 : 0,
                                    transition: "opacity 320ms ease",
                                }}
                            >
                                {!figureKnown
                                    ? ""
                                    : isZero && card.zeroMessage
                                        ? card.zeroMessage
                                        : `${card.figure!.toLocaleString()} ${card.figureCaption}`}
                            </Typography>
                        </Box>

                        {/* The front FACE — rendered on the played card and on the one
                            queued behind it. Both, so that the numeral is uncovered
                            already-drawn as a throw slides the front card clear, and so
                            that it lands in place instead of appearing. Note the button is
                            part of this: it is what reserves the space the numeral centres
                            against, so omitting it from the queued card would leave the
                            numeral centred in a taller box and it would jump on arrival —
                            the very thing pre-rendering is here to prevent. */}
                        {showsFace && (
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
                                            // Must match `SlotNumber`'s reel window, or
                                            // the figure would change height at the moment
                                            // the reels are swapped for the settled text.
                                            lineHeight: SLOT_LINE_HEIGHT,
                                            fontVariantNumeric: "tabular-nums",
                                            color: COLORS.onSurface,
                                        }}
                                    >
                                        {/* The figure spins as a slot-machine reel until
                                            its count arrives, then lands on it. This is the
                                            card's whole loading state: the corner tag stays
                                            blank and lets the big numeral carry it, because
                                            one thing moving reads as "fetching" and two
                                            read as noise. */}
                                        <SlotNumber value={card.figure} className="study-hand__figure-value" />
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
                                    // On the queued card this button is SCENERY. It must not
                                    // commit a mode that is not forward, must not swallow the
                                    // tap that promotes the card, and must not be a second
                                    // stop for a keyboard user on a card whose only action is
                                    // "bring forward" — hence inert on all three channels.
                                    onClick={isFront ? () => onStudy(card.id) : undefined}
                                    disabled={!isFront}
                                    tabIndex={isFront ? undefined : -1}
                                    aria-hidden={isFront ? undefined : true}
                                    sx={{
                                        ...(isFront ? {} : { pointerEvents: "none" }),
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
