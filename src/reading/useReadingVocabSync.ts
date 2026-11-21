import { useEffect, useRef } from "react";
import { useVocabularyUpdate } from "../contexts/VocabularyUpdateContext";
import { processDocumentForTokens } from "../utils/tokenUtils";
import type { VocabEntry } from "../types";
import type { ReadingSelection } from "./useReadingText";

/**
 * useReadingVocabSync — keeps a reading page's loaded personal cards in step with entries
 * added / edited / removed elsewhere in the app while it is open (VocabularyUpdateContext):
 * the keycap's Add key, the eip and other pages all announce through it.
 *
 *   add / bulk add — kept when the entry is one of `content`'s tokens;
 *   update         — replaced in place (or added, if now relevant), and swapped into any
 *                    selection currently showing it;
 *   remove         — dropped, and cleared from any selection showing it.
 *
 * `selections` = every text the page reads (the Reader: one; cyoa: passage + label), all
 * resolving against the same loaded cards. Read through a ref, so the subscriptions are
 * renewed only when the content changes.
 *
 * Lifted out of ReaderDocumentPage (2026-11-21). Layer: shared client state (src/reading).
 * Depended on by ReaderDocumentPage.tsx, StoryPlayPage.tsx. Docs: docs/CYOA_FEATURE.md § 4.1.
 */
export function useReadingVocabSync(
    content: string | null,
    setLoadedPersonalCards: React.Dispatch<React.SetStateAction<VocabEntry[]>>,
    selections: ReadingSelection[],
) {
    const vocabularyUpdate = useVocabularyUpdate();
    const selectionsRef = useRef(selections);
    selectionsRef.current = selections;

    useEffect(() => {
        if (content === null) return;
        const documentTokens = new Set(processDocumentForTokens(content));
        const isRelevant = (entry: VocabEntry): boolean => documentTokens.has(entry.entryKey);

        const unsubscribeAdd = vocabularyUpdate.onVocabAdd((entry: VocabEntry) => {
            if (!isRelevant(entry)) return;
            setLoadedPersonalCards((prev) => (prev.some((existing) => existing.id === entry.id) ? prev : [...prev, entry]));
        });

        const unsubscribeUpdate = vocabularyUpdate.onVocabUpdate((entry: VocabEntry) => {
            setLoadedPersonalCards((prev) => {
                const index = prev.findIndex((existing) => existing.id === entry.id);
                if (index === -1) return isRelevant(entry) ? [...prev, entry] : prev;
                const updated = [...prev];
                updated[index] = entry;
                return updated;
            });
            for (const selection of selectionsRef.current) {
                if (selection.selectedPersonalCard?.id === entry.id) selection.setSelectedPersonalCard(entry);
            }
        });

        const unsubscribeRemove = vocabularyUpdate.onVocabRemove((entryId: number) => {
            setLoadedPersonalCards((prev) => prev.filter((entry) => entry.id !== entryId));
            for (const selection of selectionsRef.current) {
                if (selection.selectedPersonalCard?.id === entryId) selection.setSelectedPersonalCard(null);
            }
        });

        const unsubscribeBulkAdd = vocabularyUpdate.onVocabBulkAdd((entries: VocabEntry[]) => {
            const relevant = entries.filter(isRelevant);
            if (relevant.length === 0) return;
            setLoadedPersonalCards((prev) => {
                const existingIds = new Set(prev.map((entry) => entry.id));
                return [...prev, ...relevant.filter((entry) => !existingIds.has(entry.id))];
            });
        });

        return () => {
            unsubscribeAdd();
            unsubscribeUpdate();
            unsubscribeRemove();
            unsubscribeBulkAdd();
        };
    }, [content, vocabularyUpdate, setLoadedPersonalCards]);
}
