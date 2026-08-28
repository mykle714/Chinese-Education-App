import type { CardPair } from "./types";

/**
 * Match Speed's ALTERNATION RULE — the game's whole Study Challenge shape
 * (docs/STUDY_CHALLENGE.md § 5.3).
 *
 * PURE MODULE, like `cardBuffer.ts` next to it: the page owns the buffer, the
 * network and the board, and hands the two card sources in here.
 *
 * ── WHY MATCH SPEED NEEDS A RULE AT ALL ───────────────────────────────────────
 * Every other challenge game has a fixed board, so "all the contested words
 * appear in the round" is a statement about its composition. Match Speed deals from
 * a rolling buffer with ten slots and a 30-second clock, so the same guarantee has
 * to become a rule about the DEAL: **every other pair filled is a contested one**,
 * while any contested word is left undealt.
 *
 * Half and not all: a board that were 100% contested would exhaust the contested
 * set in the first few seconds and spend the rest of the run on filler anyway,
 * with the player never seeing the two mixed.
 *
 * ── THE CONSEQUENCES ARE THE POINT ────────────────────────────────────────────
 * Contested words are DRAINED, never recycled, so:
 *   * once the contested set is dealt the alternation lapses and the rest of the run is
 *     filler at 20 points a pair;
 *   * contested scoring has a hard ceiling of CHALLENGE_WORD_COUNT × 100 (900 at 9),
 *     which makes CLEARING THE SET the goal of the round rather than raw
 *     taps-per-second;
 *   * two strong players converge near the top of the range — past that point this
 *     round stops separating them and the other rounds decide the match.
 */

/** Mutable deal state for one run. Create it fresh in `beginRun`. */
export interface ChallengeDealState {
    /** The contested pairs still undealt, in the order they will be dealt. */
    contested: CardPair[];
    /** Pairs dealt so far this run — the alternation's parity counter. */
    dealt: number;
}

export function emptyDealState(): ChallengeDealState {
    return { contested: [], dealt: 0 };
}

/**
 * Fill `count` board slots under the alternation rule.
 *
 * `drawFiller` is the ordinary buffered draw (`takePairs`, one at a time), and may
 * legitimately return null between top-ups — the buffer is a network-fed queue.
 * EITHER SOURCE MAY RUN DRY, and each slot falls through to the other rather than
 * being left blank: a hole on the board is worse than an off-parity pair, and the
 * fall-through is also what makes the alternation lapse to pure filler on its own
 * once the contested set is gone.
 *
 * Stops early — returning fewer than `count` — only when BOTH sources are empty,
 * which the caller handles the same way it always has: leave the slot for the next
 * refill tick.
 *
 * MUTATES `state`.
 */
export function dealChallengePairs(
    state: ChallengeDealState,
    count: number,
    drawFiller: () => CardPair | null
): CardPair[] {
    const dealt: CardPair[] = [];
    for (let slot = 0; slot < count; slot += 1) {
        // Parity is counted over pairs DEALT this run, not over this call, so a board
        // filled two slots at a time alternates across the calls as well as inside
        // them.
        const wantContested = state.dealt % 2 === 0 && state.contested.length > 0;
        const pair = wantContested
            ? state.contested.shift()!
            : (drawFiller() ?? state.contested.shift());
        if (!pair) break;
        state.dealt += 1;
        dealt.push(pair);
    }
    return dealt;
}
