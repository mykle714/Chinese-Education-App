import React, { useEffect, useLayoutEffect, useRef } from "react";
import { Box } from "@mui/material";
import { getToneColor } from "../utils/toneColors";
import { FONTS } from "../theme/fonts";
import { WEIGHT } from "../theme/scale";

export type CPCDSize = "xs" | "sm" | "md" | "lg";

export interface CPCDRowItem {
    character: string;
    pinyin?: string;
    showPinyin?: boolean;
    useToneColor?: boolean;
    interactive?: boolean;
    selected?: boolean;
    onHoverStart?: () => void;
    onTapToggle?: () => void;
    // Optional callback receiving the rendered char cell DOM node. Used by
    // SegmentedSentenceDisplay to measure per-character rects for highlights.
    cellRef?: (node: HTMLDivElement | null) => void;
}

interface CPCDRowProps {
    items: CPCDRowItem[];
    size?: CPCDSize;
    compact?: boolean;
    flexWrap?: "nowrap" | "wrap";
    justifyContent?: string;
    className?: string;
    // Renders the characters at bold weight instead of the default regular.
    // Only affects the glyphs; the pinyin overlay stays at its normal weight.
    bold?: boolean;
    // When true (default), neighboring pinyin syllables that would otherwise
    // collide are nudged apart just enough that their text stops overlapping.
    // The character cells overlap (negative margin) to keep narrow CJK glyphs
    // visually tight, but each pinyin span is as wide as a full column — so a
    // syllable whose romanization fills the column (e.g. "shén" in 神诞节) bleeds
    // into its neighbor's pinyin. This measures the actual rendered text width
    // and spreads only the offending syllables, leaving narrow pinyin and long
    // sentences untouched. Exposed as a property so every cpcd surface (flp
    // example sentences, bubble-match word bubbles, etc.) shares one behavior.
    // See docs/CPCD_PINYIN_SHIFT.md.
    pinyinShift?: boolean;
    // When true, the characters/pinyin may be selected (and a text cursor may
    // appear) on desktop — gated by the `.cpcd-row--selectable` CSS hook in
    // index.css. Defaults to false because cpcd appears in many drag-driven,
    // non-text surfaces; only prose-like surfaces (example sentences) opt in.
    // Mobile stays non-selectable regardless (see the `(pointer: coarse)` block).
    selectable?: boolean;
    // Optional override for the CHARACTER glyph color only (the per-card Contrast
    // setting on the flashcard — see docs/CARD_ICON_LAYOUT.md). The pinyin overlay is
    // never affected. Undefined keeps the theme default (text.primary).
    characterColor?: string;
}

// Per-size visual constants. Mirror the table that used to live in
// CharacterPinyinColorDisplay; kept here because CPCDRow now owns the layout.
// "xs" is sized to sit inline within 14px body prose (e.g. Chinese embedded in a long
// definition): glyph just above body size, with a compact pinyin row beneath.
const COLUMN_WIDTH: Record<CPCDSize, number> = { xs: 22, sm: 32, md: 50, lg: 54 };
// Vertical space reserved above each char cell's glyph for the pinyin row.
// Sized to fit the pinyin font's line-box at each size (font-size × 1.21).
const PINYIN_RESERVED_HEIGHT: Record<CPCDSize, number> = { xs: 13, sm: 18, md: 22, lg: 24 };
const CHAR_FONT_SIZE: Record<CPCDSize, string> = { xs: "18px", sm: "26px", md: "2.25rem", lg: "2.4rem" };
const PINYIN_FONT_SIZE: Record<CPCDSize, string> = { xs: "10px", sm: "13px", md: "1rem", lg: "1.05rem" };
const COMPACT_CHAR_FONT: Record<CPCDSize, string> = { xs: "16px", sm: "22px", md: "1.875rem", lg: "2.25rem" };
const COMPACT_PINYIN_FONT: Record<CPCDSize, string> = { xs: "9px", sm: "11px", md: "0.875rem", lg: "1rem" };
const VERTICAL_PADDING: Record<CPCDSize, string> = { xs: "2px", sm: "4px", md: "8px", lg: "8px" };
// Negative left-margin per child to overlap cells, preserving the prior visual density.
const OVERLAP_BY_SIZE: Record<CPCDSize, number> = { xs: -4, sm: -6, md: -4, lg: -2 };
// Minimum breathing space (unscaled px) kept between adjacent pinyin texts when
// de-overlapping. Only applied to pairs that actually collide, so non-colliding
// rows are never disturbed.
const PINYIN_MIN_GAP_PX = 2;

const CPCDRow: React.FC<CPCDRowProps> = ({
    items,
    size = "sm",
    compact = false,
    flexWrap = "nowrap",
    justifyContent,
    className,
    bold = false,
    pinyinShift = true,
    selectable = false,
    characterColor,
}) => {
    const charsBlockRef = useRef<HTMLDivElement | null>(null);
    const cellRefs = useRef<(HTMLDivElement | null)[]>([]);
    const pinyinRefs = useRef<(HTMLSpanElement | null)[]>([]);

    const columnWidth = COLUMN_WIDTH[size];
    const pinyinReservedHeight = PINYIN_RESERVED_HEIGHT[size];
    const overlap = OVERLAP_BY_SIZE[size];
    const overlapAbs = Math.abs(overlap);
    const charFontSize = compact ? COMPACT_CHAR_FONT[size] : CHAR_FONT_SIZE[size];
    const pinyinFontSize = compact ? COMPACT_PINYIN_FONT[size] : PINYIN_FONT_SIZE[size];

    // Position each pinyin span over its corresponding char cell. Run on every
    // render and on size changes to the chars block (handled by ResizeObserver
    // below) so pinyins reflow whenever the row wraps to a new line.
    const positionPinyins = () => {
        const charsBlock = charsBlockRef.current;
        if (!charsBlock) return;

        // Ancestors may scale this row (e.g. bubble-match shrinks long words via a
        // CSS transform). Layout offsets (offsetLeft/offsetWidth) are unscaled, but
        // Range/getBoundingClientRect widths are post-scale — so divide measured
        // text widths by this factor to keep all math in one (unscaled) space.
        const safeScale =
            charsBlock.offsetWidth > 0
                ? charsBlock.getBoundingClientRect().width / charsBlock.offsetWidth || 1
                : 1;

        // Group items into visual rows by similar offsetTop. De-overlap is
        // row-local — a wide syllable at the end of one wrapped line must not
        // push the first item of the next line.
        const rows: { topKey: number; indices: number[] }[] = [];
        for (let i = 0; i < items.length; i++) {
            const cell = cellRefs.current[i];
            if (!cell) continue;
            const top = cell.offsetTop;
            const existing = rows.find((r) => Math.abs(r.topKey - top) <= 1);
            if (existing) existing.indices.push(i);
            else rows.push({ topKey: top, indices: [i] });
        }

        // Measures the actual rendered width (unscaled) of a pinyin span's text,
        // excluding the trailing copy-space we append between syllables.
        const measureTextWidth = (span: HTMLSpanElement | null, pinyin: string): number => {
            const node = span?.firstChild;
            if (!node || !pinyin) return 0;
            const range = document.createRange();
            range.setStart(node, 0);
            range.setEnd(node, Math.min(pinyin.length, node.textContent?.length ?? 0));
            return range.getBoundingClientRect().width / safeScale;
        };

        for (const row of rows) {
            const idxs = row.indices;
            const n = idxs.length;

            // For each syllable collect its cell center and how far its pinyin text
            // extends left/right of that center. The pinyin span is a fixed,
            // cell-width box with text-align:center, so the text extent is
            // ASYMMETRIC when the romanization is wider than the box: text-align
            // only centers content that fits — an overflowing syllable is anchored
            // at the box's left edge and spills to the right (LTR). So a wide
            // syllable reaches boxWidth/2 to its left but (textWidth − boxWidth/2)
            // to its right. Modeling this correctly is what keeps a wide syllable's
            // narrow neighbor from being over-pushed.
            const centers: number[] = [];
            const halfLefts: number[] = [];
            const halfRights: number[] = [];
            for (let k = 0; k < n; k++) {
                const cell = cellRefs.current[idxs[k]];
                const item = items[idxs[k]];
                const charCount = Math.max(1, [...item.character].length);
                const boxWidth = charCount * columnWidth;
                const textWidth = measureTextWidth(pinyinRefs.current[idxs[k]], item.pinyin ?? "");
                const overflow = textWidth > boxWidth;
                centers.push(cell ? cell.offsetLeft + boxWidth / 2 : 0);
                halfLefts.push(overflow ? boxWidth / 2 : textWidth / 2);
                halfRights.push(overflow ? textWidth - boxWidth / 2 : textWidth / 2);
            }

            // Compute per-syllable horizontal offsets that keep adjacent pinyin
            // texts from touching. Each pinyin starts anchored on its own character
            // (offset 0). When two collide, the required separation is ALWAYS split
            // evenly — both syllables give ground equally. Even splitting is what
            // lets a crowded cluster spread symmetrically: e.g. a narrow syllable
            // sandwiched between two wide ones (夫 fu between 丈 zhàng and 上 shàng)
            // stays centered on its own char while the two wide neighbors drift
            // apart to make room. (An earlier variant let a wide syllable "anchor"
            // and dump the whole push on the narrow neighbor; that made such
            // sandwiches infeasible and shoved the narrow pinyin INTO a neighbor.)
            // Solved by relaxation: repeatedly push apart any overlapping pair by
            // half the deficit until stable. Capped passes; converges quickly for
            // the short runs cpcd renders (a word, or one wrapped line).
            const offsets = new Array<number>(n).fill(0);
            if (pinyinShift && n === 1) {
                // Lone syllable: no neighbor to de-overlap against, so nothing
                // constrains it. An overflowing pinyin would otherwise stay
                // browser-left-anchored (spilling only rightward); recentre it
                // over its glyph by pulling it left by half its overflow. For a
                // fitting syllable halfRight == halfLeft, so this is a no-op.
                offsets[0] = -(halfRights[0] - halfLefts[0]) / 2;
            } else if (pinyinShift && n > 1) {
                const maxPasses = Math.max(4, n);
                for (let pass = 0; pass < maxPasses; pass++) {
                    let moved = false;
                    for (let i = 0; i < n - 1; i++) {
                        // Required center spacing = left syllable's right reach +
                        // right syllable's left reach + gap.
                        const minSpacing = halfRights[i] + halfLefts[i + 1] + PINYIN_MIN_GAP_PX;
                        const actualSpacing = centers[i + 1] + offsets[i + 1] - (centers[i] + offsets[i]);
                        const deficit = minSpacing - actualSpacing;
                        if (deficit <= 0.01) continue;
                        // Split the push evenly: left yields left, right yields right.
                        offsets[i] -= deficit / 2;
                        offsets[i + 1] += deficit / 2;
                        moved = true;
                    }
                    if (!moved) break;
                }
            }

            for (let k = 0; k < n; k++) {
                const cell = cellRefs.current[idxs[k]];
                const span = pinyinRefs.current[idxs[k]];
                if (!cell || !span) continue;
                // Pinyin span is fixed-width (= cell width) with text-align:center,
                // so we align its left edge to the cell's left edge plus the offset.
                // An overflowing syllable keeps the browser's left-anchored spill
                // (it reaches right, into its yielded neighbor's freed space).
                const x = cell.offsetLeft + offsets[k];
                // Pinyin sits at the bottom of the cell, inside the reserved padding-bottom region.
                const y = cell.offsetTop + cell.offsetHeight - pinyinReservedHeight;
                span.style.transform = `translate(${x}px, ${y}px)`;
            }
        }
    };

    useLayoutEffect(() => {
        positionPinyins();
    });

    useEffect(() => {
        const block = charsBlockRef.current;
        if (!block || typeof ResizeObserver === "undefined") return;
        const ro = new ResizeObserver(() => positionPinyins());
        ro.observe(block);
        return () => ro.disconnect();
    }, []);

    // Compose the caller's className with the stable cpcd-row base class and the
    // optional selectable modifier. The CSS desktop selection rule keys off
    // `.cpcd-row--selectable` so selection is opt-in per instance.
    const rootClassName = ["cpcd-row", selectable && "cpcd-row--selectable", className]
        .filter(Boolean)
        .join(" ");

    return (
        <Box
            className={rootClassName}
            sx={{ position: "relative" }}
        >
            {/* Chars block — all characters contiguous in DOM order. A drag-selection that
                visually skips over the pinyin row (e.g. from one wrapped line of chars
                to the next) stays inside this block, so copy yields chars only.
                Uses inline-block cells (not flex) so a multi-cell selection serializes
                to a single line "你好吗" rather than newline-separated cells. */}
            <Box
                ref={charsBlockRef}
                className="cpcd-row__chars"
                sx={{
                    display: "block",
                    whiteSpace: flexWrap === "wrap" ? "normal" : "nowrap",
                    paddingLeft: `${overlapAbs}px`,
                    ...(justifyContent === "center" && { textAlign: "center" }),
                    ...(justifyContent === "flex-start" && { textAlign: "left" }),
                    ...(justifyContent === "flex-end" && { textAlign: "right" }),
                    "& > *": { marginLeft: `${overlap}px` },
                }}
            >
                {items.map((item, i) => {
                    const charCount = Math.max(1, [...item.character].length);
                    const cellWidth = charCount * columnWidth;
                    const isInteractive = item.interactive ?? false;
                    const showPinyin = item.showPinyin !== false && !!item.pinyin;
                    // Reserved vertical space (below the glyph) for the pinyin row.
                    // Kept even when showPinyin is false so toggling pinyin visibility
                    // doesn't shift surrounding layout.
                    const cellPaddingBottomForPinyin = showPinyin || item.pinyin ? `${pinyinReservedHeight}px` : "0px";
                    return (
                        <Box
                            key={i}
                            ref={(node: HTMLDivElement | null) => {
                                cellRefs.current[i] = node;
                                item.cellRef?.(node);
                            }}
                            className="char-pinyin-display cpcd-row__char-cell"
                            onMouseEnter={isInteractive ? item.onHoverStart : undefined}
                            // Stop pointerdown from bubbling on interactive cells so that
                            // an ancestor's "tap background → deselect" handler doesn't
                            // fire when the user taps a character directly.
                            onPointerDown={isInteractive ? (e) => e.stopPropagation() : undefined}
                            onTouchEnd={
                                isInteractive && item.onTapToggle
                                    ? (e) => {
                                          e.preventDefault();
                                          item.onTapToggle!();
                                      }
                                    : undefined
                            }
                            // inline-block (not flex) so multi-cell selection serializes as
                            // a single line of characters with no inter-cell newlines.
                            sx={{
                                display: "inline-block",
                                verticalAlign: "top",
                                textAlign: "center",
                                width: `${cellWidth}px`,
                                paddingTop: VERTICAL_PADDING[size],
                                paddingBottom: cellPaddingBottomForPinyin,
                                boxSizing: "border-box",
                                borderRadius: "6px",
                                border: item.selected ? "1px solid" : "1px solid transparent",
                                borderColor: item.selected ? "text.primary" : "transparent",
                                backgroundColor: item.selected ? "rgba(119, 155, 231, 0.15)" : "transparent",
                                cursor: isInteractive ? "pointer" : "default",
                                transition: "border-color 0.15s ease, background-color 0.15s ease",
                                fontSize: charFontSize,
                                fontWeight: bold ? WEIGHT.bold : WEIGHT.regular,
                                fontFamily: FONTS.cjk,
                                // Per-card Contrast override colors the glyph only (not the
                                // pinyin); falls back to the theme default. docs/CARD_ICON_LAYOUT.md.
                                color: characterColor ?? "text.primary",
                                lineHeight: 1.21,
                            }}
                        >
                            <span className="char-pinyin-display__character">{item.character}</span>
                        </Box>
                    );
                })}
            </Box>

            {/* Pinyin block — absolutely positioned overlay containing all pinyin
                spans in DOM order AFTER the chars block. Each span is placed via
                transform in positionPinyins(). pointer-events: none so the chars
                below remain interactive. */}
            {/* pointer-events: none on the wrapper so empty gaps between pinyin
                spans pass clicks through to the chars block, but each pinyin
                span re-enables pointer-events so it can be drag-selected. */}
            <Box
                className="cpcd-row__pinyins"
                sx={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: "100%",
                    pointerEvents: "none",
                }}
            >
                {items.map((item, i) => {
                    const showPinyin = item.showPinyin !== false && !!item.pinyin;
                    const useToneColor = item.useToneColor ?? true;
                    const color = useToneColor && item.pinyin ? getToneColor(item.pinyin) : "inherit";
                    // Add a trailing space between adjacent pinyins so copying the
                    // pinyin row yields "ni hao ma" rather than "nihaoma".
                    const text = (item.pinyin ?? "") + (i < items.length - 1 && item.pinyin ? " " : "");
                    const charCount = Math.max(1, [...item.character].length);
                    const cellWidth = charCount * columnWidth;
                    return (
                        <span
                            key={i}
                            ref={(node) => {
                                pinyinRefs.current[i] = node;
                            }}
                            className="char-pinyin-display__pinyin cpcd-row__pinyin-cell"
                            style={{
                                position: "absolute",
                                top: 0,
                                left: 0,
                                width: `${cellWidth}px`,
                                textAlign: "center",
                                fontSize: pinyinFontSize,
                                fontFamily: FONTS.sans,
                                fontStretch: "condensed",
                                color: color as string,
                                lineHeight: 1.21,
                                visibility: showPinyin ? undefined : "hidden",
                                whiteSpace: "nowrap",
                                pointerEvents: "auto",
                            }}
                        >
                            {text}
                        </span>
                    );
                })}
            </Box>
        </Box>
    );
};

export default CPCDRow;
