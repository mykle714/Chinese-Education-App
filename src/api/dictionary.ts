/**
 * dictionary.ts — the client's typed dictionary-table (det) reads.
 *
 * Today this holds the single lookup every "show me everything about this word"
 * surface goes through: the eip's drill-in tabs (useEipTabs.openForEntryKey), the
 * eip opened from the sort cards page (acp), and the read-only card detail page.
 *
 * Per docs/FRONTEND_LAYERING.md §3.2 nothing here takes a `token`: it goes through
 * src/api/http.ts, which resolves the Authorization header at call time.
 */
import { apiGet, apiPost } from './http';
import { dictionaryEntryToVocabEntry } from '../utils/dictEntryAdapter';
import type { DictionaryEntry } from '../types';
import type { VocabEntry } from '../features/flashcards/types';

/**
 * Look up one headword in the det tables and adapt it into the `VocabEntry` shape the
 * eip / card-detail surfaces render from.
 *
 * `language` is optional and, when omitted, the server scopes the lookup to the
 * account's selectedLanguage (see DictionaryController.lookupTerm). Pass it explicitly
 * from any surface whose displayed language comes from somewhere other than the account
 * setting — acp reads its language from the route (`/discover/sort/:language`), so
 * without it a Chinese-selected account sorting Spanish would 404 on every lookup.
 *
 * Throws (via apiGet) on a non-2xx — notably 404 for a word with no det row.
 */
export async function lookupVocabEntry(entryKey: string, language?: string): Promise<VocabEntry> {
    const dictData = await apiGet<DictionaryEntry>(
        `/api/dictionary/lookup/${encodeURIComponent(entryKey)}`,
        { params: language ? { language } : undefined }
    );
    return dictionaryEntryToVocabEntry(dictData);
}

/** One English lookup key's best det match (DictionaryController.englishMatches). */
export interface EnglishDictionaryMatch {
    // The lookup key, as the server normalized it (lowercased, leading "to"/"the"/"a" dropped).
    term: string;
    // 1-based position of the det row's sense that equals `term` (lower = a more central meaning).
    senseOrdinal: number;
    entry: DictionaryEntry;
    // Whether `entry` is among the learner's Learning cards — seeds the Reader's Add key
    // so it renders with the keycap rather than after a status fetch.
    inLearning: boolean;
}

/**
 * The Reader's English → Chinese lookup: for each key, the best det row having a sense that
 * IS that key; keys with no such row are absent. Chinese only (the server returns nothing
 * for another language). One call per document open — the server scans every sense, ~1 s.
 * Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "English words".
 */
export async function fetchEnglishDictionaryMatches(terms: string[], language: string): Promise<EnglishDictionaryMatch[]> {
    if (terms.length === 0) return [];
    const data = await apiPost<{ matches: EnglishDictionaryMatch[] }>('/api/dictionary/englishMatches', { terms, language });
    return data.matches ?? [];
}
