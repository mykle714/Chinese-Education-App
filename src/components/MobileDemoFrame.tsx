import { type ReactNode } from "react";
import { Box, useMediaQuery, useTheme } from "@mui/material";
import { styled } from "@mui/material/styles";
import { COLORS } from "../theme/colors";
import FooterPresenter from "./FooterPresenter";
import { FooterVisibilityProvider } from "./FooterVisibilityContext";
import { PHONE_WIDTH, PHONE_HEIGHT, PHONE_RADIUS, PHONE_SHADOW } from "./phoneGeometry";

// Shared phone-frame container for every mobile-demo route. This is the single
// source of truth for the "iPhone surface" sizing — routes whose registry row
// says `shell: "frame"` should NOT define their own phone wrapper.
//
// On mobile we render full-bleed (the device IS the frame). On desktop we render
// a centered card matching the design's `.phone`: 402 x 874 with a 44px radius
// and a two-layer drop shadow. Those numbers are not arbitrary desktop taste —
// every artboard in the shelf design is drawn inside a 402x874 box, so a page's
// padding, spine widths and bento columns only land where the design puts them
// when the surface is that wide. Changing `maxWidth` silently re-proportions
// every converted page (docs/SHELF_REDESIGN.md A2c). Geometry constants live in ./phoneGeometry.

const FrameRoot = styled(Box)(() => ({
    // --paper. The frame is the ground everything else sits on; a page that wants
    // to feel tinted tints an inner surface, never this.
    backgroundColor: COLORS.background,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    width: "100%",
    height: "100dvh",
    // Positioning context for the footer bar, which FooterPresenter renders as a
    // sibling of the page: `position: absolute; bottom: 0` resolves against THIS
    // box, so on desktop the bar stays inside the phone card instead of escaping
    // to the viewport. (It said "pill" until A2a made the footer a flat bar.)
    position: "relative",
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
              // The design's `.phone` box, exactly.
              maxWidth: PHONE_WIDTH,
              borderRadius: `${PHONE_RADIUS}px`,
              boxShadow: PHONE_SHADOW,
              // Vertical margin breathes space above/below the phone card;
              // "auto" still centers it horizontally.
              margin: "24px auto",
              // Override the base height: 100dvh. Subtracting the 48px of
              // top+bottom margin keeps the card strictly shorter than the
              // viewport, so the margin gap is always visible above AND below
              // instead of the full-height card pushing the bottom into scroll.
              height: "calc(100dvh - 48px)",
              minHeight: "500px",
              // Capped at the design's height so a tall monitor shows the phone at
              // its true 402x874 proportions rather than an elongated version of it.
              maxHeight: `${PHONE_HEIGHT}px`,
          }
        : {};

    return (
        <FrameRoot className={className ?? "mobile-demo-frame"} sx={desktopSx}>
            {/* The provider must wrap BOTH the pages and the footer: pages take
                suppression holds (useHideFooter), FooterPresenter reads them. */}
            <FooterVisibilityProvider>
                {children}
                {/* Single persistent footer pill, animated independently of the page
                    slides (it lives outside the page surfaces). See FooterPresenter. */}
                <FooterPresenter />
            </FooterVisibilityProvider>
        </FrameRoot>
    );
};

export default MobileDemoFrame;
