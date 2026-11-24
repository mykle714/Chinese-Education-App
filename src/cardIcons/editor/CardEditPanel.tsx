import React, { forwardRef } from "react";
import { createPortal } from "react-dom";
import { Box, Slide } from "@mui/material";
import { COLORS } from "../../theme/colors";
import { SHADOW } from "../../theme/shadows";
import { SAFE_TOP } from "../../theme/safeArea";
import { useScreenOverlayHost } from "../../hooks/useScreenOverlayHost";
import { useThemeColor } from "../../hooks/useThemeColor";
import { CARD_EDIT_ANIM_MS, CARD_EDIT_ANIM_EASING } from "./CardEditToolbar";

// Above the footer bar (100) and any page header, below every modal sheet / scrim
// (SheetPanel's 1200+) and MUI's portaled menus (1300) — so the icon picker, the reset
// confirm and the toolbar's own dropdowns all still open OVER the panel.
const CARD_EDIT_PANEL_Z_INDEX = 150;

// The eip's corner radius (InfoSheetContainer, sheetStyled.ts), mirrored onto the bottom
// edge: this panel is the eip's top-anchored twin.
const CARD_EDIT_PANEL_RADIUS = 20;

/**
 * CardEditPanel — the drop-down panel that hosts the fie's `CardEditToolbar`
 * (docs/CARD_ICON_LAYOUT.md § Edit-mode UX → "The Customize panel").
 *
 * The eip turned upside down: a white sheet with rounded BOTTOM corners and a downward
 * shadow, anchored to the very top of the phone frame. It COVERS the page header (and
 * the status-bar strip, padded by SAFE_TOP) rather than hanging below it, so the toolbar
 * starts a whole header-height higher than the old flat bar did — which is what keeps
 * `useToolbarInset` (the card's shrink/re-center) from triggering except on short screens
 * in advanced mode. Static: no grabber, no drag; it only drops in on open and slides back
 * up on close (`<Slide direction="down">`, the editor's shared timing).
 *
 * Portaled to the phone frame (`useScreenOverlayHost`) because a page's header lives
 * outside its ContentArea — an in-place overlay could never paint over it. React events
 * still bubble through the portal, so the hosts' outside-tap deselect handlers (which
 * test `closest(".card-edit-toolbar")`) keep working unchanged.
 *
 * The forwarded ref lands on the panel surface itself — the box `useToolbarInset`
 * measures (its Slide transform is discounted there via `slideOffsetY`).
 *
 * Hosts: flp (`FlashcardsLearnPage`) and td's card view (`deckTower/cardView/TowerCardView`).
 * Layer: fie presentation component (src/cardIcons/editor) — knows nothing about either page.
 */
const CardEditPanel = forwardRef<HTMLDivElement, { open: boolean; children: React.ReactNode }>(
    ({ open, children }, ref) => {
        // Resolved once and held regardless of `open` — gating it on `open` would null the
        // host the moment the editor closes and cut the exit Slide off mid-motion.
        const { anchorRef, host } = useScreenOverlayHost(true);

        // The panel owns the top of the screen while open, so the status-bar tint follows
        // its white surface instead of the (covered) header's ground.
        useThemeColor(open ? COLORS.white : null);

        return (
            <>
                <span ref={anchorRef} className="card-edit-panel__anchor" hidden />
                {host && createPortal(
                    <Slide
                        in={open}
                        direction="down"
                        timeout={CARD_EDIT_ANIM_MS}
                        easing={CARD_EDIT_ANIM_EASING}
                        mountOnEnter
                        unmountOnExit
                    >
                        <Box
                            ref={ref}
                            className="card-edit-panel"
                            sx={{
                                position: "absolute",
                                top: 0,
                                left: 0,
                                right: 0,
                                zIndex: CARD_EDIT_PANEL_Z_INDEX,
                                paddingTop: SAFE_TOP,
                                paddingBottom: "6px",
                                background: COLORS.white,
                                borderRadius: `0 0 ${CARD_EDIT_PANEL_RADIUS}px ${CARD_EDIT_PANEL_RADIUS}px`,
                                boxShadow: SHADOW.sheetDown,
                                // Rounded corners must clip the rows' own surfaces.
                                overflow: "hidden",
                            }}
                        >
                            {children}
                        </Box>
                    </Slide>,
                    host,
                )}
            </>
        );
    },
);
CardEditPanel.displayName = "CardEditPanel";

export default CardEditPanel;
