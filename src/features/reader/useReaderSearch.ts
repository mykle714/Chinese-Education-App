import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SegmentSpan } from "./documentSegmentation";
import { buildDocumentSyllables, findReaderMatches, type ReaderSearchMatch } from "./readerSearch";

/**
 * useReaderSearch — the state behind the Reader's find-in-document bar (ReaderSearchBar).
 *
 * Owns: whether the bar is open, the query, the match list (readerSearch.ts →
 * findReaderMatches; pinyin matching only in the Pinyin display mode) and which match is
 * CURRENT. Every time the current match changes — the query is edited, ˄/˅ is pressed,
 * the mode flips — `onCurrentMatch` fires with it; the page uses that to SELECT the match
 * (owner's call 2026-11-18: the keycap shows it and Read starts from it) and scroll it
 * into view. Closing clears everything.
 *
 * A fresh query lands on the first match at or after `getAnchorOffset()` (the reader's
 * current place), wrapping to the first match — a browser's find-as-you-type.
 *
 * Layer: feature hook (src/features/reader). No DOM, no fetch.
 * Used by: ReaderDocumentPage.tsx. Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Search".
 */

interface UseReaderSearchOptions {
    content: string;
    spans: SegmentSpan[];
    // word → pronunciation (documentSegmentation.ts → buildReaderPronunciationMap).
    pronunciations: Map<string, string>;
    // True in the Pinyin display mode of a Chinese document: the query is also read as pinyin.
    matchPinyin: boolean;
    // Where a new query starts looking (the reader's caret / selection start).
    getAnchorOffset: () => number;
    onCurrentMatch: (match: ReaderSearchMatch) => void;
}

export interface ReaderSearchState {
    open: boolean;
    query: string;
    matches: ReaderSearchMatch[];
    // Index into `matches`, or -1 when there are none.
    currentIndex: number;
    openSearch: () => void;
    closeSearch: () => void;
    setQuery: (query: string) => void;
    step: (direction: "next" | "prev") => void;
}

export function useReaderSearch({
    content,
    spans,
    pronunciations,
    matchPinyin,
    getAnchorOffset,
    onCurrentMatch,
}: UseReaderSearchOptions): ReaderSearchState {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [currentIndex, setCurrentIndex] = useState(-1);
    // Bumped by every ˄/˅ press, so a step re-selects even when it lands on the same
    // match (a one-match list) after the reader tapped away from it.
    const [stepCount, setStepCount] = useState(0);

    // The per-offset readings, built only while they can be used (bar open, pinyin mode).
    const syllables = useMemo(
        () => (open && matchPinyin ? buildDocumentSyllables(content, spans, pronunciations) : null),
        [open, matchPinyin, content, spans, pronunciations],
    );
    const matches = useMemo(
        () => (open && query ? findReaderMatches(content, query, syllables) : []),
        [open, query, content, syllables],
    );

    // Latest callbacks through refs, so a new identity from the page re-runs nothing.
    const getAnchorRef = useRef(getAnchorOffset);
    getAnchorRef.current = getAnchorOffset;
    const onCurrentMatchRef = useRef(onCurrentMatch);
    onCurrentMatchRef.current = onCurrentMatch;

    // A new match list (query edited, mode flipped, document saved): land on the first
    // match at/after the reader's place. Stepping changes only the index, not the list.
    useEffect(() => {
        if (matches.length === 0) {
            setCurrentIndex(-1);
            return;
        }
        const anchor = getAnchorRef.current();
        const firstAfter = matches.findIndex((match) => match.start >= anchor);
        setCurrentIndex(firstAfter === -1 ? 0 : firstAfter);
    }, [matches]);

    // Select the current match. Keyed on the match itself (plus `stepCount`) so a list
    // rebuilt with the same current range (another keystroke that still hits here) does
    // not re-select.
    const current = currentIndex >= 0 ? matches[currentIndex] : undefined;
    const currentStart = current?.start ?? -1;
    const currentEnd = current?.end ?? -1;
    useEffect(() => {
        if (currentStart < 0) return;
        onCurrentMatchRef.current({ start: currentStart, end: currentEnd });
    }, [currentStart, currentEnd, stepCount]);

    const step = useCallback((direction: "next" | "prev") => {
        setStepCount((count) => count + 1);
        setCurrentIndex((index) => {
            const count = matches.length;
            if (count === 0) return -1;
            // Wraps at both ends, like a browser.
            return direction === "next" ? (index + 1) % count : (index - 1 + count) % count;
        });
    }, [matches.length]);

    const openSearch = useCallback(() => setOpen(true), []);
    const closeSearch = useCallback(() => {
        setOpen(false);
        setQuery("");
        setCurrentIndex(-1);
    }, []);

    return { open, query, matches, currentIndex, openSearch, closeSearch, setQuery, step };
}
