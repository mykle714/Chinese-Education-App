import { useLocalGameSettings } from "../shared/useLocalGameSettings";

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

/**
 * useWordSearchSettings — persists Word Search's own preferences in
 * localStorage (shared mechanics: useLocalGameSettings). Pinyin display is
 * intentionally NOT here: it is fixed by which hub entry (Pinyin / No Pinyin)
 * launched the run, not a preference (docs/WORD_SEARCH_GAME.md §3).
 */
export function useWordSearchSettings() {
    return useLocalGameSettings(STORAGE_KEY, DEFAULT_SETTINGS);
}
