import { type ReactNode } from "react";
import { Box, type BoxProps } from "@mui/material";
import Icon from "../Icon";
import { COLORS } from "../../theme/colors";
import { FONTS, DATA_TYPE } from "../../theme/fonts";
import { SHADOW } from "../../theme/shadows";

/**
 * CardShell — the rounded, shadowed body every Bento-family card shares: the 19px
 * radius, the resting drop shadow, an OPTIONAL button/card outline, the 14px
 * padding, the clipped ghost glyph bleeding off the top-right, and the corner pin slot.
 *
 * It exists so the family's look is defined ONCE. Two entities render through it:
 *   - `BentoTile` (this folder) — every hub destination (Menu, Friends, Games);
 *   - `GameCard`'s `card` variant (games/shared/GameCard) — the full-width game card
 *     with a launch-options row (Games hub).
 * Change a number here and both move together; that is the point. Layout INSIDE the
 * shell (foot-aligned title vs. header + options row) is each caller's business.
 *
 * Layer: shared presentational primitive (src/components/bento).
 * Docs: docs/BENTO_SYSTEM.md § "CardShell".
 */

/** The family's shared geometry. */
export const CARD_SHELL = {
    radius: 19,
    padding: 14,
    /** The ghost glyph's right bleed and its opacity — every variant uses these two. */
    ghostRight: -10,
    ghostOpacity: 0.15,
    /** Pin inset from the top and side edges. */
    pinTop: 12,
    pinSide: 13,
    /** An ALERT pin's offset: negative, so the badge floats over the tile's corner the way
     *  a classic app-icon notification badge does (2026-11-13). */
    alertPinOffset: -7,
} as const;

/** Title type shared by the family's default-size members (BentoTile `base`/`low`
 *  and GameCard's header) — so a game card's name reads exactly like a tile's. */
export const CARD_TITLE_SX = {
    fontFamily: FONTS.sans,
    fontSize: 15.5,
    fontWeight: 600,
    letterSpacing: "-0.015em",
    lineHeight: 1.2,
    color: COLORS.onSurface,
} as const;

export interface CardShellPin {
    node: ReactNode;
    /** See `BentoTileProps.pinTone`. Ignored when `bare`. */
    tone?: "default" | "alert";
    /** The node brings its own chrome (e.g. `WinCountPill`); the slot only positions it. */
    bare?: boolean;
    side?: "left" | "right";
}

export interface CardShellProps extends Omit<BoxProps, "children"> {
    /** The card's body colour (a RAMP `.mid`, or white). */
    background: string;
    /**
     * Draw the app's button/card outline (`1px solid COLORS.border`). OFF by default:
     * a Bento tile is a large, occupied pastel and its drop shadow does the separating
     * — the documented exception in CLAUDE.md § "Buttons & cards" and
     * docs/BENTO_SYSTEM.md § "`markOutline` does not apply here". `GameCard`'s `card`
     * variant turns it on (game cards are outlined), except Word Search's frame.
     */
    outlined?: boolean;
    /** Ghost glyph — a Material Symbols name, drawn in ink at `CARD_SHELL.ghostOpacity`. */
    ghost?: { name: string; size: number; top: number; className?: string };
    pin?: CardShellPin;
    /** BEM block for the pin's class (`<block>__pin`). */
    pinClassBlock?: string;
    children?: ReactNode;
    /** Router-link / button props (`to`, `state`, `type`) pass straight through. */
    [extra: string]: unknown;
}

export const CardShell: React.FC<CardShellProps> = ({
    background, outlined = false, ghost, pin, pinClassBlock = "card-shell", children, sx, ...rest
}) => {
    const alertPin = pin?.tone === "alert";
    const side = pin?.side ?? "right";
    return (
        <Box
            // `rest` may carry RouterLink props (`component`, `to`, `state`) the BoxProps
            // type does not name; Box forwards them to whatever `component` renders.
            {...(rest as BoxProps)}
            sx={[
                {
                    position: "relative",
                    // A `button` / anchor brings its own border, background and font; the
                    // shell must look identical whether it navigates, opens a sheet, or
                    // does neither — so the border is always set explicitly.
                    border: outlined ? `1px solid ${COLORS.border}` : "none",
                    textAlign: "left",
                    font: "inherit",
                    textDecoration: "none",
                    color: "inherit",
                    borderRadius: `${CARD_SHELL.radius}px`,
                    padding: `${CARD_SHELL.padding}px`,
                    // Clips stray content to the rounded box — EXCEPT under an alert pin,
                    // which floats over the corner and would be cut off. The ghost glyph,
                    // the one thing that deliberately bleeds, clips in its own layer below
                    // either way, so lifting this does not let it escape.
                    overflow: alertPin ? "visible" : "hidden",
                    display: "flex",
                    flexDirection: "column",
                    background,
                    boxShadow: SHADOW.rest,
                },
                ...(Array.isArray(sx) ? sx : [sx]),
            ]}
        >
            {ghost && (
                // Clip layer: the ghost bleeds off the top-right and must be cut at the
                // tile's rounded edge even when the shell itself does not clip (alert pin).
                <Box
                    className="card-shell__ghost-clip"
                    aria-hidden
                    sx={{ position: "absolute", inset: 0, borderRadius: "inherit", overflow: "hidden", pointerEvents: "none" }}
                >
                    <Icon
                        name={ghost.name}
                        size={ghost.size}
                        color={COLORS.onSurface}
                        className={ghost.className}
                        sx={{ position: "absolute", top: ghost.top, right: CARD_SHELL.ghostRight, opacity: CARD_SHELL.ghostOpacity }}
                    />
                </Box>
            )}
            {pin && (
                <Box
                    className={`${pinClassBlock}__pin ${pinClassBlock}__pin--${pin.bare ? "bare" : pin.tone ?? "default"}`}
                    sx={pin.bare
                        ? { position: "absolute", top: CARD_SHELL.pinTop, [side]: CARD_SHELL.pinSide, zIndex: 1, display: "flex" }
                        : {
                            position: "absolute",
                            top: alertPin ? CARD_SHELL.alertPinOffset : CARD_SHELL.pinTop,
                            [side]: alertPin ? CARD_SHELL.alertPinOffset : CARD_SHELL.pinSide,
                            zIndex: 1,
                            ...DATA_TYPE,
                            fontSize: 10,
                            // An alert pin is a solid chip and needs a proper minimum size:
                            // a one-digit count in a pill sized by its padding renders as an
                            // oval, not the circle a notification badge is read as.
                            // The classic notification badge: `COLORS.notificationRed` under
                            // white, floating over the corner (offset above). It was
                            // `dangerInk`, which the v2 palette turned black.
                            ...(alertPin
                                ? {
                                    color: COLORS.white,
                                    background: COLORS.notificationRed,
                                    boxShadow: SHADOW.rest,
                                    fontWeight: 600,
                                    minWidth: 20,
                                    textAlign: "center",
                                    padding: "4px 6px",
                                    lineHeight: 1.2,
                                }
                                : {
                                    color: COLORS.onSurface,
                                    background: COLORS.frost,
                                    padding: "4px 8px",
                                }),
                            borderRadius: "999px",
                        }}
                >
                    {pin.node}
                </Box>
            )}
            {children}
        </Box>
    );
};

export default CardShell;
