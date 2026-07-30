import React from "react";
import {
    Box,
    Dialog,
    DialogContent,
    DialogTitle,
    IconButton,
    Switch,
    Typography,
    useTheme,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { isLatinScriptLang } from "../../components/ForeignText";
import type { Language } from "../../types";
import { SIZE, WEIGHT } from "../../theme/scale";

interface MatchSpeedSettingsDialogProps {
    open: boolean;
    onClose: () => void;
    /** Active run language — gates the pinyin rows (see below). */
    language: Language;
    showPinyin: boolean;
    onToggleShowPinyin: (value: boolean) => void;
    showPinyinColor: boolean;
    onToggleShowPinyinColor: (value: boolean) => void;
    autoplayChinese: boolean;
    onToggleAutoplayChinese: (value: boolean) => void;
}

/**
 * Match Speed's settings sheet, behind the header cog.
 *
 * These three toggles used to sit in the header as inline buttons, which cost
 * roughly half the header bar and left no room for anything else. They now follow
 * the same split flp and Word Search use: quick controls stay in the header,
 * everything else goes behind the cog.
 *
 * LANGUAGE GATING: the pinyin rows are HIDDEN, not merely inert, for Latin-script
 * languages. `ForeignText` renders Spanish as plain text and ignores both flags
 * entirely, so leaving them on screen would ship controls that visibly do nothing.
 * `isLatinScriptLang` is imported from ForeignText — the canonical owner of that
 * set — rather than re-testing `=== "es"` here.
 *
 * Layer: presentational. It owns no state; the page holds the settings (they are
 * the shared flp learn settings, so they persist across games).
 *
 * See docs/MATCH_SPEED_GAME.md § Page shell, header, and chrome.
 */
const MatchSpeedSettingsDialog: React.FC<MatchSpeedSettingsDialogProps> = ({
    open,
    onClose,
    language,
    showPinyin,
    onToggleShowPinyin,
    showPinyinColor,
    onToggleShowPinyinColor,
    autoplayChinese,
    onToggleAutoplayChinese,
}) => {
    const theme = useTheme();
    const fc = theme.palette.flashcard;
    const showPinyinControls = !isLatinScriptLang(language);

    const row = (key: string, label: string, checked: boolean, onChange: (v: boolean) => void) => (
        <Box
            key={key}
            className={`match-speed-settings-row match-speed-settings-row--${key}`}
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
        <Dialog className="match-speed-settings-dialog" open={open} onClose={onClose} fullWidth maxWidth="xs">
            <DialogTitle
                sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    fontSize: SIZE.bodyLg,
                    fontWeight: WEIGHT.bold,
                }}
            >
                Match Speed Settings
                <IconButton
                    className="match-speed-settings-dialog__close"
                    size="small"
                    onClick={onClose}
                    aria-label="Close settings"
                >
                    <CloseIcon fontSize="small" />
                </IconButton>
            </DialogTitle>
            <DialogContent sx={{ pb: 2 }}>
                {showPinyinControls && row("pinyin", "Show pinyin", showPinyin, onToggleShowPinyin)}
                {showPinyinControls && row("pinyin-color", "Tone colors", showPinyinColor, onToggleShowPinyinColor)}
                {row("autoplay", "Speak the word on tap", autoplayChinese, onToggleAutoplayChinese)}
            </DialogContent>
        </Dialog>
    );
};

export default MatchSpeedSettingsDialog;
