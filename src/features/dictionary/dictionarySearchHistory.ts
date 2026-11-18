import type { Language } from '../../types';

/**
 * dictionarySearchHistory.ts — the Dictionary's recent-queries list, kept in localStorage.
 *
 * ── Scope ─────────────────────────────────────────────────────────────────────
 * Per DEVICE (owner's call 2026-11-17): no table, no API. Keyed per (user, language) so two
 * accounts on one browser never see each other's lookups, and a learner's Chinese and
 * Spanish searches stay apart (the same language scoping every det/vet read follows).
 *
 * ── Shape ─────────────────────────────────────────────────────────────────────
 * Newest first, at most MAX_HISTORY entries. A query searched again MOVES to the top
 * rather than appearing twice; duplicates are matched on the trimmed, lower-cased text
 * (`Ni hao` and `ni hao` are one query), and the newest spelling wins.
 *
 * Layer: feature module (pure storage, no React). Every read and write is wrapped:
 * storage can be unavailable (private mode, quota) and the history is a convenience,
 * so a failure degrades to "no history" instead of throwing into the page.
 *
 * Used by: useDictionarySearchHistory.ts. Docs: docs/SHELF_REDESIGN.md § 7c "Search history".
 */

export interface DictionaryHistoryEntry {
    /** The query exactly as searched (trimmed). */
    query: string;
    /** Epoch ms of the most recent time it was committed. */
    searchedAt: number;
}

export const MAX_HISTORY = 50;

const storageKey = (userId: string | number | undefined, language: Language) =>
    `dictionary.searchHistory.${userId ?? 'anon'}.${language}`;

/** Identity used to collapse duplicates. */
const dedupeKey = (query: string) => query.trim().toLowerCase();

/** A stored value that is not a well-formed list is treated as empty (never thrown). */
function isEntry(value: unknown): value is DictionaryHistoryEntry {
    if (typeof value !== 'object' || value === null) return false;
    const v = value as Record<string, unknown>;
    return typeof v.query === 'string' && v.query.trim() !== '' && typeof v.searchedAt === 'number';
}

export function readHistory(userId: string | number | undefined, language: Language): DictionaryHistoryEntry[] {
    try {
        const raw = localStorage.getItem(storageKey(userId, language));
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter(isEntry).slice(0, MAX_HISTORY) : [];
    } catch {
        return [];
    }
}

function writeHistory(userId: string | number | undefined, language: Language, entries: DictionaryHistoryEntry[]) {
    try {
        localStorage.setItem(storageKey(userId, language), JSON.stringify(entries));
    } catch {
        // Storage unavailable — the list just won't outlive this page.
    }
}

/** Put `query` at the top (moving it if already present). Returns the new list. */
export function addToHistory(
    userId: string | number | undefined,
    language: Language,
    query: string,
): DictionaryHistoryEntry[] {
    const trimmed = query.trim();
    const current = readHistory(userId, language);
    if (!trimmed) return current;
    const key = dedupeKey(trimmed);
    const next = [
        { query: trimmed, searchedAt: Date.now() },
        ...current.filter((e) => dedupeKey(e.query) !== key),
    ].slice(0, MAX_HISTORY);
    writeHistory(userId, language, next);
    return next;
}

/** Drop one query (the row's ✕). Returns the new list. */
export function removeFromHistory(
    userId: string | number | undefined,
    language: Language,
    query: string,
): DictionaryHistoryEntry[] {
    const key = dedupeKey(query);
    const next = readHistory(userId, language).filter((e) => dedupeKey(e.query) !== key);
    writeHistory(userId, language, next);
    return next;
}

/** Empty the list (the panel's "Clear all"). */
export function clearHistory(userId: string | number | undefined, language: Language): void {
    writeHistory(userId, language, []);
}
