import { alpha } from "@mui/material/styles";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Box, type SxProps, type Theme } from "@mui/material";
import CpcdPopup from "./CpcdPopup";
import { copyToClipboard } from "../utils/copyToClipboard";
import { getToneColor } from "../utils/toneColors";
import { FONTS } from "../theme/fonts";
import { WEIGHT } from "../theme/scale";
import { COLORS } from "../theme/colors";
import {
    BIG_PINYIN_SCALE,
    CELL_BORDER_PX,
    CHAR_FONT_SIZE,
    CHAR_LINE_HEIGHT,
    COLUMN_WIDTH,
    COMPACT_CHAR_FONT,
    COMPACT_PINYIN_FONT,
    GLYPH_DROP_PX,
    OVERLAP_BY_SIZE,
    PINYIN_FONT_SIZE,
    PINYIN_RESERVED_HEIGHT,
    VERTICAL_PADDING,
    pinyinSeparators,
    solvePinyinShift,
    type CPCDSize,
    type CpcdCharItem,
    type PinyinExtent,
} from "./cpcdLayout";

// The size tables, the char/syllable zip and the pinyin collision solver live in
// cpcdLayout.ts (shared with the SVG mini card face, MiniCardSvg). Re-exported here for
// the many callers that import the size type from CPCDRow.
export type { CPCDSize };

export interface CPCDRowItem extends CpcdCharItem {
    interactive?: boolean;
    selected?: boolean;
    onHoverStart?: () => void;
    onTapToggle?: () => void;
    // Optional callback receiving the rendered char cell DOM node. Used by
    // SegmentedSentenceDisplay to measure per-character rects for highlights.
    cellRef?: (node: HTMLDivElement | null) => void;
    // Draw a MASK — a plain "?" — in place of the glyph, keeping the cell's width and the
    // pinyin above it. `character` stays the real character so the row's measurement is
    // unchanged; it is never shown (or copied). Set via ForeignText's `maskChar`. Used by
    // the writing flp card's source words (docs/WRITING_PRACTICE_REWORK.md § 3b).
    masked?: boolean;
    // Size the cell to its own text instead of a fixed `charCount × COLUMN_WIDTH` column —
    // for a run with no pinyin that is not a CJK character: a Latin word, a digit run, a
    // punctuation mark. Padded by half the column overlap on each side (the side bearing a
    // fixed column has), so the row's negative cell overlap tucks it in exactly like a
    // character. First user: the Reader's Pinyin view (ReaderCpcdView), whose rows carry
    // a whole paragraph — punctuation and English words included.
    autoWidth?: boolean;
    // Keep the pinyin band (padding-bottom) on a cell that has no pinyin, so a wrapped line
    // made only of such cells (punctuation, Latin) is as tall as a line of characters.
    // Same first user.
    reservePinyinBand?: boolean;
    // A FIND HIGHLIGHT painted on the whole cell (glyph + pinyin band), behind the text:
    // `background` fills it (a translucent wash reads best — the glyph keeps its own ink)
    // and `ink` (optional) recolours the glyph and any uncoloured pinyin. Unlike
    // `selected` it draws no border. `joinLeft` / `joinRight` say the neighbouring cell
    // carries the same highlight: that side is squared off and meets the neighbour's fill
    // exactly at the middle of the two cells' overlap (no double-painted strip), so a run
    // of cells reads as ONE box. First user: the Reader's search bar in the Pinyin view
    // (ReaderCpcdView → search matches).
    highlight?: { background: string; ink?: string; joinLeft?: boolean; joinRight?: boolean };
    // Extra attributes on the cell, e.g. `{ "data-reader-alternative": 0 }` — the cell-level
    // twin of CPCDRowGroup `attrs`, for callers that hit-test single cells. First user: the
    // Reader's tiebreak alternatives (ReaderCpcdView), whose cells cut across word groups.
    attrs?: Record<string, string | number>;
}

/**
 * A run of consecutive items wrapped in one inline-block element (`groups` prop).
 *
 * - **Unbreakable**: a wrapped row never breaks a line inside a group, so a group
 *   is how a caller keeps a multi-character word (and the punctuation glued to it) on one
 *   line while the row still wraps between groups.
 * - **Addressable**: the wrapper carries the caller's class, data attributes, styling
 *   (e.g. a word highlight that covers the cells AND the pinyin band) and click handler.
 *
 * Groups may nest (a word inside a word+punctuation unit) but must not partially overlap.
 * The cells inside keep their positions in the row's one coordinate space (the wrappers
 * are not positioned), so the pinyin collision solver still runs across group boundaries.
 * Docs: docs/CPCD_PINYIN_SHIFT.md § "Groups".
 */
export interface CPCDRowGroup {
    // Item index range, [start, end).
    start: number;
    end: number;
    className?: string;
    sx?: SxProps<Theme>;
    // Extra attributes on the wrapper, e.g. `{ "data-span-index": 3 }`.
    attrs?: Record<string, string | number>;
    onClick?: () => void;
}

/**
 * The masked-character mark: a bare "?" (no ring, decided 2026-10-28), centred in a
 * 1em-wide box — the advance width of the CJK glyph it replaces — so the row's spacing
 * and the pinyin centring don't shift. It inherits the cell's font size and line
 * height, so it scales with every CPCDSize and sits on the same line as the characters.
 * Ink follows the glyph colour (the per-card Contrast override when given, else the
 * secondary text ink) so the mark reads as part of the word, a shade lighter than the
 * characters around it.
 */
function MaskedCharMark({ color }: { color?: string }) {
    return (
        <Box
            component="span"
            className="char-pinyin-display__mask"
            aria-label="hidden character"
            sx={{
                display: "inline-block",
                width: "1em",
                textAlign: "center",
                color: color ?? COLORS.textSecondary,
                fontFamily: FONTS.sans,
                fontWeight: WEIGHT.medium,
            }}
        >
            ?
        </Box>
    );
}

interface CPCDRowProps {
    items: CPCDRowItem[];
    // Unbreakable / addressable runs of items (see CPCDRowGroup). Omitted → every cell
    // is a direct child of the row, as before.
    groups?: CPCDRowGroup[];
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
    // Tap-to-copy: a click/tap anywhere on the row copies it to the clipboard and
    // confirms with a small floating caption (the SAME box the est uses for a tapped
    // segment's definition — see CpcdPopup). Successive taps ALTERNATE what they copy:
    // characters first ("Characters Copied!"), then the pinyin ("Pinyin Copied!"), then
    // back. A row with no pinyin at all only ever copies characters. Defaults to false:
    // most cpcd surfaces already own the tap (flip the card, select a segment), so this
    // is opt-in per call site — the eip header headword and the Dictionary page's
    // search-result headwords (DictionaryEntryRow.headwordTapToCopy).
    tapToCopy?: boolean;
    // Optional override for the CHARACTER glyph color only (the per-card Contrast
    // setting on the flashcard — see docs/CARD_ICON_LAYOUT.md). The pinyin overlay is
    // never affected. Undefined keeps the theme default (text.primary).
    characterColor?: string;
    // "Big pinyin" mode: scales the pinyin overlay up by BIG_PINYIN_SCALE while
    // leaving the character glyph at its normal size for `size`. Reads as a
    // pronunciation-forward variant of the same layout — used by Word Search's
    // Pinyin board, where the default 13px `sm` pinyin is too small to scan while
    // dragging. Both the font size and the reserved pinyin band grow together, so
    // the glyph keeps its usual clearance and only the cell's total height changes.
    bigPinyin?: boolean;
    // Center the glyph in its cell when the WHOLE row's pinyin is hidden. A cell keeps
    // its pinyin band (padding-bottom) even with the syllable hidden, so toggling
    // pinyin never resizes the row — but a host that flex-centers the cell (a board
    // tile, a game card) then centers glyph+empty band, and the character rides half a
    // band above center. With this on, the glyph is painted half a band lower instead
    // (replacing GLYPH_DROP_PX for that cell). A paint offset like GLYPH_DROP_PX, so
    // the cell box, cpcdNaturalSize and any fit-scaler's measurement are untouched.
    // Row-level on purpose: it only engages when NO item shows pinyin, so a row mixing
    // shown and hidden syllables never puts glyphs at different heights; cells with no
    // syllable at all reserve no band and are not moved. Opt-in, because on prose and
    // flashcard surfaces the glyph should hold still when pinyin toggles.
    // Used by: Word Search tiles (WordSearchGrid), Match Speed foreign cards
    // (MatchSpeedCard). Docs: docs/CPCD_PINYIN_SHIFT.md, docs/WORD_SEARCH_GAME.md §3.
    centerGlyphWhenPinyinHidden?: boolean;
    // Font for the LATIN half of the word — the pinyin overlay. Defaults to the UI sans
    // (FONTS.sans). A surface whose whole face is set in the app's Chinese face passes
    // FONTS.cjk (975 Maru SC; its slices cover Latin + tone-marked vowels) so the pinyin
    // matches the characters: MiniCard and the flp card face (CardFace.tsx). Docs:
    // docs/CJK_TYPEFACE_LAB.md § "The dd follows the face too".
    latinFontFamily?: string;
}

// How long the tap-to-copy confirmation caption stays up. Long enough to read two
// words, short enough that it never sits over the content the user came back to.
const COPY_MESSAGE_MS = 1400;
// How far a touch may travel between touchstart and touchend and still count as a tap on a
// character (onTapToggle). Matches the tab-swipe axis-lock order of magnitude: past this,
// the finger was dragging something else (useTabSwipeTrack locks at 8px).
const TAP_SLOP_PX = 10;

const CPCDRow: React.FC<CPCDRowProps> = ({
    items,
    groups,
    size = "sm",
    compact = false,
    flexWrap = "nowrap",
    justifyContent,
    className,
    bold = false,
    pinyinShift = true,
    selectable = false,
    tapToCopy = false,
    characterColor,
    bigPinyin = false,
    centerGlyphWhenPinyinHidden = false,
    latinFontFamily = FONTS.sans,
}) => {
    const charsBlockRef = useRef<HTMLDivElement | null>(null);
    const cellRefs = useRef<(HTMLDivElement | null)[]>([]);
    // Where the current touch landed on a character cell — one finger at a time, so one
    // slot for the whole row. Read by the cell's touchend to tell a tap from a drag.
    const touchStartRef = useRef<{ x: number; y: number } | null>(null);
    const pinyinRefs = useRef<(HTMLSpanElement | null)[]>([]);
    // One separator apostrophe per gap (indexed by the LEFT syllable's item index).
    const sepRefs = useRef<(HTMLSpanElement | null)[]>([]);

    // --- Tap-to-copy (opt-in via `tapToCopy`) -----------------------------------
    // The confirmation caption's anchor. Held in STATE rather than in a ref because
    // Popper has to re-render once the node exists; a ref assignment alone would
    // leave the first tap with a null anchor.
    const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null);
    const [copyMessage, setCopyMessage] = useState<string | null>(null);
    // Which field the NEXT tap copies. A ref, not state: it must advance
    // synchronously so a fast double tap sees the first tap's result, and it drives
    // no rendering of its own.
    const nextCopyFieldRef = useRef<"characters" | "pinyin">("characters");
    const copyMessageTimerRef = useRef<number | null>(null);

    // Clear any pending caption timer on unmount so it can't setState on a dead component.
    useEffect(() => () => {
        if (copyMessageTimerRef.current !== null) window.clearTimeout(copyMessageTimerRef.current);
    }, []);

    const handleTapToCopy = () => {
        // A masked character copies as "?" — the mask must not leak through the clipboard.
        const characters = items.map((item) => (item.masked ? "?" : item.character)).join("");
        // Space-joined, matching how the pinyin row reads on screen (and how the
        // dictionary stores a pronunciation), with empty syllables dropped.
        const pinyin = items
            .map((item) => item.pinyin?.trim())
            .filter((syllable): syllable is string => !!syllable)
            .join(" ");

        // Alternate, except that a row with no pinyin (e.g. pinyin hidden by data,
        // not by display) has only one thing to give and always gives it.
        const field = pinyin && nextCopyFieldRef.current === "pinyin" ? "pinyin" : "characters";
        nextCopyFieldRef.current = field === "characters" ? "pinyin" : "characters";

        const text = field === "pinyin" ? pinyin : characters;
        const label = field === "pinyin" ? "Pinyin Copied!" : "Characters Copied!";

        // Fire-and-forget with an explicit failure caption: a refused clipboard
        // permission must not leave the user thinking the copy worked.
        void copyToClipboard(text).then((ok) => {
            setCopyMessage(ok ? label : "Copy failed");
            if (copyMessageTimerRef.current !== null) window.clearTimeout(copyMessageTimerRef.current);
            copyMessageTimerRef.current = window.setTimeout(() => setCopyMessage(null), COPY_MESSAGE_MS);
        });
    };

    const columnWidth = COLUMN_WIDTH[size];
    const overlap = OVERLAP_BY_SIZE[size];
    const overlapAbs = Math.abs(overlap);
    const charFontSize = compact ? COMPACT_CHAR_FONT[size] : CHAR_FONT_SIZE[size];
    // Big-pinyin mode scales the pinyin band and its font together (see
    // BIG_PINYIN_SCALE); the character font is untouched by design.
    const basePinyinFontSize = compact ? COMPACT_PINYIN_FONT[size] : PINYIN_FONT_SIZE[size];
    const pinyinFontSize = bigPinyin ? `calc(${basePinyinFontSize} * ${BIG_PINYIN_SCALE})` : basePinyinFontSize;
    const pinyinReservedHeight = bigPinyin
        ? Math.round(PINYIN_RESERVED_HEIGHT[size] * BIG_PINYIN_SCALE)
        : PINYIN_RESERVED_HEIGHT[size];

    // See `centerGlyphWhenPinyinHidden`: engaged only when the row has pinyin to hide
    // and every syllable is hidden.
    const centerHiddenPinyinGlyph =
        centerGlyphWhenPinyinHidden &&
        items.some((item) => !!item.pinyin) &&
        items.every((item) => item.showPinyin === false || !item.pinyin);
    // Half the reserved band puts the glyph at the cell's center. It REPLACES the
    // per-size GLYPH_DROP_PX (which only exists to tighten the glyph-to-pinyin gap,
    // moot with the pinyin hidden) rather than adding to it.
    const centeredGlyphDropPx = pinyinReservedHeight / 2;

    // Position each pinyin span over its corresponding char cell. Run on every
    // render and on size changes to the chars block (handled by ResizeObserver
    // below) so pinyins reflow whenever the row wraps to a new line.
    const positionPinyins = () => {
        const charsBlock = charsBlockRef.current;
        if (!charsBlock) return;

        // Hide all separator apostrophes up front; the row loop below re-shows only
        // the ones whose same-tone pair actually crowded together this pass.
        for (const sep of sepRefs.current) {
            if (sep) sep.style.visibility = "hidden";
        }

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

            // The row's extents (cell centre, box width, measured text width) go to the
            // shared solver (cpcdLayout.ts → solvePinyinShift; its comment carries the
            // asymmetric-extent model and the even-split relaxation). MiniCardSvg feeds
            // the same solver canvas-measured widths, so the two renderers agree.
            const extents: PinyinExtent[] = idxs.map((i) => {
                const cell = cellRefs.current[i];
                const item = items[i];
                // An auto-width cell's box is whatever its text measured to.
                const boxWidth = item.autoWidth && cell
                    ? cell.offsetWidth
                    : Math.max(1, [...item.character].length) * columnWidth;
                return {
                    center: cell ? cell.offsetLeft + boxWidth / 2 : 0,
                    boxWidth,
                    textWidth: measureTextWidth(pinyinRefs.current[i], item.pinyin ?? ""),
                };
            });
            const solution = solvePinyinShift(extents, pinyinShift);

            for (let k = 0; k < n; k++) {
                const cell = cellRefs.current[idxs[k]];
                const span = pinyinRefs.current[idxs[k]];
                if (!cell || !span) continue;
                // Pinyin span is fixed-width (= cell width) with text-align:center,
                // so we align its left edge to the cell's left edge plus the offset.
                // An overflowing syllable keeps the browser's left-anchored spill
                // (it reaches right, into its yielded neighbor's freed space).
                const x = cell.offsetLeft + solution.offsets[k];
                // Pinyin sits at the bottom of the cell, inside the reserved padding-bottom region.
                const y = cell.offsetTop + cell.offsetHeight - pinyinReservedHeight;
                span.style.transform = `translate(${x}px, ${y}px)`;
            }

            // Separator apostrophes: between each same-tone pair the solver PUSHED
            // (cpcdLayout.ts → pinyinSeparators, and the comment above it), at the midpoint
            // of the post-shift gap.
            const rowItems = idxs.map((i) => items[i]);
            for (const { gap, midX } of pinyinSeparators(extents, rowItems, solution)) {
                const sep = sepRefs.current[idxs[gap]];
                const cell = cellRefs.current[idxs[gap]];
                if (!sep || !cell) continue;
                // Anchor to the top of the reserved pinyin band so the apostrophe
                // rides near the top of the pinyin text; translateX(-50%) centers the
                // glyph horizontally on the gap midpoint (the span shrink-wraps its
                // own width, so the percentage is relative to the glyph).
                const sepY = cell.offsetTop + cell.offsetHeight - pinyinReservedHeight;
                sep.style.transform = `translate(${midX}px, ${sepY}px) translateX(-50%)`;
                sep.style.visibility = "visible";
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

    // Groups, outermost first at each start (a wider group before the narrower one it
    // contains), so the recursive render below can nest them.
    const sortedGroups = (groups ?? [])
        .filter((g) => g.start < g.end)
        .slice()
        .sort((a, b) => a.start - b.start || b.end - a.end);

    // One character cell. `firstInGroup`: the first child of a group wrapper takes no
    // overlap margin — the WRAPPER takes it instead, so the wrapper's box (and any
    // highlight drawn on it) lines up with its cells.
    const renderCell = (item: CPCDRowItem, i: number, firstInGroup: boolean) => {
            const charCount = Math.max(1, [...item.character].length);
            const cellWidth = charCount * columnWidth;
            const isInteractive = item.interactive ?? false;
            const showPinyin = item.showPinyin !== false && !!item.pinyin;
            // Reserved vertical space (below the glyph) for the pinyin row.
            // Kept even when showPinyin is false so toggling pinyin visibility
            // doesn't shift surrounding layout.
            const cellPaddingBottomForPinyin =
                showPinyin || item.pinyin || item.reservePinyinBand ? `${pinyinReservedHeight}px` : "0px";
            return (
                <Box
                    key={i}
                    ref={(node: HTMLDivElement | null) => {
                        cellRefs.current[i] = node;
                        item.cellRef?.(node);
                    }}
                    className="char-pinyin-display cpcd-row__char-cell"
                    {...item.attrs}
                    onMouseEnter={isInteractive ? item.onHoverStart : undefined}
                    // Stop pointerdown from bubbling on interactive cells so that
                    // an ancestor's "tap background → deselect" handler doesn't
                    // fire when the user taps a character directly.
                    onPointerDown={isInteractive ? (e) => e.stopPropagation() : undefined}
                    // A TAP toggles; a drag does not. Without the slop check, a finger
                    // that lands on a word, drags (a tab swipe, a sheet resize, a
                    // scroll) and lifts still fired touchend here and opened the popup.
                    onTouchStart={
                        isInteractive && item.onTapToggle
                            ? (e) => {
                                  const t = e.touches[0];
                                  touchStartRef.current = t ? { x: t.clientX, y: t.clientY } : null;
                              }
                            : undefined
                    }
                    onTouchEnd={
                        isInteractive && item.onTapToggle
                            ? (e) => {
                                  e.preventDefault();
                                  const start = touchStartRef.current;
                                  touchStartRef.current = null;
                                  const t = e.changedTouches[0];
                                  if (start && t && Math.hypot(t.clientX - start.x, t.clientY - start.y) > TAP_SLOP_PX) return;
                                  item.onTapToggle!();
                              }
                            : undefined
                    }
                    onTouchCancel={() => { touchStartRef.current = null; }}
                    // inline-block (not flex) so multi-cell selection serializes as
                    // a single line of characters with no inter-cell newlines.
                    sx={{
                        display: "inline-block",
                        verticalAlign: "top",
                        textAlign: "center",
                        width: item.autoWidth ? "auto" : `${cellWidth}px`,
                        ...(item.autoWidth && {
                            paddingLeft: `${overlapAbs / 2}px`,
                            paddingRight: `${overlapAbs / 2}px`,
                            whiteSpace: "pre",
                        }),
                        marginLeft: firstInGroup ? 0 : `${overlap}px`,
                        paddingTop: VERTICAL_PADDING[size],
                        paddingBottom: cellPaddingBottomForPinyin,
                        boxSizing: "border-box",
                        borderRadius: "6px",
                        border: `${CELL_BORDER_PX}px solid${item.selected ? "" : " transparent"}`,
                        borderColor: item.selected ? "text.primary" : "transparent",
                        // A translucent wash of the blue MARK (highlighter) tier — the selection
                        // tint SegmentedSentenceDisplay's highlight overlay uses too.
                        backgroundColor: item.selected ? alpha(COLORS.bluMk, 0.18) : "transparent",
                        cursor: isInteractive ? "pointer" : "default",
                        transition: "border-color 0.15s ease, background-color 0.15s ease",
                        fontSize: charFontSize,
                        fontWeight: bold ? WEIGHT.bold : WEIGHT.regular,
                        fontFamily: FONTS.cjk,
                        // Per-card Contrast override colors the glyph only (not the
                        // pinyin); falls back to the theme default. docs/CARD_ICON_LAYOUT.md.
                        color: item.highlight?.ink ?? characterColor ?? "text.primary",
                        lineHeight: CHAR_LINE_HEIGHT,
                        // The find highlight (CPCDRowItem `highlight`) as a ::before behind
                        // the glyph — `isolation` keeps its z-index -1 inside this cell, so
                        // it never drops behind an ancestor's background. It covers the
                        // border box; a joined side pulls in by half the column overlap
                        // (cells overlap by `overlapAbs`), meeting the neighbour's fill edge
                        // to edge so a multi-cell match is one continuous box.
                        ...(item.highlight && !item.selected && {
                            position: "relative",
                            isolation: "isolate",
                            "&::before": {
                                content: '""',
                                position: "absolute",
                                zIndex: -1,
                                top: `${-CELL_BORDER_PX}px`,
                                bottom: `${-CELL_BORDER_PX}px`,
                                left: `${item.highlight.joinLeft ? overlapAbs / 2 - CELL_BORDER_PX : -CELL_BORDER_PX}px`,
                                right: `${item.highlight.joinRight ? overlapAbs / 2 - CELL_BORDER_PX : -CELL_BORDER_PX}px`,
                                borderRadius: [
                                    item.highlight.joinLeft ? 0 : 6,
                                    item.highlight.joinRight ? 0 : 6,
                                    item.highlight.joinRight ? 0 : 6,
                                    item.highlight.joinLeft ? 0 : 6,
                                ].map((r) => `${r}px`).join(" "),
                                backgroundColor: item.highlight.background,
                            },
                        }),
                        // Covers the masked mark too, which stands in for the glyph.
                        "& .char-pinyin-display__character, & .char-pinyin-display__mask": {
                            position: "relative",
                            top: `${
                                centerHiddenPinyinGlyph && item.pinyin
                                    ? centeredGlyphDropPx
                                    : GLYPH_DROP_PX[size]
                            }px`,
                        },
                    }}
                >
                    {item.masked ? (
                        <MaskedCharMark color={characterColor} />
                    ) : (
                        <span className="char-pinyin-display__character">{item.character}</span>
                    )}
                </Box>
            );
    };

    // Render items [from, to), wrapping each group's run (recursively, for nested groups).
    // `insideGroup`: these nodes are a group's children, so the first one takes no margin.
    const renderNodes = (from: number, to: number, pending: CPCDRowGroup[], insideGroup: boolean): React.ReactNode[] => {
        const nodes: React.ReactNode[] = [];
        let i = from;
        while (i < to) {
            const group = pending.find((g) => g.start === i && g.end <= to);
            const firstHere = insideGroup && nodes.length === 0;
            if (!group) {
                nodes.push(renderCell(items[i], i, firstHere));
                i++;
                continue;
            }
            // The groups strictly inside this one (a group never partially overlaps another).
            const inner = pending.filter((g) => g !== group && g.start >= group.start && g.end <= group.end);
            nodes.push(
                <Box
                    key={`g${group.start}-${group.end}`}
                    component="span"
                    className={["cpcd-row__group", group.className].filter(Boolean).join(" ")}
                    onClick={group.onClick}
                    {...group.attrs}
                    sx={[
                        {
                            display: "inline-block",
                            verticalAlign: "top",
                            whiteSpace: "nowrap",
                            marginLeft: firstHere ? 0 : `${overlap}px`,
                        },
                        ...(Array.isArray(group.sx) ? group.sx : [group.sx]),
                    ]}
                >
                    {renderNodes(group.start, group.end, inner, true)}
                </Box>
            );
            i = group.end;
        }
        return nodes;
    };

    // Compose the caller's className with the stable cpcd-row base class and the
    // optional selectable modifier. The CSS desktop selection rule keys off
    // `.cpcd-row--selectable` so selection is opt-in per instance.
    const rootClassName = ["cpcd-row", selectable && "cpcd-row--selectable", className]
        .filter(Boolean)
        .join(" ");

    return (
        <Box
            ref={setRootEl}
            className={rootClassName}
            onClick={tapToCopy ? handleTapToCopy : undefined}
            sx={{ position: "relative", ...(tapToCopy && { cursor: "pointer" }) }}
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
                }}
            >
                {renderNodes(0, items.length, sortedGroups, false)}
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
                    // Uncoloured pinyin inherits the row's ink — except under a find
                    // highlight, which carries its own (see CPCDRowItem `highlight`).
                    const color = useToneColor && item.pinyin
                        ? getToneColor(item.pinyin)
                        : item.highlight?.ink ?? "inherit";
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
                                fontFamily: latinFontFamily,
                                // Pinned, not inherited: the pinyin stays regular whatever
                                // weight the host sets (e.g. the Deck Tower stage is bold,
                                // and the tower flp session mounts inside it).
                                fontWeight: WEIGHT.regular,
                                fontStretch: "condensed",
                                color: color as string,
                                lineHeight: CHAR_LINE_HEIGHT,
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

            {/* Separator-apostrophe overlay — one absolutely-positioned apostrophe
                per gap, positioned/toggled imperatively in positionPinyins(). Sits
                above the pinyin overlay so an apostrophe between two crowded same-tone
                syllables reads on top, near the top of the pinyin text. Text-colored
                (currentColor from the wrapper's text.primary), non-interactive, and
                unselectable so it never joins a pinyin copy. */}
            <Box
                className="cpcd-row__pinyin-seps"
                aria-hidden
                sx={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: "100%",
                    pointerEvents: "none",
                    color: "text.primary",
                }}
            >
                {items.slice(0, -1).map((_, i) => (
                    <span
                        key={i}
                        ref={(node) => {
                            sepRefs.current[i] = node;
                        }}
                        className="cpcd-row__pinyin-sep"
                        style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            fontSize: pinyinFontSize,
                            fontFamily: latinFontFamily,
                            fontWeight: WEIGHT.regular,
                            lineHeight: 1,
                            color: "currentColor",
                            visibility: "hidden",
                            pointerEvents: "none",
                            userSelect: "none",
                            whiteSpace: "nowrap",
                        }}
                    >
                        &rsquo;
                    </span>
                ))}
            </Box>

            {/* Tap-to-copy confirmation. Non-interactive (nothing to tap on it) and
                self-dismissing after COPY_MESSAGE_MS; only mounted for rows that
                opted into `tapToCopy`. */}
            {tapToCopy && (
                <CpcdPopup
                    open={!!copyMessage}
                    anchorEl={rootEl}
                    className="cpcd-row__copy-toast"
                    text={copyMessage ?? ""}
                />
            )}
        </Box>
    );
};

export default CPCDRow;
