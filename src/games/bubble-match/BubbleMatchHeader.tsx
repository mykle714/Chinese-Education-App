import React from "react";
import { HeaderIconButton, HeaderToggleChip } from "../../components/PageHeader";
import { isLatinScriptLang } from "../../components/ForeignText";
import type { Language } from "../../types";

interface BubbleMatchHeaderControlsProps {
    /** Active run language — gates the pinyin toggle (see the component comment). */
    language: Language;
    /** The pinyin toggle. OMIT BOTH to hide it: Bubble Match no longer carries one,
     *  because its pinyin setting now decides the run's mastery track and so must be
     *  chosen before the board is dealt (on the Games hub — docs/GAMES_FEATURE.md
     *  § "Bubble Match: pinyin picks the track"). Hydra Bubbles still toggles live. */
    showPinyin?: boolean;
    onTogglePinyin?: () => void;
    /** The autoplay toggle. OMIT BOTH to hide it — Bubble Match hides it on a READING
     *  run, where hearing the word would hand over the pronunciation the run is
     *  testing the player to read. */
    autoplayChinese?: boolean;
    onToggleAutoplayChinese?: () => void;
    /** Restart the current level with the same words. When omitted (e.g. outside
     *  the live "playing" phase) the restart button is hidden. */
    onRestart?: () => void;
}

/**
 * Right-side header controls for the bubble games: an optional restart button
 * (same level, same words), up to two quick toggles (pinyin + autoplay, mirroring
 * FlashcardsLearnHeader) and the minute-points fire badge.
 *
 * EVERY TOGGLE IS OPTIONAL and hidden when its caller passes no handler. Hydra
 * Bubbles takes both; Bubble Match takes neither its pinyin one (that setting now
 * chooses the run's mastery track, so it is picked on the hub before the deal) nor,
 * on a reading run, its autoplay one.
 *
 * Bubble Match is a LEAF PAGE (see docs/LEAF_NODE_PAGES.md), so the header + down
 * chevron come from LeafPage/LeafPageHeader; this component just fills LeafPage's
 * `rightContent` slot. The controls are the shared PageHeader slot primitives — the
 * design's `.lhd .tg` chip and bare `.ms` action — rather than the local `toggleSx`
 * helper this file used to duplicate from flp and Word Search (shelf redesign A2b).
 *
 * LANGUAGE GATING: the pinyin toggle is HIDDEN, not merely inert, for Latin-script
 * languages (see `showPinyinControls`). Added alongside Match Speed, which has the
 * same requirement — see docs/MATCH_SPEED_GAME.md § Language scope.
 */
const BubbleMatchHeaderControls: React.FC<BubbleMatchHeaderControlsProps> = ({
    language,
    showPinyin,
    onTogglePinyin,
    autoplayChinese,
    onToggleAutoplayChinese,
    onRestart,
}) => {
    // The pinyin chip needs a caller that owns the setting AND a non-Latin script:
    // ForeignText renders Spanish as plain text and ignores the flag, so leaving the
    // button on screen would ship a control that visibly does nothing.
    const showPinyinControls =
        showPinyin !== undefined && onTogglePinyin !== undefined && !isLatinScriptLang(language);
    const showAutoplayControl = autoplayChinese !== undefined && onToggleAutoplayChinese !== undefined;

    return (
        <>
            {/* Restart the live level with the same word set (reshuffled launch
                order). Only present during active play — the end-of-run popup owns
                replay from the won/lost screens. */}
            {onRestart && (
                <HeaderIconButton
                    className="bubble-match__restart-btn"
                    icon="restart_alt"
                    label="Restart level"
                    onClick={onRestart}
                />
            )}
            {showPinyinControls && (
                <HeaderToggleChip className="pinyin-toggle-btn" active={showPinyin} onClick={onTogglePinyin}>
                    pinyin
                </HeaderToggleChip>
            )}
            {showAutoplayControl && (
                <HeaderToggleChip
                    className="autoplay-toggle-btn"
                    active={autoplayChinese}
                    onClick={onToggleAutoplayChinese}
                >
                    autoplay
                </HeaderToggleChip>
            )}
        </>
    );
};

export default BubbleMatchHeaderControls;
