import { useState } from "react";
import type { VocabEntry } from "../../../../types";
import { isReviewHeavyDeck } from "./pawnHints";

/**
 * useDeckReviewHint — WHEN the hint pawn says the deck-review line (docs/HINT_PAWN.md
 * § "Deck review"): once per dive, on the dive's first card, if most of the deck is
 * Comfortable + Mastered cards.
 *
 * A "dive" is one stretch of the session being studied: the parked → studied transition
 * (FlpTowerHost `parked`) starts one, and parking ends it. A session stays mounted across
 * dives with its working loop kept, so the dive (not the mount) is the "session" the learner
 * sees — each tap on the tower is a new one, and says the line again if the deck is still
 * review-heavy.
 *
 * At the start of a dive it takes a SNAPSHOT:
 *   - review-heavy or not, from the host's ready band counts at that moment (the same
 *     figure the Learning tower stands at). Later marks moving the counts don't re-judge it.
 *   - the first card: the first front entry seen in the dive (the parked session's top
 *     card, or the first card dealt if it was still loading).
 * It returns the dive's key while the front card is still that first card, so the line
 * goes once the learner swipes past it (an undo back onto it brings it back, and a tap-closed
 * bubble stays closed — HintPawn's `closedKey` is the same key).
 *
 * The state is adjusted during render (React's "storing information from previous renders"
 * pattern) rather than in an effect, so the hint is right on the dive's first frame instead of
 * a frame late.
 *
 * Layer: flp page presentation hook (client).
 *
 * Depended on by: FlashcardsLearnPage.tsx (feeds `pawnHintFor`'s `deckReviewKey`),
 * src/__tests__/deckReviewHint.test.ts.
 * Docs: docs/HINT_PAWN.md § "Deck review".
 */

export interface DiveState {
    /** The `parked` this state was taken under — a change is a dive starting or ending. */
    parked: boolean;
    /** Counts dives, so each dive's hint key (and bubble) is new. */
    seq: number;
    /** The dive's snapshot: most of the deck was review when it started. */
    reviewHeavy: boolean;
    /** The dive's first front card, once one has been seen. */
    firstEntryId: VocabEntry["id"] | null;
}

type BandCounts = Readonly<Record<string, number>> | undefined;

/** A fresh dive's state: judged now, its first card still to be seen. */
function startDive(seq: number, counts: BandCounts): DiveState {
    return { parked: false, seq, reviewHeavy: isReviewHeavyDeck(counts), firstEntryId: null };
}

/** The state before anything has happened: parked, or already one dive in. */
export function initialDiveState(parked: boolean, counts: BandCounts): DiveState {
    return parked ? { parked: true, seq: 0, reviewHeavy: false, firstEntryId: null } : startDive(1, counts);
}

/**
 * The next state for this render's inputs. Pure, and it returns `state` itself when nothing
 * changed (the hook only sets state on a real change, so it settles).
 */
export function nextDiveState(state: DiveState, parked: boolean, counts: BandCounts, frontEntryId: VocabEntry["id"] | null): DiveState {
    let next = state;
    if (parked !== next.parked) {
        // Parking keeps the seq (the next dive counts on from it) and forgets the snapshot.
        next = parked ? { ...next, parked: true, reviewHeavy: false, firstEntryId: null } : startDive(next.seq + 1, counts);
    }
    if (!parked && next.firstEntryId === null && frontEntryId !== null) next = { ...next, firstEntryId: frontEntryId };
    return next;
}

/** The deck-review key for the front card under `state`, or null. */
export function deckReviewKeyOf(state: DiveState, frontEntryId: VocabEntry["id"] | null): string | null {
    const onFirstCard = state.firstEntryId !== null && frontEntryId === state.firstEntryId;
    return !state.parked && state.reviewHeavy && onFirstCard ? `${state.seq}|${state.firstEntryId}` : null;
}

/**
 * The deck-review key for the front card, or null when the pawn should not say the line.
 *
 * @param parked        FlpTowerHost `parked`.
 * @param counts        FlpTowerHost `readyBandCounts` — the world's off-cooldown cards per band.
 * @param frontEntryId  The card on top (the page's `displayCurrentEntry`), or null.
 */
export function useDeckReviewHint(parked: boolean, counts: BandCounts, frontEntryId: VocabEntry["id"] | null): string | null {
    const [state, setState] = useState<DiveState>(() => initialDiveState(parked, counts));
    const next = nextDiveState(state, parked, counts, frontEntryId);
    if (next !== state) setState(next);
    return deckReviewKeyOf(next, frontEntryId);
}
