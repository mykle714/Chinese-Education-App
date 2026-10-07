import { useCallback, useEffect, useRef, useState } from "react";
import {
    fetchNextEmptyCell,
    fetchNotebookCells,
    openNotebookSheet,
    saveNotebookCell,
} from "../../../api/writingNotebook";
import type { Language } from "../../../types";
import { pageRange } from "./notebookLayout";

/**
 * useNotebookSheet — one word's sheet as the page sees it (docs/WRITING_NOTEBOOK.md
 * § "Client data flow").
 *
 * Holds the cells fetched so far (cellIndex → encoded ink), which PAGES have been
 * fetched, and the sheet's counter. Pages are fetched on demand (`ensurePages`) as the
 * virtualised grid brings rows into view; nothing is fetched speculatively.
 *
 * A save is OPTIMISTIC: the ink shows in its cell at once, the PUT validates it on the
 * server, and the reply carries the new counter — never the verdict. A failed save puts
 * the cell back as it was and raises `saveError`, so the learner is not left looking at
 * ink the server does not have.
 *
 * Every response is checked against the word it was asked for (`wordRef`), so switching
 * words mid-request can never paint one sheet's ink onto another. The hook is keyed by
 * the page on `word` changes anyway (state resets below).
 *
 * LAYER: feature hook — all server calls go through src/api/writingNotebook.ts.
 */
export interface NotebookSheet {
    /** Encoded ink per filled cell, for the pages fetched so far. */
    cells: ReadonlyMap<number, string>;
    /** Pages whose cells are known (fetched, or nothing to fetch). */
    loadedPages: ReadonlySet<number>;
    /** The sheet's counter, null until the open call answers. */
    count: number | null;
    /** A save failed and was rolled back (cleared by the next successful save). */
    saveError: boolean;
    /** Fetch any of these pages not fetched or in flight. */
    ensurePages: (pages: number[]) => void;
    /** Save one cell's encoded ink (an encoded EMPTY ink erases it). */
    saveCell: (cellIndex: number, encoded: string, isEmpty: boolean) => void;
    /** The lowest empty cell at or after `after` (server-side gap search). */
    findNextEmpty: (after: number) => Promise<number>;
}

export function useNotebookSheet(language: Language, word: string | null): NotebookSheet {
    const [cells, setCells] = useState<Map<number, string>>(() => new Map());
    const [loadedPages, setLoadedPages] = useState<Set<number>>(() => new Set());
    const [count, setCount] = useState<number | null>(null);
    const [saveError, setSaveError] = useState(false);
    const inflightRef = useRef<Set<number>>(new Set());
    const wordRef = useRef(word);
    wordRef.current = word;

    // A new word is a new sheet: drop everything, then open it (creates the sheet row and
    // stamps it as the one the page reopens on next visit).
    useEffect(() => {
        setCells(new Map());
        setLoadedPages(new Set());
        setCount(null);
        setSaveError(false);
        inflightRef.current = new Set();
        if (!word) return;
        let cancelled = false;
        openNotebookSheet(language, word)
            .then((state) => { if (!cancelled && wordRef.current === state.word) setCount(state.count); })
            .catch((err) => console.error("Writing Notebook: could not open sheet", err));
        return () => { cancelled = true; };
    }, [language, word]);

    const ensurePages = useCallback((pages: number[]) => {
        const sheetWord = wordRef.current;
        if (!sheetWord) return;
        for (const page of pages) {
            if (inflightRef.current.has(page)) continue;
            inflightRef.current.add(page);
            const { from, to } = pageRange(page);
            fetchNotebookCells(language, sheetWord, from, to)
                .then((fetched) => {
                    if (wordRef.current !== sheetWord) return;
                    setCells((prev) => {
                        const next = new Map(prev);
                        // Only fill gaps: a cell saved locally while this page was in
                        // flight is newer than what the server just sent.
                        for (const c of fetched) if (!next.has(c.cellIndex)) next.set(c.cellIndex, c.ink);
                        return next;
                    });
                    setLoadedPages((prev) => new Set(prev).add(page));
                })
                .catch((err) => {
                    console.error("Writing Notebook: page load failed", err);
                    // Not loaded: let the next scroll retry it.
                    if (wordRef.current === sheetWord) inflightRef.current.delete(page);
                });
        }
    }, [language]);

    const saveCell = useCallback((cellIndex: number, encoded: string, isEmpty: boolean) => {
        const sheetWord = wordRef.current;
        if (!sheetWord) return;
        let previous: string | undefined;
        setCells((prev) => {
            previous = prev.get(cellIndex);
            const next = new Map(prev);
            if (isEmpty) next.delete(cellIndex); else next.set(cellIndex, encoded);
            return next;
        });
        saveNotebookCell(language, sheetWord, cellIndex, encoded)
            .then((state) => {
                if (wordRef.current !== sheetWord) return;
                setCount(state.count);
                setSaveError(false);
            })
            .catch((err) => {
                console.error("Writing Notebook: save failed", err);
                if (wordRef.current !== sheetWord) return;
                // Roll the cell back to what the server still holds.
                setCells((prev) => {
                    const next = new Map(prev);
                    if (previous === undefined) next.delete(cellIndex); else next.set(cellIndex, previous);
                    return next;
                });
                setSaveError(true);
            });
    }, [language]);

    const findNextEmpty = useCallback((after: number) => {
        const sheetWord = wordRef.current;
        if (!sheetWord) return Promise.resolve(after);
        return fetchNextEmptyCell(language, sheetWord, after);
    }, [language]);

    return { cells, loadedPages, count, saveError, ensurePages, saveCell, findNextEmpty };
}
