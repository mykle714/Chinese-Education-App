import React from "react";
import PageHeader, { HeaderIconButton, HeaderToggleChip } from "../../../components/PageHeader";
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
    // True while the icon-layout editor is open. The editor has its own draft state, so
    // a mark-undo during it is meaningless — the button greys out. The editor's own
    // TOGGLE is no longer here (it moved onto the card's rail), but its STATE still
    // reaches this header for exactly this reason.
    editMode: boolean;
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
    editMode,
    onSettingsClick,
}) => {
    // Control-placement principle (see also SettingsPanelBody): the header surfaces
    // only the "quick" pinyin toggle flipped often mid-study. All other learn prefs
    // (tone color, word spacing, autoplay) live in the Settings sheet as "setup"
    // prefs — the single complete control panel.
    //
    // The icon-layout editor's `edit` toggle used to sit here and has MOVED onto the
    // card, as `customize` on `CardOpsRail` (artboard 19's header does not carry it;
    // artboard 21 shows where it went). It decorates one specific card, so it belongs to
    // that card rather than to the session — and this header was carrying five controls
    // beside a title that interpolates a deck name.
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
            <HeaderIconButton
                className="mobile-demo-tool-button mobile-demo-settings-button"
                icon="settings"
                label="Open settings"
                onClick={onSettingsClick}
            />
        </>
    );

    return (
        <PageHeader
            title={selectedCategory ? `Learn: ${selectedCategory}` : "Learn"}
            onBack={onBack}
            // Still the busiest header in the app — four controls beside a title that
            // interpolates a deck name. The Learn artboard sets 18px for exactly this.
            size="dense"
            rightContent={rightItems}
        />
    );
};

export default FlashcardsLearnHeader;
