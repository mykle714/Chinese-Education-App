import React from "react";
import { Button, IconButton, useTheme } from "@mui/material";
import UndoIcon from "@mui/icons-material/Undo";
import SettingsIcon from "@mui/icons-material/Settings";
import PageHeader from "../../components/PageHeader";
import MinutePointsFireBadge from "../../components/MinutePointsFireBadge";
import type { LastMarkUndoSnapshot } from "./types";
import { SIZE } from "../../theme/scale";

interface FlashcardsLearnHeaderProps {
    selectedCategory: string | null;
    lastMarkUndoSnapshot: LastMarkUndoSnapshot | null;
    isAnimating: boolean;
    isUndoing: boolean;
    onBack: () => void;
    onUndo: () => void;
    showPinyin: boolean;
    onTogglePinyin: () => void;
    autoplayChinese: boolean;
    onToggleAutoplayChinese: () => void;
    onSettingsClick: () => void;
}

const FlashcardsLearnHeader: React.FC<FlashcardsLearnHeaderProps> = ({
    selectedCategory,
    lastMarkUndoSnapshot,
    isAnimating,
    isUndoing,
    onBack,
    onUndo,
    showPinyin,
    onTogglePinyin,
    autoplayChinese,
    onToggleAutoplayChinese,
    onSettingsClick,
}) => {
    const theme = useTheme();
    const fc = theme.palette.flashcard;

    const toggleSx = (active: boolean) => ({
        minWidth: "unset",
        px: 1,
        py: 0.25,
        height: "30px",
        fontSize: SIZE.micro,
        textTransform: "lowercase" as const,
        lineHeight: 1.4,
        borderRadius: "6px",
        backgroundColor: active ? fc.toggleActiveBg : fc.toggleInactiveBg,
        color: fc.onSurface,
        "&:hover": {
            backgroundColor: active ? fc.toggleActiveBg : fc.toggleInactiveBg,
        },
    });

    // Control-placement principle (see also SettingsPanelBody): the header
    // surfaces only the two "quick" toggles flipped often mid-study — pinyin and
    // autoplay. All other learn prefs (tone color, word spacing) live in the
    // Settings sheet as "setup" prefs. Both toggles here are also mirrored in the
    // sheet, which remains the single complete control panel.
    const rightItems = (
        <>
            <IconButton
                className="mobile-demo-tool-button"
                size="small"
                sx={{ color: fc.onSurface }}
                onClick={onUndo}
                disabled={!lastMarkUndoSnapshot || isAnimating || isUndoing}
            >
                <UndoIcon />
            </IconButton>
            {/* Pinyin visibility toggle */}
            <Button
                className="pinyin-toggle-btn"
                variant={showPinyin ? "contained" : "text"}
                size="small"
                onClick={onTogglePinyin}
                sx={toggleSx(showPinyin)}
            >
                pinyin
            </Button>
            {/* Autoplay-on-chinese-side toggle. Replaces the previous segment-spaces
                button — spaces moved into the settings sheet. */}
            <Button
                className="autoplay-toggle-btn"
                variant={autoplayChinese ? "contained" : "text"}
                size="small"
                onClick={onToggleAutoplayChinese}
                sx={toggleSx(autoplayChinese)}
            >
                autoplay
            </Button>
            <IconButton
                className="mobile-demo-tool-button mobile-demo-settings-button"
                size="small"
                sx={{ color: fc.onSurface }}
                onClick={onSettingsClick}
                aria-label="Open settings"
            >
                <SettingsIcon />
            </IconButton>
            <MinutePointsFireBadge />
        </>
    );

    return (
        <PageHeader
            title={selectedCategory ? `Learn: ${selectedCategory}` : "Learn"}
            onBack={onBack}
            rightContent={rightItems}
        />
    );
};

export default FlashcardsLearnHeader;
