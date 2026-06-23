import { useCallback, useEffect, useState } from 'react';

// localStorage key for the user's TTS preferences. Single JSON blob so adding
// new knobs later (e.g. voice selection) doesn't require new keys.
const STORAGE_KEY = 'tts.settings';

export interface TTSSettings {
    enabled: boolean;
}

const DEFAULT_SETTINGS: TTSSettings = {
    enabled: true,
};

function loadSettings(): TTSSettings {
    if (typeof window === 'undefined') return DEFAULT_SETTINGS;
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return DEFAULT_SETTINGS;
        const parsed = JSON.parse(raw);
        return { ...DEFAULT_SETTINGS, ...parsed };
    } catch {
        // Malformed localStorage value — fall back to defaults rather than crash.
        return DEFAULT_SETTINGS;
    }
}

/**
 * useTTSSettings — persists narration preferences in localStorage.
 *
 * Future: migrate to a server-backed user preferences column when we want
 * cross-device sync. The shape can stay the same.
 */
export function useTTSSettings() {
    const [settings, setSettings] = useState<TTSSettings>(loadSettings);

    useEffect(() => {
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        } catch {
            // Storage full or disabled — silent, settings still work in-memory.
        }
    }, [settings]);

    const update = useCallback((patch: Partial<TTSSettings>) => {
        setSettings(prev => ({ ...prev, ...patch }));
    }, []);

    return { settings, update };
}
