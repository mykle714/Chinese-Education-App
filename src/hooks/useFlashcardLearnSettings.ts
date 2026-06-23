import { useCallback, useEffect, useState } from 'react';

// localStorage key for the flashcards learn-page preferences. Single JSON blob
// so adding new knobs later doesn't require new keys or a migration.
const STORAGE_KEY = 'flashcard.learn-settings';

export interface FlashcardLearnSettings {
    showPinyin: boolean;
    showPinyinColor: boolean;
    showSegmentSpaces: boolean;
    autoplayChinese: boolean;
    // Show the card's progress category (Unfamiliar/Target/Comfortable/Mastered)
    // as a colored chip on the back (Side 2) of the card. Opt-in, off by default.
    showProgressCategory: boolean;
    // Slow down example-sentence (est) narration to 0.65× for easier listening.
    // Scoped to the est tab only — the flashcard word itself always plays at 1×,
    // as does all narration outside the flp. Off (1×) by default. See useTTS /
    // SLOW_SENTENCE_RATE and FlashcardsLearnPage's onSpeakSentence wiring.
    slowExampleSentences: boolean;
}

const DEFAULT_SETTINGS: FlashcardLearnSettings = {
    showPinyin: true,
    showPinyinColor: true,
    showSegmentSpaces: false,
    autoplayChinese: true,
    showProgressCategory: false,
    slowExampleSentences: false,
};

function loadSettings(): FlashcardLearnSettings {
    if (typeof window === 'undefined') return DEFAULT_SETTINGS;
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return DEFAULT_SETTINGS;
        const parsed = JSON.parse(raw);
        return { ...DEFAULT_SETTINGS, ...parsed };
    } catch {
        return DEFAULT_SETTINGS;
    }
}

/**
 * useFlashcardLearnSettings — persists the learn-page toggle preferences in
 * localStorage. Mirrors the useTTSSettings pattern so the same migration path
 * (server-backed prefs) applies later.
 */
export function useFlashcardLearnSettings() {
    const [settings, setSettings] = useState<FlashcardLearnSettings>(loadSettings);

    useEffect(() => {
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        } catch {
            // Storage full or disabled — silent, settings still work in-memory.
        }
    }, [settings]);

    const update = useCallback((patch: Partial<FlashcardLearnSettings>) => {
        setSettings(prev => ({ ...prev, ...patch }));
    }, []);

    return { settings, update };
}
