import { memo, useEffect, useMemo, useRef } from "react";
import { Box } from "@mui/material";
import ForeignText, { type CPCDRowGroup, type CPCDRowItem } from "../../components/ForeignText";
import { cpcdNaturalSize } from "../../components/cpcdLayout";
import { applyYiBuSandhi } from "../../utils/toneSandhi";
import type { Language } from "../../types";
import type { SegmentSpan } from "./documentSegmentation";

/**
 * READER CPCD VIEW — the Reader's **Pinyin** display mode (useReaderSettings →
 * `displayMode: 'pinyin'`, toggled by the pill under the dictionary keycap).
 *
 * Draws the document as cpcd (character, pinyin under it): ONE cpcd row per
 * newline-delimited paragraph, punctuation and Latin words included as pinyin-less cells,
 * so characters sit evenly spaced and the pinyin collision solver works across words.
 * Each gsa word is an unbreakable group inside the row, so lines wrap BETWEEN words and
 * never split one (see "Document → paragraph rows" below).
 *
 * ── Why it owns no selection logic ──────────────────────────────────────────────
 * A cpcd paragraph cannot be a `<textarea>`, so it has no native caret or
 * `::selection`. Rather than fork the Reader's navigation, the real reading textarea
 * stays mounted underneath — invisible, still focused — and remains the ONE
 * selection model: ReaderTapOverlay's zone taps, the arrow keys, auto word-select and
 * the keycap lookup all keep driving it unchanged (TextArea.tsx). This view is only a
 * HIGHLIGHT RENDERER: it maps the textarea's recorded range (useTextSelection →
 * `selectionRange`) onto the span that starts and ends there, paints that word, and
 * keeps it scrolled into view. Switching modes therefore keeps the reader's place.
 *
 * Layer: feature presentational component (src/features/reader). Depends on the shared
 * cpcd container (ForeignText `items` + `groups` → CPCDRow), the cpcd size tables
 * (components/cpcdLayout.ts) and the 一/不 sandhi pass (utils/toneSandhi.ts).
 * Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Display modes"; docs/READER_SEGMENTATION.md.
 */

// The cpcd size every word renders at. `sm` (26px glyph) is the closest step to the
// text mode's reading size (owner's call 2026-11-17), so a mode switch doesn't jump scale.
const WORD_SIZE = "sm" as const;

// One cpcd line's height: padding-top + the glyph's line box + the reserved pinyin band.
// Every line of the paragraph is pinned to it — including blank lines from `\n\n` and
// lines with no word on them — so the paragraph keeps one rhythm (the longdef display
// does the same with its 31px xs lines).
const LINE_PX = cpcdNaturalSize(WORD_SIZE).height;

// The highlight's bleed past the word's box: drawn as a box-shadow spread so it costs
// no layout (padding would widen the word and reflow the line on every step).
const HIGHLIGHT_BLEED_PX = 2;

// Breathing room kept between the selected word and the scroll box's top/bottom
// edges — the same "one line" the text mode keeps (textSelectionUtils.ts →
// scrollSelectionIntoView).
const SCROLL_MARGIN_PX = LINE_PX;

// ── Document → paragraph rows ────────────────────────────────────────────────────
//
// ROW PER PARAGRAPH (owner's call 2026-11-17): every newline-delimited paragraph is ONE
// cpcd row (ForeignText `items` → CPCDRow), not one row per word. That buys:
//   - even character spacing straight through word boundaries (no inter-word gap), and
//   - the pinyin collision solver (docs/CPCD_PINYIN_SHIFT.md) running across words and
//     punctuation, so a long syllable pushes its neighbours apart even in the next word;
//   - 一/不 sandhi across word boundaries (我 / 不 / 去), since the whole paragraph's
//     reading goes through `applyYiBuSandhi` at once.
// The row still breaks lines ONLY BETWEEN WORDS: each gsa word is a CPCDRowGroup (an
// unbreakable inline-block that also carries the highlight, `data-span-index` and the
// click), and punctuation / spaces are glued to their neighbour word in an outer group so
// a line never starts with "，" or a space, nor ends with "“".

// Item tags, for gluing non-word items to a neighbour word.
type ItemTag =
    | "word" // part of a gsa word
    | "prev" // closing punctuation / whitespace — sticks to the word BEFORE it
    | "next"; // opening punctuation (quotes, brackets) — sticks to the word AFTER it

interface ReaderParagraph {
    items: CPCDRowItem[];
    // Per gsa word in this paragraph: its span index and its item range [start, end).
    words: Array<{ spanIndex: number; start: number; end: number }>;
    // Word + glued punctuation ranges, only where they differ from the word's own range.
    units: Array<{ start: number; end: number }>;
}

const HAN_REGEX = /\p{Script=Han}/u;
// Marks that open a phrase and so belong to the word after them.
const OPENING_MARKS = new Set([..."“‘（《「『【〈〔［｛([{<"]);
// Stand-in "character" for a non-Han item in the paragraph's sandhi pass: no reading,
// so a 一/不 before it is phrase-final (toneSandhi.ts → applyYiBuSandhi).
const SANDHI_BREAK = "\uFFFC";

/** Slice the document into paragraph rows (see the section comment). */
function buildParagraphs(
    content: string,
    spans: SegmentSpan[],
    pronunciations: Map<string, string>,
    useToneColor: boolean,
): ReaderParagraph[] {
    const paragraphs: ReaderParagraph[] = [];
    let items: CPCDRowItem[] = [];
    let tags: ItemTag[] = [];
    let words: ReaderParagraph["words"] = [];
    // The paragraph's per-item sandhi input, aligned 1:1 with `items`.
    let sandhiChars: string[] = [];
    let sandhiSyllables: string[] = [];

    // A pinyin-less, text-width item (punctuation, spaces, Latin words). It keeps the
    // pinyin band so every line is one cpcd line tall (LINE_PX).
    const pushPlain = (text: string, tag: ItemTag) => {
        items.push({ character: text, autoWidth: true, reservePinyinBand: true });
        tags.push(tag);
        sandhiChars.push(SANDHI_BREAK);
        sandhiSyllables.push("");
    };

    const closeParagraph = () => {
        // One pass over the whole paragraph, so sandhi sees across word boundaries.
        const surface = applyYiBuSandhi(sandhiChars.join(""), sandhiSyllables);
        surface.forEach((syllable, i) => {
            if (syllable) items[i] = { ...items[i], pinyin: syllable };
        });
        // Glue each word's neighbouring punctuation to it (see ItemTag).
        const units: ReaderParagraph["units"] = [];
        for (const word of words) {
            let start = word.start;
            while (start > 0 && tags[start - 1] === "next") start--;
            let end = word.end;
            while (end < items.length && tags[end] === "prev") end++;
            if (start !== word.start || end !== word.end) units.push({ start, end });
        }
        paragraphs.push({ items, words, units });
        items = [];
        tags = [];
        words = [];
        sandhiChars = [];
        sandhiSyllables = [];
    };

    const pushGap = (gap: string) => {
        // Newlines end the paragraph; everything else is a space run or a mark.
        gap.split("\n").forEach((line, lineIndex) => {
            if (lineIndex > 0) closeParagraph();
            for (const piece of line.split(/(\s+)/)) {
                if (!piece) continue;
                if (/^\s+$/.test(piece)) {
                    pushPlain(piece, "prev");
                    continue;
                }
                // One item per mark, so "，“" splits into a closer and an opener.
                for (const mark of piece) pushPlain(mark, OPENING_MARKS.has(mark) ? "next" : "prev");
            }
        });
    };

    let cursor = 0;
    spans.forEach((span, spanIndex) => {
        if (span.start > cursor) pushGap(content.slice(cursor, span.start));
        const start = items.length;
        if (HAN_REGEX.test(span.text)) {
            // A cpcd word: one fixed-column item per character, zipped with its reading.
            const pronunciation = pronunciations.get(span.text);
            const syllables = pronunciation ? pronunciation.trim().split(/\s+/) : [];
            [...span.text].forEach((character, i) => {
                items.push({ character, pinyin: syllables[i] ?? "", showPinyin: true, useToneColor, reservePinyinBand: true });
                tags.push("word");
                sandhiChars.push(character);
                sandhiSyllables.push(syllables[i] ?? "");
            });
        } else {
            // A Latin word / digit run: one text-width item, no reading.
            pushPlain(span.text, "word");
        }
        words.push({ spanIndex, start, end: items.length });
        cursor = span.end;
    });
    if (cursor < content.length) pushGap(content.slice(cursor));
    closeParagraph();
    return paragraphs;
}

// ── One paragraph ────────────────────────────────────────────────────────────────

interface ReaderCpcdParagraphProps {
    paragraph: ReaderParagraph;
    // The selected word's span index when it is in THIS paragraph, else -1 — so a
    // selection step re-renders only the paragraph(s) it leaves and enters.
    selectedSpanIndex: number;
    highlightColor: string;
    language: Language;
    onSelectSpan: (spanIndex: number) => void;
    // The characters' ink (ReaderCpcdView `inkColor`).
    inkColor: string;
}

// Memoised: each cpcd row runs a layout pass of its own on render (CPCDRow →
// positionPinyins), so only the paragraphs a selection step touches may re-render.
const ReaderCpcdParagraph = memo(function ReaderCpcdParagraph({
    paragraph,
    selectedSpanIndex,
    highlightColor,
    language,
    onSelectSpan,
    inkColor,
}: ReaderCpcdParagraphProps) {
    const groups = useMemo<CPCDRowGroup[]>(() => [
        // Word + glued punctuation: unbreakable, otherwise inert.
        ...paragraph.units.map((unit) => ({ ...unit, className: "reader-cpcd-view__unit" })),
        ...paragraph.words.map(({ spanIndex, start, end }) => {
            const selected = spanIndex === selectedSpanIndex;
            return {
                start,
                end,
                className: `reader-cpcd-view__word${selected ? " reader-cpcd-view__word--selected" : ""}`,
                // On desktop (no overlay) a click selects the word, the same as clicking
                // into the textarea places the caret in it. On mobile ReaderTapOverlay
                // covers the view and turns a tap into a zone step, exactly as in the text
                // mode — but its long-press clicks this element programmatically
                // (ReaderTapOverlay → WORD JUMP), so `data-span-index` and the click
                // handler serve both.
                attrs: { "data-span-index": spanIndex },
                onClick: () => onSelectSpan(spanIndex),
                sx: {
                    cursor: "pointer",
                    borderRadius: "6px",
                    // The text mode's `::selection` tint (ReaderDocumentPage →
                    // selectionColors), so the two modes highlight in the same color.
                    backgroundColor: selected ? highlightColor : "transparent",
                    boxShadow: selected ? `0 0 0 ${HIGHLIGHT_BLEED_PX}px ${highlightColor}` : "none",
                },
            };
        }),
    ], [paragraph, selectedSpanIndex, highlightColor, onSelectSpan]);
    // (inkColor is read by the ForeignText below, not by `groups`.)

    // A blank line (from "\n\n") still takes one cpcd line, keeping the rhythm.
    if (paragraph.items.length === 0) {
        return <Box className="reader-cpcd-view__blank-line" sx={{ height: `${LINE_PX}px` }} />;
    }
    return (
        <ForeignText
            className="reader-cpcd-view__paragraph"
            language={language}
            items={paragraph.items}
            groups={groups}
            size={WORD_SIZE}
            flexWrap="wrap"
            characterColor={inkColor}
        />
    );
});

// ── The view ─────────────────────────────────────────────────────────────────────

interface ReaderCpcdViewProps {
    content: string;
    language: Language;
    // The document's gsa spans (docs/READER_SEGMENTATION.md) — the same array the
    // textarea navigates, so span indices agree between the two.
    segmentSpans: SegmentSpan[];
    // word → pronunciation (documentSegmentation.ts → buildReaderPronunciationMap).
    pronunciations: Map<string, string>;
    // The reading textarea's recorded selection (useTextSelection → selectionRange).
    selectionRange: { start: number; end: number };
    highlightColor: string;
    // The device's "Color pinyin by tone" preference (useFlashcardLearnSettings).
    showPinyinColor: boolean;
    // Select a span in the reading textarea (useTextSelection → selectRange).
    onSelectRange: (start: number, end: number) => void;
    // Attached to the scroll box; the page hands the same ref to ReaderTapOverlay, which
    // proxies vertical drags to it in this mode (ReaderDocumentPage → cpcdScrollRef → ReaderTapOverlay `scrollRef`).
    scrollRef: React.RefObject<HTMLDivElement | null>;
    // True → skip the keep-in-view scroll for this selection change: the learner scrolled
    // away during a read-aloud (useReaderReadAloud → isFollowPaused).
    isAutoScrollPaused?: () => boolean;
    // Text ink — the page's time-of-day look (ReaderDocumentPage → useTier2Look → `ink`):
    // the characters, and the pinyin when tone colouring is off (CPCDRow draws uncoloured
    // pinyin as `inherit`, so it takes the scroll box's colour). Light at night.
    inkColor: string;
}

function ReaderCpcdView({
    content,
    language,
    segmentSpans,
    pronunciations,
    selectionRange,
    highlightColor,
    showPinyinColor,
    onSelectRange,
    scrollRef,
    isAutoScrollPaused,
    inkColor,
}: ReaderCpcdViewProps) {
    const paragraphs = useMemo(
        () => buildParagraphs(content, segmentSpans, pronunciations, showPinyinColor),
        [content, segmentSpans, pronunciations, showPinyinColor]
    );

    // span start offset → span index, for mapping the textarea's range to a word.
    const spanIndexByStart = useMemo(() => {
        const map = new Map<number, number>();
        segmentSpans.forEach((span, index) => map.set(span.start, index));
        return map;
    }, [segmentSpans]);

    // The highlighted word: the span the recorded range covers EXACTLY. Navigation
    // only ever selects whole spans, so anything else (a collapsed caret, the
    // nothing-selected mode's parked caret at 0) highlights nothing — same as the text mode.
    const selectedSpanIndex = useMemo(() => {
        const { start, end } = selectionRange;
        if (start === end) return -1;
        const index = spanIndexByStart.get(start);
        return index !== undefined && segmentSpans[index].end === end ? index : -1;
    }, [selectionRange, spanIndexByStart, segmentSpans]);

    // Stable across renders so the memoised paragraphs don't all re-render on a step; reads
    // the latest spans through a ref.
    const spansRef = useRef(segmentSpans);
    spansRef.current = segmentSpans;
    const onSelectRangeRef = useRef(onSelectRange);
    onSelectRangeRef.current = onSelectRange;
    const selectSpan = useMemo(() => (spanIndex: number) => {
        const span = spansRef.current[spanIndex];
        if (span) onSelectRangeRef.current(span.start, span.end);
    }, []);

    // Keep the selected word in view, with one line of margin — the textarea gets this
    // from selectRelativeSpan → scrollSelectionIntoView; here the textarea is invisible,
    // so the view scrolls itself. Measured against the scroll box rather than via
    // `scrollIntoView`, which would also scroll the page's overflow-hidden ancestors.
    // Read through a ref so a new callback identity does not re-run the scroll.
    const isAutoScrollPausedRef = useRef(isAutoScrollPaused);
    isAutoScrollPausedRef.current = isAutoScrollPaused;
    useEffect(() => {
        const box = scrollRef.current;
        if (!box || selectedSpanIndex < 0 || isAutoScrollPausedRef.current?.()) return;
        const word = box.querySelector<HTMLElement>(`[data-span-index="${selectedSpanIndex}"]`);
        if (!word) return;
        const boxRect = box.getBoundingClientRect();
        const wordRect = word.getBoundingClientRect();
        const top = wordRect.top - boxRect.top + box.scrollTop;
        const bottom = top + wordRect.height;
        if (top < box.scrollTop + SCROLL_MARGIN_PX) {
            box.scrollTop = Math.max(0, top - SCROLL_MARGIN_PX);
        } else if (bottom > box.scrollTop + box.clientHeight - SCROLL_MARGIN_PX) {
            box.scrollTop = bottom - box.clientHeight + SCROLL_MARGIN_PX;
        }
    }, [selectedSpanIndex, scrollRef]);

    return (
        <Box
            ref={scrollRef}
            className="reader-cpcd-view"
            // Keep focus on the (invisible) reading textarea: without this a desktop click
            // on a word would blur it, and useTextSelection's blur handler would refocus
            // it a frame later restoring the OLD range over the one just clicked.
            onMouseDown={(event) => event.preventDefault()}
            sx={{
                position: "absolute",
                inset: 0,
                overflowY: "auto",
                overscrollBehavior: "contain",
                touchAction: "pan-y",
                // The textarea's 16px gutter (TextArea → '& .MuiInputBase-input' padding).
                padding: 2,
                boxSizing: "border-box",
                // Each paragraph row's line is exactly one cpcd cell tall; pinning the
                // strut to the same height keeps it from adding any.
                lineHeight: `${LINE_PX}px`,
                // Hide the cpcd rows' caret/selection on desktop; the highlight is ours.
                userSelect: "none",
                // Inherited by uncoloured pinyin (see `inkColor`).
                color: inkColor,
            }}
        >
            {paragraphs.map((paragraph, index) => {
                const first = paragraph.words[0]?.spanIndex ?? -1;
                const last = paragraph.words[paragraph.words.length - 1]?.spanIndex ?? -1;
                const selectedHere = selectedSpanIndex >= first && selectedSpanIndex <= last && first >= 0;
                return (
                    <ReaderCpcdParagraph
                        key={index}
                        paragraph={paragraph}
                        selectedSpanIndex={selectedHere ? selectedSpanIndex : -1}
                        highlightColor={highlightColor}
                        language={language}
                        onSelectSpan={selectSpan}
                        inkColor={inkColor}
                    />
                );
            })}
        </Box>
    );
}

export default ReaderCpcdView;
