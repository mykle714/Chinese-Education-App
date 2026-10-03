import { useCallback, useEffect, useState } from "react";

// localStorage key for Word Search's own (non-shared) preferences.
const STORAGE_KEY = "wordSearch.settings";

export interface WordSearchSettings {
    /** Whether the HUD's count-up timer TEXT is visible — the clock itself
     *  always keeps ticking regardless. Toggled by the eye in the HUD strip
     *  (see WordSearchPage), and also read by the hub's resume card
     *  (WordSearchHubItem), which drops the parked time when this is false.
     *  Device-local (localStorage), so it outlives the session.
     *  docs/WORD_SEARCH_GAME.md §3. */
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
 * intentionally NOT here: it is fixed by which hub entry (Pinyin / No Pinyin)
 * launched the run, not a preference (docs/WORD_SEARCH_GAME.md §3).
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
