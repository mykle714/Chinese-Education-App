import { useMemo } from "react";
import type { DictionaryEntry, VocabEntry } from "../types";
import { buildExcludeSet, buildReaderDictMap, computeSegmentSpans, type SpanRange } from "./documentSegmentation";
import { useTextSelection } from "./useTextSelection";

/** The shared "no tiebreak switches" value, so the span memo keeps its identity. */
const NO_SEGMENT_OVERRIDES: SpanRange[] = [];

interface UseReadingTextOptions {
    /** The text being read; "" while there is none. */
    content: string;
    /** The vocabulary the words resolve against (one lookup may cover several texts). */
    dictionaryCards: DictionaryEntry[];
    personalCards: VocabEntry[];
    /** The English → Chinese fallback (useEnglishTranslations → `translate`). */
    translateEnglish?: (selectedText: string) => DictionaryEntry | null;
    /** Tiebreak switches forced into the gsa (the Reader's Pinyin view); none by default. */
    overrides?: SpanRange[];
    /** Auto word selection — a placed caret grows to its word. Always on today. */
    autoSelectEnabled?: boolean;
}

/**
 * useReadingText — ONE text read with the engine: its gsa word spans
 * (docs/READER_SEGMENTATION.md) and its selection model (useTextSelection: the textarea's
 * caret/word, the keycap's entry, NOTHING-SELECTED MODE, sentence mode).
 *
 * A page calls it once per text it reads. The Reader has one (the document); the cyoa play
 * page has two — the passage and the inspected choice label (docs/CYOA_FEATURE.md § 3.2) —
 * sharing one vocabulary lookup and one keycap (useReadingKeycap), which follows whichever
 * text is active.
 *
 * Layer: shared client state (src/reading). Depended on by
 * src/features/reader/ReaderDocumentPage.tsx, src/features/cyoa/StoryPlayPage.tsx.
 * Docs: docs/CYOA_FEATURE.md § 4.2, docs/USER_DOCUMENT_FEATURE_SUMMARY.md § Frontend.
 */
export function useReadingText({
    content,
    dictionaryCards,
    personalCards,
    translateEnglish,
    overrides = NO_SEGMENT_OVERRIDES,
    autoSelectEnabled = true,
}: UseReadingTextOptions) {
    const spans = useMemo(() => {
        if (!content) return [];
        const dictMap = buildReaderDictMap(dictionaryCards, personalCards);
        const excludeSet = buildExcludeSet(dictionaryCards);
        return computeSegmentSpans(content, dictMap, excludeSet, overrides);
    }, [content, dictionaryCards, personalCards, overrides]);

    const selection = useTextSelection(personalCards, dictionaryCards, autoSelectEnabled, spans, translateEnglish);

    return { spans, selection };
}

export type ReadingText = ReturnType<typeof useReadingText>;
export type ReadingSelection = ReadingText["selection"];
