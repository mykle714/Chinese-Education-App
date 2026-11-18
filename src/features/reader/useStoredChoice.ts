import { useCallback, useState } from "react";

/**
 * A per-DEVICE choice from a closed set, remembered in localStorage — the shared engine
 * behind the `/reader` list page's three preferences:
 *   - useReaderListView      grid ⇄ list
 *   - useReaderCollection    all / Documents / Journal
 *   - useReaderListSort      newest, oldest, title, recently edited, length
 *
 * A stored value outside `allowed` (unset, or left over from an older build) reads as
 * `fallback`. Storage can be unavailable (private mode, blocked site data); then the
 * choice simply lasts for the page's lifetime.
 *
 * Layer: feature hook (src/features/reader).
 * Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § List views, § "Collections", § "Sorting".
 */
export function useStoredChoice<T extends string>(
    storageKey: string,
    allowed: readonly T[],
    fallback: T,
): [T, (next: T) => void] {
    const [value, setValue] = useState<T>(() => {
        try {
            const stored = localStorage.getItem(storageKey);
            return stored !== null && (allowed as readonly string[]).includes(stored) ? (stored as T) : fallback;
        } catch {
            return fallback;
        }
    });

    const setChoice = useCallback((next: T) => {
        setValue(next);
        try {
            localStorage.setItem(storageKey, next);
        } catch {
            // Storage unavailable: the choice won't outlive this page.
        }
    }, [storageKey]);

    return [value, setChoice];
}
