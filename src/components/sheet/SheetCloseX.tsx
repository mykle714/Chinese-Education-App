import React from "react";
import { IconButton } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import Icon from "../Icon";
import { COLORS } from "../../theme/colors";

/**
 * THE app's one panel close button — the small faint ✕ that lives at the top-right of
 * every sheet (SheetPanel) and of the challenge sheet.
 *
 * It is the eip word-trail's close, promoted. That button (`.eip-close-tab-btn` in
 * EipTabStrip) was the only ✕ any panel had, and it only existed once a second word was
 * open; every other panel — the cdp's eip, the compare sheet, the challenge sheet —
 * either had no ✕ at all (drag down, or tap the scrim) or drew its own, larger,
 * grounded one. One glyph, one size, one ink, one target, in the same corner of every
 * panel, so "close this" is a place rather than a per-surface guess.
 *
 * ⚠️ SIZE AND INK ARE THE POINT, so they are not props. 17px `close` in
 * `COLORS.textFaint` is a quiet affordance: a panel's close is not a call to action,
 * and at full weight it would out-shout the panel's own content. Pass `sx` only for
 * POSITION.
 *
 * LAYER: shared presentational. Knows nothing about what closing means — the caller
 * decides whether the tap drops a tab, dismisses a sheet or both (see SheetPanel's
 * `onCloseX`).
 */
interface SheetCloseXProps {
    onClick: () => void;
    /** Defaults to "Close". The eip's ✕ closes the showing WORD, so it says so. */
    ariaLabel?: string;
    className?: string;
    sx?: SxProps<Theme>;
}

const SheetCloseX: React.FC<SheetCloseXProps> = ({ onClick, ariaLabel = "Close", className, sx }) => (
    <IconButton
        className={className ? `sheet-close-x ${className}` : "sheet-close-x"}
        size="small"
        onClick={onClick}
        aria-label={ariaLabel}
        sx={{ flexShrink: 0, padding: "4px", "&:hover": { opacity: 0.75 }, ...sx }}
    >
        <Icon name="close" size={17} color={COLORS.textFaint} />
    </IconButton>
);

export default SheetCloseX;
