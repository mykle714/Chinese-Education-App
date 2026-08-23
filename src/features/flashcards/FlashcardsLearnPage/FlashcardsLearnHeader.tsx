import React from "react";
import PageHeader, { HeaderIconButton, HeaderToggleChip } from "../../../components/PageHeader";
import MinutePointsFireBadge from "../../../minutePoints/MinutePointsFireBadge";
import type { LastMarkUndoSnapshot } from "../types";
import type { Language } from "../../../types";

interface FlashcardsLearnHeaderProps {
    selectedCategory: string | null;
    lastMarkUndoSnapshot: LastMarkUndoSnapshot | null;
    isAnimating: boolean;
    isUndoing: boolean;
    onBack: () => void;
    onUndo: () => void;
    // Deck language. Pinyin is a Chinese-only concept, so the quick pinyin
    // toggle is rendered only for 'zh' (Spanish has no reading line).
    language: Language;
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
    language,
    showPinyin,
    onTogglePinyin,
    isFlipped,
    editMode,
    onToggleEdit,
    onSettingsClick,
}) => {
    // Control-placement principle (see also SettingsPanelBody): the header surfaces
    // only the "quick" pinyin toggle flipped often mid-study. All other learn prefs
    // (tone color, word spacing, autoplay) live in the Settings sheet as "setup"
    // prefs — the single complete control panel. The "edit" button opens the custom
    // card icon-layout editor (docs/CARD_ICON_LAYOUT.md); it acts on the back face, so
    // it is enabled only when the card is flipped to the back.
    //
    // Every control here is a PageHeader slot primitive. This file used to carry its
    // own 14-line `toggleSx` helper, byte-identical to copies in BubbleMatchHeader and
    // WordSearchHeader; the chip skin now lives once, in HeaderToggleChip.
    const rightItems = (
        <>
            <HeaderIconButton
                className="mobile-demo-tool-button"
                icon="undo"
                label="Undo last mark"
                onClick={onUndo}
                // Mark-undo is meaningless while the icon-layout editor is open (the
                // editor has its own draft state), so grey it out and disable it there.
                disabled={!lastMarkUndoSnapshot || isAnimating || isUndoing || editMode}
            />
            {/* Pinyin visibility toggle — Chinese only. */}
            {language === "zh" && (
                <HeaderToggleChip className="pinyin-toggle-btn" active={showPinyin} onClick={onTogglePinyin}>
                    pinyin
                </HeaderToggleChip>
            )}
            {/* Custom icon-layout editor toggle — back face only. Edit (icon-layout)
                uses the brush; the writing-practice button uses the pencil (the two
                were swapped per design). */}
            <HeaderToggleChip
                className="card-edit-toggle-btn"
                active={editMode}
                onClick={onToggleEdit}
                disabled={!isFlipped}
                startIcon="brush"
            >
                edit
            </HeaderToggleChip>
            <HeaderIconButton
                className="mobile-demo-tool-button mobile-demo-settings-button"
                icon="settings"
                label="Open settings"
                onClick={onSettingsClick}
            />
            <MinutePointsFireBadge />
        </>
    );

    return (
        <PageHeader
            title={selectedCategory ? `Learn: ${selectedCategory}` : "Learn"}
            onBack={onBack}
            // The busiest header in the app — up to five controls beside a title that
            // interpolates a deck name. The Learn artboard sets 18px for exactly this.
            size="dense"
            rightContent={rightItems}
        />
    );
};

export default FlashcardsLearnHeader;
