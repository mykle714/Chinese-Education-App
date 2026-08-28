import React from "react";
import { HeaderCycleChip } from "./PageHeader";
import { useTTS } from "../hooks/useTTS";
import type { AudioMode } from "../hooks/useTTSSettings";

/**
 * The narration audio-mode chip: ONE header control that reaches all three states
 * (off → passthrough → media → off) by tapping.
 *
 * It is the same setting as the three-option picker on `/settings`, not a second
 * one — both go through `useTTSSettings`, so a change here is visible there and
 * survives a reload. The picker exists to EXPLAIN the states (its subtitles have
 * room to say "pauses music" and "follows the silent switch"); the chip exists to
 * CHANGE them mid-study without leaving the page.
 *
 * Self-contained on purpose: it reads the setting itself rather than taking
 * value/onChange props, so every surface that wants it renders `<AudioModeChip />`
 * and they cannot drift in label, icon, or cycle order. Surfaces that must hide it
 * (Bubble Match on a reading run) simply do not render it.
 *
 * Used by: FlashcardsLearnHeader (flp), SortCardsPage (scp), BubbleMatchHeader
 * (Bubble Match + Hydra Bubbles), MatchSpeedHeader.
 * Documented in: docs/AUDIO_PLAYBACK.md.
 */

/**
 * How each state presents. Labels are deliberately three or four characters: this
 * chip sits in the app's most crowded header (flp carries five controls beside an
 * interpolated deck name), and the icon does most of the work. `ariaLabel` carries
 * the full meaning, since a screen reader gets no icon and no cycle affordance.
 */
const MODE_CHIP: Record<AudioMode, { icon: string; label: string; ariaLabel: string; active: boolean }> = {
    off: {
        icon: "volume_off",
        label: "off",
        ariaLabel: "Audio off — nothing plays on its own. Activate to play over everything.",
        active: false,
    },
    passthrough: {
        icon: "volume_up",
        label: "loud",
        ariaLabel: "Audio plays over everything, even on silent. Activate to play alongside media instead.",
        active: true,
    },
    media: {
        icon: "multitrack_audio",
        label: "mix",
        ariaLabel: "Audio plays alongside other media and follows the silent switch. Activate to turn audio off.",
        active: true,
    },
};

const AudioModeChip: React.FC<{ className?: string }> = ({ className }) => {
    const { mode, cycleAudioMode } = useTTS();
    const chip = MODE_CHIP[mode];

    return (
        <HeaderCycleChip
            // The state is in the class as well as the label so a surrounding
            // surface can restyle one state (the game accent ground restyles the
            // active chip — see gameSurfaceSx).
            className={["audio-mode-chip", `audio-mode-chip--${mode}`, className ?? ""].filter(Boolean).join(" ")}
            icon={chip.icon}
            active={chip.active}
            ariaLabel={chip.ariaLabel}
            onClick={cycleAudioMode}
        >
            {chip.label}
        </HeaderCycleChip>
    );
};

export default AudioModeChip;
