import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Box, Typography } from "@mui/material";
import Icon from "../../components/Icon";
import RoundPlayButton from "../../components/RoundPlayButton";
import { COLORS, RAMP, type RampHue } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import { SHADOW } from "../../theme/shadows";
import { useHandSwipe, DRAG_TILT } from "./useHandSwipe";
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
 * carries the figure and its own `Start`, so choosing a mode and committing to it
 * are two taps — which matters because Review and Challenge are the two modes a
 * learner picks on purpose and wants to see the size of first.
 *
 * ── Slot assignment ───────────────────────────────────────────────────────────
 * Three fixed slots — `back-left`, `back-right`, `front` — held as an ORDERED STACK
 * (`HandOrder`, bottom → top) rather than derived from which card is forward. The
 * distinction matters: a derived rule can only ever produce three arrangements (one per
 * possible front card), and the swipe gesture below is required to reach all six
 * permutations of the three cards. `FAN_ORDER` seeds the opening stack only — unless the
 * host passes `initialOrder`, the fan the learner last launched from (FlpStudyHand).
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
 * A small tag in the card's TOP-RIGHT corner, and WHICH card wears it is the rule:
 *
 *   BACK cards (`backLeft`, `backRight`) — always, as "N Cards". A card in the fan has no
 *     big numeral showing, so the tag is the only place its figure can be read, and it is
 *     already legible the instant a throw clears the card in front of it.
 *   FRONT card — ONLY when its figure is 0, and then it says the host's `zeroMessage`
 *     rather than a count. The front card's big numeral already states every other figure,
 *     so a tag there would just print the same number twice; a landed `0`, though, reads
 *     as a shortfall on its own, and the sentence says which state it actually is.
 *
 * The consequence is that the tag DISAPPEARS as a card is promoted (or appears, on a
 * promotion into a zero). That is deliberate: the promotion is a hard content switch
 * anyway, and the alternative — carrying the tag through the cycle — bought continuity at
 * the price of the front card stating its figure twice.
 *
 * `backLeft`, the bottom of the stack, keeps its head right-clustered: it is two
 * promotions from the front, and its left edge is the part the fan overlaps.
 *
 * ── The full face is pre-rendered on the card behind ─────────────────────────
 * `backRight` — the card the next swipe promotes — renders the WHOLE front face while
 * still in the fan: big numeral, the mark under it ("cards" or the hairline — `figureMark`) and commit button (plus the back card's own
 * quantity tag, which the promotion then drops). At rest none of it
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
 * ── The cramped layout: the numeral moves into the head ───────────────────────
 * The hand takes whatever height its host leaves (`flex: 1 1 0`), and on a short frame —
 * the Centers rail present, a small phone — the figure box between the name and `Start`
 * stops having room for the numeral. Rather than shrink or clip it, the card RE-FLOWS:
 * the SAME figure (numeral + its mark, at the SAME size) moves out from under the name
 * and centres in the block BESIDE it — bounded by the name's right edge, the card's right
 * edge, the card's top padding and the `Start` bar. The name stays where it was.
 *
 * WHEN: as soon as the figure box can no longer hold the numeral + its mark with
 * `FIGURE_BREATHING_ROOM` clear above AND below it — i.e. when it starts to look cramped,
 * well before the digits actually run out of room. Measured, not a breakpoint
 * (`useCrampedFigure`), so it stays right if the card's padding, name or `Start` bar change.
 *
 * HOW: the full face is a CSS grid and only the numeral's grid AREA changes, so it is one
 * DOM node in both layouts — the `SlotNumber` reel is never remounted mid-spin. The switch
 * is hard (no animation), like a promotion: it only happens on a resize, never mid-gesture.
 * ONLY THE FRONT CARD re-flows. The two back cards — `backRight`'s pre-rendered face
 * included — always keep the roomy format, so the fan never changes shape; a promotion
 * into a cramped front therefore swaps the numeral into the head at t=0, the same hard
 * switch the rest of a promotion already is.
 *
 * A zero front card's `zeroMessage` tag moves from beside the name to UNDER it, because the
 * space to the name's right now belongs to the figure.
 *
 * ── Waiting for the counts ───────────────────────────────────────────────────
 * A figure in flight spins as a blurred slot-machine reel (`SlotNumber`) and lands when
 * its count arrives. That reel is the card's ENTIRE loading state — one thing moving on a
 * card reads as "fetching", two read as noise.
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
 * hue, prints the `0`, and adds the corner tag's `zeroMessage` ("All caught up!") beside
 * its name — which says in words what the number cannot.
 *
 * ── The compact variant ───────────────────────────────────────────────────────
 * `variant="compact"` (the Reading Center, docs/READING_WRITING_CENTERS.md) keeps
 * EVERYTHING above about behaviour — three modes, the stored fan, tap / throw to promote,
 * the ineligible commit — except that its throw is LOCKED to left/right (vertical drags
 * scroll the page; `useHandSwipe` "The horizontal lock"), and changes the drawing to the design's `.rstk` stack: a
 * tight ±3° fan, and a front card carrying the mode's glyph, its name and a rounded-square
 * launch button (→). NO figures and NO tags: the compact hand is a launcher, not a dashboard, so
 * `figure`, `figureCaption` and `zeroMessage` are ignored in it.
 *
 * Referenced by docs/SHELF_REDESIGN.md (entry 2), docs/DECKS_FEATURE.md and
 * docs/READING_WRITING_CENTERS.md.
 */

/** What sits under the full face's big numeral — see `StudyHandProps.figureMark`. */
export type FigureMark = "label" | "rule";

/** The three session modes, in the order they seed the back slots. */
export type StudyModeId = "challenge" | "review" | "mix";
const FAN_ORDER: HandOrder = ["challenge", "review", "mix"];

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
     * is in flight — the big numeral then spins as a `SlotNumber` reel. Never a provisional 0: 0 is a real answer this figure can give, so it
     * must not appear before it is known.
     */
    figure: number | undefined;
    /** What the figure IS, in a word or two — it follows the number in the tag ("Cards") and, lowercased, is the "cards" under the front card's big numeral while `figureMark` is `label`. */
    figureCaption: string;
    /**
     * What the FRONT card's tag says when its figure lands on zero — the only case in
     * which the front card wears a tag at all. Display copy the host owns, because the
     * right sentence is per-mode: an empty Review pool means "All caught up!", an empty
     * Challenge/Mix pool means the learner needs more cards. Omit to leave a zeroed front
     * card untagged.
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
    /** Material Symbols glyph drawn top-left on a COMPACT front card. Ignored in `full`. */
    glyph?: string;
}

export interface StudyHandProps {
    /** The three cards. Order here is irrelevant — `FAN_ORDER` decides the layout. */
    cards: StudyHandCard[];
    /**
     * The fan the hand opens in, bottom → top. Omitted: `FAN_ORDER` (Study Mix forward).
     * Read once, on mount — the host restores a remembered hand with it (FlpStudyHand →
     * `rememberedHandOrder`), so coming Back from the flp finds the launched card forward.
     */
    initialOrder?: HandOrder;
    /**
     * Commit: start this mode's session (or explain why it can't be started). `order` is
     * the fan at the moment of the tap, so the host can remember it for the next mount.
     */
    onStudy: (id: StudyModeId, order: HandOrder) => void;
    /** `full` (the fdp) or `compact` (the Reading Center) — see the docblock. */
    variant?: "full" | "compact";
    className?: string;
    /**
     * The host's "session is loading" state: every card shakes on its own beat and the
     * hand stops taking input (the launch is already committed). Driven by the fdp's
     * `useFlpLaunch` (flpLaunch.ts). Default false.
     */
    shaking?: boolean;
    /**
     * What sits under the full face's big numeral. `label`: a small "cards" (the word is
     * the card's `figureCaption`), so the learner learns the number is a card count.
     * `rule`: the design's ink hairline, no word. The host picks via the `handCardCount`
     * soft introduction (FlpStudyHand; docs/SOFT_INTRODUCTION.md) — label first, rule
     * once the learner has graduated. Ignored by the compact variant (no numeral).
     */
    figureMark?: FigureMark;
}

/**
 * The full fan's shape, off the design's `.fc.l` / `.fc.r` / `.fc.f`: back cards inset
 * 20px, tilted ±4.5° and shifted ±14px; the played card inset 2px; each card 46px below
 * the one behind it.
 */
const FAN_TILT_DEG = 4.5;
const FAN_BACK_INSET = 20;
const FAN_BACK_SHIFT = 14;
const FAN_STEP = 46;

/**
 * Where the fan STARTS: the back-left card's top, chosen so its raised corner just
 * touches the top of the hand — the hand's box begins exactly where the cards do, with no
 * dead band above them. (The design's fixed `top: 40` left ~28px of empty hand above the
 * corner, which on the fdp stacked on the study area's rail→hand gap.)
 *
 * The rise: cards pivot at TOP CENTRE (`transformOrigin: "50% 0"`), so a top corner sits
 * half a card-width from the pivot and lifts by (half-width) · sin θ. The card is the
 * hand's width less both insets, so half-width = 50cqw − inset (the hand is a size
 * container). The shift is applied AFTER the rotate, i.e. along the tilted axis, so it
 * carries the corner back down by shift · sin θ. Expressed in `cqw` so the corner touches
 * on every phone width, not just the one it was measured on. (The cos θ term on the
 * card's height is < 0.5px and ignored.)
 */
const FAN_TOP = `calc((50cqw - ${FAN_BACK_INSET + FAN_BACK_SHIFT}px) * ${Math.sin((FAN_TILT_DEG * Math.PI) / 180).toFixed(5)})`;

/** Geometry of the three fan slots. The steps are unchanged; only the start moved. */
const SLOTS = {
    backLeft: { top: FAN_TOP, inset: FAN_BACK_INSET, zIndex: 1, transform: `rotate(-${FAN_TILT_DEG}deg) translateX(-${FAN_BACK_SHIFT}px)` },
    backRight: { top: `calc(${FAN_TOP} + ${FAN_STEP}px)`, inset: FAN_BACK_INSET, zIndex: 2, transform: `rotate(${FAN_TILT_DEG}deg) translateX(${FAN_BACK_SHIFT}px)` },
    front: { top: `calc(${FAN_TOP} + ${2 * FAN_STEP}px)`, inset: 2, zIndex: 3, transform: "none" },
} as const;

/**
 * The compact fan, off the design's `.rstk` (back cards `top:0; bottom:16px` at ±3° /
 * ±6px, the played `.rfc` card `top:12px; bottom:0` full width). `bottom` is per slot here
 * because, unlike the full fan, the back cards stop short of the floor.
 */
const COMPACT_SLOTS = {
    backLeft: { top: 0, bottom: 16, inset: 4, zIndex: 1, transform: "rotate(-3deg) translateX(-6px)" },
    backRight: { top: 0, bottom: 16, inset: 4, zIndex: 2, transform: "rotate(3deg) translateX(6px)" },
    front: { top: 12, bottom: 0, inset: 0, zIndex: 3, transform: "none" },
} as const;

/**
 * The numeral's tracking. Browsers add letter-spacing after the LAST glyph too, so a
 * negative value ends the numeral's box 0.06em short of its ink on the right and centres
 * whatever sits under it (the "cards" label or the hairline) ~3.5px (at 118px) LEFT of the
 * digits. The numeral pads that much back on its right so its box is centred on its ink.
 * Measured, not assumed: every Instrument Sans `tnum` digit's ink — and a 2's foot bar —
 * is centred in its 0.6em advance to within 0.005em (the 1 sits 0.035em right, as a 1
 * does), and "cards" is centred in its own box, so the trailing tracking was the whole
 * offset.
 */
const NUMERAL_TRACKING_EM = -0.06;

/**
 * `figureMark: "label"` — the numeral ↔ "cards" spacing. The two line boxes carry empty
 * space the eye does not count: the numeral's box runs `NUMERAL_FOOT_EM` below its
 * digits' baseline (Instrument Sans, descent 0.25em less the half-leading
 * `SLOT_LINE_HEIGHT` 0.85 trims), and the label's box (line-height 1) runs
 * `CAPTION_XHEIGHT_TOP_EM` above its lowercase x-height. Both are cancelled with negative
 * margins — each in its OWN em, so the trim tracks the numeral's 56–118px clamp — leaving
 * `CAPTION_GAP_PX` as the true baseline → x-height gap (user: "much closer", then 6px was
 * "too close", 2026-10-12; it was ~21px at 118px). Re-derive the two em values if
 * `FONTS.sans`, `SLOT_LINE_HEIGHT` or the label's line-height changes.
 */
const NUMERAL_FOOT_EM = 0.065;
const CAPTION_XHEIGHT_TOP_EM = 0.35;
const CAPTION_GAP_PX = 10;

/**
 * `figureMark: "rule"` — the design's hairline geometry (`.bignum:after`), measured from
 * the numeral's untrimmed box exactly as the artboard draws it.
 */
const FIGURE_GAP = 2;              // numeral ↔ hairline flex gap
const HAIRLINE_MARGIN_TOP = 11;
const HAIRLINE_HEIGHT = 2;

/** Named because `useCrampedFigure` re-adds it, so the sx and the measurement cannot drift. */
const GO_MARGIN_BOTTOM = 13;
/**
 * Clear space the numeral (+ its mark) must keep above AND below inside the figure box.
 * Once the box cannot give it this much, the numeral moves into the head — the switch is
 * meant to happen when it starts to look cramped, not when it actually collides.
 */
const FIGURE_BREATHING_ROOM = 16;

/**
 * Whether the full hand's front card is too short to centre its numeral in the figure
 * box (see "The cramped layout" in the docblock).
 *
 * LOOP-FREE by construction: every input is independent of the answer. The card's height
 * comes from its absolute `top`/`bottom` in the hand, the numeral is `30cqh` of the hand,
 * the `Start` bar is fixed, and the head is taken as ONE line of the name (its computed
 * line-height, not its rendered height — in the cramped layout the name may wrap beside a
 * wide numeral, and measuring that would hold the hand cramped after it had grown back).
 * So the "roomy" figure box can be computed even while the cramped layout is showing, and
 * no hysteresis is needed.
 *
 * Re-measured whenever the HAND resizes, and when `figureMark` changes (the only other input).
 */
function useCrampedFigure(handRef: React.RefObject<HTMLDivElement | null>, enabled: boolean, figureMark: FigureMark): boolean {
    const [cramped, setCramped] = useState(false);
    useLayoutEffect(() => {
        const hand = handRef.current;
        if (!enabled || !hand) return;
        const measure = () => {
            const card = hand.querySelector<HTMLElement>(".study-hand__card--front");
            const label = card?.querySelector<HTMLElement>(".study-hand__label");
            const numeral = card?.querySelector<HTMLElement>(".study-hand__figure-number");
            // The label or the hairline, whichever `figureMark` drew.
            const foot = card?.querySelector<HTMLElement>(".study-hand__figure-foot");
            const go = card?.querySelector<HTMLElement>(".study-hand__go");
            if (!card || !label || !numeral || !foot || !go) return;
            const cardStyle = getComputedStyle(card);
            const inner = card.clientHeight - parseFloat(cardStyle.paddingTop) - parseFloat(cardStyle.paddingBottom);
            // One line of the name. `lineHeight` can come back as "normal"; fall back to
            // the rendered height then (exact whenever the name is on one line).
            const labelLine = parseFloat(getComputedStyle(label).lineHeight);
            const headHeight = Number.isFinite(labelLine) ? labelLine : label.offsetHeight;
            const roomyFigureBox = inner - headHeight - go.offsetHeight - GO_MARGIN_BOTTOM;
            // Numeral top → label/hairline bottom, as laid out — the label's negative
            // margins make a sum of offsetHeights wrong. The same in the roomy and cramped
            // layouts (only the grid area moves), so this stays loop-free.
            const figureHeight = foot.getBoundingClientRect().bottom - numeral.getBoundingClientRect().top;
            const needed = figureHeight + 2 * FIGURE_BREATHING_ROOM;
            setCramped(roomyFigureBox < needed);
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(hand);
        return () => observer.disconnect();
    // `figureMark` too: the feature-tester si toggle swaps label ↔ hairline live, which
    // changes the figure's height without resizing the hand.
    }, [handRef, enabled, figureMark]);
    return enabled && cramped;
}

/**
 * The loading shake — a light tremor, side to side. Fast (~90–130ms a cycle) and
 * deliberately IRREGULAR: uneven amplitudes at uneven offsets, so it reads as a tremor
 * rather than a metronome. Each slot has its OWN period and phase so the three cards
 * rattle independently instead of as one rigid fan.
 *
 * It travels the SWIPE's trajectory: a dragged card tilts by `x · DRAG_TILT` degrees
 * (useHandSwipe), pivoting at the card's top centre, so every keyframe here pairs its
 * horizontal offset with exactly that tilt — the shake is a tiny, rapid back-and-forth
 * throw, not a sideways slide. Same constant, so tuning the swipe's lean retunes this.
 *
 * Animated on the individual `translate` / `rotate` properties, NOT `transform`: the slot
 * geometry already owns `transform` (and its transition), and the individual properties
 * compose with it. flpLaunch.ts's exit then animates `translate` on top of this (a later
 * animation wins).
 */
const HAND_SHAKE_OFFSETS_PX: Record<string, number> = {
    "0%, 100%": 0,
    // Peak ±2px (was ±4px — read as too aggressive on 2026-10-10).
    "15%": -2,
    "30%": 1.5,
    "45%": -1,
    "60%": 2,
    "80%": -1.5,
};
const HAND_SHAKE_KEYFRAMES = Object.fromEntries(
    Object.entries(HAND_SHAKE_OFFSETS_PX).map(([at, x]) => [
        at,
        { translate: `${x}px 0px`, rotate: `${x * DRAG_TILT}deg` },
    ])
);
/** Per-slot period and phase. Linear timing: a tremor has no ease. */
const HAND_SHAKE_BEAT: Record<keyof typeof SLOTS, { durationMs: number; delayMs: number }> = {
    front: { durationMs: 110, delayMs: 0 },
    backRight: { durationMs: 130, delayMs: -45 },
    backLeft: { durationMs: 90, delayMs: -30 },
};

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

export const StudyHand: React.FC<StudyHandProps> = ({ cards, initialOrder, onStudy, variant = "full", className, shaking = false, figureMark = "rule" }) => {
    const compact = variant === "compact";
    // The fan is the single source of truth for where every card sits. Seeded from the
    // host's remembered fan when it has one, else FAN_ORDER (Study Mix forward).
    const [order, setOrder] = useState<HandOrder>(() => initialOrder ?? FAN_ORDER);

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

    // The compact hand (Reading Center) sits mid-page in a scrolling column, so its throw
    // is locked to left/right and vertical drags scroll the page — like the Center's
    // swipe-grid tiles. The fdp's full hand keeps the free, any-direction throw.
    const swipe = useHandSwipe(handleSwipe, compact ? "horizontal" : "free");

    // Full hand only: on a short frame the figure moves beside the name.
    const handRef = useRef<HTMLDivElement | null>(null);
    const cramped = useCrampedFigure(handRef, !compact, figureMark);

    return (
        <Box
            ref={handRef}
            className={[
                "study-hand",
                cramped ? "study-hand--cramped" : null,
                shaking ? "study-hand--shaking" : null,
                className ?? null,
            ].filter(Boolean).join(" ")}
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
                // A shaking hand has already committed — no promotions, throws or second
                // Start while the session loads.
                pointerEvents: shaking ? "none" : undefined,
                "@keyframes studyHandShake": HAND_SHAKE_KEYFRAMES,
            }}
        >
            {cards.map((card) => {
                const slot = slotOf(card.id);
                const isFront = slot === "front";
                const geometry = compact ? COMPACT_SLOTS[slot] : { ...SLOTS[slot], bottom: 0 };
                // Ineligibility dims the COMMIT only. The card's fill and opacity stay
                // put: a zero count is a normal, frequent outcome and must not read as a
                // broken card (see "a zero is not a fault" in the docblock).
                const greyed = card.eligible === false;
                // `backRight` is the card the next swipe promotes — the one uncovered as
                // the played card is thrown clear. It therefore renders the FULL front
                // face (big numeral, commit button) while still in the fan,
                // so the number is already legible mid-drag and already in its final
                // position when the promotion lands. See "The full face is pre-rendered"
                // in the docblock.
                // WHO WEARS THE TAG. A back card always states its count — it has no big
                // numeral of its own. The front card wears one only on a landed zero, and
                // then it is a sentence, not a count (see "The quantity tag").
                const figureKnown = card.figure !== undefined;
                const isZero = card.figure === 0;
                const tagText = isFront
                    ? (isZero ? card.zeroMessage ?? "" : "")
                    : (figureKnown ? `${card.figure!.toLocaleString()} ${card.figureCaption}` : "");
                const isNextUp = slot === "backRight";
                const showsFace = isFront || isNextUp;
                // Only the played card is draggable, so it alone carries the ref the
                // gesture measures its dismissal threshold against.
                const isBeingDragged = isFront && swipe.isDragging;
                // Only the PLAYED card ever takes the cramped layout. The two back cards
                // keep the roomy format no matter what — including `backRight`'s
                // pre-rendered face — so the fan always reads the same; a promotion into
                // a cramped front swaps layouts at t=0 like every other promotion change.
                const crampedFace = cramped && isFront;
                return (
                    <Box
                        key={card.id}
                        ref={isFront ? swipe.cardRef : undefined}
                        // `--slot-*` names the fan position (front / backRight / backLeft);
                        // flpLaunch.ts's FDP_EXIT picks each card's exit side off it.
                        className={`study-hand__card study-hand__card--${card.id} study-hand__card--${isFront ? "front" : "back"} study-hand__card--slot-${slot}`}
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
                            bottom: geometry.bottom,
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
                            // The loading shake (see HAND_SHAKE_KEYFRAMES) — each slot on
                            // its own beat. Reduced motion: the cards hold still.
                            animation: shaking
                                ? `studyHandShake ${HAND_SHAKE_BEAT[slot].durationMs}ms linear ${HAND_SHAKE_BEAT[slot].delayMs}ms infinite`
                                : "none",
                            "@media (prefers-reduced-motion: reduce)": { animation: "none" },
                            // Full hand: the throw is omnidirectional, so the played card
                            // claims the touch on BOTH axes (`none`) — the page/sheet beneath
                            // is scrolled from anywhere but this card. Compact hand: `pan-y`,
                            // the throw is horizontal-only and vertical drags scroll. The
                            // hook owns the value so it cannot disagree with its claim rule.
                            ...(isFront ? { touchAction: swipe.frontTouchAction } : {}),
                            backgroundColor: RAMP[card.hue].surface,  // v2 "Surface: … the fanned cards"
                            borderRadius: compact ? "20px" : "22px",
                            border: `1px solid ${COLORS.border}`,
                            padding: compact ? "16px 16px 16px 18px" : isFront ? "15px 16px 14px" : "10px 16px 14px",
                            boxShadow: isFront
                                // The front card carries a shadow ABOVE it as well, so it
                                // reads as lifted off the two behind rather than pasted on.
                                ? "0 -2px 5px rgba(20,18,26,0.05), 0 10px 26px rgba(20,18,26,0.16)"
                                : SHADOW.cardRest,
                            // The full FACE is a grid so the figure can change place as one
                            // DOM node — see "The cramped layout". Roomy: the figure fills the
                            // middle row under the name. Cramped: the name takes only its own
                            // width (`auto`), and the figure fills the whole right-hand block
                            // beside it — from the card's top padding down to `Start`, and from
                            // the name's right edge to the card's — centring in it on both
                            // axes. Everything else stays a flex column.
                            ...(!compact && showsFace
                                ? {
                                    display: "grid",
                                    gridTemplateColumns: crampedFace ? "auto minmax(0, 1fr)" : "minmax(0, 1fr)",
                                    gridTemplateRows: "auto minmax(0, 1fr) auto",
                                    gridTemplateAreas: crampedFace
                                        ? `"head figure" ". figure" "go go"`
                                        : `"head" "figure" "go"`,
                                    columnGap: crampedFace ? "12px" : 0,
                                }
                                : { display: "flex", flexDirection: "column" }),
                            cursor: isFront ? (isBeingDragged ? "grabbing" : "grab") : "pointer",
                            overflow: "hidden",
                        }}
                    >
                        {compact ? (
                            // COMPACT FACE — the design's `.rfc`: glyph top-left, name and a
                            // rounded-square → launch button along the foot. Drawn on the played card and on
                            // the one queued behind it (pre-rendered, as in the full hand);
                            // the bottom card stays a blank coloured edge.
                            showsFace && (
                                <Box className="study-hand__compact-face" sx={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                                    <Icon name={card.glyph ?? "menu_book"} size={24} color={COLORS.onSurface} sx={{ opacity: 0.72 }} />
                                    <Box sx={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "12px" }}>
                                        <Typography
                                            component="b"
                                            className="study-hand__label"
                                            sx={{ fontFamily: FONTS.sans, fontSize: 24, fontWeight: WEIGHT.bold, letterSpacing: "-0.03em", lineHeight: 1.05, color: COLORS.onSurface, maxWidth: 170 }}
                                        >
                                            {card.label}
                                        </Typography>
                                        <RoundPlayButton
                                            size="hand"
                                            // A rounded square with a → rather than the
                                            // games' ▶ circle: the 14px corner matches the
                                            // full hand's `Start` bar.
                                            shape="square"
                                            glyph="arrow"
                                            className="study-hand__go study-hand__go--square"
                                            ariaLabel={isFront ? `Start ${card.label}` : undefined}
                                            // Inert on the queued card, exactly as the full
                                            // hand's button is (see its comment below).
                                            onClick={isFront ? () => onStudy(card.id, order) : undefined}
                                            disabled={!isFront}
                                            tabIndex={isFront ? undefined : -1}
                                            ariaHidden={isFront ? undefined : true}
                                            // Ineligible dims the COMMIT only, never the card.
                                            greyed={greyed}
                                            sx={isFront ? undefined : { pointerEvents: "none" }}
                                        />
                                    </Box>
                                </Box>
                            )
                        ) : (<>
                        <Box
                            className="study-hand__head"
                            sx={{
                                gridArea: "head",
                                display: "flex",
                                // Cramped: the space right of the name is the figure's, so a
                                // zero card's tag drops UNDER the name instead of beside it.
                                ...(crampedFace
                                    ? { flexDirection: "column", alignItems: "flex-start", gap: "4px", minWidth: 0 }
                                    : { alignItems: "center", gap: "9px" }),
                                // Name LEFT, tag RIGHT — on the front card and on the one
                                // queued directly behind it. `backLeft` clusters its head
                                // right: it is two promotions away, and its left side is
                                // the part the fan's overlap eats first, so a name pinned
                                // there would slide under another card.
                                justifyContent: showsFace ? "space-between" : "flex-end",
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
                            {/* The QUANTITY TAG. Always mounted so its copy can cross-fade
                                rather than pop: it is empty on a front card with a count to
                                show (the big numeral has that job), empty on a back card
                                whose count has not landed yet — four cramped mono characters
                                in a corner are too small for a placeholder to read as
                                anything but a wrong number — and otherwise carries the
                                count, or the zero sentence on the front card. */}
                            <Typography
                                component="em"
                                className="study-hand__meta"
                                sx={{
                                    fontStyle: "normal",
                                    fontFamily: FONTS.mono,
                                    fontSize: 10,
                                    color: COLORS.iconColor,
                                    whiteSpace: "nowrap",
                                    opacity: tagText ? 1 : 0,
                                    transition: "opacity 320ms ease",
                                }}
                            >
                                {tagText}
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
                                        gridArea: "figure",
                                        minHeight: 0,
                                        display: "flex",
                                        flexDirection: "column",
                                        // Centred in whichever block the grid gives it — the
                                        // middle of the card, or (cramped) the space beside the
                                        // name and above `Start`.
                                        alignItems: "center",
                                        justifyContent: "center",
                                        // The hairline hangs off the numeral's full box with
                                        // the design's 2px gap; the label sets its own
                                        // (negative) spacing — see `NUMERAL_FOOT_EM`.
                                        gap: figureMark === "rule" ? `${FIGURE_GAP}px` : 0,
                                    }}
                                >
                                    <Typography
                                        component="b"
                                        // Measured by `useCrampedFigure` — keep the class.
                                        className="study-hand__figure-number"
                                        sx={{
                                            // Its height is a measurement input; it must
                                            // never wrap beside the name.
                                            whiteSpace: "nowrap",
                                            fontFamily: FONTS.sans,
                                            // 118px is the artboard's size; `clamp` down to
                                            // the height the slot actually has, because the
                                            // hand shrinks when the Centers rail is present
                                            // and a fixed 118px numeral would clip.
                                            fontSize: "clamp(56px, 30cqh, 118px)",
                                            fontWeight: 800,
                                            letterSpacing: `${NUMERAL_TRACKING_EM}em`,
                                            // Undo the trailing tracking so the box (which
                                            // the caption centres on) is centred on the ink.
                                            paddingRight: `${-NUMERAL_TRACKING_EM}em`,
                                            // Must match `SlotNumber`'s reel window, or
                                            // the figure would change height at the moment
                                            // the reels are swapped for the settled text.
                                            lineHeight: SLOT_LINE_HEIGHT,
                                            fontVariantNumeric: "tabular-nums",
                                            color: COLORS.onSurface,
                                            // Under the label only: drop the box below the
                                            // digits' baseline — see `NUMERAL_FOOT_EM`.
                                            marginBottom: figureMark === "label" ? `-${NUMERAL_FOOT_EM}em` : 0,
                                        }}
                                    >
                                        {/* The figure spins as a slot-machine reel until
                                            its count arrives, then lands on it. This is the
                                            card's whole loading state — one thing moving on
                                            a card reads as "fetching", two read as noise. */}
                                        <SlotNumber value={card.figure} className="study-hand__figure-value" />
                                    </Typography>
                                    {/* WHAT SITS UNDER THE NUMERAL — a soft introduction
                                        (`figureMark`, docs/SOFT_INTRODUCTION.md). Either one
                                        anchors a 118px numeral in an otherwise empty panel; both
                                        carry `study-hand__figure-foot`, which `useCrampedFigure`
                                        measures — keep the class. Both are drawn while the reel
                                        spins too, so the figure never changes height on arrival,
                                        and both move with the numeral in the cramped layout. */}
                                    {figureMark === "label" ? (
                                        /* INTRO: a small "cards" in the numeral's own face, so
                                           the learner learns what the number counts (user,
                                           2026-10-12; an underline was tried and dropped). */
                                        <Typography
                                            component="span"
                                            className="study-hand__figure-foot study-hand__figure-caption"
                                            sx={{
                                                fontFamily: FONTS.sans,
                                                fontSize: SIZE.bodyLg,
                                                fontWeight: WEIGHT.semibold,
                                                lineHeight: 1,
                                                textTransform: "lowercase",
                                                color: COLORS.iconColor,
                                                whiteSpace: "nowrap",
                                                // Pull the x-height up to `CAPTION_GAP_PX` under
                                                // the digits' baseline — see `NUMERAL_FOOT_EM`.
                                                marginTop: `calc(${CAPTION_GAP_PX}px - ${CAPTION_XHEIGHT_TOP_EM}em)`,
                                            }}
                                        >
                                            {card.figureCaption}
                                        </Typography>
                                    ) : (
                                        /* GRADUATED: the design's ink hairline (`.bignum:after`,
                                           v2 draws it in ink) — the only rule on the card. */
                                        <Box
                                            className="study-hand__figure-foot study-hand__figure-rule"
                                            sx={{
                                                width: 34,
                                                height: HAIRLINE_HEIGHT,
                                                borderRadius: "1px",
                                                backgroundColor: COLORS.onSurface,
                                                opacity: 0.5,
                                                marginTop: `${HAIRLINE_MARGIN_TOP}px`,
                                            }}
                                        />
                                    )}
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
                                    onClick={isFront ? () => onStudy(card.id, order) : undefined}
                                    disabled={!isFront}
                                    tabIndex={isFront ? undefined : -1}
                                    aria-hidden={isFront ? undefined : true}
                                    // "Start" alone does not say what is started; screen
                                    // readers get the same name as the compact hand's button.
                                    aria-label={isFront ? `Start ${card.label}` : undefined}
                                    sx={{
                                        ...(isFront ? {} : { pointerEvents: "none" }),
                                        gridArea: "go",
                                        marginBottom: `${GO_MARGIN_BOTTOM}px`,
                                        // Anchors the → pinned to the right edge below.
                                        position: "relative",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        backgroundColor: greyed ? COLORS.greyA : COLORS.onSurface,
                                        color: COLORS.white,
                                        border: "none",
                                        borderRadius: "14px",
                                        padding: "14px",
                                        fontFamily: FONTS.sans,
                                        // One step up the type scale from the design's 14px:
                                        // the commit is the card's one action, and at 14px it
                                        // read small under the 118px numeral.
                                        fontSize: SIZE.bodyLg,
                                        fontWeight: WEIGHT.semibold,
                                        cursor: "pointer",
                                    }}
                                >
                                    Start
                                    {/* The same → as the compact hand's square button
                                        (`RoundPlayButton glyph="arrow"`). Drawn at 20px
                                        against the 16px label because a Material glyph
                                        fills only ~2/3 of its box: at 20px the arrow stands
                                        about as tall as the label's letters. It is
                                        pinned to the bar's RIGHT EDGE (inset by the bar's own
                                        14px padding) rather than set beside the label, so the
                                        label stays centred on the card and the arrow points
                                        off the end of the bar. Absolute, so it takes no
                                        width from the label's centring. */}
                                    <Icon
                                        name="arrow_forward"
                                        size={20}
                                        color={COLORS.white}
                                        className="study-hand__go-arrow"
                                        sx={{ position: "absolute", right: "14px", top: "50%", transform: "translateY(-50%)" }}
                                    />
                                </Box>
                            </>
                        )}
                        </>)}
                    </Box>
                );
            })}
        </Box>
    );
};

export default StudyHand;
