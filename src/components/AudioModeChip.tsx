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
 * (Bubble Match + Hydra Bubbles), MatchSpeedHeader, WordSearchHeaderControls.
 * Documented in: docs/AUDIO_PLAYBACK.md.
 */

/**
 * How each state presents: a speaker glyph plus one word.
 *
 * The glyphs are the volume family — silenced, loud, waveform — so the chip is
 * legible as an AUDIO control at a glance, before the label is read. Every name here
 * is verified present in Material Symbols; `multitrack_audio` was tried for `media`
 * and is a Material *Icons* name absent from the Symbols face, so it rendered as the
 * raw string `MULTITRACK_AUDIO` in the flp header (2026-08-28). See
 * `src/components/Icon.tsx` before adding a fourth.
 *
 * The labels match the `/settings` picker's option titles one-for-one. They were
 * briefly shortened to "loud"/"mix" to save header width, and that was a mistake: a
 * chip whose label matches nothing else in the app forces the learner to re-derive
 * which of the three settings states they are looking at. One vocabulary, everywhere.
 *
 * Two labels depart from their `AudioMode` value, and both departures are copy
 * rather than drift — the stored values `off` and `passthrough` are a persisted
 * contract and do not move:
 *   • `off` reads as **"mute"** — `off` names the setting's state, `mute` names what
 *     the tap does to the phone in the learner's hand.
 *   • `passthrough` reads as **"default"** — it IS the default route
 *     (`DEFAULT_SETTINGS.route`), and "passthrough" describes the iOS audio-session
 *     mechanism, which is not a thing a learner can act on. The picker's subtitle
 *     does the explaining ("Plays even when your phone is on silent…").
 *
 * `ariaLabel` carries the full meaning, since a screen reader gets neither the glyph
 * nor any hint that the control cycles.
 */
const MODE_CHIP: Record<AudioMode, { icon: string; label: string; ariaLabel: string; active: boolean }> = {
    off: {
        icon: "volume_off",
        label: "mute",
        ariaLabel: "Audio muted — nothing plays on its own. Activate to play over everything.",
        active: false,
    },
    passthrough: {
        icon: "volume_up",
        label: "default",
        ariaLabel: "Audio plays over everything, even on silent. Activate to play alongside media instead.",
        active: true,
    },
    media: {
        icon: "graphic_eq",
        label: "media",
        ariaLabel: "Audio plays alongside other media and follows the silent switch. Activate to mute.",
        active: true,
    },
};

/**
 * Every state renders at the width of the LONGEST label, so the chip does not resize
 * as it cycles and the controls to its left hold still under the tapping thumb.
 * Derived from the table rather than hard-coded: renaming or adding a state resizes
 * the chip automatically instead of silently reintroducing the jump.
 */
const MODE_LABEL_WIDTH_CH = Math.max(...Object.values(MODE_CHIP).map((m) => m.label.length));

const AudioModeChip: React.FC<{ className?: string }> = ({ className }) => {
    const { mode, cycleAudioMode } = useTTS();
    const chip = MODE_CHIP[mode];

    return (
        <HeaderCycleChip
            // The state is in the class as well as the label so a surrounding
            // surface can restyle one state (the game accent ground restyles the
            // active chip — see gameSurfaceSx).
            className={["audio-mode-chip", `audio-mode-chip--${mode}`, className ?? ""].filter(Boolean).join(" ")}
            active={chip.active}
            widthCh={MODE_LABEL_WIDTH_CH}
            icon={chip.icon}
            ariaLabel={chip.ariaLabel}
            onClick={cycleAudioMode}
        >
            {chip.label}
        </HeaderCycleChip>
    );
};

export default AudioModeChip;
