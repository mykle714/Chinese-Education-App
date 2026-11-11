import { getToneColor } from "../utils/toneColors";
import { applyYiBuSandhi } from "../utils/toneSandhi";

/**
 * cpcd LAYOUT — the measurement-free half of the character + pinyin row: the per-size
 * tables, the character/syllable zip, and the pinyin collision solver.
 *
 * Why it is its own module: two renderers lay a cpcd row out and must agree to the pixel.
 *   - `CPCDRow` (HTML) — the browser lays the cells out; CPCDRow measures each pinyin
 *     with a DOM Range and feeds the widths to `solvePinyinShift`.
 *   - `MiniCardSvg` (SVG) — no layout engine, so it places the cells itself from these
 *     tables, measures each pinyin with canvas (`src/utils/canvasText.ts`) and feeds the
 *     SAME solver. It exists because WebKit mis-paints positioned HTML inside a
 *     transformed `<foreignObject>` (the acp's iso deck faces, SortBins → DeckFace).
 * A change to a table or to the solver here reaches both at once; that is the point.
 *
 * Layer: presentation-only pure functions (src/components); no React, no DOM except
 * `fontPx`'s root-font read.
 *
 * Referenced by docs/CPCD_PINYIN_SHIFT.md (the solver), docs/ISO_ART_FRAMEWORK.md and
 * docs/SORT_CARDS_REQUIREMENTS.md § 5.3 (the SVG deck face), docs/WORD_SEARCH_GAME.md §3
 * (`cpcdNaturalSize`).
 */

export type CPCDSize = "xs" | "sm" | "smd" | "md" | "lg" | "xl";

// Per-size visual constants. Mirror the table that used to live in
// CharacterPinyinColorDisplay. Lived in CPCDRow until 2026-11-10; moved here so the
// SVG mini card face (MiniCardSvg) lays its cpcd row out on the SAME numbers.
// "xs" is sized to sit inline within 14px body prose (e.g. Chinese embedded in a long
// definition): glyph just above body size, with a compact pinyin row beneath.
// "smd" sits between sm and md, for a board tile too large for sm and too small for md:
// Word Search's 5-column compact board, whose tiles it sizes to 70px with big pinyin on.
export const COLUMN_WIDTH: Record<CPCDSize, number> = { xs: 22, sm: 32, smd: 40, md: 50, lg: 54, xl: 72 };
// Vertical space reserved below each char cell's glyph for the pinyin row.
// Sized to fit the pinyin font's line-box at each size (font-size × 1.21).
export const PINYIN_RESERVED_HEIGHT: Record<CPCDSize, number> = { xs: 13, sm: 18, smd: 22, md: 22, lg: 24, xl: 30 };
export const CHAR_FONT_SIZE: Record<CPCDSize, string> = { xs: "18px", sm: "26px", smd: "32px", md: "2.25rem", lg: "2.4rem", xl: "3.2rem" };
export const PINYIN_FONT_SIZE: Record<CPCDSize, string> = { xs: "10px", sm: "13px", smd: "16px", md: "1rem", lg: "1.05rem", xl: "1.3rem" };
export const COMPACT_CHAR_FONT: Record<CPCDSize, string> = { xs: "16px", sm: "22px", smd: "28px", md: "1.875rem", lg: "2.25rem", xl: "2.8rem" };
export const COMPACT_PINYIN_FONT: Record<CPCDSize, string> = { xs: "9px", sm: "11px", smd: "14px", md: "0.875rem", lg: "1rem", xl: "1.15rem" };
export const VERTICAL_PADDING: Record<CPCDSize, string> = { xs: "2px", sm: "4px", smd: "5px", md: "8px", lg: "8px", xl: "10px" };
// How far the glyph is painted below its line box, tightening the glyph-to-pinyin gap. A
// paint offset (position: relative), NOT padding: positionPinyins() hangs the pinyin off
// the cell's height, so padding would push the pinyin down by the same amount and grow the
// cell. This moves the glyph alone; cell size and cpcdNaturalSize are unchanged.
export const GLYPH_DROP_PX: Record<CPCDSize, number> = { xs: 0, sm: 0, smd: 3, md: 3, lg: 0, xl: 0 };
// Negative left-margin per child to overlap cells, preserving the prior visual density.
export const OVERLAP_BY_SIZE: Record<CPCDSize, number> = { xs: -4, sm: -6, smd: -5, md: -4, lg: -2, xl: -2 };
// Minimum breathing space (unscaled px) kept between adjacent pinyin texts when
// de-overlapping. Only applied to pairs that actually collide, so non-colliding
// rows are never disturbed.
export const PINYIN_MIN_GAP_PX = 2;
// Multiplier applied to BOTH the pinyin font size and the reserved pinyin band
// when `bigPinyin` is on. Expressed as one scale factor rather than a second
// per-size font table so it composes with every CPCDSize *and* with `compact`
// automatically: the font tables mix px and rem units, so the font is scaled via
// CSS `calc()` (valid for both) and the reserved height — always a plain px
// number — by ordinary arithmetic. 1.2 puts `sm` pinyin at ~15.6px against its
// 26px glyph: a readability bump that still reads as secondary to the character.
export const BIG_PINYIN_SCALE = 1.2;
// Line-height applied to BOTH the character glyph and the pinyin text. A shared
// constant rather than two literals because `cpcdNaturalSize` (below) has to
// reproduce the glyph's line box exactly — a cell measured with a different
// factor than it renders with is the kind of drift that only shows up as a
// clipped board on one browser.
export const CHAR_LINE_HEIGHT = 1.21;
// Every char cell carries a 1px border (transparent unless the cell is selected), inside
// its border-box width — so the cell is 2px taller than cpcdNaturalSize's stack, and its
// glyph and pinyin sit 1px further down. MiniCardSvg places cells on this.
export const CELL_BORDER_PX = 1;

/**
 * Convert one of the font tables above to px. The tables mix `px` and `rem`
 * (a historical split — the small sizes were authored in px, the large ones in
 * rem), so anything that has to do ARITHMETIC on them has to normalize first.
 * `rem` is resolved against the document root font size at call time, falling
 * back to the CSS initial 16px when there is no document (tests, SSR).
 */
export function fontPx(value: string): number {
    const n = parseFloat(value);
    if (Number.isNaN(n)) return 0;
    if (!value.trim().endsWith("rem")) return n;
    const root =
        typeof document !== "undefined"
            ? parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
            : 16;
    return n * root;
}

export interface CpcdNaturalSizeOptions {
    /** Characters in the cell being measured. A cell is `charCount` columns wide. */
    charCount?: number;
    /** Mirrors CPCDRow's `compact` — picks the compact font tables. */
    compact?: boolean;
    /** Mirrors CPCDRow's `bigPinyin` — scales the reserved pinyin band. */
    bigPinyin?: boolean;
    /**
     * Whether the cell reserves vertical space for the pinyin row. CPCDRow
     * reserves it whenever the item HAS a syllable, even when the syllable is
     * hidden (so toggling pinyin doesn't shift surrounding layout) — so a caller
     * rendering pronounced text should pass true even for `showPinyin={false}`.
     */
    reservePinyin?: boolean;
}

/**
 * The natural (untransformed) px box ONE cpcd character cell occupies, derived
 * from the same per-size tables the component renders with.
 *
 * WHY THIS IS EXPORTED — a cpcd cell is WIDER-THAN-TALL nowhere and TALLER-THAN-
 * WIDE always (a 32px `sm` column carrying a ~57px glyph+pinyin stack), so a
 * caller that wants a SQUARE tile around one cannot get there with
 * `aspect-ratio: 1`: that asks the browser to reconcile a width derived from
 * content-width with a height derived from content-height, and browsers disagree
 * about which one wins inside a `1fr` grid track. Word Search shipped exactly
 * that and its board painted 59.5px tracks inside a box laid out at ~32px per
 * column on Safari — the grid overflowed its panel to the right and the
 * fit-scaler, measuring the box rather than the tracks, saw nothing wrong.
 * Callers that need a square (or otherwise explicit) cpcd cell should size the
 * track from this and let the cell stretch into it.
 *
 * Used by: src/games/word-search/boardMetrics.ts (square board tiles).
 * Docs: docs/WORD_SEARCH_GAME.md §3.
 */
export function cpcdNaturalSize(
    size: CPCDSize,
    { charCount = 1, compact = false, bigPinyin = false, reservePinyin = true }: CpcdNaturalSizeOptions = {}
): { width: number; height: number } {
    const charFont = fontPx(compact ? COMPACT_CHAR_FONT[size] : CHAR_FONT_SIZE[size]);
    const band = reservePinyin
        ? bigPinyin
            ? Math.round(PINYIN_RESERVED_HEIGHT[size] * BIG_PINYIN_SCALE)
            : PINYIN_RESERVED_HEIGHT[size]
        : 0;
    return {
        width: Math.max(1, charCount) * COLUMN_WIDTH[size],
        // Same stack the char cell renders: padding-top, the glyph's line box,
        // then the reserved pinyin band as padding-bottom.
        height: fontPx(VERTICAL_PADDING[size]) + Math.round(charFont * CHAR_LINE_HEIGHT) + band,
    };
}

// A separator apostrophe is drawn between two adjacent SAME-TONE syllables only
// when the collision solver actually had to PUSH that pair apart — i.e. their
// pinyin texts were touching and got relaxed to the bare PINYIN_MIN_GAP_PX
// minimum. That "was pushed" flag is the exact crowding signal: when same-colored
// syllables sit right against each other their shared tone color stops signalling
// the syllable boundary (the run reads as one long blob), so a text-colored
// apostrophe — the standard pinyin syllable divider, as in Xi'an — restores the
// break. Pairs the solver left alone (any comfortable natural gap) get none.
// Drawn on top of the overlay near the top of the pinyin text; consumes no layout
// space. See docs/CPCD_PINYIN_SHIFT.md.

// ── Character / syllable zip ────────────────────────────────────────────────────────

/** One character cell of a cpcd row, before any interaction props (CPCDRowItem extends it). */
export interface CpcdCharItem {
    character: string;
    pinyin?: string;
    showPinyin?: boolean;
    useToneColor?: boolean;
    /** Draw a "?" in place of the glyph (ForeignText's `maskChar`). */
    masked?: boolean;
}

/**
 * Build one cpcd item per character, zipping each character with its pronunciation
 * syllable (yī/bù tone sandhi applied when `sandhi`). `showPinyin`/`useToneColor` apply
 * uniformly; a renderer still hides the pinyin of any character whose syllable is empty.
 * Used by ForeignText (→ CPCDRow / CPCDBlock / CPCDInline) and MiniCardSvg.
 */
export function buildCharItems(
    text: string,
    pronunciation: string | null | undefined,
    showPinyin: boolean,
    useToneColor: boolean,
    sandhi: boolean,
    maskChar?: string,
): CpcdCharItem[] {
    const raw = pronunciation ? pronunciation.trim().split(/\s+/) : [];
    const syllables = sandhi ? applyYiBuSandhi(text, raw) : raw;
    return [...text].map((character, i) => ({
        character,
        pinyin: syllables[i] ?? "",
        showPinyin,
        useToneColor,
        ...(maskChar && character === maskChar ? { masked: true } : {}),
    }));
}

// ── Pinyin collision solver (docs/CPCD_PINYIN_SHIFT.md) ───────────────────────────────

/** One syllable of a VISUAL row (de-overlap is row-local), in unscaled px. */
export interface PinyinExtent {
    /** The x of its character cell's centre (cell left + boxWidth / 2). */
    center: number;
    /** The cell's width: charCount × COLUMN_WIDTH. The pinyin box is this wide. */
    boxWidth: number;
    /** The pinyin's rendered advance width (0 for no syllable). */
    textWidth: number;
}

export interface PinyinShiftSolution {
    /** Per syllable: how far its pinyin box moves right (negative = left) of its cell. */
    offsets: number[];
    /** Per syllable: how far its TEXT reaches left / right of the cell centre. */
    halfLefts: number[];
    halfRights: number[];
    /** Per adjacent pair (k, k+1): true once the solver pushed them apart. */
    pushed: boolean[];
}

/**
 * Solve one visual row's pinyin offsets.
 *
 * Text extent: the pinyin box is the cell's width with `text-align: center`, and
 * text-align only centres content that FITS — an overflowing syllable is anchored at the
 * box's left edge and spills right (LTR). So a wide syllable reaches boxWidth/2 to its
 * left but (textWidth − boxWidth/2) to its right. Modelling this is what keeps a wide
 * syllable's narrow neighbour from being over-pushed. (MiniCardSvg reproduces the
 * left-anchoring when it draws an overflowing syllable.)
 *
 * Offsets: each pinyin starts on its own character (offset 0). When two collide the
 * required separation is ALWAYS split evenly — both syllables give ground equally. Even
 * splitting lets a crowded cluster spread symmetrically: a narrow syllable sandwiched
 * between two wide ones (夫 fu between 丈 zhàng and 上 shàng) stays centred on its own
 * char while the two wide neighbours drift apart. (An earlier variant let a wide syllable
 * "anchor" and dump the whole push on the narrow neighbour; that made such sandwiches
 * infeasible and shoved the narrow pinyin INTO a neighbour.) Solved by relaxation:
 * repeatedly push apart any overlapping pair by half the deficit until stable; capped
 * passes, converges quickly for the short runs cpcd renders.
 *
 * A lone syllable has no neighbour to de-overlap against, so an overflowing one is just
 * re-centred over its glyph (pulled left by half its overflow; a no-op when it fits).
 * `enabled = false` (CPCDRow's `pinyinShift={false}`) leaves every offset at 0.
 */
export function solvePinyinShift(row: readonly PinyinExtent[], enabled = true): PinyinShiftSolution {
    const n = row.length;
    const halfLefts: number[] = [];
    const halfRights: number[] = [];
    for (const { boxWidth, textWidth } of row) {
        const overflow = textWidth > boxWidth;
        halfLefts.push(overflow ? boxWidth / 2 : textWidth / 2);
        halfRights.push(overflow ? textWidth - boxWidth / 2 : textWidth / 2);
    }
    const offsets = new Array<number>(n).fill(0);
    const pushed = new Array<boolean>(Math.max(0, n - 1)).fill(false);
    if (enabled && n === 1) {
        offsets[0] = -(halfRights[0] - halfLefts[0]) / 2;
    } else if (enabled && n > 1) {
        const maxPasses = Math.max(4, n);
        for (let pass = 0; pass < maxPasses; pass++) {
            let moved = false;
            for (let i = 0; i < n - 1; i++) {
                // Required centre spacing = left syllable's right reach + right
                // syllable's left reach + gap.
                const minSpacing = halfRights[i] + halfLefts[i + 1] + PINYIN_MIN_GAP_PX;
                const actualSpacing = row[i + 1].center + offsets[i + 1] - (row[i].center + offsets[i]);
                const deficit = minSpacing - actualSpacing;
                if (deficit <= 0.01) continue;
                // Split the push evenly: left yields left, right yields right.
                offsets[i] -= deficit / 2;
                offsets[i + 1] += deficit / 2;
                pushed[i] = true;
                moved = true;
            }
            if (!moved) break;
        }
    }
    return { offsets, halfLefts, halfRights, pushed };
}

/**
 * The separator apostrophes one solved row draws: one per adjacent pair that the solver
 * PUSHED, whose two syllables both show and share a tone colour. `gap` is the LEFT
 * syllable's index within the row; `midX` the centre of the (post-shift) gap between the
 * two pinyin texts, where the apostrophe is centred.
 */
export function pinyinSeparators(
    row: readonly PinyinExtent[],
    items: readonly CpcdCharItem[],
    solution: PinyinShiftSolution,
): { gap: number; midX: number }[] {
    const out: { gap: number; midX: number }[] = [];
    const { offsets, halfLefts, halfRights, pushed } = solution;
    for (let k = 0; k < row.length - 1; k++) {
        if (!pushed[k]) continue;
        const left = items[k];
        const right = items[k + 1];
        if (!syllableShown(left) || !syllableShown(right)) continue;
        if (getToneColor(left.pinyin!) !== getToneColor(right.pinyin!)) continue;
        // Edges of the two pinyin texts after shifting (see the extent model above).
        const rightEdgeLeft = row[k].center + offsets[k] + halfRights[k];
        const leftEdgeRight = row[k + 1].center + offsets[k + 1] - halfLefts[k + 1];
        out.push({ gap: k, midX: (rightEdgeLeft + leftEdgeRight) / 2 });
    }
    return out;
}

/** Whether an item's pinyin is drawn (it has a syllable and isn't hidden). */
export function syllableShown(item: CpcdCharItem): boolean {
    return item.showPinyin !== false && !!item.pinyin;
}
