import { Box, Card, Typography } from "@mui/material";
import { styled, alpha } from "@mui/material/styles";
import { CORRECT_COLOR, INCORRECT_COLOR, FC_FONT } from "./constants";
import { FONTS } from "../../../theme/fonts";
import { SIZE, WEIGHT } from "../../../theme/scale";

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

// Scrim overlay behind the modal info sheet — tap to close.
export const EicScrim = styled(Box)(({ theme }) => ({
    position: "absolute",
    inset: 0,
    background: theme.palette.flashcard.scrim,
    animation: "eicScrimIn 0.18s ease-out both",
    zIndex: 10,
    "@keyframes eicScrimIn": {
        from: { opacity: 0 },
        to: { opacity: 1 },
    },
}));

// Modal bottom sheet for the EIP. Height is set inline by InfoCardSection
// (measured natural height on mount, adjustable via grabber drag) and
// position is fixed to the bottom of the parent.
export const InfoSheetContainer = styled(Box)(({ theme }) => ({
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    background: theme.palette.flashcard.background,
    borderRadius: "20px 20px 0 0",
    padding: "10px 0 18px",
    display: "flex",
    flexDirection: "column",
    zIndex: 11,
    boxShadow: theme.palette.flashcard.sheetShadow,
}));

// Centered grabber pill at the top of the info sheet.
export const InfoSheetGrabber = styled(Box)(({ theme }) => ({
    width: 44,
    height: 5,
    borderRadius: 5,
    background: theme.palette.flashcard.grabber,
    flexShrink: 0,
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
export const EipTabStripContainer = styled(Box)(({ theme }) => ({
    display: "flex",
    gap: 4,
    padding: "6px 14px 0",
    borderBottom: `1px solid ${theme.palette.flashcard.border}`,
    flexShrink: 0,
    overflow: "hidden",
}));

// Single "entry tab" pill. Active tab gets a low-alpha fill in its assigned
// tone color; inactive tabs are transparent. Chinese label only (no pinyin).
export const EipEntryTab = styled(Box, {
    shouldForwardProp: (prop) => prop !== "isActive" && prop !== "toneColor",
})<{ isActive: boolean; toneColor: string }>(({ isActive, toneColor, theme }) => ({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "6px 12px",
    borderRadius: "8px 8px 0 0",
    background: isActive ? alpha(toneColor, 0.22) : "transparent",
    borderBottom: isActive ? `2px solid ${toneColor}` : "2px solid transparent",
    marginBottom: -1,
    cursor: "pointer",
    fontFamily: FONTS.cjk,
    fontSize: SIZE.body,
    fontWeight: WEIGHT.semibold,
    color: theme.palette.flashcard.onSurface,
    lineHeight: 1.1,
    userSelect: "none",
    whiteSpace: "nowrap",
    transition: "background 0.15s ease",
    flexShrink: 0,
    "&:hover": {
        background: alpha(toneColor, isActive ? 0.28 : 0.1),
    },
}));

// Flex row of underline-style tab buttons.
export const InfoSheetTabStrip = styled(Box)(({ theme }) => ({
    display: "flex",
    gap: 4,
    padding: "0 14px 12px",
    borderBottom: `1px solid ${theme.palette.flashcard.border}`,
    flexShrink: 0,
}));

// Individual underline tab inside the tab strip.
// Active tab shows a 2px ink underline; inactive is transparent.
export const InfoSheetTab = styled(Box, {
    shouldForwardProp: (prop) => prop !== "isActive" && prop !== "isEmpty",
})<{ isActive: boolean; isEmpty?: boolean }>(({ isActive, isEmpty, theme }) => ({
    flex: 1,
    padding: "8px 4px 10px",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 4,
    borderBottom: isActive
        ? `2px solid ${theme.palette.flashcard.tabUnderline}`
        : "2px solid transparent",
    marginBottom: -1,
    fontFamily: FC_FONT,
    userSelect: "none",
    opacity: isEmpty && !isActive ? 0.4 : 1,
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

// Info-tab metadata row: HSK pill + POS chips, centered above the long definition.
export const MetadataChipRow = styled(Box)(() => ({
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 10,
}));

export const HskPill = styled(Box)(({ theme }) => ({
    backgroundColor: theme.palette.flashcard.hskPill,
    color: "#FFFFFF",
    fontFamily: FC_FONT,
    fontSize: SIZE.micro,
    fontWeight: WEIGHT.semibold,
    letterSpacing: "0.02em",
    padding: "3px 8px",
    borderRadius: 999,
    lineHeight: 1,
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
// While the icon editor is open the pill stays DRAWN but greyed + inert (`isDisabled`); in
// advanced mode the card slides down and paints over it (the card slot is raised above the
// pill — see FlashCardSection), so it ends up covered rather than removed.
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
    pointerEvents: isDisabled || !isFlipped ? "none" : "auto",
    transition: "opacity 0.35s ease",
    whiteSpace: "nowrap",
    animation: hintActive && !isDisabled ? "moreInfoPulse 1.6s ease-in-out infinite" : "none",
    "@keyframes moreInfoPulse": {
        "0%, 100%": { transform: "translateX(-50%) translateY(0)", opacity: 0.7 },
        "50%": { transform: "translateX(-50%) translateY(-4px)", opacity: 1 },
    },
}));

// Fills the card slot absolutely — gives CardAspectWrapper a definite containing block
// so that height: 100% resolves correctly (flex-grown heights are not definite in CSS).
// containerType: "size" makes this the @container query target for CardAspectWrapper:
// the wrapper switches which axis it fills based on this element's aspect ratio.
// Card-slot vertical padding in the NON-pushed (centered) layout. The push-down keeps the
// SUM constant so the card never resizes (see DraggableCardContainer below). Exported so the
// toolbar-overlap detector (useToolbarOverlap) can compute where the card's top sits when
// centered without duplicating these magic numbers.
export const CARD_SLOT_TOP_PAD = 48; // top padding when centered
export const CARD_SLOT_VPAD_SUM = 96; // top + bottom padding sum (INVARIANT across push states)

export const DraggableCardContainer = styled(Box, {
    shouldForwardProp: (prop) => prop !== "pushDown",
})<{ pushDown?: boolean }>(({ pushDown }) => ({
    position: "absolute",
    inset: 0,
    // Normally the card is centered with symmetric padding. In ADVANCED edit mode the
    // toolbar grows to three rows and overlays the top of the content area, so we push
    // the card DOWN to clear as much of it as possible.
    //
    // CRITICAL — the push-down must NOT resize the card (the fie must show the card at its
    // exact flp size). Because this element is the `@container` sizing target
    // (containerType:"size") and the CardAspectWrapper fills its padded content box, the
    // card's height-bound size is `containerHeight − (topPad + botPad)`. So we keep the
    // vertical padding SUM constant at 96px and only REDISTRIBUTE it downward
    // (48/48 → 72/24) instead of growing it. Because the sum is unchanged the card keeps the
    // identical size it has on flp on every viewport (previously the old 148/28 grew the sum
    // to 176px and shrank any height-bound card by 80px).
    //
    // The card is also BOTTOM-ANCHORED while pushed (alignItems flex-end), so its bottom
    // margin is a constant 24px (= botPad) on EVERY screen — matching the More Info pill's own
    // `bottom: 24` (of ContentArea). The card's bottom edge therefore lands exactly at the
    // pill's bottom edge, so it slides down JUST far enough to cover the greyed pill and no
    // further. Centering alone was not enough: on a width-bound viewport with vertical slack a
    // centered card floats with a large bottom margin and never reaches the pill. flex-end only
    // moves the card (never resizes it), so the flp-size guarantee holds. Basic mode keeps the
    // symmetric 48/48 + center so the card stays centered. The padding change is TRANSITIONED
    // so the card glides down/up rather than snapping. Both states keep the vertical sum at
    // CARD_SLOT_VPAD_SUM (48+48 = 72+24 = 96) so the card size is identical either way.
    padding: pushDown ? "72px 40px 24px" : `${CARD_SLOT_TOP_PAD}px 40px`,
    // Keep this in lockstep with the toolbar's drop / adv-rows reveal (CardEditToolbar)
    // so the card and toolbar move together — same duration + easing curve.
    transition: "padding 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
    boxSizing: "border-box",
    perspective: "1200px",
    display: "flex",
    // Bottom-anchor when pushed (covers the More Info pill on all viewports); center otherwise.
    alignItems: pushDown ? "flex-end" : "center",
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
