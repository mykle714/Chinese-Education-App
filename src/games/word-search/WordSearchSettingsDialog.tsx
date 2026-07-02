import React from "react";
import { Dialog, DialogContent, DialogTitle, Box, IconButton, Switch, Typography, useTheme } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { SIZE, WEIGHT } from "../../theme/scale";

interface WordSearchSettingsDialogProps {
    open: boolean;
    onClose: () => void;
    showPinyin: boolean;
    onToggleShowPinyin: (value: boolean) => void;
    showPinyinColor: boolean;
    onToggleShowPinyinColor: (value: boolean) => void;
    showTimer: boolean;
    onToggleShowTimer: (value: boolean) => void;
}

/**
 * Word Search's settings sheet, behind the header cog. Mirrors flp's Settings
 * sheet (SettingsPanelBody): the header keeps only the highest-frequency
 * controls (hint, restart), everything else — pinyin display, timer
 * visibility — moves here. See docs/WORD_SEARCH_GAME.md §3.
 */
const WordSearchSettingsDialog: React.FC<WordSearchSettingsDialogProps> = ({
    open,
    onClose,
    showPinyin,
    onToggleShowPinyin,
    showPinyinColor,
    onToggleShowPinyinColor,
    showTimer,
    onToggleShowTimer,
}) => {
    const theme = useTheme();
    const fc = theme.palette.flashcard;

    const row = (
        key: string,
        label: string,
        checked: boolean,
        onChange: (v: boolean) => void,
        indented = false
    ) => (
        <Box
            key={key}
            className={`word-search-settings-row word-search-settings-row--${key}${indented ? " word-search-settings-row--nested" : ""}`}
            sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 0",
                ...(indented && {
                    paddingLeft: "14px",
                    marginLeft: "4px",
                    borderLeft: `2px solid ${fc.border}`,
                }),
                borderBottom: `1px solid ${fc.border}`,
            }}
        >
            <Typography sx={{ fontSize: indented ? 13 : 14, color: indented ? fc.textSecondary : fc.onSurface }}>
                {label}
            </Typography>
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
                {row("pinyin", "Show pinyin", showPinyin, onToggleShowPinyin)}
                {showPinyin && row("pinyin-color", "Color pinyin by tone", showPinyinColor, onToggleShowPinyinColor, true)}
                {row("timer", "Show timer", showTimer, onToggleShowTimer)}
            </DialogContent>
        </Dialog>
    );
};

export default WordSearchSettingsDialog;
