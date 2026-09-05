import { Box, Card, Typography } from "@mui/material";
import { styled, alpha, keyframes } from "@mui/material/styles";
import { CORRECT_COLOR, INCORRECT_COLOR, FC_FONT } from "../constants";
import { FONTS } from "../../../theme/fonts";
import { SIZE, WEIGHT } from "../../../theme/scale";
import { COLORS } from "../../../theme/colors";

// IPhoneFrame removed — phone-frame sizing comes from MobileDemoFrame via Layout.tsx.

export const InfoCard = styled(Card)(({ theme }) => ({
    backgroundColor: theme.palette.background.paper,
    borderRadius: "12px",
    boxShadow: theme.palette.flashcard.cardShadow,
    overflow: "hidden", // clip the dark TabHeader inside the card's rounded corners
    position: "relative",
    zIndex: 2,
    userSelect: "none",
    WebkitUserSelect: "none",
    MozUserSelect: "none",
    msUserSelect: "none",
    touchAction: "pan-y",
    display: "flex",
    flexDirection: "column",
}));

// Headword + translation + audio row below the grabber, separated from tabs by a rule.
export const InfoSheetEntryHeader = styled(Box)(({ theme }) => ({
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "8px 18px 18px",
    borderBottom: `1px solid ${theme.palette.flashcard.border}`,
    flexShrink: 0,
}));

// Strip of "entry tabs" sitting above the grabber/header. One tab per looked-up
// dictionary entry inside the current EIP. The strip is unmounted entirely
// when only the root entry is open (EipTabStrip handles that). Padding mirrors
// InfoSheetTabStrip's horizontal padding so tab edges align with the
// underline tab strip below.
// `.wtrail` — the WORD TRAIL: the words that have been opened in this panel, and how
// you get back to one. NOT a second content tab strip: the three content tabs
// (definition / examples / breakdown) are `InfoSheetTabStrip` directly below it, and
// two underline strips stacked would have read as one two-row control.
//
// That distinction is why the trail's pills are ROUNDED and FILLED while the content
// tabs are underlined — the two strips answer different questions ("which word?" vs
// "what about it?"), so they are deliberately different shapes.
// No bottom rule: the trail's filled pills already read as their own band, and a hairline
// under them stacked with the content tabs' own rule directly below, which made the two
// strips read as one boxed two-row control.
export const EipTabStripContainer = styled(Box)(() => ({
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: "11px 16px 12px",
    flexShrink: 0,
    overflow: "hidden",
}));

// Entrance keyframes for a trail pill (see EipEntryTab). Kept as a `keyframes` const so
// the animation is emitted with the component's own styles rather than a global rule.
const eipPillIn = keyframes({
    from: { opacity: 0, maxWidth: 0, paddingLeft: 0, paddingRight: 0, transform: "scale(0.9)" },
    to: { opacity: 1, maxWidth: "240px", paddingLeft: "11px", paddingRight: "11px", transform: "scale(1)" },
});

// One word in the trail. The showing word is INK; the rest are grey — a plain
// present/absent contrast rather than a per-tab hue.
//
// The tone-coloured fill this used to carry is gone. Tone colour means ONE thing in
// this app (a syllable's tone, D2b), and a pill tinted by a colour picked at random
// from the tone palette was borrowing that vocabulary to say "tab 3" — on a strip
// sitting directly above cpcd rows where the same five colours mean their real thing.
// `toneColor` survives on the tab MODEL (useEipTabs) because nothing else assigns tab
// identity yet; it is simply no longer painted.
export const EipEntryTab = styled(Box, {
    shouldForwardProp: (prop) => prop !== "isActive" && prop !== "toneColor",
})<{ isActive: boolean; toneColor: string }>(({ isActive, theme }) => ({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "6px 11px",
    borderRadius: "999px",
    background: isActive ? COLORS.onSurface : COLORS.grey,
    color: isActive ? COLORS.white : theme.palette.flashcard.textSecondary,
    cursor: "pointer",
    fontFamily: FONTS.cjk,
    fontSize: 14,
    fontWeight: WEIGHT.bold,
    letterSpacing: "0.01em",
    lineHeight: 1.1,
    userSelect: "none",
    whiteSpace: "nowrap",
    transition: "background 0.15s ease",
    flexShrink: 0,
    // Entrance: a pill only ever mounts when a word is ADDED to the trail, so a
    // mount-time keyframe is the whole trigger — no state, no flag to reset. It widens
    // from nothing (max-width + horizontal padding/margin) so the pills already on the
    // strip are pushed aside rather than jumped aside, and rises to full opacity, in step
    // with the panel slide that shows the same word's content (InfoCardSection).
    // max-width, not width: the resting size stays intrinsic to the label.
    animation: `${eipPillIn} 240ms cubic-bezier(0.22, 1, 0.36, 1) both`,
}));

// `.tabs2` — the eip's CONTENT tabs: which question about this word is being
// answered. Underlined rather than filled, because the word trail directly above it is
// the filled shape; the two strips must not read as one two-row control.
export const InfoSheetTabStrip = styled(Box)(({ theme }) => ({
    display: "flex",
    gap: 0,
    padding: "0 14px",
    borderBottom: `1px solid ${theme.palette.flashcard.border}`,
    flexShrink: 0,
}));

// One content tab. The active one is inked and carries a 2px underline drawn as an
// INSET SHADOW rather than a border: a border changes the box's height, so the strip
// used to shift by a pixel as the selection moved.
//
// An EMPTY tab (no examples, no breakdown) stays legible but is dimmed — it is still a
// real destination that says "nothing here for this word", which is an answer.
export const InfoSheetTab = styled(Box, {
    shouldForwardProp: (prop) => prop !== "isActive" && prop !== "isEmpty",
})<{ isActive: boolean; isEmpty?: boolean }>(({ isActive, isEmpty, theme }) => ({
    flex: 1,
    textAlign: "center",
    padding: "11px 2px 10px",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    boxShadow: isActive ? `inset 0 -2px 0 ${theme.palette.flashcard.tabUnderline}` : "none",
    fontFamily: FC_FONT,
    userSelect: "none",
    opacity: isEmpty && !isActive ? 0.4 : 1,
    transition: "opacity 0.2s ease, box-shadow 0.2s ease",
}));

export const ArrowIndicator = styled(Box)(({ theme }) => ({
    position: "absolute",
    top: "50%",
    transform: "translateY(-50%)",
    color: theme.palette.flashcard.textSecondary,
    opacity: 0.4,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    zIndex: 5,
    transition: "opacity 0.2s ease-in-out",
    "&:hover": {
        opacity: 0.7,
    },
}));

export const BreakdownLineItem = styled(Box)(({ theme }) => ({
    display: "flex",
    alignItems: "center",
    gap: 36,
    padding: "3px 8px 3px 2px",
    borderBottom: `1px dashed ${theme.palette.flashcard.border}`,
    "&:last-child": {
        borderBottom: "none",
    },
}));

export const DefinitionColumn = styled(Box)(() => ({
    flex: 1,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    height: "100%",
    textAlign: "right",
}));

export const DefinitionText = styled(Typography)(({ theme }) => ({
    fontSize: SIZE.caption,
    color: theme.palette.flashcard.onSurface,
    lineHeight: "16px",
    fontFamily: FC_FONT,
}));

// Info-tab metadata row: category/POS chips, centered above the long definition.
// (HSK/difficulty no longer rides here — it is a chip in the definition meta strip.)
export const MetadataChipRow = styled(Box)(() => ({
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 10,
}));

export const PosChip = styled(Box)(({ theme }) => ({
    border: `1px solid ${theme.palette.flashcard.border}`,
    color: theme.palette.flashcard.onSurface,
    fontFamily: FC_FONT,
    fontSize: SIZE.micro,
    fontWeight: WEIGHT.medium,
    padding: "2px 8px",
    borderRadius: 999,
    lineHeight: 1.2,
}));

// Section header above the shared-characters list inside the info tab.
// Mirrors the "Expanded Form" label in the literal tab.
export const SharedCharsLabel = styled(Typography)(({ theme }) => ({
    fontSize: SIZE.caption,
    color: theme.palette.flashcard.textSecondary,
    fontFamily: FC_FONT,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    textAlign: "center",
    marginBottom: 6,
}));

export const SharedCharsSection = styled(Box)(({ theme }) => ({
    marginTop: 16,
    paddingTop: 12,
    borderTop: `1px dashed ${theme.palette.flashcard.border}`,
}));


export const ContentArea = styled(Box)(() => ({
    flex: 1,
    minHeight: 0, // allow flex to bound height (prevents content from stretching parent)
    overflow: "hidden",
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    alignItems: "center",
    position: "relative", // containing block for EicSheet/EicBackdrop overlays
    // Make non-CPCD text within the flashcard area + EIP unselectable so taps,
    // long-presses, and drags don't accidentally start text selection. CPCD
    // characters/pinyin remain selectable so users can copy individual chars.
    userSelect: "none",
    WebkitUserSelect: "none",
    "& .char-pinyin-display, & .char-pinyin-display *": {
        userSelect: "text",
        WebkitUserSelect: "text",
    },
}));

// Centered pill button at the bottom of ContentArea that opens the EIC sheet.
// Ghosted (opacity 0.32) before the card is flipped; full opacity after.
// `hintActive` drives a gentle bounce animation to signal discoverability after the first flip.
// While the icon editor is open the pill stays DRAWN but greyed + inert (`isDisabled`). It stays
// VISIBLE in advanced mode too: the card no longer travels down over it (the slot reserves the
// toolbar's band at its TOP instead — see DraggableCardContainer's toolbarInset).
export const MoreInfoPill = styled(Box, {
    shouldForwardProp: (prop) => prop !== "isFlipped" && prop !== "hintActive" && prop !== "isDisabled",
})<{ isFlipped: boolean; hintActive?: boolean; isDisabled?: boolean }>(({ isFlipped, hintActive, isDisabled, theme }) => ({
    position: "absolute",
    bottom: 24,
    left: "50%",
    transform: "translateX(-50%)",
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: theme.palette.flashcard.moreInfoPill,
    border: `1px solid ${theme.palette.flashcard.border}`,
    borderRadius: 999,
    padding: "7px 16px 7px 14px",
    cursor: isDisabled ? "default" : "pointer",
    fontFamily: FC_FONT,
    zIndex: 2,
    // Greyed & inert while editing; otherwise faded until the card is flipped (extra info
    // only applies to the flipped/answer side).
    opacity: isDisabled ? 0.32 : isFlipped ? 1 : 0.32,
    // Only the editor case swallows taps. A pre-flip tap must still REACH the handler —
    // that is what raises the "flip the card first" tooltip (handleMoreInfoClick); making
    // the ghosted pill inert would leave it silent exactly when it needs to explain itself.
    pointerEvents: isDisabled ? "none" : "auto",
    transition: "opacity 0.35s ease",
    whiteSpace: "nowrap",
    animation: hintActive && !isDisabled ? "moreInfoPulse 1.6s ease-in-out infinite" : "none",
    "@keyframes moreInfoPulse": {
        "0%, 100%": { transform: "translateX(-50%) translateY(0)", opacity: 0.7 },
        "50%": { transform: "translateX(-50%) translateY(-4px)", opacity: 1 },
    },
}));

// ── Card-slot vertical padding ────────────────────────────────────────────────
// The slot's padding decides BOTH where the card sits and (when the card is
// height-bound) how big it is: a height-bound card is exactly
// `slotHeight − (top + bottom)` tall. Two things have to hold at once:
//
//   1. The card must never reach the BOTTOM AFFORDANCE that raises the eip — the
//      More Info pill on the flp, the info peek on the cdp. That affordance is
//      absolutely positioned against the bottom of ContentArea, so it overlaps the
//      bottom of the card slot; the bottom padding RESERVES the band it occupies
//      (its own height plus its offset from the bottom) plus a small gap. The old
//      fixed 48px bottom pad did not: the pill reaches ~56px up, so on any viewport
//      short enough to make the card height-bound the card clipped into it.
//   2. On a SHORT slot the padding must not eat the card. The bottom pad can't shrink
//      (it is a hard reservation), so the TOP pad is the elastic one: it scales with
//      the slot height and only reaches its 48px resting value on a roomy slot.
//
// `sum` is the card's total vertical reservation; advanced edit mode adds a measured
// toolbar inset on top of `top` — see DraggableCardContainer.

/** Resting (roomy-slot) top padding. The top pad shrinks below this on short slots. */
export const CARD_SLOT_TOP_PAD_MAX = 48;
/** Never squeeze the card's top clearance below this, however short the slot gets. */
export const CARD_SLOT_TOP_PAD_MIN = 12;
/** Fraction of the slot height the top pad is allowed to take before clamping. */
const CARD_SLOT_TOP_PAD_RATIO = 0.1;
/** Breathing room between the card's bottom edge and the top of the bottom affordance. */
export const CARD_SLOT_BOTTOM_GAP = 8;
/**
 * Fallback bottom inset, used only until the affordance has been measured (and on any
 * surface that renders the card slot without one). Matches the More Info pill: a 24px
 * offset from the bottom of ContentArea plus its ~32px height.
 */
export const CARD_SLOT_BOTTOM_INSET_FALLBACK = 56;

export interface CardSlotPadding {
    /** Top padding in the resting layout (advanced edit mode adds a measured toolbar inset). */
    top: number;
    /** Bottom padding — the bottom-affordance reservation. */
    bottom: number;
    /** top + bottom. */
    sum: number;
}

/**
 * cardSlotPadding — the card slot's vertical padding for a given slot height + bottom inset.
 *
 * Single source of truth: the page styles the slot with it (via useCardSlotPadding) and
 * useToolbarInset uses it to derive where the slot's content box starts, so the two
 * can't drift.
 *
 * @param slotHeight px height of the card slot (0 before it has been measured)
 * @param bottomInset px band at the bottom of the slot owned by the eip affordance
 */
export function cardSlotPadding(
    slotHeight: number,
    bottomInset = CARD_SLOT_BOTTOM_INSET_FALLBACK,
): CardSlotPadding {
    const bottom = Math.round(Math.max(0, bottomInset) + CARD_SLOT_BOTTOM_GAP);
    // Elastic top pad: full 48px once the slot is ~480px tall, shrinking proportionally
    // below that so a short slot spends its height on the card rather than on whitespace.
    // An unmeasured slot (height 0) rests at the max so the first paint isn't cramped.
    if (slotHeight <= 0) return { top: CARD_SLOT_TOP_PAD_MAX, bottom, sum: CARD_SLOT_TOP_PAD_MAX + bottom };
    const top = Math.round(
        Math.min(
            CARD_SLOT_TOP_PAD_MAX,
            Math.max(CARD_SLOT_TOP_PAD_MIN, slotHeight * CARD_SLOT_TOP_PAD_RATIO),
        ),
    );
    return { top, bottom, sum: top + bottom };
}

// Fills the card slot absolutely — gives CardAspectWrapper a definite containing block
// so that height: 100% resolves correctly (flex-grown heights are not definite in CSS).
// containerType: "size" makes this the @container query target for CardAspectWrapper:
// the wrapper switches which axis it fills based on this element's aspect ratio.
export const DraggableCardContainer = styled(Box, {
    shouldForwardProp: (prop) => prop !== "toolbarInset" && prop !== "pad",
})<{ toolbarInset?: number; pad: CardSlotPadding }>(({ toolbarInset = 0, pad }) => ({
    position: "absolute",
    inset: 0,
    // The card is always CENTERED inside this element's padded content box. In ADVANCED edit
    // mode the toolbar grows to three rows and overlays the top of the content area; rather
    // than moving the card by a fixed amount, the page measures how far the toolbar intrudes
    // past `pad.top` (useToolbarInset) and passes it here as EXTRA top padding. The container
    // therefore just gets SHORTER, and the ordinary centering decides where the card sits:
    //
    //  - toolbar clears the padded top  → inset 0 → nothing moves at all;
    //  - toolbar intrudes               → the box shrinks from the top and the card settles
    //                                     lower, by no more than the intrusion requires.
    //
    // This element is the `@container` sizing target (containerType:"size") and
    // CardAspectWrapper fills its padded content box, so a HEIGHT-BOUND card shrinks with the
    // box. That is intended: clearing the toolbar wins over holding the exact flp size, and a
    // width-bound card (vertical slack) keeps its size and merely re-centers. The padding is
    // TRANSITIONED so the card glides rather than snapping.
    padding: `${pad.top + toolbarInset}px 40px ${pad.bottom}px`,
    // Keep this in lockstep with the toolbar's drop / adv-rows reveal (CardEditToolbar)
    // so the card and toolbar move together — same duration + easing curve.
    transition: "padding 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
    boxSizing: "border-box",
    perspective: "1200px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    touchAction: "none",
    userSelect: "none",
    containerType: "size",
}));

// Swipe-direction tutorial label, rendered above the card after the user taps
// an already-flipped card. Left side reads "← Incorrect" in the incorrect color,
// right side reads "Correct →" in the correct color. Fade + slight rise on entry.
export const SwipeHintLabel = styled(Box, {
    shouldForwardProp: (prop) => prop !== "visible" && prop !== "side",
})<{ visible: boolean; side: "left" | "right" }>(({ visible, side }) => ({
    position: "absolute",
    top: 16,
    [side === "left" ? "left" : "right"]: 24,
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontFamily: FC_FONT,
    fontSize: SIZE.body,
    fontWeight: WEIGHT.semibold,
    letterSpacing: "0.02em",
    color: side === "left" ? INCORRECT_COLOR : CORRECT_COLOR,
    opacity: visible ? 1 : 0,
    transform: visible ? "translateY(0)" : "translateY(-4px)",
    transition: "opacity 0.28s ease, transform 0.28s ease",
    pointerEvents: "none",
    userSelect: "none",
    zIndex: 4,
    whiteSpace: "nowrap",
}));

// Flip tutorial label — centered above the card, shown after the user attempts
// to drag a card that hasn't been flipped yet. Mirrors SwipeHintLabel's entry
// animation but in a neutral (instructional) color and a centered position.
export const FlipHintLabel = styled(Box, {
    shouldForwardProp: (prop) => prop !== "visible",
})<{ visible: boolean }>(({ visible, theme }) => ({
    position: "absolute",
    top: 16,
    left: "50%",
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontFamily: FC_FONT,
    fontSize: SIZE.body,
    fontWeight: WEIGHT.semibold,
    letterSpacing: "0.02em",
    color: theme.palette.flashcard.textSecondary,
    opacity: visible ? 1 : 0,
    transform: visible ? "translate(-50%, 0)" : "translate(-50%, -4px)",
    transition: "opacity 0.28s ease, transform 0.28s ease",
    pointerEvents: "none",
    userSelect: "none",
    zIndex: 4,
    whiteSpace: "nowrap",
}));

// alpha is available for consumers of this module.
export { alpha };
