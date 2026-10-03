import { type ReactNode } from "react";
import { Box, type BoxProps } from "@mui/material";
import Icon from "../Icon";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SHADOW } from "../../theme/shadows";

/**
 * CardShell — the rounded, shadowed body every Bento-family card shares: the 19px
 * radius, the resting drop shadow, an OPTIONAL button/card outline, the 14px
 * padding, the clipped ghost glyph bleeding off the top-right, and the corner pin slot.
 *
 * It exists so the family's look is defined ONCE. Two entities render through it:
 *   - `BentoTile` (this folder) — every hub destination (Home, Discover, Friends, Games);
 *   - `GameCard`'s `card` variant (games/shared/GameCard) — the full-width game card
 *     with a launch-options row (Games hub, Reading Center games carousel).
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
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                    background,
                    boxShadow: SHADOW.rest,
                },
                ...(Array.isArray(sx) ? sx : [sx]),
            ]}
        >
            {ghost && (
                <Icon
                    name={ghost.name}
                    size={ghost.size}
                    color={COLORS.onSurface}
                    className={ghost.className}
                    sx={{ position: "absolute", top: ghost.top, right: CARD_SHELL.ghostRight, opacity: CARD_SHELL.ghostOpacity, pointerEvents: "none" }}
                />
            )}
            {pin && (
                <Box
                    className={`${pinClassBlock}__pin ${pinClassBlock}__pin--${pin.bare ? "bare" : pin.tone ?? "default"}`}
                    sx={pin.bare
                        ? { position: "absolute", top: CARD_SHELL.pinTop, [side]: CARD_SHELL.pinSide, zIndex: 1, display: "flex" }
                        : {
                            position: "absolute",
                            top: CARD_SHELL.pinTop,
                            [side]: CARD_SHELL.pinSide,
                            zIndex: 1,
                            fontFamily: FONTS.mono,
                            fontSize: 10,
                            // An alert pin is a solid chip and needs a proper minimum size:
                            // a one-digit count in a pill sized by its padding renders as an
                            // oval, not the circle a notification badge is read as.
                            ...(alertPin
                                ? {
                                    color: COLORS.white,
                                    background: COLORS.dangerInk,
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
