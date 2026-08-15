import { useState } from "react";
import { Box, ClickAwayListener, IconButton, Tooltip } from "@mui/material";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";
import { SIZE } from "../theme/scale";

/**
 * A tappable ⓘ that reveals one short explanation.
 *
 * WHY IT IS CLICK-DRIVEN, not the usual hover Tooltip: this app is mobile-first and
 * there is no hover on touch. MUI's default listeners are therefore all disabled and
 * the open state is controlled — the icon toggles it, a tap anywhere else closes it
 * (ClickAwayListener). That makes the same control work identically with a mouse.
 *
 * Use it to move a caption that only *some* readers need out of the layout: the
 * number stays big and unexplained-until-asked, instead of carrying a permanent line
 * of small print. The explanation must stay short enough to read in a tooltip — if it
 * needs a paragraph, it belongs in a page or a dialog, not here.
 */
interface InfoTipProps {
    /** The explanation shown when tapped. Keep it to a sentence or so. */
    text: string;
    /** Screen-reader name for the button. Defaults to a generic label. */
    ariaLabel?: string;
    className?: string;
}

function InfoTip({ text, ariaLabel = "More information", className }: InfoTipProps) {
    const [open, setOpen] = useState(false);

    return (
        <ClickAwayListener onClickAway={() => setOpen(false)}>
            {/* The span is the click-away boundary AND the ref holder — ClickAwayListener
                needs a single child that forwards one, which an IconButton alone would
                also satisfy, but keeping the wrapper lets the caller style placement. */}
            <Box component="span" className={`info-tip ${className ?? ""}`.trim()} sx={{ display: "inline-flex" }}>
                <Tooltip
                    open={open}
                    title={text}
                    arrow
                    placement="top"
                    // Controlled: every built-in trigger is off so the icon's onClick is
                    // the only thing that can open it. Without this, a desktop hover and
                    // the controlled state fight each other.
                    disableFocusListener
                    disableHoverListener
                    disableTouchListener
                    slotProps={{
                        tooltip: {
                            sx: {
                                fontFamily: FONTS.sans,
                                fontSize: SIZE.caption,
                                backgroundColor: COLORS.onSurface,
                                maxWidth: 220,
                                textAlign: "center",
                            },
                        },
                        arrow: { sx: { color: COLORS.onSurface } },
                    }}
                >
                    <IconButton
                        className="info-tip__button"
                        aria-label={ariaLabel}
                        onClick={() => setOpen((prev) => !prev)}
                        sx={{ p: 0.25, color: COLORS.textSecondary }}
                    >
                        <InfoOutlinedIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                </Tooltip>
            </Box>
        </ClickAwayListener>
    );
}

export default InfoTip;
