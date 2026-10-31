import React, { createContext, useContext } from "react";
import { Box, Popper, Typography } from "@mui/material";
import type { PopperProps } from "@mui/material";
import { FONTS } from "../theme/fonts";
import { SIZE } from "../theme/scale";
import { COLORS } from "../theme/colors";
import { tier2Var } from "../timeOfDay/tier2Chrome";

/**
 * The colours a night-themed surface lends the popup. Null (the default) leaves it on the
 * Tier 2 variables below; EipPaletteProvider publishes tones at night because an eip can
 * open over a page with no Tier 2 claim (the Deck Tower), where those variables are unset.
 */
export interface CpcdPopupTones {
    surface: string;
    pressed: string;
    outline: string;
    ink: string;
    muted: string;
}

export const CpcdPopupTonesCtx = createContext<CpcdPopupTones | null>(null);

/**
 * The small caption card that floats above a cpcd run: white, or the lighter night slate
 * (#2A3446) on a night-themed surface. Docs: docs/EIP_SHEET_GESTURES.md § Time of day,
 * docs/SHELF_REDESIGN.md § 7b "Time of day".
 *
 * Extracted from SegmentedSentenceDisplay (where it is the est's tapped-segment
 * definition box) so a second surface can reuse the SAME visual affordance rather
 * than re-authoring it: CPCDRow's tap-to-copy toast ("Characters Copied!") is the
 * same box saying something else. Anything specific to a caller — what dismisses
 * it, whether a tap on it does anything — stays with the caller and arrives here
 * as props; this component owns only the Popper placement and the card's looks.
 *
 * Placement is always "above the anchor, flipping below when there is no room".
 * The anchor may be a real element or a Popper virtual element (a bare
 * `{ getBoundingClientRect }`), which is how the est anchors to a measured
 * highlight rect rather than to a DOM node.
 *
 * Referenced by: src/components/SegmentedSentenceDisplay.tsx (segment definition
 * popup), src/components/CPCDRow.tsx (tap-to-copy toast).
 */
export interface CpcdPopupProps {
    open: boolean;
    anchorEl: PopperProps["anchorEl"];
    /** The caption text. Callers pre-format it (the est strips parentheses first). */
    text: string;
    /**
     * Root class name; the text and chevron nodes derive theirs from it
     * (`${className}__text`, `${className}__chevron`) so each surface keeps its own
     * descriptive, greppable class names.
     */
    className?: string;
    /** Render the drill-in chevron and the pointer cursor: the card itself is tappable. */
    interactive?: boolean;
    /** Grey the card while it is being pressed (tap feedback for `interactive` cards). */
    pressed?: boolean;
    /** Popper's live instance, for callers that need to re-run placement (see the est). */
    popperRef?: PopperProps["popperRef"];
    /** Ref to the card element itself — the est uses it to tell a tap on the popup apart from a tap outside. */
    cardRef?: React.Ref<HTMLDivElement>;
    onMouseEnter?: React.MouseEventHandler<HTMLDivElement>;
    onMouseLeave?: React.MouseEventHandler<HTMLDivElement>;
    onPointerDown?: React.PointerEventHandler<HTMLDivElement>;
    onPointerUp?: React.PointerEventHandler<HTMLDivElement>;
    onPointerLeave?: React.PointerEventHandler<HTMLDivElement>;
    onPointerCancel?: React.PointerEventHandler<HTMLDivElement>;
}

const CpcdPopup: React.FC<CpcdPopupProps> = ({
    open,
    anchorEl,
    text,
    className = "cpcd-popup",
    interactive = false,
    pressed = false,
    popperRef,
    cardRef,
    onMouseEnter,
    onMouseLeave,
    onPointerDown,
    onPointerUp,
    onPointerLeave,
    onPointerCancel,
}) => {
    // Tier 2 variables are unset away from a Tier 2 page, so each falls back to the day look.
    const tones = useContext(CpcdPopupTonesCtx);
    const surface = tones?.surface ?? tier2Var("surface", COLORS.white);
    return (
    // Rendered into a portal via Popper so the card escapes any ancestor's
    // overflow:auto/hidden (e.g. the EIP scroll container) and is never clipped.
    <Popper
        open={open}
        anchorEl={anchorEl}
        popperRef={popperRef}
        placement="top"
        modifiers={[
            { name: "offset", options: { offset: [0, 6] } },
            { name: "preventOverflow", options: { boundary: "viewport", padding: 8 } },
            { name: "flip", options: { fallbackPlacements: ["bottom"] } },
        ]}
        sx={{ zIndex: 1300 }}
    >
        <Box
            ref={cardRef}
            className={className}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerLeave}
            onPointerCancel={onPointerCancel}
            sx={{
                backgroundColor: surface,
                border: "1px solid",
                borderColor: (theme) => tones?.outline ?? tier2Var("outline", theme.palette.divider),
                borderRadius: "8px",
                boxShadow: 2,
                px: 1.25,
                py: 0.75,
                maxWidth: "220px",
                ...(interactive && {
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 0.5,
                    // Grey the whole card while pressed so a registered tap is obvious.
                    transition: "background-color 100ms ease",
                    backgroundColor: (theme) => pressed
                        ? tones?.pressed ?? tier2Var("pressed", theme.palette.action.selected)
                        : surface,
                }),
            }}
        >
            <Typography
                className={`${className}__text`}
                sx={{
                    fontSize: SIZE.caption,
                    lineHeight: 1.3,
                    color: (theme) => tones?.ink ?? tier2Var("ink", theme.palette.text.primary),
                    fontFamily: FONTS.sans,
                    textAlign: "center",
                    wordBreak: "break-word",
                    ...(interactive && { flex: 1, textAlign: "left" }),
                }}
            >
                {text}
            </Typography>
            {interactive && (
                // Same drill-in chevron the breakdown/used-in rows use, so "chevron =
                // opens the eip for this word" stays a consistent gesture across the card.
                <Box
                    className={`${className}__chevron`}
                    component="span"
                    sx={{
                        flexShrink: 0,
                        fontSize: SIZE.body,
                        lineHeight: 1,
                        color: (theme) => tones?.muted ?? tier2Var("muted", theme.palette.text.secondary),
                        fontFamily: FONTS.sans,
                    }}
                >
                    ›
                </Box>
            )}
        </Box>
    </Popper>
    );
};

export default CpcdPopup;
