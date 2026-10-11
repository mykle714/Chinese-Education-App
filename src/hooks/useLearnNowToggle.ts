import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../AuthContext";
import { addToLibrary, getLibraryStatus, removeFromLibrary } from "../utils/vocabApi";
import type { Language, VocabEntry } from "../types";

/**
 * Learn Now membership of ONE word, as a toggle — the state behind `LearnNowToggle`
 * (src/components/LearnNowToggle.tsx). ("Learn Now" is the UI name of the internal
 * `'library'` bucket — CLAUDE.md § Terminology; the API helpers keep `library`.)
 *
 * A TOGGLE, not an add-only button: removal is never a delete — the server demotes the
 * row to 'provisional', keeping its marks, and a re-add promotes it back in place
 * (VocabEntryService.removeFromLibrary), so it needs no confirmation.
 *
 * Membership is fetched per word and stored WITH its entryKey, so when the hook's entry
 * changes (an eip tab switch, a drill-in) `inLibrary` reads `undefined` until THAT word's
 * status arrives — callers render nothing meanwhile, so the control never flashes "+" on
 * a word that is already added. A failed status fetch falls back to "+" (adding is
 * idempotent server-side, so a wrong "+" costs at most a no-op tap).
 *
 * Only discoverable entries can join Learn Now, and only for a signed-in user; for any
 * other entry (or `null`) the hook stays inert and `available` is false.
 *
 * Hosts: EipSheet (the Dictionary page's eip) and DictionaryCardDetailPage.
 * Docs: docs/LEAF_NODE_PAGES.md § "Read-only dictionary cdp".
 */
export function useLearnNowToggle(entry: VocabEntry | null | undefined, language: Language) {
    const { user } = useAuth();
    const entryKey = entry?.entryKey;
    const available = !!entry?.discoverable && !!user?.id;

    const [status, setStatus] = useState<{ entryKey: string; inLibrary: boolean } | null>(null);
    const [pending, setPending] = useState(false);
    // Failure message for the host's snackbar. Success is silent — the toggle is the feedback.
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!entryKey || !available) return;
        let cancelled = false;
        getLibraryStatus(entryKey, language)
            .then((data) => { if (!cancelled) setStatus({ entryKey, inLibrary: data.inLibrary }); })
            .catch((err) => {
                console.error("Failed to load Learn Now status:", err);
                if (!cancelled) setStatus({ entryKey, inLibrary: false });
            });
        return () => { cancelled = true; };
        // Keyed on the stable auth identity (via `available`), never `token`
        // (CLAUDE.md token-refresh rule).
    }, [entryKey, available, language]);

    const inLibrary = available && entryKey && status?.entryKey === entryKey ? status.inLibrary : undefined;

    const toggle = useCallback(async () => {
        if (!entryKey || inLibrary === undefined || pending) return;
        setPending(true);
        try {
            if (inLibrary) {
                await removeFromLibrary(entryKey, language);
                setStatus({ entryKey, inLibrary: false });
            } else {
                // 'already-in-library' also lands on "Added!" — either way the word is in.
                await addToLibrary(entryKey, language);
                setStatus({ entryKey, inLibrary: true });
            }
        } catch (err) {
            console.error("Failed to update Learn Now:", err);
            setError(inLibrary ? "Failed to remove from Learn Now" : "Failed to add to Learn Now");
        } finally {
            setPending(false);
        }
        // No `token` dep: the API helpers read the header at call time.
    }, [entryKey, inLibrary, pending, language]);

    const clearError = useCallback(() => setError(null), []);

    return { available, inLibrary, pending, toggle, error, clearError };
}

export type LearnNowToggleState = ReturnType<typeof useLearnNowToggle>;
