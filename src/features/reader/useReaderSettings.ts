import { useCallback, useMemo, useState } from "react";

/**
 * How the open document's text is drawn (docs/USER_DOCUMENT_FEATURE_SUMMARY.md § Display modes):
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

// Reader settings. The desktop settings sidebar (ReaderSettings.tsx) was retired
// with the desktop layout. Two settings live here:
//   • auto word selection — currently always on (no UI toggles it);
//   • the display mode — the Pinyin pill (ReaderDisplayToggle) under the dictionary keycap.
interface UseReaderSettingsReturn {
    autoSelectEnabled: boolean;
    setAutoSelectEnabled: React.Dispatch<React.SetStateAction<boolean>>;
    displayMode: ReaderDisplayMode;
    setDisplayMode: (mode: ReaderDisplayMode) => void;
}

export function useReaderSettings(): UseReaderSettingsReturn {
    // Auto-expand a tapped caret to the dictionary word containing it
    // (docs/READER_SEGMENTATION.md).
    const [autoSelectEnabled, setAutoSelectEnabled] = useState(true);

    const [displayMode, setDisplayModeState] = useState<ReaderDisplayMode>(readDisplayMode);
    const setDisplayMode = useCallback((mode: ReaderDisplayMode) => {
        setDisplayModeState(mode);
        try {
            localStorage.setItem(DISPLAY_MODE_STORAGE_KEY, mode);
        } catch {
            // Storage unavailable — the choice just won't outlive this page.
        }
    }, []);

    return useMemo(() => ({
        autoSelectEnabled,
        setAutoSelectEnabled,
        displayMode,
        setDisplayMode,
    }), [autoSelectEnabled, displayMode, setDisplayMode]);
}
