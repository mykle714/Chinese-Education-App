import React from "react";
import { Box } from "@mui/material";
import { type CPCDSize } from "./CPCDRow";
import { getToneColor } from "../utils/toneColors";
import { FONTS } from "../theme/fonts";
import { WEIGHT } from "../theme/scale";

export interface CPCDInlineItem {
    // A single Chinese character (or, via the low-level items API, a multi-char
    // segment sharing one pronunciation).
    character: string;
    pinyin?: string;
    showPinyin?: boolean;
    useToneColor?: boolean;
}

interface CPCDInlineProps {
    items: CPCDInlineItem[];
    size?: CPCDSize;
    bold?: boolean;
    className?: string;
    characterColor?: string;
}

/**
 * CPCDInline — the CAPTION layout: characters in a line with the whole reading
 * set BESIDE them (老板 lǎobǎn) rather than stacked above each column.
 *
 * ⚠️ WHY A THIRD LAYOUT RATHER THAN A CPCDRow FLAG. CPCDRow and CPCDBlock both
 * reserve a vertical band for the pronunciation, and CPCDRow additionally owns a
 * per-column alignment problem (the pinyin shift, docs/CPCD_PINYIN_SHIFT.md) that
 * only exists because each syllable must sit over its own character. Inline mode
 * has neither: nothing is stacked, so nothing collides, and the whole reading is
 * one run of text. Bolting it onto CPCDRow would mean a mode in which most of that
 * component's machinery is switched off.
 *
 * ⚠️ WHEN TO REACH FOR IT. Inline is for a name or label that must stay on ONE
 * line of chrome — it costs a row's width instead of a row's height. It is NOT the
 * layout for anything the learner is meant to study: a stacked reading is easier to
 * map syllable-to-character, which is the whole point of cpcd. The first caller is
 * the iw speaker caption inside a speech bubble, where a stacked reading would sit
 * directly above the spoken line's own stacked reading.

 *
 * ⚠️ INLINE IS DELIBERATELY SMALLER THAN THE STACKED LAYOUTS AT THE SAME `size`.
 * The other two tables size the glyph as the SUBJECT of its surface; inline text is
 * a caption sharing a line with other chrome, so its scale is set relative to
 * surrounding body text instead. `size` still orders the steps the same way.
 *
 * Reached through `ForeignText layout="inline"`, never imported directly —
 * ForeignText is the public container (see its header).
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 5.3a.
 */
const CHAR_FONT_SIZE: Record<CPCDSize, string> = { xs: "14px", sm: "18px", md: "24px", lg: "28px", xl: "36px" };
const PINYIN_FONT_SIZE: Record<CPCDSize, string> = { xs: "10px", sm: "12px", md: "15px", lg: "17px", xl: "21px" };
/** Space between the glyph run and the reading beside it. */
const READING_GAP_PX: Record<CPCDSize, number> = { xs: 4, sm: 5, md: 6, lg: 7, xl: 9 };

const CPCDInline: React.FC<CPCDInlineProps> = ({
    items,
    size = "sm",
    bold = false,
    className,
    characterColor,
}) => {
    const characters = items.map((item) => item.character).join("");
    // One syllable per item, in order, dropping the items that have nothing to say.
    // The reading is a single run of text rather than a span per column: there is no
    // column to align to here, so per-item spans would only add DOM.
    const syllables = items.filter((item) => item.showPinyin !== false && !!item.pinyin);

    return (
        <Box
            className={`cpcd-inline ${className ?? ""}`.trim()}
            sx={{
                display: "inline-flex",
                // Baseline, not center: the caption reads as one line of text, and a
                // 14px glyph centred against 10px pinyin floats visibly high.
                alignItems: "baseline",
                gap: `${READING_GAP_PX[size]}px`,
                minWidth: 0,
                lineHeight: 1.1,
            }}
        >
            <span
                className="cpcd-inline__characters"
                style={{
                    fontSize: CHAR_FONT_SIZE[size],
                    fontWeight: bold ? WEIGHT.bold : WEIGHT.regular,
                    fontFamily: FONTS.cjk,
                    // Same rule as the stacked layouts: the Contrast override colors the
                    // glyph only, never the reading. docs/CARD_ICON_LAYOUT.md.
                    //
                    // ⚠️ INHERITS where CPCDRow hard-codes `text.primary`, and that is the
                    // caption difference again: inline text sits inside somebody else's line
                    // of chrome and has to take that line's color (a muted caption stays
                    // muted). The tone hues below are absolute either way.
                    color: characterColor ?? "inherit",
                    whiteSpace: "nowrap",
                }}
            >
                {characters}
            </span>
            {syllables.length > 0 && (
                <span
                    className="cpcd-inline__pinyin"
                    style={{
                        fontSize: PINYIN_FONT_SIZE[size],
                        fontFamily: FONTS.sans,
                        fontStretch: "condensed",
                        whiteSpace: "nowrap",
                        // The run can be clipped when the caption is narrower than the name;
                        // the glyphs are what must survive, so they are not the ones that go.
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                    }}
                >
                    {syllables.map((item, i) => (
                        <span
                            key={i}
                            // Tone color rides the PINYIN, exactly as it does in CPCDRow — the
                            // glyph stays theme-colored so the two layouts cannot disagree
                            // about what a tone hue means.
                            style={{
                                color: (item.useToneColor ?? true) ? getToneColor(item.pinyin!) : "inherit",
                            }}
                        >
                            {i > 0 ? " " : ""}
                            {item.pinyin}
                        </span>
                    ))}
                </span>
            )}
        </Box>
    );
};

export default CPCDInline;
