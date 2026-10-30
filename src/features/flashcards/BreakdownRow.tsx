import { Box, Typography, useTheme } from "@mui/material";
import Icon from "../../components/Icon";
import ForeignText from "../../components/ForeignText";
import { stripParentheses } from "../../utils/definitionUtils";
import { FC_FONT } from "./constants";
import type { Language } from "../../types";
import { useEipColors } from "./FlashcardsLearnPage/useEipPalette";

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
 * Rendered only by the eip's breakdown tab (InfoCardTabContent); both cdps reach it
 * through the eip panel.
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
    const colors = useEipColors();
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
                // `.bk` (Tower Tier 2, 2026-10-29): each character is its own outlined
                // CARD — the eip palette's `card` fill in a 1.5px `line` ring, 14px
                // radius — stacked 10px apart. (It was a ruled list, on the reasoning
                // that boxes would read as four cards rather than one word taken apart;
                // the design chose cards, and the word's ORDER still reads top to bottom.)
                boxSizing: "border-box",
                padding: "10px 12px",
                marginBottom: "10px",
                "&:last-of-type": { marginBottom: 0 },
                borderRadius: "14px",
                backgroundColor: colors.card,
                boxShadow: `inset 0 0 0 1.5px ${colors.line}`,
                border: "none",
                textAlign: "left",
                font: "inherit",
                color: "inherit",
                cursor: clickable ? "pointer" : "default",
                transition: "background-color 0.12s ease-out",
                "&:hover": clickable ? { backgroundColor: fc.subtleBg } : undefined,
            }}
        >
            {/* Fixed-width glyph column, so every row's gloss starts on the same margin
                however wide the character renders. A breakdown row is always ONE
                character, so the glyph can afford the `md` step (36px) — a size a
                multi-character word could not take in this column. Width tracks the
                cpcd's own `md` column (50px) with a hair of slack.

                The reading sits UNDER the glyph as the cpcd's own pinyin line (the
                same layout as every other CPCDRow), tone-coloured through the cpcd's
                `useToneColor` rather than a hand-rolled per-syllable span. */}
            <Box
                className="breakdown-row__glyph"
                sx={{ width: 52, flexShrink: 0, display: "flex", justifyContent: "center" }}
            >
                <ForeignText
                    size="md"
                    language={language}
                    text={character}
                    pronunciation={pinyin}
                    showPinyin={showPinyin && !!pinyin}
                    useToneColor={showPinyinColor}
                />
            </Box>
            <Typography
                className="breakdown-row__gloss"
                sx={{ flex: 1, minWidth: 0, fontSize: 14.5, color: colors.ink, fontFamily: FC_FONT, lineHeight: 1.4 }}
            >
                {stripParentheses(definition)}
            </Typography>
            {clickable && <Icon name="chevron_right" size={20} color={colors.muted} />}
        </Box>
    );
};

export default BreakdownRow;
