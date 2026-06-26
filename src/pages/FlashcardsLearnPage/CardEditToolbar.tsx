import React from "react";
import { Box, Button, IconButton, Typography, useTheme } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import CropDinIcon from "@mui/icons-material/CropDin";
import { SIZE, WEIGHT } from "../../theme/scale";
import { ICON_LAYOUT_MAX_ITEMS } from "../../types";

/**
 * CardEditToolbar — the floating secondary bar shown just below the page header while
 * the custom card icon-layout editor is open (docs/CARD_ICON_LAYOUT.md). Surfaces the
 * Add / Reset-to-default / Save / Cancel actions and the icon count.
 */
const CardEditToolbar: React.FC<{
    count: number;
    textBackdrop: boolean;
    onAdd: () => void;
    onToggleBackdrop: () => void;
    onReset: () => void;
    onSave: () => void;
    onCancel: () => void;
    saving: boolean;
}> = ({ count, textBackdrop, onAdd, onToggleBackdrop, onReset, onSave, onCancel, saving }) => {
    const theme = useTheme();
    const fc = theme.palette.flashcard;
    const atMax = count >= ICON_LAYOUT_MAX_ITEMS;

    const smallBtnSx = {
        minWidth: "unset",
        px: 1,
        py: 0.25,
        height: "30px",
        fontSize: SIZE.micro,
        textTransform: "lowercase" as const,
        borderRadius: "6px",
        color: fc.onSurface,
    };

    return (
        <Box
            className="card-edit-toolbar"
            sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                px: 1.5,
                py: 0.75,
                backgroundColor: fc.toggleInactiveBg,
                borderBottom: "1px solid rgba(0,0,0,0.08)",
            }}
        >
            <Button
                className="card-edit-toolbar__add"
                size="small"
                variant="text"
                startIcon={<AddIcon sx={{ fontSize: "16px !important" }} />}
                onClick={onAdd}
                disabled={atMax || saving}
                sx={smallBtnSx}
            >
                add
            </Button>
            <Typography
                className="card-edit-toolbar__count"
                sx={{ fontSize: SIZE.micro, color: fc.onSurface, opacity: 0.7 }}
            >
                {count}/{ICON_LAYOUT_MAX_ITEMS}
            </Typography>

            {/* White backdrop (text frame) behind the card text, for legibility over
                icons. Icon-only toggle; filled when active. */}
            <IconButton
                className="card-edit-toolbar__backdrop"
                size="small"
                onClick={onToggleBackdrop}
                disabled={saving}
                aria-label="Toggle text background"
                sx={{
                    height: "30px",
                    width: "30px",
                    borderRadius: "6px",
                    color: fc.onSurface,
                    backgroundColor: textBackdrop ? fc.toggleActiveBg : "transparent",
                    "&:hover": { backgroundColor: textBackdrop ? fc.toggleActiveBg : fc.toggleInactiveBg },
                }}
            >
                <CropDinIcon sx={{ fontSize: "18px" }} />
            </IconButton>

            <Button
                className="card-edit-toolbar__reset"
                size="small"
                variant="text"
                startIcon={<RestartAltIcon sx={{ fontSize: "16px !important" }} />}
                onClick={onReset}
                disabled={saving}
                sx={smallBtnSx}
            >
                reset
            </Button>

            {/* Push Save/Cancel to the right. */}
            <Box sx={{ flex: 1 }} />

            <Button
                className="card-edit-toolbar__cancel"
                size="small"
                variant="text"
                onClick={onCancel}
                disabled={saving}
                sx={smallBtnSx}
            >
                cancel
            </Button>
            <Button
                className="card-edit-toolbar__save"
                size="small"
                variant="contained"
                onClick={onSave}
                disabled={saving}
                sx={{
                    ...smallBtnSx,
                    fontWeight: WEIGHT.semibold,
                    backgroundColor: fc.toggleActiveBg,
                    "&:hover": { backgroundColor: fc.toggleActiveBg },
                }}
            >
                save
            </Button>
        </Box>
    );
};

export default CardEditToolbar;
