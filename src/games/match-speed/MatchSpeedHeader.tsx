import React from "react";
import { HeaderToggleChip } from "../../components/PageHeader";
import { isLatinScriptLang } from "../../components/ForeignText";
import AudioModeChip from "../../components/AudioModeChip";
import type { Language } from "../../types";

interface MatchSpeedHeaderProps {
    /** Active run language — gates the pinyin chip (see the component comment). */
    language: Language;
    showPinyin: boolean;
    onTogglePinyin: () => void;
}

/**
 * Right-side header controls for Match Speed: the pinyin toggle, the narration
 * audio-mode chip and the minute-points fire badge.
 *
 * These toggles used to live here inline with the run clock beside them; they moved
 * into a `MatchSpeedSettingsDialog` behind a cog, and the clock moved to a bar above
 * the board — it belongs to the play area, where the player is already looking, not
 * to the page chrome (see MatchSpeedTimerBar).
 *
 * BOTH CAME BACK on 2026-08-28 and the dialog and its cog were deleted, because
 * neither setting is Match Speed's any more:
 *   • audio is the app-wide narration setting (`AudioModeChip`, self-contained and
 *     identical on the flp, scp, Bubble Match, Hydra and here);
 *   • tone coloring moved to /settings → Display, which is where EVERY surface now
 *     edits it — it applies to every reading the app renders.
 * That left the sheet holding one row, and holding NOTHING at all for a
 * Latin-script language (both its rows were gated on a non-Latin script), so a cog
 * opening an empty dialog was the alternative. See docs/AUDIO_PLAYBACK.md.
 *
 * LANGUAGE GATING: the pinyin chip is HIDDEN, not merely inert, for Latin-script
 * languages — `ForeignText` renders Spanish as plain text and ignores the flag, so
 * leaving the control on screen would ship a button that visibly does nothing.
 * Same rule as BubbleMatchHeaderControls.
 *
 * Match Speed is a LEAF PAGE (see docs/LEAF_NODE_PAGES.md), so the header + down
 * chevron come from LeafPage/LeafPageHeader; this component just fills LeafPage's
 * `rightContent` slot.
 *
 * See docs/MATCH_SPEED_GAME.md § Page shell, header, and chrome.
 */
const MatchSpeedHeaderControls: React.FC<MatchSpeedHeaderProps> = ({
    language,
    showPinyin,
    onTogglePinyin,
}) => (
    <>
        {!isLatinScriptLang(language) && (
            <HeaderToggleChip className="pinyin-toggle-btn" active={showPinyin} onClick={onTogglePinyin}>
                pinyin
            </HeaderToggleChip>
        )}
        <AudioModeChip className="match-speed__audio-chip" />
    </>
);

export default MatchSpeedHeaderControls;
