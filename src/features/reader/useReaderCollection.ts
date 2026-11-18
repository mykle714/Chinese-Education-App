import { useStoredChoice } from "./useStoredChoice";
import { READER_COLLECTIONS, type ReaderCollection } from "./readerListOrder";

/**
 * Which collection tile (Documents / Journal) is selected on `/reader` — always one,
 * Documents by default (a stored value from an older build, e.g. 'all', reads as
 * Documents). Per DEVICE (localStorage), so finishing a new journal entry and pressing Back
 * returns to the Journal view it was started from.
 *
 * Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Collections (Documents / Journal)".
 * Layer: feature hook (src/features/reader). Depended on by: ReaderPage.tsx.
 */
export function useReaderCollection(): [ReaderCollection, (next: ReaderCollection) => void] {
    return useStoredChoice("reader.collection", READER_COLLECTIONS, "document");
}
