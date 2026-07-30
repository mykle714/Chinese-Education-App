import type { VocabEntry } from "../../types";
import type { CardPair, GameCategory } from "./types";
import { CATEGORY_FALLBACK_ORDER, CATEGORY_WEIGHTS, BUFFER_DEPTH } from "./constants";

/**
 * Match Speed — card buffer and the weighted category roll.
 *
 * PURE MODULE with an injectable rng, the way `spawnSelection.ts` is for Bubble
 * Match. The weighted roll and the fallback walk are exactly the kind of logic
 * that is miserable to verify through the UI and trivial to verify as a pure
 * function, so nothing here touches React, the network, or `Math.random` except
 * through the default parameter.
 *
 * Layer: pure domain logic under a feature folder. The page owns all I/O (the
 * pool fetch) and hands the results here.
 *
 * See docs/MATCH_SPEED_GAME.md § Card selection: distribution + buffer.
 */

/** Injectable randomness, matching Bubble Match's `spawnSelection.ts` convention. */
export type Rng = () => number;

/** Per-category queues of pairs waiting to be placed on the board. */
export type CardBuffer = Record<GameCategory, CardPair[]>;

const ALL_CATEGORIES = Object.keys(CATEGORY_WEIGHTS) as GameCategory[];

/** An empty buffer with every bucket present, so callers never index undefined. */
export function emptyBuffer(): CardBuffer {
    return { Unfamiliar: [], Target: [], Comfortable: [], Mastered: [] };
}

/** Total pairs held across all buckets. */
export function bufferSize(buffer: CardBuffer): number {
    return ALL_CATEGORIES.reduce((sum, cat) => sum + buffer[cat].length, 0);
}

/** Every vocab-entry id currently in the buffer — half of what a top-up request
 *  must `exclude` (the other half is what's on the board). */
export function bufferedEntryIds(buffer: CardBuffer): number[] {
    return ALL_CATEGORIES.flatMap((cat) => buffer[cat].map((pair) => pair.entry.id));
}

/**
 * Roll one category against the full 12/60/20/8 weight table.
 *
 * Note this ignores what is actually IN the buffer — the roll is deliberately
 * independent of supply, and `takePair` handles a bare shelf via the fallback
 * walk. Keeping the two separate is what makes the distribution honest: if we
 * re-rolled against only the non-empty buckets, a run whose Mastered bucket kept
 * running dry would silently drift toward Target without anything saying so.
 */
export function rollCategory(rng: Rng = Math.random): GameCategory {
    const totalWeight = ALL_CATEGORIES.reduce((sum, cat) => sum + CATEGORY_WEIGHTS[cat], 0);
    let ticket = rng() * totalWeight;
    for (const category of ALL_CATEGORIES) {
        ticket -= CATEGORY_WEIGHTS[category];
        if (ticket < 0) return category;
    }
    // Only reachable through floating-point drift at the very top of the range.
    return ALL_CATEGORIES[ALL_CATEGORIES.length - 1];
}

/**
 * Draw one pair: roll a category, and if that bucket is empty walk
 * CATEGORY_FALLBACK_ORDER (Target → Comfortable → Unfamiliar → Mastered) to the
 * first bucket that has anything. Returns null only when the WHOLE buffer is
 * empty (a network-starved top-up), in which case the caller leaves the slot
 * empty until the next tick.
 *
 * MUTATES `buffer` — the pair is shifted off its queue.
 */
export function takePair(buffer: CardBuffer, rng: Rng = Math.random): CardPair | null {
    const rolled = rollCategory(rng);
    // Rolled bucket first, then the fallback walk. The rolled one may appear again
    // inside the fallback order; it's already empty by then, so the extra visit is
    // a no-op rather than a special case to code around.
    for (const category of [rolled, ...CATEGORY_FALLBACK_ORDER]) {
        const pair = buffer[category].shift();
        if (pair) return pair;
    }
    return null;
}

/**
 * Draw up to `count` pairs. Short-returns (fewer than `count`) when the buffer
 * runs dry; the caller fills the slots it can and leaves the rest for the next
 * tick rather than blocking the board on the network.
 */
export function takePairs(buffer: CardBuffer, count: number, rng: Rng = Math.random): CardPair[] {
    const drawn: CardPair[] = [];
    for (let i = 0; i < count; i++) {
        const pair = takePair(buffer, rng);
        if (!pair) break;
        drawn.push(pair);
    }
    return drawn;
}

/**
 * File freshly fetched pool cards into their buckets, keyed by the server's
 * per-card `gameCategory` stamp (see docs/MATCH_SPEED_GAME.md § Backend change).
 *
 * A card with a missing or unrecognized stamp is filed under `Target` rather than
 * dropped: an unlabeled card is still a perfectly playable card, and silently
 * discarding it would starve the board on exactly the payloads we understand
 * least. `pairId` is derived from the entry id, which is unique per vocab entry
 * and is already what `exclude` dedupes on — so a duplicate can never end up as
 * two pairs with different ids.
 *
 * MUTATES and returns `buffer`.
 */
export function fillBuffer(buffer: CardBuffer, cards: VocabEntry[]): CardBuffer {
    for (const entry of cards) {
        // `gameCategory` comes off the shared wire contract already typed as the
        // same four-value union, so no cast is needed — only a presence check for
        // payloads predating the stamp.
        const stamped = entry.gameCategory;
        const category: GameCategory = stamped && stamped in buffer ? stamped : "Target";
        buffer[category].push({
            pairId: `pair-${entry.id}`,
            entry,
            category,
        });
    }
    return buffer;
}

/**
 * How many cards to ask for per bucket to restore every bucket toward
 * BUFFER_DEPTH. Fired after each refill tick as a single request for exactly what
 * was consumed, so the requests stay small and steady and the buffer rarely dips.
 * Returns null when nothing is needed, letting the caller skip the round trip.
 */
export function topUpRequest(buffer: CardBuffer): Record<GameCategory, number> | null {
    const request = {} as Record<GameCategory, number>;
    let anyNeeded = false;
    for (const category of ALL_CATEGORIES) {
        const missing = Math.max(0, BUFFER_DEPTH - buffer[category].length);
        request[category] = missing;
        if (missing > 0) anyNeeded = true;
    }
    return anyNeeded ? request : null;
}

/** Serialize a top-up request as the pool endpoint's `?Target=3&…` query. Buckets
 *  needing nothing are omitted so the server doesn't do useless per-bucket work. */
export function topUpQuery(request: Record<GameCategory, number>): string {
    return ALL_CATEGORIES.filter((cat) => request[cat] > 0)
        .map((cat) => `${encodeURIComponent(cat)}=${request[cat]}`)
        .join("&");
}
