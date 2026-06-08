import { useCallback, useEffect, useState } from 'react';

// localStorage key for the Discover (sort cards) page preferences. Single JSON
// blob so adding new knobs later doesn't require new keys or a migration.
const STORAGE_KEY = 'discover.settings';

export interface DiscoverSettings {
    // Narrate the on-deck word automatically each time a new card becomes the
    // active (head) card. Gated additionally by the global TTS enable flag
    // (useTTSSettings) — if narration is off entirely, this is a no-op.
    autoplay: boolean;
}

const DEFAULT_SETTINGS: DiscoverSettings = {
    autoplay: true,
};

function loadSettings(): DiscoverSettings {
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
 * useDiscoverSettings — persists the Discover page toggle preferences in
 * localStorage. Mirrors the useTTSSettings / useFlashcardLearnSettings pattern
 * so the same migration path (server-backed prefs) applies later.
 */
export function useDiscoverSettings() {
    const [settings, setSettings] = useState<DiscoverSettings>(loadSettings);

    useEffect(() => {
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        } catch {
            // Storage full or disabled — silent, settings still work in-memory.
        }
    }, [settings]);

    const update = useCallback((patch: Partial<DiscoverSettings>) => {
        setSettings(prev => ({ ...prev, ...patch }));
    }, []);

    return { settings, update };
}
