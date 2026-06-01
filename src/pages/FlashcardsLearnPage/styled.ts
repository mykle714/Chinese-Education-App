import { Box, Card, Typography } from "@mui/material";
import { styled, alpha } from "@mui/material/styles";
import { CORRECT_COLOR, INCORRECT_COLOR, FC_FONT } from "./constants";

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
    fontFamily: '"Noto Sans SC", "Inter", sans-serif',
    fontSize: 14,
    fontWeight: 600,
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
    fontSize: 12,
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
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.02em",
    padding: "3px 8px",
    borderRadius: 999,
    lineHeight: 1,
}));

export const PosChip = styled(Box)(({ theme }) => ({
    border: `1px solid ${theme.palette.flashcard.border}`,
    color: theme.palette.flashcard.onSurface,
    fontFamily: FC_FONT,
    fontSize: 11,
    fontWeight: 500,
    padding: "2px 8px",
    borderRadius: 999,
    lineHeight: 1.2,
}));

// Section header above the shared-characters list inside the info tab.
// Mirrors the "Expanded Form" label in the literal tab.
export const SharedCharsLabel = styled(Typography)(({ theme }) => ({
    fontSize: 12,
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
export const MoreInfoPill = styled(Box, {
    shouldForwardProp: (prop) => prop !== "isFlipped" && prop !== "hintActive",
})<{ isFlipped: boolean; hintActive?: boolean }>(({ isFlipped, hintActive, theme }) => ({
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
    cursor: "pointer",
    fontFamily: FC_FONT,
    zIndex: 2,
    opacity: isFlipped ? 1 : 0.32,
    pointerEvents: isFlipped ? "auto" : "none",
    transition: "opacity 0.35s ease",
    whiteSpace: "nowrap",
    animation: hintActive ? "moreInfoPulse 1.6s ease-in-out infinite" : "none",
    "@keyframes moreInfoPulse": {
        "0%, 100%": { transform: "translateX(-50%) translateY(0)", opacity: 0.7 },
        "50%": { transform: "translateX(-50%) translateY(-4px)", opacity: 1 },
    },
}));

// Fills the card slot absolutely — gives CardAspectWrapper a definite containing block
// so that height: 100% resolves correctly (flex-grown heights are not definite in CSS).
// containerType: "size" makes this the @container query target for CardAspectWrapper:
// the wrapper switches which axis it fills based on this element's aspect ratio.
export const DraggableCardContainer = styled(Box)(() => ({
    position: "absolute",
    inset: 0,
    padding: "48px 40px",
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
    fontSize: 13,
    fontWeight: 600,
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
    fontSize: 13,
    fontWeight: 600,
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
