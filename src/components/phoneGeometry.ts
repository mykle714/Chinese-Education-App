// Phone-frame geometry — the design's `.phone` box (shelf-system.css), in one
// place so nothing re-guesses it.
//
// This is a separate module rather than a few more exports on MobileDemoFrame
// because `PHONE_OVERLAY_SX` is an OBJECT: the react-refresh lint rule allows a
// component file to also export primitive constants (`allowConstantExport`), but
// an object export breaks fast refresh for the component, so it belongs here.
// MobileDemoFrame is still the only thing that RENDERS the frame.

export const PHONE_WIDTH = 402;
export const PHONE_HEIGHT = 874;
export const PHONE_RADIUS = 44;
export const PHONE_SHADOW = "0 16px 44px rgba(20, 18, 26, 0.14), 0 2px 5px rgba(20, 18, 26, 0.05)";

/**
 * Geometry for a full-screen OVERLAY that must line up with the phone card —
 * a MUI Dialog whose chrome anchors to the phone's own corners and bottom edge
 * (the Practice Writing popup, the community design zoom). Spread into
 * `PaperProps.sx`; the Paper itself stays transparent and shadowless so each
 * element inside reads as its own floating island over the scrim.
 *
 * It lives here because it is the SAME box as MobileDemoFrame's `desktopSx`. Both
 * previously hard-copied `393` / `932`, so the frame's width could change (and
 * just did, A2c) without them following — the overlay would sit 9px narrower
 * than the surface it is supposed to be pinned to.
 */
export const PHONE_OVERLAY_SX = {
    backgroundColor: "transparent",
    boxShadow: "none",
    overflow: "visible",
    m: 0,
    width: { xs: "100vw", md: PHONE_WIDTH },
    maxWidth: "100vw",
    height: { xs: "100dvh", md: "calc(100dvh - 48px)" },
    maxHeight: { xs: "100dvh", md: PHONE_HEIGHT },
} as const;
