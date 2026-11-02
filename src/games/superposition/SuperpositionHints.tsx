import { Box, ButtonBase, Typography } from "@mui/material";
import Icon from "../../components/Icon";
import TonedPronunciation from "../../components/TonedPronunciation";
import { COLORS, RAMP } from "../../theme/colors";
import { LEADING, SIZE } from "../../theme/scale";
import type { SuperpositionWord } from "../../api/superposition";

/** A dd's longest run, in lines: four one-character words leave each column under 100px. */
const DEFINITION_MAX_LINES = 3;

interface SuperpositionHintsProps {
    words: SuperpositionWord[];
    /** Characters currently stacked and finished. */
    finishedChars: ReadonlySet<string>;
    /** Clear space above the words: a break's Leave arrow sits top-left. */
    topInsetPx: number;
    onSpeak: (word: SuperpositionWord) => void;
}

/**
 * What to build, drawn straight on the grid: the words side by side, each a column of
 * colored pinyin, dd and audio button. A green check sits beside the pinyin while all of a
 * word's characters are finished, so it follows the board if a finished stack is pulled apart.
 *
 * Only the audio button takes input: the rest lets a press through to any tile lying here.
 * That button stops its own press from reaching the board, which would start a drag.
 */
const SuperpositionHints: React.FC<SuperpositionHintsProps> = ({ words, finishedChars, topInsetPx, onSpeak }) => (
    <Box className="superposition-hints" sx={{ display: "flex", alignItems: "flex-start", gap: 0.5, px: 0.75, pt: `${topInsetPx}px`, pb: 0.5 }}>
        {words.map((word) => {
            const finished = word.characters.every(({ char }) => finishedChars.has(char));
            return (
                <Box
                    key={word.entryKey}
                    className={`superposition-hints__word${finished ? " superposition-hints__word--finished" : ""}`}
                    sx={{
                        position: "relative",
                        flex: "1 1 0",
                        minWidth: 0,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 0.5,
                        px: 0.5,
                        py: 0.5,
                        textAlign: "center",
                    }}
                >
                    {finished && (
                        // Pinned to the column's corner, so finishing a word does not shift its text.
                        <Icon className="superposition-hints__finished-check" name="check_circle" size={18} color={RAMP.grn.mark} fill={1} sx={{ position: "absolute", top: 4, right: 0 }} />
                    )}
                    {word.pinyin && (
                        <TonedPronunciation className="superposition-hints__pinyin" pronunciation={word.pinyin} fontSize={SIZE.title} gap={4} justifyContent="center" />
                    )}
                    <Typography
                        className="superposition-hints__definition"
                        sx={{
                            width: "100%",
                            fontSize: SIZE.subtitle,
                            lineHeight: LEADING.tight,
                            color: COLORS.onSurface,
                            overflowWrap: "anywhere",
                            display: "-webkit-box",
                            WebkitBoxOrient: "vertical",
                            WebkitLineClamp: DEFINITION_MAX_LINES,
                            overflow: "hidden",
                        }}
                    >
                        {word.definition}
                    </Typography>
                    <ButtonBase
                        className="superposition-hints__audio"
                        aria-label={`Play ${word.entryKey}`}
                        onClick={() => onSpeak(word)}
                        onPointerDown={(event) => event.stopPropagation()}
                        sx={{ width: 36, height: 36, borderRadius: "10px", border: `1px solid ${COLORS.border}`, pointerEvents: "auto" }}
                    >
                        <Icon className="superposition-hints__audio-icon" name="volume_up" size={20} />
                    </ButtonBase>
                </Box>
            );
        })}
    </Box>
);

export default SuperpositionHints;
