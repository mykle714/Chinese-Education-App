import { useCallback, useEffect, useState } from "react";

/**
 * useLocalGameSettings — one game's device-local preferences, persisted to
 * localStorage under `storageKey` and merged over `defaults` on load (so a newly
 * added field picks up its default for existing users). Storage that is full,
 * disabled or holds unparseable JSON falls back to `defaults` / in-memory only.
 *
 * Used by: useWordSearchSettings (Word Search), WritingGridPage (Writing Grid).
 * `defaults` is read once, on mount — pass a module-level constant.
 */
export function useLocalGameSettings<T extends object>(storageKey: string, defaults: T) {
    const [settings, setSettings] = useState<T>(() => {
        if (typeof window === "undefined") return defaults;
        try {
            const raw = window.localStorage.getItem(storageKey);
            return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
        } catch {
            return defaults;
        }
    });

    useEffect(() => {
        try {
            window.localStorage.setItem(storageKey, JSON.stringify(settings));
        } catch {
            // Storage full or disabled — silent, settings still work in-memory.
        }
    }, [storageKey, settings]);

    const update = useCallback((patch: Partial<T>) => {
        setSettings((prev) => ({ ...prev, ...patch }));
    }, []);

    return { settings, update };
}
