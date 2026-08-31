import React from "react";
import { HeaderIconButton } from "../../components/PageHeader";
import AudioModeChip from "../../components/AudioModeChip";

interface WordSearchHeaderControlsProps {
    /** Open the settings sheet (timer visibility). */
    onSettingsClick: () => void;
}

/**
 * Right-side header controls for Word Search: the narration audio-mode chip and the
 * settings cog, and nothing else.
 *
 * The audio chip is the SAME self-contained `AudioModeChip` the flp, scp, Bubble
 * Match/Hydra Bubbles and Match Speed headers render — it reads the app-wide
 * `useTTSSettings` value itself, so there is nothing to wire and no way for this
 * surface's label, icon or cycle order to drift from the others. Word Search speaks
 * on its own schedule (a found word, a blue match, a review rung — all through
 * `autoSpeakSentence`), so it is exactly the kind of surface that needs a mid-play
 * mute without a trip to /settings. See docs/AUDIO_PLAYBACK.md.
 *
 * Three things have left this slot over time, and the reason is the same each time —
 * the header holds SETTINGS-shaped controls, not game ones (docs/SHELF_REDESIGN.md
 * § A2b):
 *   - restart, removed outright: a board in progress is now only discarded by finishing
 *     it or by starting a fresh game from the hub.
 *   - pinyin display and timer visibility, into `WordSearchSettingsDialog` — and pinyin
 *     display then out of there too, because it is fixed by which hub entry (Pinyin /
 *     No Pinyin) the run was launched from. The HUD states the mode instead of offering
 *     a switch, which is what artboard 13 draws.
 *   - the hint button, into the play panel's `.hintbar` alongside its own charges and
 *     reveal (see WordSearchHintBar). Spending a hint is a game ACTION.
 *
 * Word Search is a LEAF PAGE (see docs/LEAF_NODE_PAGES.md), so the header + down chevron
 * come from LeafPage/LeafPageHeader; this component just fills LeafPage's `rightContent`
 * slot. See docs/WORD_SEARCH_GAME.md §3.
 */
const WordSearchHeaderControls: React.FC<WordSearchHeaderControlsProps> = ({ onSettingsClick }) => (
    <>
        <AudioModeChip className="word-search__audio-chip" />
        <HeaderIconButton
            className="word-search__settings-btn"
            icon="settings"
            label="Open settings"
            onClick={onSettingsClick}
        />
    </>
);

export default WordSearchHeaderControls;
