import React from "react";
import { Box, Typography } from "@mui/material";
import { SpeakerButton } from "../../components/SpeakerButton";
import { resolveDisplayDefinition, resolveDisplayPronunciation } from "../../utils/definitionUtils";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT, LEADING } from "../../theme/scale";
import type { VocabEntry } from "../../types";

interface SpeedReadingPromptProps {
    entry: VocabEntry;
    onSpeak: () => void;
    speaking: boolean;
}

/**
 * The prompt: pinyin, definition, and a speaker button.
 *
 * This is everything the player has to identify the word — the glyphs are the
 * ANSWER, so the prompt never shows the characters themselves.
 *
 * The definition MUST resolve through `resolveDisplayDefinition`: the game pool
 * ships `definitionClusters` + `selectedSense`, and rendering `entry.definition`
 * raw would show a different sense than the card the player has been studying.
 * See docs/GAMES_FEATURE.md § Sense correctness.
 */
const SpeedReadingPrompt: React.FC<SpeedReadingPromptProps> = ({ entry, onSpeak, speaking }) => {
    const definition = resolveDisplayDefinition(entry);

    return (
        <Box
            className="speed-reading__prompt"
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
                    fontSize: SIZE.heading,
                    fontWeight: WEIGHT.bold,
                    color: COLORS.onSurface,
                    lineHeight: LEADING.tight,
                }}
            >
                {resolveDisplayPronunciation(entry) ?? ""}
            </Typography>
            <Typography
                className="speed-reading__prompt-definition"
                sx={{
                    fontFamily: FONTS.sans,
                    fontSize: SIZE.bodyLg,
                    color: COLORS.textSecondary,
                    lineHeight: LEADING.normal,
                    // Two lines max: a long definition must not push the options
                    // down far enough to change the glyph size mid-run.
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                }}
            >
                {definition}
            </Typography>
            <SpeakerButton onClick={onSpeak} isLoading={speaking} />
        </Box>
    );
};

export default SpeedReadingPrompt;
