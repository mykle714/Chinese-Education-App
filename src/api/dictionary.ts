/**
 * dictionary.ts — the client's typed dictionary-table (det) reads.
 *
 * Today this holds the single lookup every "show me everything about this word"
 * surface goes through: the eip's drill-in tabs (useEipTabs.openForEntryKey), the
 * eip opened from the sort cards page (scp), and the read-only card detail page.
 *
 * Per docs/FRONTEND_LAYERING.md §3.2 nothing here takes a `token`: it goes through
 * src/api/http.ts, which resolves the Authorization header at call time.
 */
import { apiGet } from './http';
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
 * setting — scp reads its language from the route (`/discover/sort/:language`), so
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
