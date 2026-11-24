import { useCallback, useMemo } from "react";
import type { DictionaryEntry, VocabEntry } from "../types";
import { buildExcludeSet, buildReaderDictMap, computeSegmentSpans, type SpanRange } from "./documentSegmentation";
import { chunkPhrases } from "./phraseChunking";
import { drillAt } from "./readerDrill";
import { useTextSelection } from "./useTextSelection";
import { buildEntryByWord } from "./wordRoles";

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
    /**
     * The "Phrase" pill (useReaderStepMode): true → taps, arrows, the long-press word jump
     * and a placed caret all work in PHRASES (phraseChunking.ts) instead of gsa words.
     */
    stepByPhrase?: boolean;
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
 * PHRASE STEPPING (docs/READER_SEGMENTATION.md § "Phrase stepping"): the phrases join the
 * words by grammar rules (phraseChunking.ts); `stepSpans` is what navigation walks — the
 * phrases with the Phrase pill on, else the words. `spans` stays the WORDS for everything drawn or read per
 * word (the Pinyin view, read-aloud, search, the split keycap). `drillAtOffset` is the
 * tap-inside-the-selection narrowing (readerDrill.ts).
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
    stepByPhrase = false,
}: UseReadingTextOptions) {
    // word1 → frequencyScore over det + personal vocab: what the gsa scores against, and
    // the "is this a headword" test the drill uses.
    const dictMap = useMemo(() => buildReaderDictMap(dictionaryCards, personalCards), [dictionaryCards, personalCards]);
    const spans = useMemo(() => {
        if (!content) return [];
        const excludeSet = buildExcludeSet(dictionaryCards);
        return computeSegmentSpans(content, dictMap, excludeSet, overrides);
    }, [content, dictMap, dictionaryCards, overrides]);

    // The phrases are computed whatever the pill says (cheap: one pass over the words), so
    // flipping the pill changes only which list navigation walks.
    const phrases = useMemo(
        () => chunkPhrases(content, spans, buildEntryByWord(dictionaryCards)),
        [content, spans, dictionaryCards]
    );
    const stepSpans = stepByPhrase ? phrases : spans;

    const selection = useTextSelection(personalCards, dictionaryCards, autoSelectEnabled, stepSpans, translateEnglish);

    // TAP INSIDE THE SELECTION (readerDrill.ts): narrow to the piece under the finger.
    // Returns true when the tap was inside the selection (consumed — the caller must not
    // also zone-step), false when it was outside. Sentence mode keeps its own tap rules
    // (a tap steps out of the sentence), so it never drills.
    const { getRecordedSelection, selectRange, selectedSentence } = selection;
    const drillAtOffset = useCallback((offset: number): boolean => {
        if (selectedSentence) return false;
        const result = drillAt({
            content,
            selection: getRecordedSelection(),
            offset,
            stepSpans,
            wordSpans: spans,
            isHeadword: (text) => dictMap.has(text),
        });
        if (result.kind === "outside") return false;
        if (result.kind === "narrow") selectRange(result.start, result.end);
        return true;
    }, [selectedSentence, content, getRecordedSelection, stepSpans, spans, dictMap, selectRange]);

    return { spans, stepSpans, selection, drillAtOffset };
}

export type ReadingText = ReturnType<typeof useReadingText>;
export type ReadingSelection = ReadingText["selection"];
