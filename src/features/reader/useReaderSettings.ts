import { useMemo, useState } from "react";

import { useReaderDisplayMode, type ReaderDisplayMode } from "../../reading/useReaderDisplayMode";

// The display mode moved to the shared engine (src/reading/useReaderDisplayMode — the cyoa
// story page uses the same setting); re-exported for the Reader's existing importers.
export type { ReaderDisplayMode };

// Reader settings. The desktop settings sidebar (ReaderSettings.tsx) was retired
// with the desktop layout. Two settings live here:
//   • auto word selection — currently always on (no UI toggles it);
//   • the display mode — the Pinyin pill (ReaderDisplayToggle) under the dictionary keycap,
//     held by the shared useReaderDisplayMode.
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

    const { displayMode, setDisplayMode } = useReaderDisplayMode();

    return useMemo(() => ({
        autoSelectEnabled,
        setAutoSelectEnabled,
        displayMode,
        setDisplayMode,
    }), [autoSelectEnabled, displayMode, setDisplayMode]);
}
