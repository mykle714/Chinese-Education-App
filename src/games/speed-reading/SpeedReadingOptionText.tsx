import React from "react";
import { Box } from "@mui/material";
import ForeignText from "../../components/ForeignText";
import type { CPCDSize } from "../../components/ForeignText";
import { COLORS } from "../../theme/colors";
import { OPTION_WORD_PADDING_X_PX } from "./constants";
import type { RoundOption } from "./types";

interface SpeedReadingOptionTextProps {
    option: RoundOption;
    /**
     * cpcd size to draw at — `OPTION_GLYPH_SIZE` for a word round, the much
     * smaller `OPTION_SENTENCE_GLYPH_SIZE` for the finale's sentence rounds. Both
     * options of a round always get the SAME size; a per-option size would leak
     * the answer through layout.
     */
    size: CPCDSize;
}

/**
 * One option's text — a headword, or a whole example sentence in the finale —
 * drawn in the middle of its half of the screen.
 *
 * ── Display only ────────────────────────────────────────────────────────────
 * This component receives NO tap handler and is deliberately unreachable by
 * pointer events. The control is the half of the screen behind it
 * (`SpeedReadingTapZone`): the whole left half picks option A, the whole right
 * half picks option B. The text is just the label on that zone, so it lives in
 * the content layer, which the page marks `pointer-events: none` in full.
 *
 * It used to be a rounded `ButtonBase` card that both carried the word and took
 * the tap. The card chrome is gone with the tap target — an answer is now a tap
 * anywhere on your side of the screen, which is a far bigger target under a
 * clock, and the green/red answer feedback is painted by the zone rather than by
 * a button.
 *
 * ── Rendered with cpcd ──────────────────────────────────────────────────────
 * Drawn by `ForeignText` (row layout → CPCDRow), the same component every other
 * foreign-text surface in the app uses. Word rounds sit at the top of the cpcd
 * ladder (`xl`) — reading those two words quickly IS the game; sentence rounds
 * drop to `sm` because a sentence has to fit half a screen without becoming six
 * wrapped lines.
 *
 * `showPinyin` is FALSE and must stay false — the prompt already shows the
 * pinyin, so a pinyin overlay here would name the answer without any reading.
 *
 * ── Why wrapping instead of shrinking ───────────────────────────────────────
 * Each option gets half the screen's width, which a 3–4 character `xl` row (or
 * any sentence) can exceed. Rather than scale the glyphs down per round, the row
 * wraps: a 4-character word becomes 2×2 at full size. Legibility is the point of
 * the game, so size is the thing that must not give. Both options are the same
 * length (the one-character invariant), so they always wrap the same way and
 * neither side can hint at the answer.
 */
const SpeedReadingOptionText: React.FC<SpeedReadingOptionTextProps> = ({ option, size }) => (
    <Box
        className="speed-reading__option"
        sx={{
            // Equal share of the row, so each option sits centred on the tap zone
            // behind it. The row carries no gap for exactly that reason: any gap
            // would offset the two from their halves' centres.
            flex: 1,
            minWidth: 0,
            px: `${OPTION_WORD_PADDING_X_PX}px`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            // The cpcd row is a flex child here; without an explicit
            // min-width:0 / width:100% its default `min-width: auto` would
            // refuse to shrink below its content and it would never wrap.
            "& .speed-reading__option-word": { width: "100%", minWidth: 0 },
        }}
    >
        <ForeignText
            className="speed-reading__option-word"
            language="zh"
            text={option.chars.join("")}
            // The glyphs ARE the answer: no pronunciation, ever.
            showPinyin={false}
            useToneColor={false}
            size={size}
            // Text too wide for half the screen breaks onto another line at full
            // size rather than shrinking (see the doc-comment).
            flexWrap="wrap"
            justifyContent="center"
            characterColor={COLORS.onSurface}
        />
    </Box>
);

export default SpeedReadingOptionText;
