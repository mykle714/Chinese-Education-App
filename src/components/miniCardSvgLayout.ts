import type { Language } from "../types";
import { FONTS } from "../theme/fonts";
import { WEIGHT } from "../theme/scale";
import { getToneColor } from "../utils/toneColors";
import { splitClassifierLabel } from "../utils/definitionUtils";
import {
    baselineInLineBox,
    fontLineMetrics,
    measureAdvance,
    type FontSpec,
    type LineMetrics,
} from "../utils/canvasText";
import {
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
    buildCharItems,
    fontPx,
    pinyinSeparators,
    solvePinyinShift,
    syllableShown,
    type CpcdCharItem,
    type PinyinExtent,
} from "./cpcdLayout";
import {
    DEFINITION_DESCENDER_ROOM,
    DEFINITION_LINE_HEIGHT,
    DEFINITION_MAX_LINES,
    MINI_CARD_CONTENT_LAYOUT,
    MINI_CARD_DIMENSIONS,
    MINI_CARD_RADIUS,
    miniCardDefinitionBottom,
    type MiniCardSize,
} from "./miniCardFace";
import { isLatinScriptLang } from "./ForeignText";

/**
 * miniCardSvgLayout — places MiniCard's contents by hand, in the card's own px space
 * (0,0 = its top-left, 92 × 132 for `regular`), for MiniCardSvg to draw as native SVG.
 *
 * WHY: SVG has no layout engine, so everything the browser does for the HTML MiniCard —
 * centring the cpcd row in a flex box, wrapping its inline-block cells, the pinyin
 * collision shift, wrapping and clamping the gloss to two lines with an ellipsis, putting
 * each line's baseline where CSS's half-leading puts it — is redone here from the SAME
 * numbers the HTML reads:
 *   - miniCardFace → MINI_CARD_DIMENSIONS, MINI_CARD_RADIUS, MINI_CARD_CONTENT_LAYOUT,
 *     miniCardDefinitionBottom, DEFINITION_* (the numbers MiniCard itself renders with);
 *   - cpcdLayout → the cpcd size tables, buildCharItems (with tone sandhi) and the
 *     pinyin solver CPCDRow itself runs.
 * Text is measured with canvas (`src/utils/canvasText.ts`), the metrics CSS lays out with.
 *
 * Scope = what MiniCard draws WITHOUT a mastery strip, icon layer or overlay children —
 * the acp deck face's needs. Spanish (plain-text headword) is laid out but unverified:
 * Spanish is paused (CLAUDE.md), see docs/DEFERRED_WORK.md.
 *
 * Known approximations (sub-pixel at the deck's size, documented so nobody chases them):
 *   - gloss line breaks are taken after spaces and hyphens only; CSS's UAX #14 breaker
 *     knows more opportunities (e.g. after "/"), so a rare gloss may break one word apart;
 *   - the two-line clamp truncates line 2 by characters to fit "…", as Chrome and WebKit
 *     do, but which glyph is the last to survive can differ by one.
 *
 * Layer: presentation, pure (src/components). Depended on by MiniCardSvg.tsx; covered by
 * src/__tests__/miniCardSvgLayout.test.ts. Docs: docs/ISO_ART_FRAMEWORK.md (intro),
 * docs/SORT_CARDS_REQUIREMENTS.md § 5.3 ("the deck"), docs/CARD_LIBRARY.md.
 */

export interface MiniCardSvgInput {
    language?: Language;
    entryKey: string;
    pronunciation?: string | null;
    /** The display definition, already cleaned by the caller (as MiniCard's `definition`). */
    definition: string;
    iconId?: string | null;
    size?: MiniCardSize;
}

/** A run of gloss text; `italic` = the classifier sense's "classifier for" label (GlossText). */
export interface GlossRun {
    text: string;
    italic: boolean;
}

export interface MiniCardSvgLayout {
    width: number;
    height: number;
    radius: number;
    /** The fixed icon slot's image box (drawn only when the card has an icon). */
    iconBox: { x: number; y: number; size: number };
    /** zh: one glyph per character, centred on `x`, baseline `y`. */
    glyphs: { x: number; y: number; text: string }[];
    glyphFont: FontSpec;
    /**
     * zh: one per SHOWN syllable. `anchor: "middle"` centres a fitting syllable on its
     * (shifted) box; an overflowing one is `"start"`-anchored at the box's left edge,
     * the spill CPCDRow's text-align produces and its solver models.
     */
    pinyins: { x: number; y: number; text: string; anchor: "middle" | "start"; color: string }[];
    pinyinFont: FontSpec;
    /** zh: the separator apostrophes between crowded same-tone syllables (centred on x). */
    separators: { x: number; y: number }[];
    separatorFont: FontSpec;
    /** es: the plain headword's lines, start-anchored at x. */
    plainLines: { x: number; y: number; text: string }[];
    plainFont: FontSpec;
    /** The gloss: its clamped lines, each centred on `centerX` at baseline `y`. */
    definitionLines: { y: number; runs: GlossRun[] }[];
    definitionCenterX: number;
    definitionFont: FontSpec;
    /** The gloss box's clip (MiniCard's `overflow: hidden` padding box). */
    definitionClip: { x: number; y: number; width: number; height: number };
}

/** Injectable for tests; defaults to canvas. */
export interface TextMeasurer {
    advance: (text: string, font: FontSpec) => number;
    metrics: (font: FontSpec) => LineMetrics;
}
const CANVAS_MEASURER: TextMeasurer = { advance: measureAdvance, metrics: fontLineMetrics };

/** The cpcd size every mini card sets its word at (MiniCard → ForeignText `size="xs"`). */
const WORD_SIZE = "xs" as const;
/** Line height of ForeignText's plain (Latin-script) headword. */
const PLAIN_LINE_HEIGHT = 1.21;
const ELLIPSIS = "…";

export function layoutMiniCardSvg(input: MiniCardSvgInput, measure: TextMeasurer = CANVAS_MEASURER): MiniCardSvgLayout {
    const size = input.size ?? "regular";
    const { width, height } = MINI_CARD_DIMENSIONS[size];
    const content = MINI_CARD_CONTENT_LAYOUT[size];
    const bodyWidth = width - 2 * content.sideInset;

    const glyphFont: FontSpec = {
        family: FONTS.cjk,
        sizePx: fontPx(content.cpcdCompact ? COMPACT_CHAR_FONT[WORD_SIZE] : CHAR_FONT_SIZE[WORD_SIZE]),
        weight: WEIGHT.bold,
    };
    const pinyinFont: FontSpec = {
        family: FONTS.cjk,
        sizePx: fontPx(content.cpcdCompact ? COMPACT_PINYIN_FONT[WORD_SIZE] : PINYIN_FONT_SIZE[WORD_SIZE]),
        weight: WEIGHT.regular,
        stretch: "condensed",
    };
    // The apostrophe span pins no stretch (CPCDRow → `.cpcd-row__pinyin-sep`).
    const separatorFont: FontSpec = { ...pinyinFont, stretch: undefined };
    const plainFont: FontSpec = { family: FONTS.cjk, sizePx: fontPx(content.plainFontSize), weight: WEIGHT.bold };
    const definitionFont: FontSpec = { family: FONTS.cjk, sizePx: fontPx(content.definitionFontSize), weight: WEIGHT.regular };

    const word = isLatinScriptLang(input.language)
        ? { glyphs: [], pinyins: [], separators: [], plainLines: layoutPlainWord(input.entryKey, plainFont, content, bodyWidth, measure) }
        : { ...layoutCpcdWord(input, glyphFont, pinyinFont, separatorFont, content, bodyWidth, measure), plainLines: [] };

    return {
        width,
        height,
        radius: parseFloat(MINI_CARD_RADIUS),
        iconBox: { x: content.sideInset + (bodyWidth - content.iconSize) / 2, y: content.iconTop, size: content.iconSize },
        ...word,
        glyphFont,
        pinyinFont,
        separatorFont,
        plainFont,
        ...layoutDefinition(input.definition, definitionFont, content, width, height, bodyWidth, measure),
        definitionFont,
    };
}

// ── The cpcd word ───────────────────────────────────────────────────────────────────

/**
 * MiniCard's key wrapper is a flex box (`top: keyTop`, `left/right: sideInset`, centred)
 * holding CPCDRow's root, which shrink-wraps its chars block: `paddingLeft: |overlap|`,
 * `text-align: center`, and inline-block cells `cellWidth` wide with `margin-left:
 * overlap` (negative), so each cell's margin box is `cellWidth + overlap` and its border
 * box starts `|overlap|` before its margin box. Cells wrap between one another when the
 * row would pass the body width; each line is centred in the space after the padding.
 */
function layoutCpcdWord(
    input: MiniCardSvgInput,
    glyphFont: FontSpec,
    pinyinFont: FontSpec,
    separatorFont: FontSpec,
    content: (typeof MINI_CARD_CONTENT_LAYOUT)[MiniCardSize],
    bodyWidth: number,
    measure: TextMeasurer,
) {
    const items = buildCharItems(input.entryKey, input.pronunciation, true, true, true);
    const columnWidth = COLUMN_WIDTH[WORD_SIZE];
    const overlap = OVERLAP_BY_SIZE[WORD_SIZE];
    const pad = Math.abs(overlap);
    const band = PINYIN_RESERVED_HEIGHT[WORD_SIZE];
    const padTop = fontPx(VERTICAL_PADDING[WORD_SIZE]);
    const glyphLine = glyphFont.sizePx * CHAR_LINE_HEIGHT;
    const pinyinLine = pinyinFont.sizePx * CHAR_LINE_HEIGHT;
    const glyphBaseline = baselineInLineBox(glyphLine, measure.metrics(glyphFont)) + GLYPH_DROP_PX[WORD_SIZE];
    const pinyinBaseline = baselineInLineBox(pinyinLine, measure.metrics(pinyinFont));
    // The apostrophe's span sets `line-height: 1`.
    const separatorBaseline = baselineInLineBox(separatorFont.sizePx, measure.metrics(separatorFont));

    const cellWidthOf = (item: CpcdCharItem) => Math.max(1, [...item.character].length) * columnWidth;
    // A cell reserves the pinyin band whenever it HAS a syllable (shown or not).
    const cellHeightOf = (item: CpcdCharItem) => 2 * CELL_BORDER_PX + padTop + glyphLine + (item.pinyin ? band : 0);

    // Root width: the chars block's max-content, capped by the body (then it wraps).
    const marginBoxes = items.map((item) => cellWidthOf(item) + overlap);
    const rootWidth = Math.min(bodyWidth, pad + marginBoxes.reduce((a, b) => a + b, 0));
    const rootLeft = content.sideInset + (bodyWidth - rootWidth) / 2;
    const lineRoom = rootWidth - pad;

    // Greedy line fill — at least one cell per line.
    const lines: number[][] = [];
    let current: number[] = [];
    let used = 0;
    items.forEach((_, i) => {
        if (current.length > 0 && used + marginBoxes[i] > lineRoom + 0.01) {
            lines.push(current);
            current = [];
            used = 0;
        }
        current.push(i);
        used += marginBoxes[i];
    });
    if (current.length > 0) lines.push(current);

    const glyphs: MiniCardSvgLayout["glyphs"] = [];
    const pinyins: MiniCardSvgLayout["pinyins"] = [];
    const separators: MiniCardSvgLayout["separators"] = [];
    let lineTop = content.keyTop;
    for (const line of lines) {
        const lineWidth = line.reduce((sum, i) => sum + marginBoxes[i], 0);
        // An overflowing line (one cell wider than the body) start-aligns, as CSS does.
        let marginLeftEdge = rootLeft + pad + Math.max(0, (lineRoom - lineWidth) / 2);
        const cells = line.map((i) => {
            const left = marginLeftEdge + overlap;
            marginLeftEdge += marginBoxes[i];
            return { item: items[i], left, width: cellWidthOf(items[i]), height: cellHeightOf(items[i]) };
        });

        // The row's pinyin goes through the same solver CPCDRow runs (row-local).
        const extents: PinyinExtent[] = cells.map((c) => ({
            center: c.left + c.width / 2,
            boxWidth: c.width,
            textWidth: measure.advance(c.item.pinyin ?? "", pinyinFont),
        }));
        const solution = solvePinyinShift(extents);

        cells.forEach((c, k) => {
            glyphs.push({ x: c.left + c.width / 2, y: lineTop + CELL_BORDER_PX + padTop + glyphBaseline, text: c.item.character });
            if (!syllableShown(c.item)) return;
            // The pinyin hangs off the cell's bottom: its top is cell height − band.
            const pinyinTop = lineTop + c.height - band;
            const boxLeft = c.left + solution.offsets[k];
            const fits = extents[k].textWidth <= c.width;
            pinyins.push({
                x: fits ? boxLeft + c.width / 2 : boxLeft,
                y: pinyinTop + pinyinBaseline,
                text: c.item.pinyin!,
                anchor: fits ? "middle" : "start",
                color: getToneColor(c.item.pinyin!),
            });
        });
        for (const { gap, midX } of pinyinSeparators(extents, cells.map((c) => c.item), solution)) {
            separators.push({ x: midX, y: lineTop + cells[gap].height - band + separatorBaseline });
        }
        // Cells are `vertical-align: top`; the line is as tall as its tallest cell.
        lineTop += Math.max(...cells.map((c) => c.height));
    }
    return { glyphs, pinyins, separators };
}

// ── The plain (Latin-script) word — es, unverified while Spanish is paused ────────────

/**
 * ForeignText's Latin path: one span in a centred flex box, `line-height: 1.21`. The span
 * shrink-wraps a one-line word (centred); a word that wraps fills the body and its lines
 * start-align inside it.
 */
function layoutPlainWord(
    text: string,
    font: FontSpec,
    content: (typeof MINI_CARD_CONTENT_LAYOUT)[MiniCardSize],
    bodyWidth: number,
    measure: TextMeasurer,
): MiniCardSvgLayout["plainLines"] {
    const lineHeight = font.sizePx * PLAIN_LINE_HEIGHT;
    const baseline = baselineInLineBox(lineHeight, measure.metrics(font));
    const lines = wrapRuns([{ text: normalizeSpace(text), italic: false }], font, bodyWidth, measure);
    const spanWidth = lines.length > 1 ? bodyWidth : Math.min(bodyWidth, runsWidth(lines[0] ?? [], font, measure));
    const x = content.sideInset + (bodyWidth - spanWidth) / 2;
    return lines.map((runs, i) => ({ x, y: content.keyTop + i * lineHeight + baseline, text: runs.map((r) => r.text).join("") }));
}

// ── The gloss ───────────────────────────────────────────────────────────────────────

/**
 * MiniCard's definition Typography: absolute, `bottom: definitionBottom − ROOM`,
 * `paddingBottom: ROOM`, `minHeight` (border-box — CssBaseline), lines `lineHeight` ×
 * font tall and clamped to DEFINITION_MAX_LINES with an ellipsis, centred. It grows
 * UPWARD from its bottom; a box shorter than its min height keeps its text at the top.
 */
function layoutDefinition(
    definition: string,
    font: FontSpec,
    content: (typeof MINI_CARD_CONTENT_LAYOUT)[MiniCardSize],
    width: number,
    height: number,
    bodyWidth: number,
    measure: TextMeasurer,
): Pick<MiniCardSvgLayout, "definitionLines" | "definitionCenterX" | "definitionClip"> {
    const text = normalizeSpace(definition);
    // GlossText is given no `pos` by MiniCard, so any "classifier for …" gloss italicises its label.
    const { label, rest } = splitClassifierLabel(text);
    const runs: GlossRun[] = label ? [{ text: label, italic: true }, { text: rest, italic: false }] : [{ text, italic: false }];
    const lines = clampLines(wrapRuns(runs, font, bodyWidth, measure), font, bodyWidth, measure);

    const lineHeight = font.sizePx * DEFINITION_LINE_HEIGHT;
    const baseline = baselineInLineBox(lineHeight, measure.metrics(font));
    const contentBottom = height - (miniCardDefinitionBottom(false) - DEFINITION_DESCENDER_ROOM) - DEFINITION_DESCENDER_ROOM;
    const contentHeight = Math.max(lines.length * lineHeight, content.definitionMinHeight - DEFINITION_DESCENDER_ROOM);
    const contentTop = contentBottom - contentHeight;
    return {
        definitionLines: lines.map((line, i) => ({ y: contentTop + i * lineHeight + baseline, runs: line })),
        definitionCenterX: width / 2,
        definitionClip: { x: content.sideInset, y: contentTop, width: bodyWidth, height: contentHeight + DEFINITION_DESCENDER_ROOM },
    };
}

/** CSS `white-space: normal`: whitespace runs collapse to one space, ends trimmed. */
function normalizeSpace(text: string): string {
    return text.replace(/\s+/g, " ").trim();
}

/** Total advance of a line of runs (each run measured in its own style). */
function runsWidth(runs: readonly GlossRun[], font: FontSpec, measure: TextMeasurer): number {
    return runs.reduce((sum, r) => sum + measure.advance(r.text, { ...font, italic: r.italic }), 0);
}

/** Drop trailing spaces from a line (CSS hangs/removes them at a soft wrap). */
function trimEndRuns(runs: readonly GlossRun[]): GlossRun[] {
    const out = runs.map((r) => ({ ...r }));
    while (out.length > 0) {
        const last = out[out.length - 1];
        last.text = last.text.replace(/\s+$/, "");
        if (last.text) break;
        out.pop();
    }
    return out;
}

/** Concatenate runs, merging neighbours of the same style. */
function appendRuns(into: GlossRun[], add: readonly GlossRun[]): GlossRun[] {
    const out = into.map((r) => ({ ...r }));
    for (const r of add) {
        if (!r.text) continue;
        const last = out[out.length - 1];
        if (last && last.italic === r.italic) last.text += r.text;
        else out.push({ ...r });
    }
    return out;
}

/**
 * Split runs into wrap tokens: each ends just after a break opportunity — a space run, or
 * a hyphen followed by a non-space. A token keeps its trailing space (trimmed at a wrap).
 */
function tokenize(runs: readonly GlossRun[]): GlossRun[][] {
    const chars: { ch: string; italic: boolean }[] = [];
    for (const r of runs) for (const ch of r.text) chars.push({ ch, italic: r.italic });
    const tokens: GlossRun[][] = [];
    let token: GlossRun[] = [];
    chars.forEach(({ ch, italic }, i) => {
        token = appendRuns(token, [{ text: ch, italic }]);
        const next = chars[i + 1]?.ch;
        const breakAfter = next !== undefined && ((ch === " " && next !== " ") || (ch === "-" && next !== " "));
        if (breakAfter) {
            tokens.push(token);
            token = [];
        }
    });
    if (token.length > 0) tokens.push(token);
    return tokens;
}

/** Greedy wrap into lines no wider than `maxWidth` (a lone overlong token overflows, as in CSS). */
function wrapRuns(runs: readonly GlossRun[], font: FontSpec, maxWidth: number, measure: TextMeasurer): GlossRun[][] {
    const lines: GlossRun[][] = [];
    let line: GlossRun[] = [];
    for (const token of tokenize(runs)) {
        const candidate = appendRuns(line, token);
        if (line.length > 0 && runsWidth(trimEndRuns(candidate), font, measure) > maxWidth + 0.01) {
            lines.push(trimEndRuns(line));
            line = token.map((r) => ({ ...r }));
        } else {
            line = candidate;
        }
    }
    const last = trimEndRuns(line);
    if (last.length > 0) lines.push(last);
    return lines;
}

/**
 * `-webkit-line-clamp`: keep the first DEFINITION_MAX_LINES lines; when text was cut, the
 * last kept line ends in "…", dropping characters from its end until line + "…" fits.
 * The ellipsis takes the box's upright style.
 */
function clampLines(lines: GlossRun[][], font: FontSpec, maxWidth: number, measure: TextMeasurer): GlossRun[][] {
    if (lines.length <= DEFINITION_MAX_LINES) return lines;
    const kept = lines.slice(0, DEFINITION_MAX_LINES);
    let last = kept[kept.length - 1];
    const ellipsis: GlossRun = { text: ELLIPSIS, italic: false };
    while (last.length > 0 && runsWidth(appendRuns(last, [ellipsis]), font, measure) > maxWidth + 0.01) {
        const tail = last[last.length - 1];
        const chars = [...tail.text];
        chars.pop();
        last = chars.length > 0 ? [...last.slice(0, -1), { ...tail, text: chars.join("") }] : last.slice(0, -1);
        last = trimEndRuns(last);
    }
    kept[kept.length - 1] = appendRuns(last, [ellipsis]);
    return kept;
}
