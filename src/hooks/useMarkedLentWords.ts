import { useCallback, useMemo, useRef, useState } from "react";
import { isProvisional } from "../utils/provisionalCards";
import type { VocabEntry } from "../types";

/** The minimum a card must carry to be recorded — anything shaped like a vet row. */
type MarkableCard = Pick<VocabEntry, "starterPackBucket" | "entryKey">;

export interface MarkedLentWords {
    /** The lent words this session actually reviewed, in the order they were reviewed. */
    words: string[];
    /**
     * Record a review of `card`. A no-op for a card the learner owns, and idempotent
     * per word, so call sites can fire it unconditionally on every mark.
     */
    note: (card: MarkableCard | null | undefined) => void;
    /** Clear the set — call at the start of a run so a replay is judged on its own. */
    reset: () => void;
}

/**
 * useMarkedLentWords — which BORROWED cards the learner actually reviewed this session.
 *
 * WHY THIS EXISTS
 * The end-of-round "keep these cards?" offer (`ProvisionalSortOffer`) must list the
 * lent words the learner *played*, and on a surface whose supply streams in, the set of
 * cards SERVED is much larger than the set PLAYED. Each streaming surface used to
 * accumulate the served set, at a different (and progressively earlier) moment:
 *
 *   Match Speed  — on FETCH, every buffer top-up: cards that never reached the board
 *   Hydra        — on DEAL, in `useColorBuffers.take`: bubbles lost to overflow, unmatched
 *   flp          — on ENTRY TO THE WORKING LOOP: the loop holds ~10, so a session ended
 *                  after 3 cards still offered all 10
 *
 * All three then asked the learner to keep words they never saw the meaning of. The
 * fixed-board surfaces (Bubble Match, Speed Reading, Word Search) have no such gap —
 * dealt IS played — and do not use this hook.
 *
 * WHAT COUNTS AS REVIEWED: **any attempt**. A hit, a miss, and a mark the server drops
 * on cooldown all count, which is why recording happens at the CALL SITE rather than off
 * the mark response:
 *
 *   - a MISS is the best possible reason to keep a card, and in Hydra it is the last
 *     thing that happens (a wrong match ends the run), so scoring on correctness alone
 *     would systematically drop the word the player just failed;
 *   - a SUPPRESSED mark writes nothing (`POST /api/flashcards/mark`, the hard
 *     "next markable at" guard). That is not an edge case for lent cards: the server
 *     RE-LENDS rows the learner already holds before minting new ones
 *     (docs/PROVISIONAL_CARDS.md § 3b), so a learner returning inside the cooldown
 *     window plays the same borrowed cards with every mark dropped. Keying the offer on
 *     what the server recorded would hand that session an EMPTY offer — a worse and
 *     quieter failure than the over-offer this replaces;
 *   - the mark request is fire-and-forget and races the round ending, so its response
 *     may not have arrived when the offer is built.
 *
 * The ref is the authoritative accumulator (it is written from pointer/rAF paths where a
 * re-render per card would be pointless); the state exists only so the offer re-renders.
 *
 * Referenced by: MatchSpeedPage, HydraBubblesPage, useWorkingLoop (flp).
 * Documented in docs/PROVISIONAL_CARDS.md § 5.
 */
export function useMarkedLentWords(): MarkedLentWords {
    const seenRef = useRef<Set<string>>(new Set());
    const [words, setWords] = useState<string[]>([]);

    const note = useCallback((card: MarkableCard | null | undefined) => {
        if (!card || !isProvisional(card)) return;
        const word = card.entryKey;
        if (!word || seenRef.current.has(word)) return;
        seenRef.current.add(word);
        setWords([...seenRef.current]);
    }, []);

    const reset = useCallback(() => {
        // Bail before touching state when there is nothing to clear: `reset` runs at the
        // top of every run, and an unconditional setState there would re-render the page
        // on each launch for no reason.
        if (seenRef.current.size === 0) return;
        seenRef.current = new Set();
        setWords([]);
    }, []);

    return useMemo(() => ({ words, note, reset }), [words, note, reset]);
}
