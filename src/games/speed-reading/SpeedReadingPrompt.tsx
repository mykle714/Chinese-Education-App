import React from "react";
import { Box, Typography } from "@mui/material";
import { SpeakerButton } from "../../components/SpeakerButton";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT, LEADING } from "../../theme/scale";

interface SpeedReadingPromptProps {
    /** Big line — the reading the player has to match. */
    pinyin: string;
    /** Small line — what it means. */
    english: string;
    onSpeak: () => void;
    speaking: boolean;
    /**
     * A sentence round's clue is a whole line of pinyin and a whole translation,
     * where a word round's is a syllable or two and a gloss. Set to shrink both
     * lines so the finale's prompt doesn't push the options off-centre.
     */
    compact?: boolean;
}

/**
 * The prompt: pinyin, English, and a speaker button.
 *
 * This is everything the player has to identify the answer — the glyphs ARE the
 * answer, so the prompt never shows the characters themselves. Purely
 * presentational: WHICH pinyin and WHICH English (the headword's, or the example
 * sentence's on a finale round) is decided by `roundPrompt`, so this component
 * has no idea which kind of round it is drawing beyond the `compact` flag.
 */
const SpeedReadingPrompt: React.FC<SpeedReadingPromptProps> = ({
    pinyin,
    english,
    onSpeak,
    speaking,
    compact = false,
}) => (
    <Box
        className={`speed-reading__prompt${compact ? " speed-reading__prompt--compact" : ""}`}
        sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 0.75,
            px: 3,
            textAlign: "center",
        }}
    >
        <Typography
            className="speed-reading__prompt-pinyin"
            sx={{
                fontFamily: FONTS.sans,
                fontSize: compact ? SIZE.bodyLg : SIZE.heading,
                fontWeight: WEIGHT.bold,
                color: COLORS.onSurface,
                lineHeight: LEADING.tight,
            }}
        >
            {pinyin}
        </Typography>
        <Typography
            className="speed-reading__prompt-definition"
            sx={{
                fontFamily: FONTS.sans,
                fontSize: compact ? SIZE.body : SIZE.bodyLg,
                color: COLORS.textSecondary,
                lineHeight: LEADING.normal,
                // Two lines max: a long definition (or translation) must not push
                // the options down far enough to move them mid-run.
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
            }}
        >
            {english}
        </Typography>
        {/* ⚠️ The prompt renders inside the page's content layer, which is
            `pointer-events: none` in full so taps fall through to the
            left/right tap zones behind it. The speaker is the ONE control in
            that layer, so it has to opt back in explicitly — without this it
            looks tappable and silently plays nothing. */}
        <Box className="speed-reading__prompt-speaker" sx={{ pointerEvents: "auto" }}>
            <SpeakerButton onClick={onSpeak} isLoading={speaking} />
        </Box>
    </Box>
);

export default SpeedReadingPrompt;
