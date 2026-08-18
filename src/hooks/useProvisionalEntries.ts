import { useEffect, useState } from "react";
import { fetchProvisionalSortSet } from "../api/provisional";
import { discoverCardToProvisionalEntry } from "../utils/provisionalCards";
import type { Language, VocabEntry } from "../types";

/**
 * useProvisionalEntries — the lent cards for a set of words, as VocabEntry rows ready
 * for `MiniVocabCard`.
 *
 * Two kinds of surface need this preview (docs/PROVISIONAL_CARDS.md § 5):
 *
 *   1. those holding the real served cards (Bubble Match, Speed Reading) — they pass
 *      `localEntries` from `provisionalEntries(cards)` and this hook never fetches;
 *   2. those holding only the WORDS — Word Search, whose grid payload carries
 *      `provisionalWords: string[]` rather than vet rows, and every end-of-round sort
 *      offer (Match Speed and flp accumulate words as they deal). Those pass `words`
 *      and the cards are fetched from `GET /api/starterPacks/:language/provisionalSet`,
 *      which is the same set the sort flow itself will show.
 *
 * Path 2 arrives in the DISCOVER shape, so each card goes through
 * `discoverCardToProvisionalEntry`. That adapter is lossy in one visible way — no
 * mastery strip on the mini card — which is documented on it.
 *
 * Fetching through the sort-set endpoint has a useful side effect: the server
 * intersects the asked-for words with what the learner genuinely still holds as
 * provisional, so a word sorted in another tab drops out on its own and
 * `entries.length === 0` means "there is nothing left to offer".
 *
 * Per the token rule in CLAUDE.md the effect keys on the words/language only — the
 * Authorization header is resolved at call time inside src/api/http.ts, so a silent
 * token refresh cannot re-trigger the fetch.
 *
 * Referenced by: src/components/ProvisionalCardsNotice.tsx,
 * src/components/ProvisionalSortOffer.tsx.
 */
export function useProvisionalEntries(
    language: Language,
    words: string[] | undefined,
    localEntries: VocabEntry[] | undefined,
    /** Skip the fetch entirely while the surface using the cards is closed. */
    enabled: boolean
): { entries: VocabEntry[]; loading: boolean } {
    const hasLocal = Array.isArray(localEntries) && localEntries.length > 0;
    const [fetched, setFetched] = useState<VocabEntry[]>([]);
    const [loading, setLoading] = useState(false);

    // Stable dependency: the effect must re-run when the WORDS change, not when the
    // caller happens to hand over a new array with the same contents.
    const wordsKey = (words ?? []).join(",");

    useEffect(() => {
        if (!enabled || hasLocal || wordsKey.length === 0) {
            setFetched([]);
            return;
        }
        let cancelled = false;
        setLoading(true);
        fetchProvisionalSortSet(language, wordsKey.split(","))
            .then((res) => {
                if (cancelled) return;
                setFetched(res.cards.map(discoverCardToProvisionalEntry));
            })
            // A failed lookup must not break the round: the caller falls back to the
            // word-less copy rather than showing an error the learner cannot act on.
            .catch(() => {
                if (!cancelled) setFetched([]);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [enabled, hasLocal, wordsKey, language]);

    return { entries: hasLocal ? localEntries! : fetched, loading };
}
