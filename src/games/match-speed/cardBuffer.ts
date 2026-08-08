import type { VocabEntry } from "../../types";
import type { CardPair, GameCategory, ModeConfig } from "./types";
import { CATEGORY_WEIGHTS, DEFAULT_MODE_CONFIG } from "./constants";

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
 * MODE-AWARE: every function takes the run's `ModeConfig` (Study Mix / Review / Challenge)
 * as a trailing optional argument and reads its buckets, weights, fallback
 * order and depth from it — nothing here branches on the mode NAME. The default
 * is Mix, which is exactly the game's pre-modes behavior.
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

/** Total pairs held across all buckets (including any left over from a mode
 *  switch — a fresh run always starts from `emptyBuffer()`). */
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
export function rollCategory(rng: Rng = Math.random, mode: ModeConfig = DEFAULT_MODE_CONFIG): GameCategory {
    const categories = mode.categories;
    const totalWeight = categories.reduce((sum, cat) => sum + mode.weights[cat], 0);
    let ticket = rng() * totalWeight;
    for (const category of categories) {
        ticket -= mode.weights[category];
        if (ticket < 0) return category;
    }
    // Only reachable through floating-point drift at the very top of the range.
    return categories[categories.length - 1];
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
export function takePair(
    buffer: CardBuffer,
    rng: Rng = Math.random,
    mode: ModeConfig = DEFAULT_MODE_CONFIG
): CardPair | null {
    const rolled = rollCategory(rng, mode);
    // Rolled bucket first, then the fallback walk. The rolled one may appear again
    // inside the fallback order; it's already empty by then, so the extra visit is
    // a no-op rather than a special case to code around.
    for (const category of [rolled, ...mode.fallbackOrder]) {
        const pair = buffer[category].shift();
        if (pair) return pair;
    }
    return null;
}

/**
 * Draw up to `count` pairs. Short-returns (fewer than `count`) when the buffer
 * runs dry; the caller fills the slots it can and leaves the rest for the next
 * tick rather than blocking the board on the network.
 *
 * DUPLICATE GATE. Two cards for the same vocab entry must never be on the board
 * at once — they'd share a `pairId`, so every one of the four cards would match
 * every other and the board would stop being a pairing puzzle. The server-side
 * `exclude` list is the first line of defence, but it cannot be airtight: a
 * top-up in flight was built from a snapshot of the board, and a bucket the
 * server tops up from its own fallback order can legitimately return a card the
 * request didn't ask for. So the draw itself is the LAST line of defence and
 * gates on two things:
 *
 *  - `isBlocked` — the caller's live "already on the board" test (the page owns
 *    that set; this module stays pure).
 *  - this batch — an id already drawn in this same call, which no external set
 *    can know about yet because the board hasn't been handed the batch.
 *
 * A rejected pair is DISCARDED, not put back: it was consumed off its queue and
 * re-queuing it would spin this loop forever on a buffer of duplicates. Dropping
 * it also self-heals — the bucket is now shorter, so the next `topUpRequest`
 * asks for a replacement.
 */
export function takePairs(
    buffer: CardBuffer,
    count: number,
    rng: Rng = Math.random,
    mode: ModeConfig = DEFAULT_MODE_CONFIG,
    isBlocked: (pair: CardPair) => boolean = () => false
): CardPair[] {
    const drawn: CardPair[] = [];
    const drawnIds = new Set<number>();
    // Terminates because every iteration shifts one pair off the buffer, so the
    // buffer strictly shrinks whether the pair is kept or discarded.
    while (drawn.length < count) {
        const pair = takePair(buffer, rng, mode);
        if (!pair) break;
        if (drawnIds.has(pair.entry.id) || isBlocked(pair)) continue;
        drawnIds.add(pair.entry.id);
        drawn.push(pair);
    }
    return drawn;
}

/**
 * File freshly fetched pool cards into their buckets, keyed by the server's
 * per-card `gameCategory` stamp (see docs/MATCH_SPEED_GAME.md § Backend change).
 *
 * A card with a missing or unrecognized stamp is filed under the mode's first
 * fallback bucket (`Target` in Mix) rather than dropped: an unlabeled card is
 * still a perfectly playable card, and silently discarding it would starve the
 * board on exactly the payloads we understand least. `pairId` is derived from
 * the entry id, which is unique per vocab entry and is already what `exclude`
 * dedupes on — so a duplicate can never end up as two pairs with different ids.
 *
 * A DUPLICATE is dropped too — an entry already sitting in any bucket is not
 * shelved a second time. One response can legitimately repeat a card (the server
 * tops a short bucket up from its own fallback order, so the same entry can
 * satisfy two requested buckets), and two buffered pairs for one entry would
 * share a `pairId` and eventually land on the board together. Cheaper to reject
 * here than to detect at draw time; `takePairs` still gates as a backstop
 * because the buffer can't see what is on the board.
 *
 * An OFF-MODE stamped card IS dropped. The server tops a short bucket up from
 * its own fallback order, so a Review request can come back holding an Unfamiliar
 * card; a mode is a hard bucket restriction (the /decks rule), so shelving a
 * card no roll can ever draw would only bloat the `exclude` list. In Mix nothing
 * is off-mode, so this branch is unreachable there.
 *
 * MUTATES and returns `buffer`.
 */
export function fillBuffer(
    buffer: CardBuffer,
    cards: VocabEntry[],
    mode: ModeConfig = DEFAULT_MODE_CONFIG
): CardBuffer {
    // Seeded from what is already shelved, then grown as this batch files, so the
    // gate covers both "already buffered" and "twice in this one response".
    const buffered = new Set(bufferedEntryIds(buffer));
    for (const entry of cards) {
        if (buffered.has(entry.id)) continue;
        // `gameCategory` comes off the shared wire contract already typed as the
        // same four-value union, so no cast is needed — only a presence check for
        // payloads predating the stamp.
        const stamped = entry.gameCategory;
        const isKnown = !!stamped && ALL_CATEGORIES.includes(stamped);
        if (isKnown && !mode.categories.includes(stamped as GameCategory)) continue;
        const category: GameCategory = isKnown ? (stamped as GameCategory) : mode.fallbackOrder[0];
        buffered.add(entry.id);
        buffer[category].push({
            pairId: `pair-${entry.id}`,
            entry,
            category,
        });
    }
    return buffer;
}

/**
 * How many cards to ask for per bucket to restore every IN-MODE bucket toward
 * the mode's `bufferDepth`. Fired after each refill tick as a single request for
 * exactly what was consumed, so the requests stay small and steady and the
 * buffer rarely dips. Off-mode buckets are never requested (and never refilled,
 * since `fillBuffer` drops off-mode cards).
 * Returns null when nothing is needed, letting the caller skip the round trip.
 */
export function topUpRequest(
    buffer: CardBuffer,
    mode: ModeConfig = DEFAULT_MODE_CONFIG
): Record<GameCategory, number> | null {
    const request = {} as Record<GameCategory, number>;
    let anyNeeded = false;
    for (const category of mode.categories) {
        const missing = Math.max(0, mode.bufferDepth - buffer[category].length);
        request[category] = missing;
        if (missing > 0) anyNeeded = true;
    }
    return anyNeeded ? request : null;
}

/** Serialize a top-up request as the pool endpoint's `?Target=3&…` query. Buckets
 *  needing nothing — and buckets outside the mode, which are absent from the
 *  request entirely — are omitted so the server doesn't do useless per-bucket work. */
export function topUpQuery(request: Partial<Record<GameCategory, number>>): string {
    return ALL_CATEGORIES.filter((cat) => (request[cat] ?? 0) > 0)
        .map((cat) => `${encodeURIComponent(cat)}=${request[cat]}`)
        .join("&");
}
