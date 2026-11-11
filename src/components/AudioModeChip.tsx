import React from "react";
import type { SxProps, Theme } from "@mui/material/styles";
import { HeaderCycleChip } from "./PageHeader";
import { cycleChipWidthCh } from "./cycleChipSizing";
import { OUTLINED_CHIP_ICON_PX, outlinedChipSx } from "./pageHeaderSizing";
import { COLORS } from "../theme/colors";
import { useTTSSettings, type AudioMode } from "../hooks/useTTSSettings";

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
 * Reads `useTTSSettings`, NOT `useTTS`. The chip never plays anything, and `useTTS`
 * is the playback hook — mounting a playback instance here once let the chip's
 * StrictMode remount cancel the acp's first autoplay word (docs/AUDIO_PLAYBACK.md
 * § "Only the speaker stops on unmount").
 *
 * ONE skin everywhere (since 2026-11-04): the bare glyph + label in `ink`, bundled by a
 * thin pill outline in that same ink (pageHeaderSizing.ts → `outlinedChipSx`, shared with
 * HeaderActionChip), the label in 975 Maru SC (`FONTS.cjk`) at its one regular weight. It floats as plain text
 * rather than drawing the eye as a filled chip. Before 2026-11-04 only the Deck Tower and
 * the acp used this skin and every other surface had a filled blue mono chip; the label
 * now carries the state on every surface (there is no fill to light up when audio is on).
 *
 * `ink` is the one per-surface choice: it defaults to `COLORS.iconColor` (--ink2, the
 * header's icon ink) for paper grounds; the tower passes white for the sky and the acp
 * its ground look's ink. On a game's accent ground `gameSurfaceSx` re-inks it to full ink
 * like the header's other icons.
 *
 * Used by: TowerStudyHeader (the flp), AddCardsPage (acp), BubbleMatchHeader
 * (Bubble Match + Hydra Bubbles), MatchSpeedHeader, WordSearchHeader, BucketDropStage, and
 * GameBreakChrome (an flp game break's header row; a white and a dark copy for its ink swap).
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
 *
 * `cycleChipWidthCh` also accounts for the chip's long-label rule — `default` is
 * seven characters and renders a size down, so the width it asks for is what it
 * actually occupies rather than its raw character count. `mute` and `media` are
 * unaffected and stay full size.
 */
const MODE_LABELS = Object.values(MODE_CHIP).map((m) => m.label);
const MODE_LABEL_WIDTH_CH = cycleChipWidthCh(MODE_LABELS);


const AudioModeChip: React.FC<{
    className?: string;
    /** Glyph, label and outline colour — pick the one that reads on the surface's ground. */
    ink?: string;
    /** Layered over the outlined skin (HeaderCycleChip `sx`). */
    sx?: SxProps<Theme>;
}> = ({ className, ink = COLORS.iconColor, sx }) => {
    const { mode, cycleMode: cycleAudioMode } = useTTSSettings();
    const chip = MODE_CHIP[mode];

    return (
        <HeaderCycleChip
            // The state is in the class as well as the label so a surrounding
            // surface can restyle one state.
            className={["audio-mode-chip", `audio-mode-chip--${mode}`, className ?? ""].filter(Boolean).join(" ")}
            active={chip.active}
            // `bare`: no fill in any state — glyph and label in `ink`, the outline below.
            tone="bare"
            ink={ink}
            sx={[outlinedChipSx(ink), ...(Array.isArray(sx) ? sx : sx ? [sx] : [])] as SxProps<Theme>}
            // The outlined skin resizes the label's font, so `widthCh` (measured in the
            // chip's mono `ch`) would be wrong: the box is sized to the real labels instead.
            fitLabels={MODE_LABELS}
            iconPx={OUTLINED_CHIP_ICON_PX}
            // Required by HeaderCycleChip but unused once `fitLabels` is set.
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
