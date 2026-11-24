import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PronunciationOverride } from "../../server/contracts/wire";
import { buildOverrideLookup, cycleOverride, readingOptionsFor, type OverrideTarget } from "./pronunciationOverrides";
import type { DictionaryEntry } from "../types";

// Taps closer together than this are saved as one PUT (cycling 着 through four readings
// is four quick taps, not four requests).
const SAVE_DEBOUNCE_MS = 600;

const NO_OVERRIDES: PronunciationOverride[] = [];

interface UsePronunciationOverridesOptions {
    /**
     * The document's stored list (texts."pronunciationOverrides"). A NEW array identity —
     * a fetched document, the server's answer to an edit save — reseeds the state; the
     * hook's own taps never change it (they are saved without replacing the document).
     */
    saved: PronunciationOverride[] | null | undefined;
    /**
     * Writes the whole list. Omitted = the choices last only for the page visit (a
     * surface without a saved document, e.g. a cyoa story).
     */
    persist?: (overrides: PronunciationOverride[]) => Promise<unknown>;
    /** A save failed (the caller raises its notification). */
    onPersistError?: (error: unknown) => void;
}

/**
 * usePronunciationOverrides — READING CHOICES state for one document
 * (docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Reading choices"; pure rules in
 * ./pronunciationOverrides.ts).
 *
 *   - `overrides` — the live list (optimistic: a tap shows at once);
 *   - `lookup` — span → toned override, for the Pinyin view, read-aloud, preloading, search;
 *   - `cycle(target, entry)` — one tap on the rdb headword: next reading for that
 *     occurrence. Returns false when the word has under two readings (the caller then
 *     copies instead);
 *   - `flush()` — sends a pending debounced save now. The Reader calls it before opening
 *     the editor, whose Save carries the shifted list itself.
 *
 * SAVING: debounced, and chained so PUTs land in tap order (a slow earlier request can
 * never overwrite a later list). The list is never re-read from a save's response.
 * A pending save is flushed on unmount.
 *
 * Layer: shared client state (src/reading). Depended on by
 * src/features/reader/ReaderDocumentPage.tsx (via useReadingKeycap's `readingChoices`).
 */
export function usePronunciationOverrides({ saved, persist, onPersistError }: UsePronunciationOverridesOptions) {
    const seed = saved ?? NO_OVERRIDES;
    const [state, setState] = useState({ source: seed, overrides: seed });
    // Reseed on a new stored list (adjusting state during render, React's documented
    // pattern for "reset when a prop changes" — no extra committed frame with stale data).
    let overrides = state.overrides;
    if (state.source !== seed) {
        overrides = seed;
        setState({ source: seed, overrides: seed });
    }

    // Latest values for the timer/unmount paths, which must not capture stale closures.
    const latestRef = useRef({ persist, onPersistError });
    latestRef.current = { persist, onPersistError };
    const pendingRef = useRef<PronunciationOverride[] | null>(null);
    const timerRef = useRef<number | null>(null);
    const chainRef = useRef<Promise<void>>(Promise.resolve());

    const flush = useCallback(() => {
        if (timerRef.current !== null) {
            window.clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        const list = pendingRef.current;
        const save = latestRef.current.persist;
        pendingRef.current = null;
        if (!list || !save) return;
        chainRef.current = chainRef.current
            .then(() => save(list))
            .then(() => undefined)
            .catch((error) => {
                console.error("Reader: failed to save reading choices:", error);
                latestRef.current.onPersistError?.(error);
            });
    }, []);

    // Flush on unmount: leaving the page right after a tap must not lose the choice.
    useEffect(() => flush, [flush]);

    const cycle = useCallback((target: OverrideTarget, entry: DictionaryEntry | null | undefined): boolean => {
        const options = readingOptionsFor(entry);
        if (options.length < 2) return false;
        const next = cycleOverride(overrides, target, options);
        setState((previous) => ({ source: previous.source, overrides: next }));
        if (latestRef.current.persist) {
            pendingRef.current = next;
            if (timerRef.current !== null) window.clearTimeout(timerRef.current);
            timerRef.current = window.setTimeout(flush, SAVE_DEBOUNCE_MS);
        }
        return true;
    }, [overrides, flush]);

    const lookup = useMemo(() => buildOverrideLookup(overrides), [overrides]);

    // One object per list change, so callers can pass it whole into memos and deps.
    return useMemo(() => ({ overrides, lookup, cycle, flush }), [overrides, lookup, cycle, flush]);
}

export type PronunciationOverridesState = ReturnType<typeof usePronunciationOverrides>;
