import { useCallback, useEffect, useState } from 'react';

// localStorage key for the flashcards learn-page preferences. Single JSON blob
// so adding new knobs later doesn't require new keys or a migration.
const STORAGE_KEY = 'flashcard.learn-settings';

export interface FlashcardLearnSettings {
    // Whether the reading line shows at all. Toggled from the flp header chip and
    // the Match Speed settings sheet; read by every surface that renders a reading.
    showPinyin: boolean;
    // Whether that reading is tinted by tone. Toggled from /settings → Display (it
    // is a display preference, not a study control) and from Match Speed's sheet.
    showPinyinColor: boolean;
    // NOTE: this hook no longer has a settings sheet of its own. The flp's sheet was
    // deleted on 2026-08-28 once its last row moved out; both prefs above are now
    // edited from the flp header chip and /settings. Three things that used to live
    // here and where they went:
    //   • word spacing → account-level (users."showSegmentSpaces", migration 129),
    //     so the eip and the cdp can't disagree. Read from useAuth(), toggled on the
    //     Account page. See docs/EXAMPLE_SENTENCES.md.
    //   • narration autoplay → the unified narration setting (useTTSSettings, the
    //     3-state Off/Passthrough/Media control), because it applies to the games and
    //     the scp as much as to the flp. See docs/AUDIO_PLAYBACK.md.
    //   • progress category on the card back → DELETED with the chip it drove.
}

const DEFAULT_SETTINGS: FlashcardLearnSettings = {
    showPinyin: true,
    showPinyinColor: true,
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
