import React from "react";
import { Button, IconButton, useTheme } from "@mui/material";
import UndoIcon from "@mui/icons-material/Undo";
import SettingsIcon from "@mui/icons-material/Settings";
// Edit (icon-layout) uses the brush; the writing-practice button uses the pencil
// (the two were swapped per design).
import BrushIcon from "@mui/icons-material/Brush";
import PageHeader from "../../../components/PageHeader";
import MinutePointsFireBadge from "../../../minutePoints/MinutePointsFireBadge";
import type { LastMarkUndoSnapshot } from "./types";
import { SIZE } from "../../../theme/scale";

interface FlashcardsLearnHeaderProps {
    selectedCategory: string | null;
    lastMarkUndoSnapshot: LastMarkUndoSnapshot | null;
    isAnimating: boolean;
    isUndoing: boolean;
    onBack: () => void;
    onUndo: () => void;
    showPinyin: boolean;
    onTogglePinyin: () => void;
    // Whether the active card is showing its back (Side 2). The icon-layout editor
    // only operates on the back face, so the "edit" button is enabled only here.
    isFlipped: boolean;
    // True while the icon-layout editor is open (keeps the button from re-triggering).
    editMode: boolean;
    onToggleEdit: () => void;
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
    isFlipped,
    editMode,
    onToggleEdit,
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

    // Control-placement principle (see also SettingsPanelBody): the header surfaces
    // only the "quick" pinyin toggle flipped often mid-study. All other learn prefs
    // (tone color, word spacing, autoplay) live in the Settings sheet as "setup"
    // prefs — the single complete control panel. The "edit" button opens the custom
    // card icon-layout editor (docs/CARD_ICON_LAYOUT.md); it acts on the back face, so
    // it is enabled only when the card is flipped to the back.
    const rightItems = (
        <>
            <IconButton
                className="mobile-demo-tool-button"
                size="small"
                sx={{ color: fc.onSurface }}
                onClick={onUndo}
                // Mark-undo is meaningless while the icon-layout editor is open (the
                // editor has its own draft state), so grey it out and disable it there.
                disabled={!lastMarkUndoSnapshot || isAnimating || isUndoing || editMode}
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
            {/* Custom icon-layout editor toggle — back face only. */}
            <Button
                className="card-edit-toggle-btn"
                variant={editMode ? "contained" : "text"}
                size="small"
                startIcon={<BrushIcon sx={{ fontSize: "14px !important" }} />}
                onClick={onToggleEdit}
                disabled={!isFlipped}
                sx={toggleSx(editMode)}
            >
                edit
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
