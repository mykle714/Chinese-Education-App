import React from "react";
import { Box, Typography, type SxProps, type Theme } from "@mui/material";
import { getToneColor } from "../utils/toneColors";
import { FONTS } from "../theme";
import { WEIGHT } from "../theme/scale";

/**
 * A pronunciation split into syllables, each painted in its own tone colour.
 *
 * `getToneColor` reads the tone off ONE syllable's diacritic, so the string has to be
 * split before it can be coloured — colouring the whole string would paint every
 * syllable with the first one's tone. Syllables are space-separated throughout the app
 * (the same convention cpcd zips against characters positionally).
 *
 * Plain `Typography`, NOT `ForeignText`: a romanization is Latin text describing the
 * word, not the word itself, and routing it through the foreign-script container (by
 * claiming a Latin-script language to reach its plain-text branch) would be lying to it
 * about what it is rendering. The tone colours are shared with cpcd via `toneColors`,
 * so the two agree without either owning the other.
 *
 * Used by Memory Map's prompt (`MemoryMapPrompt`) and the writing flp card
 * (`WritingCardFace`). Referenced by docs/WRITING_PRACTICE_REWORK.md § 3.
 */
interface TonedPronunciationProps {
    pronunciation: string;
    /** BEM block for the wrapper; each syllable gets `${className}-syllable`. */
    className: string;
    fontSize: string;
    /** Space between syllables, px. */
    gap?: number;
    justifyContent?: "flex-start" | "center";
    sx?: SxProps<Theme>;
}

const TonedPronunciation: React.FC<TonedPronunciationProps> = ({
    pronunciation, className, fontSize, gap = 8, justifyContent = "flex-start", sx,
}) => (
    <Box className={className} sx={[{ display: "flex", flexWrap: "wrap", columnGap: `${gap}px`, justifyContent }, ...(Array.isArray(sx) ? sx : [sx])]}>
        {pronunciation.split(/\s+/).filter(Boolean).map((syllable, i) => (
            <Typography
                key={`${syllable}-${i}`}
                component="span"
                className={`${className}-syllable`}
                sx={{
                    fontFamily: FONTS.sans,
                    fontSize,
                    fontWeight: WEIGHT.semibold,
                    color: getToneColor(syllable),
                    whiteSpace: "nowrap",
                }}
            >
                {syllable}
            </Typography>
        ))}
    </Box>
);

export default TonedPronunciation;
