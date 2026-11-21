import { useCallback, useState } from "react";

/**
 * How a reading page's text is drawn (docs/USER_DOCUMENT_FEATURE_SUMMARY.md § Display modes):
 *   'text'   — the plain read-only textarea; the highlight is the browser's `::selection`.
 *   'pinyin' — ReaderCpcdView: every gsa word as an inline cpcd (character + pinyin under it),
 *              flowing like the longdef display, with the Reader's own highlight.
 * Navigation is identical in both: the textarea stays the selection model either way.
 */
export type ReaderDisplayMode = "text" | "pinyin";

// Per DEVICE (owner's call 2026-11-17), like the other display preferences — no account column.
const DISPLAY_MODE_STORAGE_KEY = "reader.displayMode";

function readDisplayMode(): ReaderDisplayMode {
    try {
        return localStorage.getItem(DISPLAY_MODE_STORAGE_KEY) === "pinyin" ? "pinyin" : "text";
    } catch {
        return "text";
    }
}

/**
 * useReaderDisplayMode — the Text ⇄ Pinyin display mode behind the Pinyin pill
 * (ReaderDisplayToggle). ONE setting for every reading page: the Reader document page (its
 * display strip) and the cyoa story page (its header, docs/CYOA_FEATURE.md § 3.1) read and
 * write the same `reader.displayMode`. Each mount reads storage fresh; the pages are never
 * mounted together, so no cross-instance sync is needed.
 *
 * Lifted out of features/reader/useReaderSettings (2026-11-21), which still exposes it.
 * Layer: shared client state (src/reading). Depended on by useReaderSettings, StoryPlayPage.
 */
export function useReaderDisplayMode() {
    const [displayMode, setDisplayModeState] = useState<ReaderDisplayMode>(readDisplayMode);
    const setDisplayMode = useCallback((mode: ReaderDisplayMode) => {
        setDisplayModeState(mode);
        try {
            localStorage.setItem(DISPLAY_MODE_STORAGE_KEY, mode);
        } catch {
            // Storage unavailable — the choice just won't outlive this page.
        }
    }, []);
    return { displayMode, setDisplayMode };
}
