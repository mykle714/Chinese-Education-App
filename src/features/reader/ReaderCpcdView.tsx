import { memo, useEffect, useMemo, useRef } from "react";
import { Box } from "@mui/material";
import ForeignText from "../../components/ForeignText";
import {
    CHAR_FONT_SIZE,
    CHAR_LINE_HEIGHT,
    PINYIN_RESERVED_HEIGHT,
    VERTICAL_PADDING,
    cpcdNaturalSize,
    fontPx,
} from "../../components/cpcdLayout";
import { FONTS } from "../../theme/fonts";
import type { Language } from "../../types";
import type { SegmentSpan } from "./documentSegmentation";

/**
 * READER CPCD VIEW — the Reader's **Pinyin** display mode (useReaderSettings →
 * `displayMode: 'pinyin'`, toggled by the pill under the dictionary keycap).
 *
 * Draws the whole document the way the longdef display draws its embedded Chinese
 * (LongDefinitionDisplay → parts path): one flowing `pre-line` paragraph in which
 * every gsa word is an inline-block cpcd (character, pinyin under it), so lines wrap
 * BETWEEN words and never split one.
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
 * cpcd container (ForeignText) and the cpcd size tables (components/cpcdLayout.ts) so
 * non-word runs line up with the words' glyph boxes.
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

// ── Document → render runs ───────────────────────────────────────────────────────

type ReaderRun =
    // A gsa word: tappable/highlightable, drawn as cpcd (Han) or plain text (Latin, digits).
    | { kind: "word"; spanIndex: number; text: string; isHan: boolean }
    // Whitespace between words, newlines included — left to `pre-line` to lay out.
    | { kind: "space"; text: string }
    // Anything else between words (punctuation, symbols): drawn in a glyph box so it sits
    // on the words' character line, but it is not a word and is never highlighted.
    | { kind: "mark"; text: string };

const HAN_REGEX = /\p{Script=Han}/u;

/** Slice the document into word runs (one per gsa span) and the gaps between them. */
function buildRuns(content: string, spans: SegmentSpan[]): ReaderRun[] {
    const runs: ReaderRun[] = [];
    const pushGap = (gap: string) => {
        // Split on whitespace, KEEPING it (the capture group), so spaces/newlines and
        // marks alternate: "，\n\n“" → ["，", "\n\n", "“"].
        for (const piece of gap.split(/(\s+)/)) {
            if (!piece) continue;
            runs.push(/^\s+$/.test(piece) ? { kind: "space", text: piece } : { kind: "mark", text: piece });
        }
    };
    let cursor = 0;
    spans.forEach((span, spanIndex) => {
        if (span.start > cursor) pushGap(content.slice(cursor, span.start));
        runs.push({ kind: "word", spanIndex, text: span.text, isHan: HAN_REGEX.test(span.text) });
        cursor = span.end;
    });
    if (cursor < content.length) pushGap(content.slice(cursor));
    return runs;
}

// A plain run boxed exactly like a cpcd char cell (padding-top, the glyph's line box,
// then the empty pinyin band as padding-bottom), so punctuation and Latin words sit on
// the same character line as the cpcd words beside them.
const glyphBoxSx = {
    display: "inline-block",
    verticalAlign: "top",
    fontFamily: FONTS.cjk,
    fontSize: CHAR_FONT_SIZE[WORD_SIZE],
    lineHeight: `${Math.round(fontPx(CHAR_FONT_SIZE[WORD_SIZE]) * CHAR_LINE_HEIGHT)}px`,
    paddingTop: VERTICAL_PADDING[WORD_SIZE],
    paddingBottom: `${PINYIN_RESERVED_HEIGHT[WORD_SIZE]}px`,
    whiteSpace: "nowrap",
} as const;

// ── One word ─────────────────────────────────────────────────────────────────────

interface ReaderCpcdWordProps {
    spanIndex: number;
    text: string;
    isHan: boolean;
    pronunciation: string | undefined;
    selected: boolean;
    highlightColor: string;
    showPinyinColor: boolean;
    language: Language;
    onSelectSpan: (spanIndex: number) => void;
}

// Memoised: a document is hundreds of words and a selection step changes only two of
// them (the old word and the new one), so every other word must skip the re-render —
// each cpcd row runs a layout pass of its own (CPCDRow → positionPinyins).
const ReaderCpcdWord = memo(function ReaderCpcdWord({
    spanIndex,
    text,
    isHan,
    pronunciation,
    selected,
    highlightColor,
    showPinyinColor,
    language,
    onSelectSpan,
}: ReaderCpcdWordProps) {
    return (
        <Box
            component="span"
            className={`reader-cpcd-view__word${selected ? " reader-cpcd-view__word--selected" : ""}`}
            data-span-index={spanIndex}
            // On desktop (no overlay) a click selects the word, the same as clicking into
            // the textarea places the caret in it. On mobile ReaderTapOverlay covers the
            // view and turns a tap into a zone step, exactly as in the text mode — but its
            // long-press clicks this element programmatically (ReaderTapOverlay → WORD
            // JUMP), so the `data-span-index` attribute and this handler serve both.
            onClick={() => onSelectSpan(spanIndex)}
            sx={[
                isHan
                    ? { display: "inline-block", verticalAlign: "top" }
                    : glyphBoxSx,
                {
                    cursor: "pointer",
                    borderRadius: "6px",
                    // The text mode's `::selection` tint (ReaderDocumentPage → selectionColors),
                    // so the two modes highlight in the same color.
                    backgroundColor: selected ? highlightColor : "transparent",
                    boxShadow: selected ? `0 0 0 ${HIGHLIGHT_BLEED_PX}px ${highlightColor}` : "none",
                },
            ]}
        >
            {isHan ? (
                <ForeignText
                    language={language}
                    text={text}
                    pronunciation={pronunciation}
                    size={WORD_SIZE}
                    flexWrap="nowrap"
                    showPinyin
                    useToneColor={showPinyinColor}
                />
            ) : (
                text
            )}
        </Box>
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
}: ReaderCpcdViewProps) {
    const runs = useMemo(() => buildRuns(content, segmentSpans), [content, segmentSpans]);

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

    // Stable across renders so the memoised words don't all re-render on a step; reads
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
                whiteSpace: "pre-line",
                lineHeight: `${LINE_PX}px`,
                // Hide the cpcd rows' caret/selection on desktop; the highlight is ours.
                userSelect: "none",
            }}
        >
            {runs.map((run, index) => {
                if (run.kind === "space") return <span key={index}>{run.text}</span>;
                if (run.kind === "mark") {
                    return (
                        <Box key={index} component="span" className="reader-cpcd-view__mark" sx={glyphBoxSx}>
                            {run.text}
                        </Box>
                    );
                }
                return (
                    <ReaderCpcdWord
                        key={index}
                        spanIndex={run.spanIndex}
                        text={run.text}
                        isHan={run.isHan}
                        pronunciation={pronunciations.get(run.text)}
                        selected={run.spanIndex === selectedSpanIndex}
                        highlightColor={highlightColor}
                        showPinyinColor={showPinyinColor}
                        language={language}
                        onSelectSpan={selectSpan}
                    />
                );
            })}
        </Box>
    );
}

export default ReaderCpcdView;
