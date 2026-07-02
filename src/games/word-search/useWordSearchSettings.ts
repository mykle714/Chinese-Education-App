import { useCallback, useEffect, useState } from "react";

// localStorage key for Word Search's own (non-shared) preferences.
const STORAGE_KEY = "wordSearch.settings";

export interface WordSearchSettings {
    /** Whether the HUD's count-up timer TEXT is visible — the clock itself
     *  always keeps ticking regardless (see WordSearchPage). */
    showTimer: boolean;
}

const DEFAULT_SETTINGS: WordSearchSettings = {
    showTimer: true,
};

function loadSettings(): WordSearchSettings {
    if (typeof window === "undefined") return DEFAULT_SETTINGS;
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return DEFAULT_SETTINGS;
        return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch {
        return DEFAULT_SETTINGS;
    }
}

/**
 * useWordSearchSettings — persists Word Search's own preferences in
 * localStorage, mirroring useFlashcardLearnSettings. Pinyin display is
 * intentionally NOT here: it reuses the shared useFlashcardLearnSettings so
 * the toggle stays in sync with flp (see WordSearchPage / WordSearchSettingsDialog).
 */
export function useWordSearchSettings() {
    const [settings, setSettings] = useState<WordSearchSettings>(loadSettings);

    useEffect(() => {
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        } catch {
            // Storage full or disabled — silent, settings still work in-memory.
        }
    }, [settings]);

    const update = useCallback((patch: Partial<WordSearchSettings>) => {
        setSettings((prev) => ({ ...prev, ...patch }));
    }, []);

    return { settings, update };
}
