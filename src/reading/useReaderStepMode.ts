import { useCallback, useState } from "react";

/**
 * What one forward / back tap steps over on a reading page
 * (docs/READER_SEGMENTATION.md § "Phrase stepping"):
 *   'word'   — one gsa word (the original behaviour);
 *   'phrase' — one phrase: neighbouring words joined by the grammar rules in
 *              phraseChunking.ts (太多的 in one tap instead of three).
 */
export type ReaderStepMode = "word" | "phrase";

// Per DEVICE, like the Pinyin pill's `reader.displayMode` (useReaderDisplayMode) — no account column.
const STEP_MODE_STORAGE_KEY = "reader.stepMode";

function readStepMode(): ReaderStepMode {
    try {
        return localStorage.getItem(STEP_MODE_STORAGE_KEY) === "phrase" ? "phrase" : "word";
    } catch {
        return "word";
    }
}

/**
 * useReaderStepMode — the Word ⇄ Phrase setting behind the "Phrase" pill (ReaderPhraseToggle).
 * ONE setting for every reading page: the Reader's display strip and the cyoa story page's
 * toolbar read and write the same `reader.stepMode`. Each mount reads storage fresh; the
 * pages are never mounted together, so no cross-instance sync is needed.
 *
 * Layer: shared client state (src/reading). Depended on by ReaderDocumentPage, StoryPlayPage.
 */
export function useReaderStepMode() {
    const [stepMode, setStepModeState] = useState<ReaderStepMode>(readStepMode);
    const setStepMode = useCallback((mode: ReaderStepMode) => {
        setStepModeState(mode);
        try {
            localStorage.setItem(STEP_MODE_STORAGE_KEY, mode);
        } catch {
            // Storage unavailable — the choice just won't outlive this page.
        }
    }, []);
    return { stepMode, setStepMode };
}
