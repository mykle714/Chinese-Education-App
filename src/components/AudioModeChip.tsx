import React from "react";
import type { SxProps, Theme } from "@mui/material/styles";
import { HeaderCycleChip } from "./PageHeader";
import { cycleChipWidthCh } from "./cycleChipSizing";
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
 * StrictMode remount cancel the scp's first autoplay word (docs/AUDIO_PLAYBACK.md
 * § "Only the speaker stops on unmount").
 *
 * `tone`, `ink`, `sx`, `fitLabels` and `iconPx` let ONE surface reskin it without forking
 * it. `outlined` is the one named reskin: the bare glyph + label in `ink`, bundled by a
 * thin pill outline in that same ink (`OUTLINED_SX`) — it floats as plain text on a
 * scene ground rather than drawing the eye as a filled chip. Used by the Deck Tower study
 * header (TowerStudyHeader, white ink on the sky) and the scp (the ground look's ink).
 * Everywhere else takes the blue mono default.
 *
 * Used by: TowerStudyHeader (tower flp), FlashcardsLearnHeader (flp), SortCardsPage (scp), BubbleMatchHeader
 * (Bubble Match + Hydra Bubbles), MatchSpeedHeader, WordSearchHeaderControls,
 * IWPlayPage (Immersive World).
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

/**
 * The `outlined` skin's label type and glyph, px — a step up from the header chip's
 * 10 px / 13 px now that there is no fill to carry it.
 */
const OUTLINED_TEXT_PX = 12;
const OUTLINED_ICON_PX = 15;

/**
 * The `outlined` skin's pill: a 1px outline in the chip's own `ink` (not `COLORS.border`
 * — the --line2 hairline is built for paper and goes muddy on a scene ground), pill ends
 * like the tower's plates.
 */
const OUTLINED_SX = (ink: string) =>
    ({
        border: `1px solid ${ink}`,
        borderRadius: "999px",
        padding: "4px 10px",
        fontSize: OUTLINED_TEXT_PX,
    }) as const;

const AudioModeChip: React.FC<{
    className?: string;
    /** The active-state skin (HeaderCycleChip `tone`); blue unless a surface overrides it. */
    tone?: "ink" | "blu" | "bare";
    /** The `bare` tone's text colour (HeaderCycleChip `ink`). */
    ink?: string;
    /** Layered over the chip's own skin (HeaderCycleChip `sx`). */
    sx?: SxProps<Theme>;
    /** Size to the labels in the chip's actual font — pass when `sx` changes the font. */
    fitLabels?: boolean;
    /** The glyph's size, px (HeaderCycleChip `iconPx`). */
    iconPx?: number;
    /**
     * The scene-ground skin: bare glyph + label in `ink` inside a thin `ink` pill outline,
     * 12 px type / 15 px glyph, boxed to the longest label. Overrides `tone`, `fitLabels`
     * and `iconPx`; requires `ink`.
     */
    outlined?: boolean;
}> = ({ className, tone = "blu", ink, sx, fitLabels = false, iconPx, outlined = false }) => {
    const { mode, cycleMode: cycleAudioMode } = useTTSSettings();
    const chip = MODE_CHIP[mode];

    // `outlined` resizes the label's font, so the default `ch` width would be wrong:
    // it always sizes the box to the real labels (fitLabels).
    const skin = outlined && ink
        ? {
              tone: "bare" as const,
              sx: [OUTLINED_SX(ink), ...(Array.isArray(sx) ? sx : sx ? [sx] : [])] as SxProps<Theme>,
              fitLabels: true,
              iconPx: OUTLINED_ICON_PX,
          }
        : { tone, sx, fitLabels, iconPx };

    return (
        <HeaderCycleChip
            // The state is in the class as well as the label so a surrounding
            // surface can restyle one state.
            className={["audio-mode-chip", `audio-mode-chip--${mode}`, className ?? ""].filter(Boolean).join(" ")}
            active={chip.active}
            // Mid blue rather than the shared ink inversion when audio is on (mute
            // stays grey). Holds on game grounds too — see gameSurfaceSx.
            tone={skin.tone}
            ink={ink}
            sx={skin.sx}
            fitLabels={skin.fitLabels ? MODE_LABELS : undefined}
            iconPx={skin.iconPx}
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
