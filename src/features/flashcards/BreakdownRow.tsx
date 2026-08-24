import { Box, Typography, useTheme } from "@mui/material";
import Icon from "../../components/Icon";
import ForeignText from "../../components/ForeignText";
import { stripParentheses } from "../../utils/definitionUtils";
import { getToneColor } from "../../utils/toneColors";
import { COLORS } from "../../theme/colors";
import { FC_FONT } from "./constants";
import { WEIGHT } from "../../theme/scale";
import type { Language } from "../../types";

/**
 * `BreakdownRow` — the design's `.bkr` (artboard 25): ONE component character of a
 * multi-character word, as a full-width row.
 *
 * ── Why this replaced the square grid ─────────────────────────────────────────
 * The breakdown used to be a wrapping grid of 1:1 block buttons (`InfoCardBlockButton`,
 * deleted with this pass), one per character, each stacking the glyph over its gloss
 * inside a ~116px square. Two things were wrong with that shape:
 *
 *   • A square sized to the character clips the GLOSS, which is the part the learner is
 *     reading. "to pass; to cross; to go over" does not fit in 116px at a legible size,
 *     so it was either truncated or set small enough to stop being prose.
 *   • A grid says "these are peers to choose between". A breakdown is not a menu — it
 *     is the word taken apart in ORDER, and order is what a column of rows shows and a
 *     wrapping grid destroys the moment it wraps.
 *
 * A row gives the gloss the full width, keeps the characters in the word's own order,
 * and gets a chevron — which is the honest affordance, because tapping one opens that
 * character's own entry (the panel's word trail is how you come back).
 *
 * Rendered by BOTH breakdown surfaces — the eip's breakdown tab and the cdp's
 * Character Breakdown box — which previously carried two copies of the grid.
 *
 * ⚠️ Artboard 25 also draws a titled paragraph under the rows, "How the parts make the
 * word". The det tables have a `breakdownElaboration` column for exactly that, but it is
 * NOT on the wire contract and no endpoint returns it, so the paragraph is omitted
 * rather than faked. Tracked in docs/DEFERRED_WORK.md.
 *
 * Referenced by docs/BREAKDOWN_FEATURE_IMPLEMENTATION.md and docs/SHELF_REDESIGN.md
 * (artboard 25).
 */

export interface BreakdownRowProps {
    character: string;
    pinyin: string;
    definition: string;
    language?: Language;
    showPinyin: boolean;
    showPinyinColor?: boolean;
    /** Open this character's own entry. Omit to render the row passive (no chevron). */
    onClick?: () => void;
    className?: string;
}

export const BreakdownRow: React.FC<BreakdownRowProps> = ({
    character,
    pinyin,
    definition,
    language,
    showPinyin,
    showPinyinColor = true,
    onClick,
    className,
}) => {
    const theme = useTheme();
    const fc = theme.palette.flashcard;
    const clickable = !!onClick;

    return (
        <Box
            component={clickable ? "button" : "div"}
            className={className ?? "breakdown-row"}
            onClick={onClick}
            sx={{
                display: "flex",
                alignItems: "center",
                gap: "14px",
                width: "100%",
                padding: "11px 22px",
                // A hairline BETWEEN rows, drawn on the bottom of each and cancelled on
                // the last: a bordered box per row would read as four cards rather than
                // one word taken apart.
                borderBottom: `1px solid ${fc.border}`,
                "&:last-of-type": { borderBottom: "none" },
                background: "transparent",
                border: "none",
                textAlign: "left",
                font: "inherit",
                color: "inherit",
                cursor: clickable ? "pointer" : "default",
                transition: "background-color 0.12s ease-out",
                "&:hover": clickable ? { background: fc.subtleBg } : undefined,
            }}
        >
            {/* Fixed-width glyph column, so every row's gloss starts on the same margin
                however wide the character renders. */}
            <Box sx={{ width: 36, flexShrink: 0, display: "flex", justifyContent: "center" }}>
                <ForeignText
                    size="sm"
                    language={language}
                    text={character}
                    // The row prints the reading on its own line below, in tone colour,
                    // so the per-character overlay would say it twice.
                    showPinyin={false}
                    bold
                />
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
                {showPinyin && pinyin && (
                    <Typography
                        className="breakdown-row__pinyin"
                        sx={{ fontSize: 12.5, fontWeight: WEIGHT.semibold, fontFamily: FC_FONT, lineHeight: 1.2 }}
                    >
                        {/* The reading as TEXT on its own line, not as a per-character
                            overlay: the glyph column beside it is one character wide, so
                            an overlay would be a one-cell cpcd — all of the machinery and
                            none of the alignment it exists for.

                            Tone colour is applied here as a LITERAL hue per syllable
                            (`getToneColor`, D2b): the five tone colours mean tones and
                            nothing else, so they are deliberately not ramp members. */}
                        {pinyin.split(/\s+/).filter(Boolean).map((syllable, i) => (
                            <span
                                key={i}
                                style={{ color: showPinyinColor ? getToneColor(syllable) : fc.onSurface }}
                            >
                                {i > 0 ? " " : ""}{syllable}
                            </span>
                        ))}
                    </Typography>
                )}
                <Typography
                    className="breakdown-row__gloss"
                    sx={{ fontSize: 12.5, color: fc.textSecondary, fontFamily: FC_FONT, marginTop: "2px", lineHeight: 1.35 }}
                >
                    {stripParentheses(definition)}
                </Typography>
            </Box>
            {clickable && <Icon name="chevron_right" size={16} color={COLORS.textFaint} />}
        </Box>
    );
};

export default BreakdownRow;
