import { Box, Card, Typography } from "@mui/material";
import { styled, alpha } from "@mui/material/styles";
import { COLORS } from "./constants";

export const IPhoneFrame = styled(Box)(() => ({
    backgroundColor: COLORS.background,
    borderRadius: 0,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    width: "100vw",
}));

export const InfoCard = styled(Card)(({ theme }) => ({
    backgroundColor: theme.palette.background.paper,
    borderRadius: "12px",
    boxShadow: "2px 4px 4px rgba(0, 0, 0, 0.25)",
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

// Dark header strip across the top of the EIC sheet housing the pill-style tabs.
export const TabHeader = styled(Box)(({ theme }) => ({
    backgroundColor: theme.palette.eic.header,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 10,
    padding: "10px 16px 12px",
    width: "100%",
    boxSizing: "border-box",
}));

// Centered pill at the top of the sheet that signals it's swipeable.
export const DragHandle = styled(Box)(({ theme }) => ({
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: alpha(theme.palette.text.primary, 0.3),
    flexShrink: 0,
}));

// Pill-shaped tab button. Inactive: outlined with a translucent light border.
// Active: filled with the tab's identity color so each tab keeps its visual signature.
// `isEmpty` mutes the pill when the current card has no content for that tab.
// Selected state still wins visually so the active tab is identifiable even when empty.
export const TabPill = styled(Box, {
    shouldForwardProp: (prop) => prop !== "isSelected" && prop !== "isEmpty" && prop !== "color",
})<{ isSelected: boolean; color: string; isEmpty?: boolean }>(({ isSelected, color, isEmpty, theme }) => ({
    height: 22,
    padding: "0 10px",
    borderRadius: 999,
    // Inactive pill outline/text derive from the theme's primary text color so
    // they stay legible regardless of header background (light beige, sage, etc).
    border: `1px solid ${isSelected ? color : alpha(theme.palette.text.primary, 0.45)}`,
    backgroundColor: isSelected ? color : "transparent",
    color: isSelected ? COLORS.onSurface : alpha(theme.palette.text.primary, 0.85),
    opacity: isEmpty && !isSelected ? 0.4 : 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: isEmpty && !isSelected ? "not-allowed" : "pointer",
    transition: "background-color 0.2s ease, color 0.2s ease, border-color 0.2s ease, opacity 0.2s ease",
}));

export const ArrowIndicator = styled(Box)(() => ({
    position: "absolute",
    top: "50%",
    transform: "translateY(-50%)",
    color: COLORS.gray,
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

export const BreakdownLineItem = styled(Box)(() => ({
    display: "flex",
    alignItems: "center",
    gap: 36,
    padding: "3px 8px 3px 2px",
    borderBottom: `1px dashed ${COLORS.border}`,
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

export const DefinitionText = styled(Typography)(() => ({
    fontSize: 12,
    color: COLORS.onSurface,
    lineHeight: "16px",
    fontFamily: '"Inter", sans-serif',
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

export const HskPill = styled(Box)(() => ({
    backgroundColor: COLORS.blue,
    color: "#FFFFFF",
    fontFamily: '"Inter", sans-serif',
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.02em",
    padding: "3px 8px",
    borderRadius: 999,
    lineHeight: 1,
}));

export const PosChip = styled(Box)(() => ({
    border: `1px solid ${COLORS.border}`,
    color: COLORS.onSurface,
    fontFamily: '"Inter", sans-serif',
    fontSize: 11,
    fontWeight: 500,
    padding: "2px 8px",
    borderRadius: 999,
    lineHeight: 1.2,
}));

// Section header above the shared-characters list inside the info tab.
// Mirrors the "Expanded Form" label in the literal tab.
export const SharedCharsLabel = styled(Typography)(() => ({
    fontSize: 12,
    color: COLORS.gray,
    fontFamily: '"Inter", sans-serif',
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    textAlign: "center",
    marginBottom: 6,
}));

export const SharedCharsSection = styled(Box)(() => ({
    marginTop: 16,
    paddingTop: 12,
    borderTop: `1px dashed ${COLORS.border}`,
}));

// Title block at the top of each EIC tab body. Vocab word (CPCD lg) → English →
// tab function label. `isEmpty` greys it out when the tab has no content.
export const EicTabTitleSection = styled(Box, {
    shouldForwardProp: (prop) => prop !== "isEmpty",
})<{ isEmpty?: boolean }>(({ isEmpty }) => ({
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 4,
    paddingBottom: 12,
    marginBottom: 12,
    borderBottom: `1px dashed ${COLORS.border}`,
    opacity: isEmpty ? 0.4 : 1,
    pointerEvents: isEmpty ? "none" : "auto",
}));

export const EicTabTitleEnglish = styled(Typography)(() => ({
    fontSize: 15,
    color: COLORS.onSurface,
    fontFamily: '"Inter", sans-serif',
    fontWeight: 500,
    textAlign: "left",
    lineHeight: 1.3,
}));

export const EicTabTitleFunction = styled(Typography)(() => ({
    fontSize: 11,
    color: COLORS.gray,
    fontFamily: '"Inter", sans-serif',
    textTransform: "uppercase",
    letterSpacing: "0.6px",
    textAlign: "left",
    marginTop: 2,
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
}));

// Bottom-anchored modal sheet wrapping the EIC content. Height is driven by
// useEicSheet — 0 when hidden, halfHeight (70%) or fullHeight (90%) when open.
// Full-bleed within the iPhone-frame container.
export const EicSheet = styled(Box)(({ theme }) => ({
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    width: "100%",
    backgroundColor: theme.palette.background.paper,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: "hidden",
    boxShadow: "0 -4px 12px rgba(0, 0, 0, 0.15)",
    display: "flex",
    flexDirection: "column",
    willChange: "transform",
    zIndex: 3,
    // Disable browser-handled touch panning so useDrag reliably owns the gesture.
    // Inner scroll is driven manually by the drag handler / wheel listener.
    touchAction: "none",
}));

// Floating circular button in the bottom-right of the flashcard view.
// Tapping opens the EIC sheet to the HALF (70%) snap point.
// `disabled` greys out the FAB while the card is unflipped. The button stays
// clickable on purpose so a tap can trigger the "flip first" hint tooltip.
export const EicExpandFab = styled(Box, {
    shouldForwardProp: (prop) => prop !== "disabled",
})<{ disabled?: boolean }>(({ theme, disabled }) => ({
    position: "absolute",
    bottom: 16,
    right: 16,
    width: 48,
    height: 48,
    borderRadius: "50%",
    backgroundColor: disabled
        ? theme.palette.action.disabledBackground
        : theme.palette.eic.header,
    color: disabled ? theme.palette.action.disabled : theme.palette.text.primary,
    boxShadow: disabled ? "0 1px 3px rgba(0, 0, 0, 0.12)" : "0 2px 8px rgba(0, 0, 0, 0.2)",
    opacity: disabled ? 0.55 : 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    zIndex: 4,
    transition: "opacity 0.2s ease, transform 0.2s ease, background-color 0.2s ease",
    "&:hover": {
        transform: disabled ? "none" : "scale(1.05)",
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
