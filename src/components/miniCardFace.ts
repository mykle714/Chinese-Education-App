/**
 * The mini preview card FACE — the one 92×132 tile every "here is a word" surface in
 * the app draws.
 *
 * ⚠️ THIS FILE EXISTS BECAUSE THE FACE WAS WRITTEN THREE TIMES. `MiniVocabCard` (td's
 * cards page, the provisional-card previews), `QuickMarkCard` (Quick Mark triage) and
 * `ChallengeWordCard` (the challenge word set) each re-declared the same size, radius,
 * fill, elevation and containment, and each one's comment said it was matching the
 * other two. They had already drifted: only `MiniVocabCard` carried the design's 1px
 * inset ring, so the same word rendered with a hairline border on the decks page and without
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
 * ⚠️ Cards don't call `miniCardFaceSx` directly any more: the one consumer is
 * `MiniCard` (src/components/MiniCard.tsx), which also owns the card's CONTENTS. Render
 * that instead of spreading this into a new card.
 *
 * Also holds the CONTENTS' geometry (MINI_CARD_CONTENT_LAYOUT, MINI_CARD_BAR_STRIP,
 * DEFINITION_*), read by MiniCard and by its SVG twin MiniCardSvg (miniCardSvgLayout.ts),
 * so the two place the icon, word and gloss on the same numbers.
 *
 * Referenced by docs/DECK_TOWER.md (the cards page), docs/QUICK_MARK.md,
 * docs/STUDY_CHALLENGE.md § 3.2, docs/CARD_LIBRARY.md and docs/SORT_CARDS_REQUIREMENTS.md.
 */
import { COLORS } from "../theme/colors";
import { SHADOW } from "../theme/shadows";
import { SIZE } from "../theme/scale";

/** The tile's footprint. Every mini card is exactly this, on every surface. */
export const MINI_CARD_WIDTH = 92;
export const MINI_CARD_HEIGHT = 132;

/**
 * The ONE sanctioned exception to "every mini card is exactly 92×132": a `compact`
 * face, 78×112 (the same ~0.70 ratio, ~0.85×). It is a real second geometry — MiniCard
 * re-lays its contents for it with smaller type — rather than a CSS `scale()` of the
 * regular face, so the text stays crisp and legible at the smaller size.
 *
 * Only the acp dock uses it, and only when a FULL 4-card pack would not fit across at
 * the regular size (a phone narrower than ~456px) — then every pack takes it, so the
 * dock's height never changes between packs (see AddCardsPage's `dockCardSize`). Every other surface stays on `regular`; a new caller should
 * only reach for `compact` when a row genuinely cannot fit, never as a style choice.
 *
 * Referenced by docs/SORT_CARDS_REQUIREMENTS.md § 4.5 ("Compact dock").
 */
export type MiniCardSize = "regular" | "compact";
export const MINI_CARD_DIMENSIONS: Record<MiniCardSize, { width: number; height: number }> = {
    regular: { width: MINI_CARD_WIDTH, height: MINI_CARD_HEIGHT },
    compact: { width: 78, height: 112 },
};
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
     * Raise the card one step on hover. For a card whose tap OPENS something (td's
     * cards page, where a tap opens the cdp). Omit where the tap acts in place — Quick Mark cycles a mark, so a
     * "raised, will take you somewhere" affordance would be a lie.
     */
    hoverLift?: boolean;
    /** Staggered pop-in on mount; the grid passes `index * step`. */
    animationDelayMs?: number;
    /** The face's footprint (see MINI_CARD_DIMENSIONS). Defaults to `regular`. */
    size?: MiniCardSize;
}

/**
 * The face, as an `sx` object to spread. Callers add their own positioning, their
 * badges and any state fill on top.
 *
 * ⚠️ `transition` is box-shadow ONLY — never add `transform` or `translate`. These cards
 * are track elements of `useScrollStretch`, which writes an inline `translate` every frame
 * during a scroll; a CSS transition on it re-filters each of those writes through an ease
 * curve and turns the elastic stretch into lag. The pop-in is a keyframe ANIMATION on
 * `transform` (a separate property from `translate`), so it composes with the stretch
 * even when a card pops in mid-scroll.
 */
export const miniCardFaceSx = ({ background, hoverLift = false, animationDelayMs, size = "regular" }: MiniCardFaceOptions) => ({
    width: MINI_CARD_DIMENSIONS[size].width,
    height: MINI_CARD_DIMENSIONS[size].height,
    backgroundColor: background,
    borderRadius: MINI_CARD_RADIUS,
    boxShadow: `${MINI_CARD_RING}, ${SHADOW.raised}`,
    transition: "box-shadow 0.2s ease-in-out",
    position: "relative" as const,
    overflow: "hidden" as const,
    // CSS containment: the browser skips layout/paint for cards scrolled out of view
    // (a real account's library holds hundreds). They stay in the DOM and tappable, and
    // `containIntrinsicSize` reserves the footprint so scroll height stays stable.
    contentVisibility: "auto" as const,
    containIntrinsicSize: `${MINI_CARD_DIMENSIONS[size].width}px ${MINI_CARD_DIMENSIONS[size].height}px`,
    // `backwards` fill holds the scaled-down start state during the delay.
    ...(typeof animationDelayMs === "number" && {
        animation: `cardPopIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) ${animationDelayMs}ms backwards`,
    }),
    // Elevation only — the card must NOT move on hover: a hover lift would add to the
    // inline `translate` useScrollStretch writes on this same element mid-scroll.
    ...(hoverLift && {
        "&:hover": { boxShadow: `${MINI_CARD_RING}, ${SHADOW.float}` },
    }),
});

// ── Content layout per face size ─────────────────────────────────────────────────
// Where the icon slot, the word and the definition sit, and at what type size. The
// `regular` column is the original 92×132 layout, unchanged. `compact` (78×112) is a
// genuine re-layout rather than a scaled copy: every offset shrinks roughly with the
// card (~0.85×), and the type steps down ONE notch on the existing scales — the cpcd
// switches to its own `compact` variant (16px glyphs / 9px pinyin at `xs`), es plain
// text 14 → 12px, and the definition SIZE.body → SIZE.caption — so no new font sizes
// are introduced. Referenced by docs/SORT_CARDS_REQUIREMENTS.md § 4.5 ("Compact dock").
// Read by MiniCard AND by MiniCardSvg (its SVG twin, which places the same contents by
// hand through miniCardSvgLayout.ts) — a change here reaches both.
export const MINI_CARD_CONTENT_LAYOUT: Record<MiniCardSize, {
    sideInset: number;
    iconTop: number;
    iconSize: number;
    keyTop: number;
    cpcdCompact: boolean;
    plainFontSize: string;
    definitionFontSize: string;
    definitionMinHeight: number;
}> = {
    regular: { sideInset: 8, iconTop: 14, iconSize: 26, keyTop: 46, cpcdCompact: false, plainFontSize: "14px", definitionFontSize: SIZE.body, definitionMinHeight: 24 },
    compact: { sideInset: 6, iconTop: 11, iconSize: 22, keyTop: 38, cpcdCompact: true, plainFontSize: "12px", definitionFontSize: SIZE.caption, definitionMinHeight: 20 },
};

/**
 * The mastery window strip's geometry (MiniCard → MasteryStrip, whose comment carries the
 * design rationale). Here because the definition's anchor depends on it.
 */
export const MINI_CARD_BAR_STRIP = {
    height: 3.5,      // v2 frame 17's hairline (`.mcd .mk`, was 3)
    cellGap: 1.5,     // the cdp's 3px gap does not survive the scale down; half of it does
    inset: 8,         // left AND right — the window spans the card
    bottom: 8,
};

/** How far (px) the definition sits below its natural anchor — see `miniCardDefinitionBottom`. */
export const DEFINITION_DROP = 2;
/**
 * Extra bottom padding (px) inside the definition's clip box, so descenders (g, y, p)
 * on the last line are not cut off. At `lineHeight: 1.05` a glyph's descender reaches
 * ~1px past its line box, and `overflow: hidden` (required by the line clamp) clips at
 * the padding edge. The box's `bottom` is lowered by the same amount, so the text itself
 * does not move. Kept at 2px on purpose: a clamped THIRD line starts right below the
 * second, and its ascenders sit ~2px under that line's top, so more padding than this
 * would let the hidden line peek through.
 */
export const DEFINITION_DESCENDER_ROOM = 2;
/** The definition's line height (× its font size) and its line clamp. */
export const DEFINITION_LINE_HEIGHT = 1.05;
export const DEFINITION_MAX_LINES = 2;

/**
 * How far (px) above the card's bottom edge the definition's text block ENDS: just above
 * the mastery strip when there is one, in the strip's place when there isn't, nudged
 * `DEFINITION_DROP` lower — the definition grows UPWARD from this anchor, so a two-line
 * gloss otherwise crowds the cpcd row above it (2026-09-28). Shared with MiniCardSvg.
 */
export function miniCardDefinitionBottom(hasMasteryStrip: boolean): number {
    return MINI_CARD_BAR_STRIP.bottom + (hasMasteryStrip ? MINI_CARD_BAR_STRIP.height + 5 : 0) - DEFINITION_DROP;
}
