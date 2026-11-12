import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../AuthContext";
import { afterNextPaint } from "../utils/afterNextPaint";
import { addToLibrary, getLibraryStatus, removeFromLibrary } from "../utils/vocabApi";
import type { Language, VocabEntry } from "../types";

/**
 * Learning membership of ONE word, as a toggle — the state behind the eip's Add key
 * (`EipAddKey`). ("Learning" is the UI name of the internal
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
 * OPTIMISTIC: a tap flips the control immediately and the request runs after the next
 * paint; there is no in-flight/disabled state. Rapid taps are serialized per word (one
 * request at a time, ending on the last tap); a failed request snaps the control back to
 * the server's last accepted state and raises `error`.
 *
 * Only discoverable entries can join Learning, and only for a signed-in user; for any
 * other entry (or `null`) the hook stays inert and `available` is false.
 *
 * `inLibraryOnLoad` is the server's answer when the word was last loaded, untouched by
 * taps. The flp eip is ADD-ONLY: it draws the key only when this is `false`, so a word
 * already in Learning shows no key, a tapped word keeps "Added!" (and stays removable)
 * while it is showing, and the key disappears the next time that word is loaded.
 *
 * Hosts: EipSheet (the Dictionary page's and the saved-card cdp's eip) and the flp
 * (FlashcardsLearnPage, add-only), both drawn as EipAddKey.
 * (The read-only dictionary cdp drew it as a glowing `LearningToggle` until both were
 * deleted 2026-11-10.) Docs: docs/EIP_SHEET_GESTURES.md § Add key.
 */
export function useLearningToggle(entry: VocabEntry | null | undefined, language: Language) {
    const { user } = useAuth();
    const entryKey = entry?.entryKey;
    const available = !!entry?.discoverable && !!user?.id;

    // What the control SHOWS: the server's answer at first, then the learner's latest tap.
    const [status, setStatus] = useState<{ entryKey: string; inLibrary: boolean } | null>(null);
    // What the server said when THIS word's status was last LOADED (taps don't move it).
    // Lets an add-only host (the flp eip) hide the key on words already in Learning while
    // still showing "Added!" after a tap — until the next load re-evaluates the word.
    const [loaded, setLoaded] = useState<{ entryKey: string; inLibrary: boolean } | null>(null);
    // Failure message for the host's snackbar. Success is silent — the toggle is the feedback.
    const [error, setError] = useState<string | null>(null);

    // OPTIMISTIC SYNC, per entryKey (refs, not state — none of this is rendered):
    //   confirmed = what the server last told us / last accepted
    //   desired   = what the learner last tapped to
    //   syncing   = keys with a request loop running
    // A tap flips `status` (and `desired`) at once and only THEN, after the next paint,
    // starts the request — so the key's state change is never held behind the network.
    // Keyed by entryKey so a tap followed by a quick switch to another word still lands.
    const confirmedRef = useRef(new Map<string, boolean>());
    const desiredRef = useRef(new Map<string, boolean>());
    const syncingRef = useRef(new Set<string>());
    // The word on screen, read by the sync loop when it reverts after a failure.
    const entryKeyRef = useRef(entryKey);
    entryKeyRef.current = entryKey;

    useEffect(() => {
        if (!entryKey || !available) return;
        let cancelled = false;
        getLibraryStatus(entryKey, language)
            .then((data) => {
                // A sync loop for this word owns its state until it settles; a status
                // read that raced it would show a stale answer.
                if (cancelled || syncingRef.current.has(entryKey)) return;
                confirmedRef.current.set(entryKey, data.inLibrary);
                desiredRef.current.set(entryKey, data.inLibrary);
                setStatus({ entryKey, inLibrary: data.inLibrary });
                setLoaded({ entryKey, inLibrary: data.inLibrary });
            })
            .catch((err) => {
                console.error("Failed to load Learning status:", err);
                if (cancelled || syncingRef.current.has(entryKey)) return;
                confirmedRef.current.set(entryKey, false);
                desiredRef.current.set(entryKey, false);
                setStatus({ entryKey, inLibrary: false });
                setLoaded({ entryKey, inLibrary: false });
            });
        return () => { cancelled = true; };
        // Keyed on the stable auth identity (via `available`), never `token`
        // (CLAUDE.md token-refresh rule).
    }, [entryKey, available, language]);

    const inLibrary = available && entryKey && status?.entryKey === entryKey ? status.inLibrary : undefined;
    // The server's answer at the last load of the showing word; `undefined` while loading.
    // Re-evaluated whenever the word is loaded again (the effect above re-runs when the
    // entry changes, e.g. trail A → B → A, or the eip reopening on the next card).
    const inLibraryOnLoad = available && entryKey && loaded?.entryKey === entryKey ? loaded.inLibrary : undefined;

    // Drives the server to the learner's latest tap for `key`. One loop per key: taps that
    // land while a request is in flight only move `desired`, and the loop sends one more
    // request when the current one returns if the two still differ — so a rapid
    // add → remove → add sends at most one request at a time and always ends on the last tap.
    const sync = useCallback(async (key: string) => {
        if (syncingRef.current.has(key)) return;
        syncingRef.current.add(key);
        try {
            for (;;) {
                const want = desiredRef.current.get(key);
                if (want === undefined || want === confirmedRef.current.get(key)) break;
                if (want) {
                    // 'already-in-library' also counts as added — either way the word is in.
                    await addToLibrary(key, language);
                } else {
                    await removeFromLibrary(key, language);
                }
                confirmedRef.current.set(key, want);
            }
        } catch (err) {
            console.error("Failed to update Learning:", err);
            // Snap back to the last state the server accepted, and say so.
            const confirmed = confirmedRef.current.get(key) ?? false;
            desiredRef.current.set(key, confirmed);
            if (entryKeyRef.current === key) setStatus({ entryKey: key, inLibrary: confirmed });
            setError(confirmed ? "Failed to remove from Learning" : "Failed to add to Learning");
        } finally {
            syncingRef.current.delete(key);
        }
        // No `token` dep: the API helpers read the header at call time.
    }, [language]);

    const toggle = useCallback(() => {
        if (!entryKey || inLibrary === undefined) return;
        const next = !inLibrary;
        desiredRef.current.set(entryKey, next);
        setStatus({ entryKey, inLibrary: next });
        // The request waits for the flipped key to paint (afterNextPaint).
        afterNextPaint(() => { void sync(entryKey); });
    }, [entryKey, inLibrary, sync]);

    const clearError = useCallback(() => setError(null), []);

    return { available, inLibrary, inLibraryOnLoad, toggle, error, clearError };
}

export type LearningToggleState = ReturnType<typeof useLearningToggle>;
