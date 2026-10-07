/**
 * Writing Notebook — client API (docs/WRITING_NOTEBOOK.md § "API").
 * Server: /api/writingNotebook/* (WritingNotebookController → WritingNotebookService).
 *
 * zh only today, but every call carries the language so the server stays language-scoped.
 * No call ever returns a cell's verdict — only ink and counters.
 */
import { apiGet, apiPost, apiPut } from "./http";
import type {
    NotebookCell,
    NotebookSheetState,
    NotebookSummary,
} from "../../server/contracts/writingNotebook";
import type { Language } from "../types";

export type { NotebookCell, NotebookSheetState, NotebookSummary };

/** The belt card's total + the word the page reopens on. */
export function fetchNotebookSummary(language: Language): Promise<NotebookSummary> {
    return apiGet<NotebookSummary>("/api/writingNotebook/summary", { params: { language } });
}

/** Open (create / re-stamp) a sheet and read its counter. */
export function openNotebookSheet(language: Language, word: string): Promise<NotebookSheetState> {
    return apiPost<NotebookSheetState>("/api/writingNotebook/sheets/open", { language, word });
}

/** Filled cells with `from <= cellIndex < to`. */
export async function fetchNotebookCells(
    language: Language,
    word: string,
    from: number,
    to: number,
    signal?: AbortSignal
): Promise<NotebookCell[]> {
    const data = await apiGet<{ cells?: NotebookCell[] }>("/api/writingNotebook/cells", {
        params: { language, word, from, to },
        signal,
    });
    return Array.isArray(data?.cells) ? data.cells : [];
}

/** The lowest empty cell index at or after `after`. */
export async function fetchNextEmptyCell(language: Language, word: string, after: number): Promise<number> {
    const data = await apiGet<{ cellIndex: number }>("/api/writingNotebook/nextEmpty", {
        params: { language, word, after },
    });
    return Number(data.cellIndex);
}

/**
 * Save one cell's encoded ink (an encoded EMPTY ink erases the cell). The server
 * validates it silently and replies with the sheet's counter.
 */
export function saveNotebookCell(
    language: Language,
    word: string,
    cellIndex: number,
    ink: string
): Promise<NotebookSheetState> {
    return apiPut<NotebookSheetState>(`/api/writingNotebook/cells/${cellIndex}`, { language, word, ink });
}
