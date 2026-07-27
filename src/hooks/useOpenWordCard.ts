import { useCallback, useEffect, useRef } from "react";
import { useSlideNavigate } from "./useSlideNavigate";
import { fetchVocabEntriesByTokens } from "../utils/vocabApi";

// Delimiter for the prewarm-list effect key. A headword may itself contain a space
// (Spanish multi-word entries) but never a newline, so joining/splitting on "\n" is
// lossless where " " would not be.
const PREWARM_DELIM = "\n";

// Drill-in resolver for the saved-card cdp (VocabCardDetailPage): given a word
// tapped in the Character Breakdown / Used In / example-sentence rows, open the
// card detail that BEST matches it —
//
//   • the learner's own saved card (`/flashcards/card/:id`) when a vet row exists
//     for that word, so the drill-in stays inside their deck and keeps the edit
//     affordances; otherwise
//   • the read-only dictionary cdp (`/dictionary/card/:word`), which works for any
//     det headword.
//
// The read-only dictionary cdp does NOT use this hook — it drills straight into
// `/dictionary/card/:word` so browsing the dictionary never jumps into the
// editable deck surface (see DictionaryCardDetailPage.handleWordOpen).
//
// Resolution goes through `fetchVocabEntriesByTokens`, which is client-cached per
// token, so repeat taps resolve with no network call. `prewarmWords` seeds that
// cache on mount (one batched request for every linkable word on the page) so the
// FIRST tap navigates instantly too, instead of stalling on a round trip.
//
// Docs: docs/LEAF_NODE_PAGES.md (§ "Breakdown drill-in targets"), docs/NAVIGATION.md.
export function useOpenWordCard(prewarmWords?: string[]) {
    const slideNavigate = useSlideNavigate();
    // Guards double-taps: a second tap while a lookup is in flight is ignored, so
    // we never fire two navigations for one gesture.
    const resolvingRef = useRef(false);

    // Batch-prefetch every linkable word once per word-set. The effect is keyed on
    // the joined list because an array is a new identity every render. Deliberately
    // NOT keyed on the auth token: it rotates every ~15 min and re-running this on
    // each silent refresh would be pure waste (see CLAUDE.md "Never reload/reset a
    // page on a silent token refresh").
    const prewarmKey = prewarmWords?.join(PREWARM_DELIM) ?? "";
    useEffect(() => {
        if (!prewarmKey) return;
        // Fire-and-forget cache warm: a failure here is harmless (the tap-time
        // lookup retries, and falls back to the dictionary cdp on error).
        fetchVocabEntriesByTokens(prewarmKey.split(PREWARM_DELIM)).catch(() => {});
    }, [prewarmKey]);

    return useCallback(
        async (word: string) => {
            if (!word || resolvingRef.current) return;
            const dictionaryRoute = `/dictionary/card/${encodeURIComponent(word)}`;
            resolvingRef.current = true;
            try {
                const { personalEntries } = await fetchVocabEntriesByTokens([word]);
                const saved = personalEntries.find((e) => e.entryKey === word);
                slideNavigate(saved ? `/flashcards/card/${saved.id}` : dictionaryRoute);
            } catch (err) {
                // Lookup failed (offline / server error) — the dictionary cdp is the
                // safe target: it works for any det headword and is read-only.
                console.error("Failed to resolve saved card for word, opening dictionary cdp:", err);
                slideNavigate(dictionaryRoute);
            } finally {
                resolvingRef.current = false;
            }
        },
        [slideNavigate]
    );
}
