import { useLayoutEffect, useRef, useState } from "react";
import { Box } from "@mui/material";
import ForeignText from "../components/ForeignText";
import SenseList from "../components/SenseList";
import { VERTICAL_PADDING, cpcdNaturalSize, type CPCDSize } from "../components/cpcdLayout";
import { useFlashcardLearnSettings } from "../hooks/useFlashcardLearnSettings";
import { COLORS } from "../theme/colors";
import { resolveDisplayPronunciation } from "../utils/definitionUtils";
import type { Language } from "../types";
import type { SegmentSpan } from "./documentSegmentation";
import type { PhraseWord } from "./phrasePick";

/**
 * ReaderPhraseSplitFace — the dictionary keycap's SPLIT-SCREEN face, shown while a phrase of
 * two or more words is selected (docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Split-screen
 * keycap"; picked by useReadingKeycap → phrasePick.ts → `pickPhraseWords`).
 *
 *   ┌───────────────┬───────────────┐
 *   │ tài           │ duō           │   headword: md, stepping down md → smd → sm → xs →
 *   │ 太            │ 多            │   xxs until the row fits the half's width
 *   │───────────────│───────────────│
 *   │ 1. too (much) │ 1. many ★     │   SenseList, ONE column (`singleColumn`)
 *   │ 2. very       │ 2. much       │
 *   └───────────────┴───────────────┘
 *
 *   - Compact: no speaker, no More Info, no Add key (owner's call 2026-11-23). VocabDisplayCard
 *     draws no header controls under a `customFace`, so nothing needs hiding here.
 *   - ONE scroll: both halves sit in the keycap's own scrolling content box, so they move
 *     together.
 *   - A tap on a half selects that word in the text (`onSelectWord`) — the same narrowing as
 *     a tap on the word in the reading box — and the keycap returns to the full face.
 *     Taps on a sense row's text keep opening its commonality popup instead (SenseList).
 *   - A word with no det row shows its headword only (no pinyin, no senses).
 *
 * ⚠️ The halves are tappable but carry no outline of their own (CLAUDE.md § Buttons & cards):
 * they are regions of the keycap, whose outline already frames them. Flagged to the owner.
 *
 * Layer: shared presentation (src/reading). Rendered through VocabDisplayCard `customFace`.
 */

// The headword sizes tried, largest first; the first whose row fits the half wins.
const HEADWORD_SIZES: CPCDSize[] = ["md", "smd", "sm", "xs", "xxs"];
// The gap between the two halves on each side of the divider, px.
const HALF_GUTTER_PX = 8;

interface ReaderPhraseSplitFaceProps {
    /** The two words to show, in text order (pickPhraseWords). */
    words: PhraseWord[];
    language: Language;
    /** Select this word in the text. */
    onSelectWord: (span: SegmentSpan) => void;
}

function ReaderPhraseSplitFace({ words, language, onSelectWord }: ReaderPhraseSplitFaceProps) {
    const { settings } = useFlashcardLearnSettings();
    return (
        <Box className="reader-phrase-split-face" sx={{ display: "flex", alignItems: "stretch", minHeight: "100%" }}>
            {words.map((word, index) => (
                <ReaderPhraseHalf
                    key={`${word.span.start}:${word.span.text}`}
                    word={word}
                    language={language}
                    showPinyinColor={settings.showPinyinColor}
                    side={index === 0 ? "left" : "right"}
                    onSelect={() => onSelectWord(word.span)}
                />
            ))}
        </Box>
    );
}

interface ReaderPhraseHalfProps {
    word: PhraseWord;
    language: Language;
    showPinyinColor: boolean;
    side: "left" | "right";
    onSelect: () => void;
}

function ReaderPhraseHalf({ word, language, showPinyinColor, side, onSelect }: ReaderPhraseHalfProps) {
    const { span, entry } = word;
    // FIT: the largest headword size whose natural row width fits the half (cpcdLayout's
    // column widths). Re-measured when the half resizes (the keycap's width changes).
    const halfRef = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState<CPCDSize>("md");
    const charCount = [...span.text].length;
    useLayoutEffect(() => {
        const half = halfRef.current;
        if (!half) return;
        const measure = () => {
            const room = half.clientWidth - HALF_GUTTER_PX;
            const fit = HEADWORD_SIZES.find((s) => cpcdNaturalSize(s, { charCount }).width <= room);
            setSize(fit ?? HEADWORD_SIZES[HEADWORD_SIZES.length - 1]);
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(half);
        return () => observer.disconnect();
    }, [charCount]);

    return (
        <Box
            ref={halfRef}
            className={`reader-phrase-split-face__half reader-phrase-split-face__half--${side}`}
            role="button"
            aria-label={`Select ${span.text}`}
            onClick={(event) => {
                // A tap on a sense row's text opens its commonality popup (SenseList); it is
                // not a request to select the word.
                if ((event.target as HTMLElement).closest(".eip-sense-list__tap")) return;
                onSelect();
            }}
            sx={{
                flex: "1 1 0",
                minWidth: 0,
                cursor: "pointer",
                ...(side === "left"
                    ? { pr: `${HALF_GUTTER_PX}px` }
                    // The divider between the halves: the header divider's hairline colour.
                    : { pl: `${HALF_GUTTER_PX}px`, borderLeft: `1px solid ${COLORS.rowBorder}` }),
            }}
        >
            <Box
                className="reader-phrase-split-face__headword"
                // Pulled up by the cell's padding-top, as VocabDisplayCard's header is.
                sx={{ display: "flex", mt: `calc(-1 * ${VERTICAL_PADDING[size]})` }}
            >
                <ForeignText
                    className="reader-phrase-split-face__headword-cpcd"
                    size={size}
                    justifyContent="flex-start"
                    text={span.text}
                    pronunciation={entry ? resolveDisplayPronunciation(entry) : undefined}
                    language={entry?.language ?? language}
                    useToneColor={showPinyinColor}
                    showPinyin={!!entry}
                />
            </Box>
            {entry && (
                <>
                    <Box
                        className="reader-phrase-split-face__divider"
                        sx={{ height: "1px", backgroundColor: COLORS.rowBorder, mt: 0.5, mb: 1.25 }}
                    />
                    <SenseList
                        entry={entry}
                        wordKey={`${entry.language}:${entry.word1}:${entry.id}`}
                        showPinyinColor={showPinyinColor}
                        singleColumn
                    />
                </>
            )}
        </Box>
    );
}

export default ReaderPhraseSplitFace;
