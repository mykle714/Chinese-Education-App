import { useStoredChoice } from "./useStoredChoice";
import { READER_SORT_KEYS, type ReaderSortKey } from "./readerListOrder";

/**
 * The `/reader` list's sort order, picked from the header sort menu (ReaderSortMenu).
 * Per DEVICE (localStorage). Default 'newest', the server's own `createdAt DESC` order.
 *
 * Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Sorting".
 * Layer: feature hook (src/features/reader). Depended on by: ReaderPage.tsx.
 */
export function useReaderListSort(): [ReaderSortKey, (next: ReaderSortKey) => void] {
    return useStoredChoice("reader.listSort", READER_SORT_KEYS, "newest");
}
