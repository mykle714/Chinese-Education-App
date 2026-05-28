import React, { useEffect, useLayoutEffect, useRef } from "react";
import { Box } from "@mui/material";
import { getToneColor } from "../utils/toneColors";
import { computePinyinShifts, SHIFT_UNIT_BY_SIZE } from "../utils/pinyinShift";

export type CPCDSize = "sm" | "md" | "lg";

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
}

// Per-size visual constants. Mirror the table that used to live in
// CharacterPinyinColorDisplay; kept here because CPCDRow now owns the layout.
const COLUMN_WIDTH: Record<CPCDSize, number> = { sm: 32, md: 50, lg: 54 };
// Vertical space reserved above each char cell's glyph for the pinyin row.
// Sized to fit the pinyin font's line-box at each size (font-size × 1.21).
const PINYIN_RESERVED_HEIGHT: Record<CPCDSize, number> = { sm: 18, md: 22, lg: 24 };
const CHAR_FONT_SIZE: Record<CPCDSize, string> = { sm: "26px", md: "2.25rem", lg: "2.4rem" };
const PINYIN_FONT_SIZE: Record<CPCDSize, string> = { sm: "13px", md: "1rem", lg: "1.05rem" };
const COMPACT_CHAR_FONT: Record<CPCDSize, string> = { sm: "22px", md: "1.875rem", lg: "2.25rem" };
const COMPACT_PINYIN_FONT: Record<CPCDSize, string> = { sm: "11px", md: "0.875rem", lg: "1rem" };
const VERTICAL_PADDING: Record<CPCDSize, string> = { sm: "4px", md: "8px", lg: "8px" };
// Negative left-margin per child to overlap cells, preserving the prior visual density.
const OVERLAP_BY_SIZE: Record<CPCDSize, number> = { sm: -6, md: -4, lg: -2 };

const CPCDRow: React.FC<CPCDRowProps> = ({
    items,
    size = "sm",
    compact = false,
    flexWrap = "nowrap",
    justifyContent,
    className,
}) => {
    const charsBlockRef = useRef<HTMLDivElement | null>(null);
    const cellRefs = useRef<(HTMLDivElement | null)[]>([]);
    const pinyinRefs = useRef<(HTMLSpanElement | null)[]>([]);

    const columnWidth = COLUMN_WIDTH[size];
    const pinyinReservedHeight = PINYIN_RESERVED_HEIGHT[size];
    const overlap = OVERLAP_BY_SIZE[size];
    const overlapAbs = Math.abs(overlap);
    const shiftUnitPx = SHIFT_UNIT_BY_SIZE[size];
    const charFontSize = compact ? COMPACT_CHAR_FONT[size] : CHAR_FONT_SIZE[size];
    const pinyinFontSize = compact ? COMPACT_PINYIN_FONT[size] : PINYIN_FONT_SIZE[size];

    // Position each pinyin span over its corresponding char cell. Run on every
    // render and on size changes to the chars block (handled by ResizeObserver
    // below) so pinyins reflow whenever the row wraps to a new line.
    const positionPinyins = () => {
        if (!charsBlockRef.current) return;

        // Group items into visual rows by similar offsetTop. The shift algorithm
        // is row-local — a long syllable at the end of one wrapped line must not
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

        for (const row of rows) {
            const rowItems = row.indices.map((idx) => items[idx]);
            const shifts = computePinyinShifts(rowItems, shiftUnitPx);

            row.indices.forEach((itemIdx, localIdx) => {
                const cell = cellRefs.current[itemIdx];
                const span = pinyinRefs.current[itemIdx];
                if (!cell || !span) return;
                // Pinyin span is fixed-width (= cell width) with text-align:center,
                // so we just align its left edge to the cell's left edge plus shift.
                const x = cell.offsetLeft + shifts[localIdx];
                // Pinyin sits at the bottom of the cell, inside the reserved padding-bottom region.
                const y = cell.offsetTop + cell.offsetHeight - pinyinReservedHeight;
                span.style.transform = `translate(${x}px, ${y}px)`;
            });
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

    return (
        <Box
            className={className}
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
                                fontWeight: 400,
                                fontFamily: '"Inter", "Noto Sans JP", sans-serif',
                                color: "text.primary",
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
                                fontFamily: '"Noto Sans Display", sans-serif',
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
