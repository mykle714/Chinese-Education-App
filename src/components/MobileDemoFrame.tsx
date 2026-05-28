import { type ReactNode } from "react";
import { Box, useMediaQuery, useTheme } from "@mui/material";
import { styled } from "@mui/material/styles";

// Shared phone-frame container for every mobile-demo route. This is the single
// source of truth for the "iPhone surface" sizing — pages under
// MOBILE_DEMO_PATHS in Layout.tsx should NOT define their own IPhoneFrame.
// On mobile we render full-bleed; on desktop we render a centered, rounded
// 393px-wide card so the surface still feels like a phone next to the
// Layout sidebar.

const COLORS = {
    background: "#F7F7F8",
};

const FrameRoot = styled(Box)(() => ({
    backgroundColor: COLORS.background,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    width: "100%",
    height: "100dvh",
}));

interface MobileDemoFrameProps {
    children: ReactNode;
    className?: string;
}

const MobileDemoFrame: React.FC<MobileDemoFrameProps> = ({ children, className }) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down("md"));

    // Desktop overrides layer on top of the base full-bleed styles to produce
    // the centered phone-shaped card.
    const desktopSx = !isMobile
        ? {
              maxWidth: 393,
              borderRadius: "20px",
              margin: "0 auto",
              minHeight: "852px",
              maxHeight: "932px",
          }
        : {};

    return (
        <FrameRoot className={className ?? "mobile-demo-frame"} sx={desktopSx}>
            {children}
        </FrameRoot>
    );
};

export default MobileDemoFrame;
