import { useCallback, useEffect, useRef, useState } from 'react';
import type { Language } from '../../types';
import {
    addToHistory,
    clearHistory,
    readHistory,
    removeFromHistory,
    type DictionaryHistoryEntry,
} from './dictionarySearchHistory';

/**
 * useDictionarySearchHistory — the Dictionary's recent-queries list plus the rules for
 * WHEN a query earns a place in it.
 *
 * ── Why "commit" is not "every search" ────────────────────────────────────────
 * The dictionary searches as you type (useDictionarySearch, 400 ms debounce), so every
 * pause mid-word fires a search: typing "hello" may search "hel" first. Saving each one
 * would fill the list with fragments. A query is saved only once the learner shows they
 * meant it (owner's list, 2026-11-17):
 *
 *   1. They open a result (eip)                          → `commit()` from the page
 *   2. They press Enter / the keyboard's Search key      → `commit()` from the page
 *   3. They scroll the results, or swipe a result's dd   → the scroll listener below
 *   4. The term sits unchanged for SETTLE_MS             → the settle timer below
 *
 * 3 and 4 also require that the term actually found something (`hasResults`): a typo
 * with no hits is not worth re-running. 1 and 2 are explicit, so they always save.
 *
 * ── The scroll trigger (3) ───────────────────────────────────────────────────
 * Scroll events do not bubble, but a CAPTURING listener on `document` sees every one.
 * Two scrollers count: the page's own scroll area (MobileTabScreen's, an ANCESTOR of
 * `rootRef`) and each result's swipeable gloss line (SwipeableTextLine, a native
 * horizontal scroller INSIDE `rootRef`). Layout changes can also fire `scroll` (results
 * shrinking under a scrolled page clamps scrollTop), so a scroll only counts within
 * GESTURE_WINDOW_MS of a real touch / pointer / wheel.
 *
 * Each term commits at most once per appearance (`committedTermRef`), so a long scroll
 * does not rewrite storage on every frame.
 *
 * Layer: feature hook (React state over the pure storage module).
 * Used by: DictionaryPage.tsx. Docs: docs/SHELF_REDESIGN.md § 7c "Search history".
 */

const SETTLE_MS = 5000;
const GESTURE_WINDOW_MS = 1500;

interface Options {
    userId: string | number | undefined;
    language: Language;
    /** The term the results on screen belong to (debounced). */
    activeTerm: string;
    /** The active term has hits on screen (rows, segment groups or an AI card). */
    hasResults: boolean;
    /** Auto-commit is paused while false — e.g. while the history panel covers the results. */
    autoCommitEnabled: boolean;
    /** The page's content root, to scope the scroll trigger. */
    rootRef: React.RefObject<HTMLElement | null>;
}

export function useDictionarySearchHistory({
    userId,
    language,
    activeTerm,
    hasResults,
    autoCommitEnabled,
    rootRef,
}: Options) {
    const [entries, setEntries] = useState<DictionaryHistoryEntry[]>(() => readHistory(userId, language));

    // Re-read when the account or language changes (keyed on the stable user id, never on
    // the rotating auth token — CLAUDE.md § "Never reload/reset a page on a silent token refresh").
    useEffect(() => {
        setEntries(readHistory(userId, language));
    }, [userId, language]);

    // The last term committed, so the auto triggers fire once per term.
    const committedTermRef = useRef<string | null>(null);

    const commit = useCallback((query: string) => {
        const trimmed = query.trim();
        if (!trimmed) return;
        committedTermRef.current = trimmed;
        setEntries(addToHistory(userId, language, trimmed));
    }, [userId, language]);

    const remove = useCallback((query: string) => {
        setEntries(removeFromHistory(userId, language, query));
    }, [userId, language]);

    const clearAll = useCallback(() => {
        clearHistory(userId, language);
        setEntries([]);
    }, [userId, language]);

    const term = activeTerm.trim();
    const autoEligible = autoCommitEnabled && hasResults && term !== '' && committedTermRef.current !== term;

    // ── 4. Settle: SETTLE_MS on one term with results showing. ──
    useEffect(() => {
        if (!autoEligible) return;
        const timer = setTimeout(() => commit(term), SETTLE_MS);
        return () => clearTimeout(timer);
    }, [autoEligible, term, commit]);

    // ── 3. Scroll / dd swipe, gated on a recent real gesture. ──
    useEffect(() => {
        if (!autoEligible) return;
        let lastGestureAt = 0;
        const markGesture = () => { lastGestureAt = Date.now(); };
        const onScroll = (event: Event) => {
            if (Date.now() - lastGestureAt > GESTURE_WINDOW_MS) return;
            const root = rootRef.current;
            const target = event.target;
            // `document` itself scrolls nothing here (the app shell never scrolls) and it
            // "contains" everything, so it must not pass the ancestor test below.
            if (!root || !(target instanceof Element)) return;
            if (target.contains(root) || root.contains(target)) commit(term);
        };
        const opts = { capture: true, passive: true } as const;
        document.addEventListener('touchstart', markGesture, opts);
        document.addEventListener('pointerdown', markGesture, opts);
        document.addEventListener('wheel', markGesture, opts);
        document.addEventListener('scroll', onScroll, opts);
        return () => {
            document.removeEventListener('touchstart', markGesture, opts);
            document.removeEventListener('pointerdown', markGesture, opts);
            document.removeEventListener('wheel', markGesture, opts);
            document.removeEventListener('scroll', onScroll, opts);
        };
    }, [autoEligible, term, commit, rootRef]);

    return { entries, commit, remove, clearAll };
}
