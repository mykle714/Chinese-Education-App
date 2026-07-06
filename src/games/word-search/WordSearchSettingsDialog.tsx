import React from "react";
import { Dialog, DialogContent, DialogTitle, Box, IconButton, Switch, Typography, useTheme } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { SIZE, WEIGHT } from "../../theme/scale";

interface WordSearchSettingsDialogProps {
    open: boolean;
    onClose: () => void;
    showTimer: boolean;
    onToggleShowTimer: (value: boolean) => void;
}

/**
 * Word Search's settings sheet, behind the header cog. Pinyin display is NO
 * LONGER a setting here: it's fixed by which hub entry (Pinyin / No Pinyin) the
 * player launched, so the only remaining control is timer visibility. See
 * docs/WORD_SEARCH_GAME.md §3.
 */
const WordSearchSettingsDialog: React.FC<WordSearchSettingsDialogProps> = ({
    open,
    onClose,
    showTimer,
    onToggleShowTimer,
}) => {
    const theme = useTheme();
    const fc = theme.palette.flashcard;

    const row = (key: string, label: string, checked: boolean, onChange: (v: boolean) => void) => (
        <Box
            key={key}
            className={`word-search-settings-row word-search-settings-row--${key}`}
            sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 0",
                borderBottom: `1px solid ${fc.border}`,
            }}
        >
            <Typography sx={{ fontSize: 14, color: fc.onSurface }}>{label}</Typography>
            <Switch size="small" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        </Box>
    );

    return (
        <Dialog className="word-search-settings-dialog" open={open} onClose={onClose} fullWidth maxWidth="xs">
            <DialogTitle
                sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: SIZE.bodyLg, fontWeight: WEIGHT.bold }}
            >
                Word Search Settings
                <IconButton className="word-search-settings-dialog__close" size="small" onClick={onClose} aria-label="Close settings">
                    <CloseIcon fontSize="small" />
                </IconButton>
            </DialogTitle>
            <DialogContent sx={{ pb: 2 }}>
                {row("timer", "Show timer", showTimer, onToggleShowTimer)}
            </DialogContent>
        </Dialog>
    );
};

export default WordSearchSettingsDialog;
