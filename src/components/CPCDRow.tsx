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
    // When true (default), any syllable whose pinyin is "long" (renders wider than
    // its own character column, e.g. "chuáng" in 起床) spaces itself out from its
    // neighbors: it stays centered over its own character and pushes each immediate
    // neighbor outward by one discrete push unit. Pushes from a long left neighbor
    // and a long right neighbor cancel, so a syllable sandwiched between two long
    // ones doesn't move.
    // Narrow pinyin and ordinary words are left untouched. Exposed as a property so
    // every cpcd surface (flp example sentences, bubble-match word bubbles, etc.)
    // shares one behavior. See docs/CPCD_PINYIN_SHIFT.md.
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
// A pinyin syllable counts as "long" (and so pushes its neighbors apart) when its
// rendered text overflows its own character column by more than this slack (px,
// unscaled). The slack keeps a syllable sitting right at the column edge from
// flickering in and out of "long" as measurement/font rounding jitters.
const LONG_PINYIN_OVERFLOW_SLACK_PX = 2;
// A long syllable nudges each neighbor by one discrete push unit — a fixed
// fraction of the column width, NOT a magnitude derived from the exact overflow.
// A syllable is therefore either pushed (by one unit) or not; pushes from a long
// left and a long right neighbor cancel to a net zero so it stays put.
const PINYIN_PUSH_FRACTION = 0.05;

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

            // Measure each syllable in this visual row: its rendered pinyin text
            // width, its character column-box width, and whether it is "long".
            const textWidths: number[] = [];
            const boxWidths: number[] = [];
            const isLong: boolean[] = [];
            for (let k = 0; k < n; k++) {
                const item = items[idxs[k]];
                const charCount = Math.max(1, [...item.character].length);
                const boxWidth = charCount * columnWidth;
                const pinyin = item.pinyin ?? "";
                const textWidth = measureTextWidth(pinyinRefs.current[idxs[k]], pinyin);
                textWidths.push(textWidth);
                boxWidths.push(boxWidth);
                // Long = the rendered pinyin overflows its own column (with slack),
                // i.e. it is too wide on screen for its character.
                isLong.push(textWidth > boxWidth + LONG_PINYIN_OVERFLOW_SLACK_PX);
            }

            // Each long syllable stays put (centered over its own char, below) and
            // pushes its two immediate in-row neighbors outward by one discrete push
            // unit — left neighbor left, right neighbor right. The pushes accumulate
            // additively, so a syllable shoved right by a long left neighbor and left
            // by a long right neighbor nets zero and stays anchored.
            const pushUnit = columnWidth * PINYIN_PUSH_FRACTION;
            const offsets = new Array<number>(n).fill(0);
            if (pinyinShift) {
                for (let k = 0; k < n; k++) {
                    if (!isLong[k]) continue;
                    if (k - 1 >= 0) offsets[k - 1] -= pushUnit; // left neighbor yields leftward
                    if (k + 1 < n) offsets[k + 1] += pushUnit; // right neighbor yields rightward
                }
            }

            for (let k = 0; k < n; k++) {
                const cell = cellRefs.current[idxs[k]];
                const span = pinyinRefs.current[idxs[k]];
                if (!cell || !span) continue;
                // The pinyin span is a fixed, cell-width box with text-align:center.
                // When the text fits, that already centers it over the char. When it
                // overflows, the browser left-anchors it (spilling only rightward),
                // so we add a correction that re-centers the overflow over the char —
                // which is what lets a long syllable spill symmetrically and push
                // both neighbors evenly.
                const overflow = textWidths[k] - boxWidths[k];
                const centeringCorrection = overflow > 0 ? -overflow / 2 : 0;
                const x = cell.offsetLeft + centeringCorrection + offsets[k];
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
