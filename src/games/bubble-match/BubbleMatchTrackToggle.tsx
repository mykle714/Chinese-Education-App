import React from "react";
import { Box } from "@mui/material";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { MARK_TYPE_COLORS, MARK_TYPE_LABELS } from "../../utils/masteryCompute";
import { isLatinScriptLang } from "../../components/ForeignText";
import { useFlashcardLearnSettings } from "../../hooks/useFlashcardLearnSettings";
import type { Language, MarkType } from "../../types";

/**
 * BubbleMatchTrackToggle — the pinyin switch for Bubble Match, living on the GAMES
 * HUB rather than inside the game (docs/GAMES_FEATURE.md § "Bubble Match: pinyin
 * picks the track", docs/MASTERY_REWORK.md § 1a).
 *
 * WHY IT IS HERE AND NOT IN THE GAME'S HEADER: pinyin is no longer a display
 * preference for this game — it chooses which mastery track the run marks (pinyin
 * shown ⇒ Recognition, pinyin hidden ⇒ Reading, because the player then reaches the
 * meaning from the characters alone). The card pool is bucketed and cooled on that
 * track when the board is dealt, so the choice has to be made BEFORE the deal; a
 * mid-run flip would mark a track the board was not selected for and the server would
 * silently drop those marks. The game latches the setting on its first pool fetch
 * (`BubbleMatchPage`'s `runTrack`).
 *
 * WHY IT NAMES THE TRACKS: a bare "pinyin" chip would hide the consequence. Both
 * tracks are always drawn — the live one in its own `MARK_TYPE_COLORS` hue, the other
 * faint — so the switch reads as "this is what you are training, tap for the other".
 *
 * Hidden for Latin-script languages, matching every other pinyin control in the app:
 * `ForeignText` renders Spanish as plain text and ignores the flag, so the choice
 * would change nothing on the board (and `foreignPromptTrack` keeps such a run on
 * Recognition whatever the setting says).
 *
 * Writes the SHARED `showPinyin` setting (`useFlashcardLearnSettings`), the same one
 * the flp and Hydra Bubbles read — a learner who studies without pinyin gets the
 * reading track everywhere by one choice, which is the point.
 */
interface BubbleMatchTrackToggleProps {
    /** The learner's active language — gates the control out for Latin scripts. */
    language: Language;
    className?: string;
}

/** One half of the switch: a track's dot + name, inked when live and faint when not. */
const TrackSegment: React.FC<{ track: MarkType; active: boolean }> = ({ track, active }) => (
    <Box
        className={`bubble-match-track-toggle__segment bubble-match-track-toggle__segment--${track}${
            active ? " bubble-match-track-toggle__segment--active" : ""
        }`}
        sx={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            fontFamily: FONTS.label,
            fontSize: 9,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: active ? COLORS.onSurface : COLORS.textFaint,
            whiteSpace: "nowrap",
        }}
    >
        <Box
            className="bubble-match-track-toggle__dot"
            sx={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                // The inactive dot keeps its shape but drops its hue: two lit dots
                // would read as "both tracks are on".
                backgroundColor: active ? MARK_TYPE_COLORS[track] : COLORS.textFaint,
                opacity: active ? 1 : 0.45,
                flexShrink: 0,
            }}
        />
        {MARK_TYPE_LABELS[track]}
    </Box>
);

const BubbleMatchTrackToggle: React.FC<BubbleMatchTrackToggleProps> = ({ language, className }) => {
    const { settings, update } = useFlashcardLearnSettings();
    const { showPinyin } = settings;

    if (isLatinScriptLang(language)) return null;

    return (
        <Box
            className={`bubble-match-track-toggle${className ? ` ${className}` : ""}`}
            component="button"
            type="button"
            aria-pressed={showPinyin}
            aria-label={
                showPinyin
                    ? "Pinyin on — Bubble Match marks Recognition. Tap to hide pinyin and mark Reading."
                    : "Pinyin off — Bubble Match marks Reading. Tap to show pinyin and mark Recognition."
            }
            onClick={(e: React.MouseEvent) => {
                // The strip header can itself be clickable (BentoStrip's `action`), and
                // this control must never trigger it.
                e.stopPropagation();
                e.preventDefault();
                update({ showPinyin: !showPinyin });
            }}
            sx={{
                display: "flex",
                alignItems: "center",
                gap: "7px",
                padding: "3px 8px",
                borderRadius: 999,
                border: `1px solid ${COLORS.rowBorder}`,
                backgroundColor: COLORS.white,
                cursor: "pointer",
                // The hub is a touch surface: no hover-only affordance, and no tap
                // highlight rectangle on a pill.
                WebkitTapHighlightColor: "transparent",
            }}
        >
            <TrackSegment track="recognition" active={showPinyin} />
            {/* The switch's own glyph: what tapping does, between the two outcomes. */}
            <Box
                className="bubble-match-track-toggle__swap"
                aria-hidden
                sx={{ fontFamily: FONTS.mono, fontSize: 9, color: COLORS.textFaint, lineHeight: 1 }}
            >
                ⇄
            </Box>
            <TrackSegment track="reading" active={!showPinyin} />
        </Box>
    );
};

export default BubbleMatchTrackToggle;
