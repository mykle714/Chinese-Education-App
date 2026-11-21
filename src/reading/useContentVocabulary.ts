import { useEffect, useState } from "react";
import { useAuth } from "../AuthContext";
import { fetchVocabInBatches } from "../hooks/useVocabularyProcessing";
import { processDocumentForTokens } from "../utils/tokenUtils";
import type { DictionaryEntry, VocabEntry } from "../types";

/**
 * useContentVocabulary — the reading engine's vocabulary for a piece of text that is not a
 * Reader document: the det rows and the learner's own cards for every token in `content`,
 * re-read whenever `content` changes. Used by the cyoa play page (docs/CYOA_FEATURE.md § 4),
 * whose `content` is the passage AND its choice labels joined, so inspecting a choice
 * (§ 3.2) needs no second fetch.
 *
 * Why not useVocabularyProcessing's `processDocumentVocabulary`: that one caches per
 * document id for the page session and skips a document it has seen, which suits a Reader
 * document but would leave a story page on the previous passage's cards when the learner
 * comes back round to a passage. This hook always fetches, and drops a response that a
 * newer `content` has overtaken (rapid choices).
 *
 * Same lookup underneath (`fetchVocabInBatches` → POST /api/vocabEntries/byTokens), so a
 * word resolves exactly as it does in the Reader. Keyed on the stable auth flag, never on
 * `token` (CLAUDE.md "Never reload on token refresh").
 *
 * Layer: shared client state (src/reading). Docs: docs/CYOA_FEATURE.md § 4.2.
 */
export function useContentVocabulary(content: string | null) {
    const { isAuthenticated } = useAuth();
    const [loadedPersonalCards, setLoadedPersonalCards] = useState<VocabEntry[]>([]);
    const [loadedDictionaryCards, setLoadedDictionaryCards] = useState<DictionaryEntry[]>([]);
    const [processingVocab, setProcessingVocab] = useState(false);

    useEffect(() => {
        if (!isAuthenticated || !content) return;
        let cancelled = false;
        setProcessingVocab(true);
        fetchVocabInBatches(processDocumentForTokens(content))
            .then(({ personalEntries, dictionaryEntries }) => {
                if (cancelled) return;
                setLoadedPersonalCards(personalEntries);
                setLoadedDictionaryCards(dictionaryEntries);
            })
            .catch((error) => {
                // The text stays readable; its words just find no entries.
                if (!cancelled) console.error("[reading] vocabulary lookup failed:", error);
            })
            .finally(() => {
                if (!cancelled) setProcessingVocab(false);
            });
        return () => { cancelled = true; };
    }, [content, isAuthenticated]);

    return { loadedPersonalCards, loadedDictionaryCards, setLoadedPersonalCards, processingVocab };
}
