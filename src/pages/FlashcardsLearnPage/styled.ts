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

export const Header = styled(Box)(() => ({
    backgroundColor: COLORS.header,
    height: 60,
    minHeight: 60,
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
}));

export const Toolbar = styled(Box)(() => ({
    display: "flex",
    gap: 10,
    width: "100%",
    height: 59,
    alignItems: "center",
    padding: "0 12px",
    position: "relative",
}));

export const PageTools = styled(Box)(() => ({
    display: "flex",
    gap: 8,
    alignItems: "center",
    position: "absolute",
    right: 0,
    width: 224,
    justifyContent: "flex-end",
    padding: "0 12px",
}));

export const InfoCard = styled(Card)(() => ({
    backgroundColor: COLORS.infoCard,
    borderRadius: "12px",
    boxShadow: "2px 4px 4px rgba(0, 0, 0, 0.25)",
    cursor: "grab",
    overflow: "visible",
    position: "relative",
    zIndex: 2, // renders above TabsContainer (zIndex 1) so card covers tab bottoms
    userSelect: "none",
    WebkitUserSelect: "none",
    MozUserSelect: "none",
    msUserSelect: "none",
    touchAction: "pan-y",
    "&:active": {
        cursor: "grabbing",
    },
}));

export const TabsContainer = styled(Box)(() => ({
    position: "absolute",
    top: -18,
    left: 0,
    right: 0,
    display: "flex",
    justifyContent: "center",
    gap: 4,
    padding: "0 16px",
    pointerEvents: "none",
    zIndex: 1,
}));

export const Tab = styled(Box)<{ isSelected: boolean; color: string }>(({ isSelected, color }) => ({
    width: 56,
    height: isSelected ? 30 : 28,
    backgroundColor: isSelected ? color : alpha(color, 0.5),
    borderRadius: "4px 4px 0 0",
    transform: isSelected ? "translateY(-4px)" : "translateY(2px)",
    transition: "all 0.3s ease-in-out",
    cursor: "pointer",
    pointerEvents: "auto",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    paddingTop: "3px",
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

export const ContentArea = styled(Box)(() => ({
    flex: 1,
    minHeight: 0, // allow flex to bound height (prevents content from stretching parent)
    overflow: "hidden",
    padding: "40px 0 12px 0",
    display: "flex",
    flexDirection: "column",
    gap: 6,
    alignItems: "center",
}));

// Fills the card slot absolutely — gives CardAspectWrapper a definite containing block
// so that height: 100% resolves correctly (flex-grown heights are not definite in CSS).
export const DraggableCardContainer = styled(Box)(() => ({
    position: "absolute",
    inset: 0,
    padding: "48px 0",
    boxSizing: "border-box",
    perspective: "1200px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    touchAction: "none",
    userSelect: "none",
}));
