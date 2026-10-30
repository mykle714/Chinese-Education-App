import { Box, Card, Typography } from "@mui/material";
import { styled, alpha, keyframes } from "@mui/material/styles";
import { CORRECT_LABEL, INCORRECT_LABEL, FC_FONT, TAB_SWIPE_TRANSITION } from "../constants";
import { FONTS } from "../../../theme/fonts";
import { SIZE, WEIGHT } from "../../../theme/scale";
import { SHADOW } from "../../../theme/shadows";
import { SAFE_BOTTOM } from "../../../theme/safeArea";
import { towerPlateSx } from "./towerPlate";
import type { PlateTones } from "./flpTowerHost";

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

// `.trail` — the WORD TRAIL (Tower Tier 2 design): the words opened in this panel as a
// breadcrumb, `过去 › 去`, the showing word in ink and the rest muted. It is ALWAYS shown,
// even with one word (2026-10-29; it used to hide until a second word opened), because the
// row is also where the panel's ✕ and the Dictionary eip's Add key live (EipTrailRow in
// EipUpperPanel). The strip itself is only the word list; it takes the row's free width.
//
// Bare words, not pills (the shelf system's filled `.wtrail` pills were retired by the
// same design): the content tabs right below are now the filled shape (a sunken segmented
// track), so the trail reads as a caption line above the headword rather than as a second
// control.
export const EipTabStripContainer = styled(Box)(() => ({
    display: "flex",
    alignItems: "center",
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
}));

// How long a trail word takes to widen into the strip. Exported because EipTabStrip has
// to wait it out before it can scroll a freshly-pushed word into view — measured
// mid-entrance, the word is still near zero-width and the scroll lands short.
export const EIP_PILL_IN_MS = 240;

// Entrance keyframes for a trail word (see EipEntryTab). Kept as a `keyframes` const so
// the animation is emitted with the component's own styles rather than a global rule.
const eipPillIn = keyframes({
    from: { opacity: 0, maxWidth: 0, transform: "scale(0.9)" },
    to: { opacity: 1, maxWidth: "240px", transform: "scale(1)" },
});

// One word in the trail (design `.trail b`): CJK 15px, the showing word in ink, the rest
// muted. Colours come from the eip palette (night inverts them), passed in by EipTabStrip.
//
// `toneColor` survives on the tab MODEL (useEipTabs) because nothing else assigns tab
// identity yet; it is not painted (tone colour means one thing in this app, D2b).
export const EipEntryTab = styled(Box, {
    shouldForwardProp: (prop) => prop !== "isActive" && prop !== "toneColor" && prop !== "ink" && prop !== "muted",
})<{ isActive: boolean; toneColor: string; ink: string; muted: string }>(({ isActive, ink, muted }) => ({
    display: "inline-flex",
    alignItems: "center",
    padding: "4px 4px 5px",
    borderRadius: 9,
    color: isActive ? ink : muted,
    cursor: "pointer",
    fontFamily: FONTS.cjk,
    fontSize: 15,
    fontWeight: WEIGHT.medium,
    lineHeight: 1.1,
    userSelect: "none",
    whiteSpace: "nowrap",
    transition: "color 0.15s ease",
    flexShrink: 0,
    // Entrance: a word only ever mounts when it is ADDED to the trail, so a mount-time
    // keyframe is the whole trigger. It widens from nothing (max-width) so the words
    // already on the strip are pushed aside rather than jumped aside, in step with the
    // panel slide that shows the same word's content (InfoCardSection).
    animation: `${eipPillIn} ${EIP_PILL_IN_MS}ms cubic-bezier(0.22, 1, 0.36, 1) both`,
}));

// `.tabs` — the eip's CONTENT tabs (definition / examples / breakdown), as the Tower Tier 2
// design draws them: a SUNKEN SEGMENTED TRACK — a well with a 2px inner top lip — in which
// the selected tab is a raised chip. Replaced the shelf system's underlined `.tabs2`
// (2026-10-29). The word trail above is now bare breadcrumb text, so this is the panel's
// one filled control and the two still cannot read as one two-row strip.
//
// Track colours come from the eip palette (`tabWell` / `tabWellShadow`, the time-of-day
// well mixed into white), passed in by InfoCardPanelBody.
export const InfoSheetTabStrip = styled(Box, {
    shouldForwardProp: (prop) => prop !== "trackColor" && prop !== "trackShadow",
})<{ trackColor: string; trackShadow: string }>(({ trackColor, trackShadow }) => ({
    // Positioning context for the sliding chip (InfoSheetTabIndicator).
    position: "relative",
    display: "flex",
    gap: EIP_TAB_GAP,
    padding: EIP_TAB_TRACK_PAD,
    margin: "0 18px",
    borderRadius: 12,
    background: trackColor,
    boxShadow: `inset 0 2px 0 ${trackShadow}`,
    flexShrink: 0,
}));

// The track's inner padding and the gap between segments — shared by the track and the
// sliding chip, whose width and travel are computed from them.
const EIP_TAB_TRACK_PAD = 3;
const EIP_TAB_GAP = 2;

// The SELECTED-TAB CHIP (design `.tabs b.on`: white, 9px radius, a hairline drop) — ONE
// element that SLIDES between segments (2026-10-29) rather than a fill that jumps from tab
// to tab. Absolutely positioned inside the track, one segment wide, moved by
// translateX(index × (segment + gap)); `100%` in a translate is the chip's OWN width, i.e.
// one segment. Same duration/easing as the content panes' slide (TAB_SWIPE_TRANSITION), so
// the chip and the pane below arrive together.
export const InfoSheetTabIndicator = styled(Box, {
    shouldForwardProp: (prop) => prop !== "index" && prop !== "count" && prop !== "chipColor",
})<{ index: number; count: number; chipColor: string }>(({ index, count, chipColor }) => ({
    position: "absolute",
    top: EIP_TAB_TRACK_PAD,
    bottom: EIP_TAB_TRACK_PAD,
    left: EIP_TAB_TRACK_PAD,
    width: `calc((100% - ${2 * EIP_TAB_TRACK_PAD}px - ${(count - 1) * EIP_TAB_GAP}px) / ${count})`,
    borderRadius: 9,
    background: chipColor,
    // Design `0 1px 2px rgba(23,22,26,.12)` → SHADOW.rest (same geometry, 0.05 alpha).
    boxShadow: SHADOW.rest,
    transform: `translateX(calc(${index} * (100% + ${EIP_TAB_GAP}px)))`,
    transition: TAB_SWIPE_TRANSITION,
    pointerEvents: "none",
    "@media (prefers-reduced-motion: reduce)": { transition: "none" },
}));

// One content tab — a transparent segment over the track; the selected one is marked by
// the sliding chip under it (InfoSheetTabIndicator) and by its ink label.
//
// No outline ring on these (CLAUDE.md § Buttons & cards): they are segments of one
// control, not separate buttons, and the selected chip is already set off by its fill.
//
// An EMPTY tab (no examples, no breakdown) stays legible but is dimmed — it is still a
// real destination that says "nothing here for this word", which is an answer.
export const InfoSheetTab = styled(Box, {
    shouldForwardProp: (prop) => prop !== "isActive" && prop !== "isEmpty",
})<{ isActive: boolean; isEmpty?: boolean }>(({ isActive, isEmpty }) => ({
    // Above the sliding chip.
    position: "relative",
    zIndex: 1,
    flex: 1,
    textAlign: "center",
    padding: "7px 2px",
    borderRadius: 9,
    border: "none",
    cursor: "pointer",
    fontFamily: FC_FONT,
    userSelect: "none",
    opacity: isEmpty && !isActive ? 0.4 : 1,
    background: "transparent",
    transition: "opacity 0.2s ease",
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
//
// The 24px offset is measured from the TOP of the home-indicator strip (SAFE_BOTTOM), not
// the screen edge: flp is footerless and the frame paints edge to edge, so a bare `bottom: 24`
// sat inside the 34pt home-indicator band on Face ID iPhones. The card moves up with it for
// free — useCardSlotPadding reserves the band from the pill's live `offsetTop` down.
//
// `plate` (Deck Tower sessions only): drawn as the tower's floor-plate push button instead
// of the white pill — towerPlate.ts. It overrides the fill, outline, print and shadow, and
// presses along with the pill's own `translateX(-50%)` centring.
export const MoreInfoPill = styled(Box, {
    shouldForwardProp: (prop) => prop !== "isFlipped" && prop !== "hintActive" && prop !== "isDisabled" && prop !== "plate",
})<{ isFlipped: boolean; hintActive?: boolean; isDisabled?: boolean; plate?: PlateTones }>(({ isFlipped, hintActive, isDisabled, plate, theme }) => ({
    position: "absolute",
    bottom: `calc(24px + ${SAFE_BOTTOM})`,
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
    // The "tap me" bob. Not in Deck Tower sessions (`plate`): there the pill is a solid
    // floor-plate button, and a bobbing plate reads as a glitch rather than a hint.
    animation: hintActive && !isDisabled && !plate ? "moreInfoPulse 1.6s ease-in-out infinite" : "none",
    "@keyframes moreInfoPulse": {
        "0%, 100%": { transform: "translateX(-50%) translateY(0)", opacity: 0.7 },
        "50%": { transform: "translateX(-50%) translateY(-4px)", opacity: 1 },
    },
    ...(plate ? towerPlateSx(plate, "translateX(-50%)") : {}),
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
 * offset from the bottom of ContentArea plus its ~32px height. It cannot include the
 * pill's SAFE_BOTTOM term (an `env()` string, not a number), so on a Face ID iPhone it
 * under-reserves for the one frame before the first measure lands.
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

/**
 * The hint labels sit IN the card's top corners, centred in its top band
 * (`--card-hint-band`, set on the card frame by FlashCardSection: the Deck Tower stock's
 * cream rim, or a fixed row on the plain flp), and in from the side by the card's corner
 * radius (`--card-radius`) so they start where the straight edge does. The card's own top
 * chrome (CardOpsRail's `•••`, the CardNote strip) sits below the band
 * (`--card-chrome-inset`), leaving the corners to these labels.
 * Fallbacks are only for a frame that sets neither.
 */
const HINT_BAND_CSS = "var(--card-hint-band, 32px)";
const HINT_SIDE_CSS = "var(--card-radius, 24px)";

// Swipe-direction tutorial label, in the card's top-left / top-right corner after the user
// taps an already-flipped card. Left reads "← Incorrect" in the incorrect color, right
// reads "Correct →" in the correct color. Fade + slight rise on entry.
export const SwipeHintLabel = styled(Box, {
    shouldForwardProp: (prop) => prop !== "visible" && prop !== "side",
})<{ visible: boolean; side: "left" | "right" }>(({ visible, side }) => ({
    position: "absolute",
    top: `calc(${HINT_BAND_CSS} / 2)`,
    [side === "left" ? "left" : "right"]: HINT_SIDE_CSS,
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontFamily: FC_FONT,
    fontSize: SIZE.body,
    fontWeight: WEIGHT.semibold,
    lineHeight: 1,
    letterSpacing: "0.02em",
    color: side === "left" ? INCORRECT_LABEL : CORRECT_LABEL,
    opacity: visible ? 1 : 0,
    // Centred on the band's middle line; the hidden state sits 4px higher (the rise).
    transform: visible ? "translateY(-50%)" : "translateY(calc(-50% - 4px))",
    transition: "opacity 0.28s ease, transform 0.28s ease",
    pointerEvents: "none",
    userSelect: "none",
    zIndex: 10,
    whiteSpace: "nowrap",
}));

// Flip tutorial label — centred in the card's top band, shown after the user attempts
// to drag a card that hasn't been flipped yet. Mirrors SwipeHintLabel's entry
// animation but in a neutral (instructional) color and a centered position.
export const FlipHintLabel = styled(Box, {
    shouldForwardProp: (prop) => prop !== "visible",
})<{ visible: boolean }>(({ visible, theme }) => ({
    position: "absolute",
    top: `calc(${HINT_BAND_CSS} / 2)`,
    left: "50%",
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontFamily: FC_FONT,
    fontSize: SIZE.body,
    fontWeight: WEIGHT.semibold,
    lineHeight: 1,
    letterSpacing: "0.02em",
    color: theme.palette.flashcard.textSecondary,
    opacity: visible ? 1 : 0,
    transform: visible ? "translate(-50%, -50%)" : "translate(-50%, calc(-50% - 4px))",
    transition: "opacity 0.28s ease, transform 0.28s ease",
    pointerEvents: "none",
    userSelect: "none",
    zIndex: 10,
    whiteSpace: "nowrap",
}));

// alpha is available for consumers of this module.
export { alpha };
