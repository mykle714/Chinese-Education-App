/**
 * The mini preview card FACE — the one 92×132 tile every "here is a word" surface in
 * the app draws.
 *
 * ⚠️ THIS FILE EXISTS BECAUSE THE FACE WAS WRITTEN THREE TIMES. `MiniVocabCard` (the
 * fdp panel, collections, search), `QuickMarkCard` (Quick Mark triage) and
 * `ChallengeWordCard` (the challenge word set) each re-declared the same size, radius,
 * fill, elevation and containment, and each one's comment said it was matching the
 * other two. They had already drifted: only `MiniVocabCard` carried the design's 1px
 * inset ring, so the same word rendered with a hairline border on `/decks` and without
 * one in Quick Mark and in a challenge — visible side by side, and impossible to
 * attribute to any decision.
 *
 * The rule this encodes: **all three ARE the same card.** They differ in what drives
 * them (a `VocabEntry`, a `DiscoverCard`, a `ChallengeReviewWord`), in their corner
 * badges and in what a tap does — never in the tile. Anything about the tile itself
 * belongs here, so a change reaches all three at once and cannot half-land.
 *
 * The geometry is ALSO a grid contract: `MiniVocabCardGrid` lays out on these numbers,
 * which is what lets a caller swap its `renderCard` for one of the other two.
 *
 * Referenced by docs/DECKS_FEATURE.md (the fdp card previews), docs/QUICK_MARK.md and
 * docs/STUDY_CHALLENGE.md § 3.2.
 */
import { COLORS } from "../theme/colors";
import { SHADOW } from "../theme/shadows";

/** The tile's footprint. Every mini card is exactly this, on every surface. */
export const MINI_CARD_WIDTH = 92;
export const MINI_CARD_HEIGHT = 132;
/**
 * Tightened from 12px to 8px on 2026-09-01 — less round, so the tile reads as a card
 * rather than a chip at this size. One edit, because all three mini cards take their
 * radius from here; before the extraction it would have been three.
 */
export const MINI_CARD_RADIUS = "8px";

/**
 * The design's hairline ring (`.mcd`), as an INSET box-shadow rather than a border.
 *
 * ⚠️ Inset shadow, never `border`. Everything on the face — the icon layer, the corner
 * badges, the mastery strip — is absolutely positioned against the card box, and a real
 * border insets the padding box and shifts all of it by 1px. The inset ring paints over
 * the content instead and follows the 12px radius.
 *
 * Exported on its own so a card composing a fancier shadow (the challenge card's
 * selected state adds an outer 2px ring) can keep the hairline rather than dropping it.
 */
export const MINI_CARD_RING = `inset 0 0 0 1px ${COLORS.border}`;

export interface MiniCardFaceOptions {
    /** The tile's fill. Almost always the theme's `palette.flashcard.flashCard`. */
    background: string;
    /**
     * Raise the card one step on hover. For a card whose tap OPENS something (the fdp
     * previews). Omit where the tap acts in place — Quick Mark cycles a mark, so a
     * "raised, will take you somewhere" affordance would be a lie.
     */
    hoverLift?: boolean;
    /** Staggered pop-in on mount; the grid passes `index * step`. */
    animationDelayMs?: number;
}

/**
 * The face, as an `sx` object to spread. Callers add their own positioning, their
 * badges and any state fill on top.
 *
 * ⚠️ `transition` is box-shadow ONLY — never add `transform`. These cards are track
 * elements of `useScrollStretch`, which writes an inline transform every frame during a
 * scroll; a CSS transition on transform re-filters each of those writes through an ease
 * curve and turns the elastic stretch into lag. The pop-in is a keyframe ANIMATION, not
 * a transition, so it is unaffected — it runs at mount, when nothing is scrolling.
 */
export const miniCardFaceSx = ({ background, hoverLift = false, animationDelayMs }: MiniCardFaceOptions) => ({
    width: MINI_CARD_WIDTH,
    height: MINI_CARD_HEIGHT,
    backgroundColor: background,
    borderRadius: MINI_CARD_RADIUS,
    boxShadow: `${MINI_CARD_RING}, ${SHADOW.raised}`,
    transition: "box-shadow 0.2s ease-in-out",
    position: "relative" as const,
    overflow: "hidden" as const,
    // CSS containment: the browser skips layout/paint for cards scrolled out of view
    // (a real account's /decks holds hundreds). They stay in the DOM and tappable, and
    // `containIntrinsicSize` reserves the footprint so scroll height stays stable.
    contentVisibility: "auto" as const,
    containIntrinsicSize: `${MINI_CARD_WIDTH}px ${MINI_CARD_HEIGHT}px`,
    // `backwards` fill holds the scaled-down start state during the delay.
    ...(typeof animationDelayMs === "number" && {
        animation: `cardPopIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) ${animationDelayMs}ms backwards`,
    }),
    // Elevation only — the card must NOT translate on hover, or it fights the inline
    // transform useScrollStretch writes on this same element mid-scroll.
    ...(hoverLift && {
        "&:hover": { boxShadow: `${MINI_CARD_RING}, ${SHADOW.float}` },
    }),
});
