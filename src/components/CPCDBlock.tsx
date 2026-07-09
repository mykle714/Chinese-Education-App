import React from "react";
import { Box } from "@mui/material";
import CPCDRow, { type CPCDSize } from "./CPCDRow";
import { getToneColor } from "../utils/toneColors";
import { FONTS } from "../theme/fonts";
import { WEIGHT } from "../theme/scale";

export interface CPCDBlockItem {
    // A single Chinese character. CPCDBlock lays out up to 4 of these as a
    // square, unlike CPCDRow's items which may each hold a multi-char word.
    character: string;
    pinyin?: string;
    showPinyin?: boolean;
    useToneColor?: boolean;
}

interface CPCDBlockProps {
    // 1–4 characters. More than 4 is a caller error — only the first 4 render.
    items: CPCDBlockItem[];
    size?: CPCDSize;
    // Only consulted when items.length === 3: whether items[0] and items[1]
    // belong to the same GSA segment. Determines triangle orientation (see
    // layout comment below). Ignored for 1/2/4-char blocks.
    firstTwoAreSegment?: boolean;
    bold?: boolean;
    className?: string;
    characterColor?: string;
}

// Mirrors CPCDRow's per-size glyph/pinyin sizing so a block reads as the same
// visual system as a row. Blocks have no per-char column alignment (chars sit
// in a 2D arrangement, not a line), so pinyin is a plain centered line rather
// than CPCDRow's per-column collision-avoided overlay: one row beneath the
// triangle (3-char), or one row beneath each char of the 2x2 (4-char).
const CHAR_FONT_SIZE: Record<CPCDSize, string> = { xs: "18px", sm: "26px", md: "2.25rem", lg: "2.4rem", xl: "3.2rem" };
const PINYIN_FONT_SIZE: Record<CPCDSize, string> = { xs: "10px", sm: "13px", md: "1rem", lg: "1.05rem", xl: "1.3rem" };
// Fixed 2px between glyphs at every size. The glyph boxes shrink-wrap the
// character (no padding around the glyph), so this gap IS the visible spacing
// between characters — they sit 2px from touching.
const GRID_GAP_PX = 2;
const PINYIN_ROW_GAP: Record<CPCDSize, number> = { xs: 4, sm: 5, md: 6, lg: 6, xl: 8 };
const PINYIN_TOP_MARGIN: Record<CPCDSize, number> = { xs: 2, sm: 3, md: 4, lg: 4, xl: 5 };

const CPCDBlock: React.FC<CPCDBlockProps> = ({
    items,
    size = "sm",
    firstTwoAreSegment = false,
    bold = false,
    className,
    characterColor,
}) => {
    // 1–2 chars: identical to a plain CPCDRow (inline chars, per-char pinyin
    // below each), so just delegate instead of re-implementing that layout.
    if (items.length <= 2) {
        return <CPCDRow items={items} size={size} bold={bold} className={className} characterColor={characterColor} />;
    }

    if (items.length > 4 && process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.warn(`CPCDBlock: received ${items.length} items, only the first 4 will render.`);
    }
    const blockItems = items.slice(0, 4);
    const count = blockItems.length;

    const charFontSize = CHAR_FONT_SIZE[size];
    const pinyinFontSize = PINYIN_FONT_SIZE[size];
    const gridGap = GRID_GAP_PX;

    // Each glyph box shrink-wraps the character (no fixed cell padding) so the
    // grid/flex `gap` below is the actual space between glyphs. lineHeight 1
    // trims the box vertically to the glyph too. CJK glyphs are full-width
    // (~1em square), so shrink-wrapped boxes stay uniformly sized and the 2x2
    // grid / triangle rows line up without an explicit fixed cell size.
    const renderChar = (item: CPCDBlockItem, key: number) => (
        <Box
            key={key}
            component="span"
            sx={{
                display: "inline-block",
                textAlign: "center",
                fontSize: charFontSize,
                fontWeight: bold ? WEIGHT.bold : WEIGHT.regular,
                fontFamily: FONTS.cjk,
                color: characterColor ?? "text.primary",
                lineHeight: 1,
            }}
        >
            {item.character}
        </Box>
    );

    // A single pinyin syllable span (tone-colored). Returns null when the item
    // has no pinyin / opts out, so callers can lay out only the shown ones.
    const renderPinyin = (item: CPCDBlockItem, key: number): React.ReactNode => {
        const showPinyin = item.showPinyin !== false && !!item.pinyin;
        if (!showPinyin) return null;
        const useToneColor = item.useToneColor ?? true;
        const color = useToneColor ? getToneColor(item.pinyin!) : "inherit";
        return (
            <span
                key={key}
                style={{
                    fontSize: pinyinFontSize,
                    fontFamily: FONTS.sans,
                    fontStretch: "condensed",
                    color: color as string,
                    lineHeight: 1.21,
                    whiteSpace: "nowrap",
                }}
            >
                {item.pinyin}
            </span>
        );
    };

    // 4 chars: a 2x2 char square, then the pinyin as TWO lines beneath it — two
    // syllables per line (row-major, matching the char square), with normal
    // word spacing between the two on each line. The shared single-row pinyin
    // below is skipped for this case.
    if (count === 4) {
        const pinyinLine = (rowItems: CPCDBlockItem[], key: number) => (
            <Box key={key} sx={{ display: "flex", justifyContent: "center", gap: `${PINYIN_ROW_GAP[size]}px` }}>
                {rowItems.map((item, i) => renderPinyin(item, i))}
            </Box>
        );
        return (
            <Box className={className} sx={{ display: "inline-flex", flexDirection: "column", alignItems: "center" }}>
                <Box
                    sx={{
                        display: "grid",
                        gridTemplateColumns: "repeat(2, auto)",
                        justifyItems: "center",
                        gap: `${gridGap}px`,
                    }}
                >
                    {blockItems.map((item, i) => renderChar(item, i))}
                </Box>
                <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: `${gridGap}px`, marginTop: `${PINYIN_TOP_MARGIN[size]}px` }}>
                    {pinyinLine(blockItems.slice(0, 2), 0)}
                    {pinyinLine(blockItems.slice(2, 4), 1)}
                </Box>
            </Box>
        );
    }

    // 3 chars: triangle, oriented by whether the first two chars are one GSA
    // segment. If they are, they read as a pair — the pair sits together on top
    // and the odd character anchors the point below ("inverted": 2-top /
    // 1-bottom). If not, each character stands alone, so the lone first character
    // sits on top and the remaining two anchor the base below ("upright": 1-top /
    // 2-bottom). The triangle's chars are staggered across two rows, so their
    // pinyin can't sit per-glyph — it renders as one shared line beneath.
    const charGrid = firstTwoAreSegment ? (
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: `${gridGap}px` }}>
            <Box sx={{ display: "flex", gap: `${gridGap}px` }}>
                {renderChar(blockItems[0], 0)}
                {renderChar(blockItems[1], 1)}
            </Box>
            {renderChar(blockItems[2], 2)}
        </Box>
    ) : (
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: `${gridGap}px` }}>
            {renderChar(blockItems[0], 0)}
            <Box sx={{ display: "flex", gap: `${gridGap}px` }}>
                {renderChar(blockItems[1], 1)}
                {renderChar(blockItems[2], 2)}
            </Box>
        </Box>
    );

    return (
        <Box className={className} sx={{ display: "inline-flex", flexDirection: "column", alignItems: "center" }}>
            {charGrid}
            <Box
                sx={{
                    display: "flex",
                    justifyContent: "center",
                    flexWrap: "wrap",
                    gap: `${PINYIN_ROW_GAP[size]}px`,
                    marginTop: `${PINYIN_TOP_MARGIN[size]}px`,
                }}
            >
                {blockItems.map((item, i) => renderPinyin(item, i))}
            </Box>
        </Box>
    );
};

export default CPCDBlock;
