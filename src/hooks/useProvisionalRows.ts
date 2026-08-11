import { useEffect, useState } from "react";
import { fetchProvisionalSortSet } from "../api/provisional";
import { resolveDisplayDefinition } from "../utils/definitionUtils";
import type { ProvisionalCardRow } from "../utils/provisionalCards";
import type { Language } from "../types";

/**
 * useProvisionalRows — the word1 / pinyin / dd rows for a set of lent words.
 *
 * Two kinds of surface need this table (docs/PROVISIONAL_CARDS.md § 5):
 *
 *   1. those holding the real served cards (Bubble Match, Speed Reading) — they pass
 *      `localRows` from `provisionalRows(cards)` and this hook never fetches;
 *   2. those holding only the WORDS — Word Search, whose grid payload carries
 *      `provisionalWords: string[]` rather than vet rows, and every end-of-round sort
 *      offer (Match Speed and flp accumulate words as they deal). Those pass `words`
 *      and the rows are fetched from `GET /api/starterPacks/:language/provisionalSet`,
 *      which is the same set the sort flow itself will show.
 *
 * Fetching through the sort-set endpoint has a useful side effect: the server
 * intersects the asked-for words with what the learner genuinely still holds as
 * provisional, so a word sorted in another tab drops out of the table on its own and
 * `rows.length === 0` means "there is nothing left to offer".
 *
 * Per the token rule in CLAUDE.md the effect keys on the words/language only — the
 * Authorization header is resolved at call time inside src/api/http.ts, so a silent
 * token refresh cannot re-trigger the fetch.
 *
 * Referenced by: src/components/ProvisionalCardsNotice.tsx,
 * src/components/ProvisionalSortOffer.tsx.
 */
export function useProvisionalRows(
    language: Language,
    words: string[] | undefined,
    localRows: ProvisionalCardRow[] | undefined,
    /** Skip the fetch entirely while the surface using the rows is closed. */
    enabled: boolean
): { rows: ProvisionalCardRow[]; loading: boolean } {
    const hasLocal = Array.isArray(localRows) && localRows.length > 0;
    const [fetched, setFetched] = useState<ProvisionalCardRow[]>([]);
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
                setFetched(
                    res.cards.map((card) => ({
                        word: card.entryKey,
                        pinyin: card.pronunciation ?? null,
                        // Discover cards carry no sense clusters, so this is the flat dd —
                        // the same one the sort flow's own card shows.
                        dd: resolveDisplayDefinition({ definition: card.definition }),
                    }))
                );
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

    return { rows: hasLocal ? localRows! : fetched, loading };
}
