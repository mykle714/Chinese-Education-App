import { useMemo, useState } from "react";

// Reader settings. The desktop settings sidebar (ReaderSettings.tsx) was retired
// with the desktop layout, so the only live setting is auto word selection —
// currently always on (no UI toggles it); the hook remains as the home for any
// future reader settings.
interface UseReaderSettingsReturn {
    autoSelectEnabled: boolean;
    setAutoSelectEnabled: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useReaderSettings(): UseReaderSettingsReturn {
    // Auto-expand a tapped caret to the dictionary word containing it
    // (docs/READER_SEGMENTATION.md).
    const [autoSelectEnabled, setAutoSelectEnabled] = useState(true);

    return useMemo(() => ({
        autoSelectEnabled,
        setAutoSelectEnabled,
    }), [autoSelectEnabled]);
}
