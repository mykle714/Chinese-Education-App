import type { BubbleBody, BubbleKind } from "./types";

/**
 * Bubble Match — next-bubble selection.
 *
 * The launcher doesn't pull the next bubble off the queue in order; it *chooses*
 * one to keep the playfield balanced and the difficulty self-regulating. Two
 * independent biases are applied, each an INVERTED ratio of what's already on
 * screen (so the board trends toward balance), then the queue is filtered to
 * matching candidates. If nothing qualifies, we fall back to a uniform random
 * pick from the whole queue.
 *
 * Terminology: a "Chinese" bubble is `kind === "word"`, an "English" bubble is
 * `kind === "definition"`. A bubble "has a match on screen" when its partner
 * (the other bubble sharing its `pairId`) is also currently on screen.
 *
 * All randomness flows through an injectable `rng` (defaults to Math.random) so
 * the logic is deterministically unit-testable.
 */

export type Rng = () => number;

/** Which kind to spawn next, biased toward whichever kind is under-represented. */
export function chooseKind(onScreen: BubbleBody[], rng: Rng = Math.random): BubbleKind {
    const chinese = onScreen.filter((b) => b.kind === "word").length;
    const english = onScreen.filter((b) => b.kind === "definition").length;
    const total = chinese + english;

    // Empty screen → no signal, flip a fair coin.
    if (total === 0) return rng() < 0.5 ? "word" : "definition";

    // Inverted ratio: the more English on screen, the likelier the next is Chinese.
    //   P(word) = english / total ; P(definition) = chinese / total
    return rng() < english / total ? "word" : "definition";
}

/**
 * Whether the next bubble should have its partner already on screen.
 * Inverted ratio: the more on-screen bubbles that currently HAVE a partner, the
 * likelier we spawn one WITHOUT a partner (and vice-versa).
 */
export function chooseWantWithMatch(onScreen: BubbleBody[], rng: Rng = Math.random): boolean {
    const total = onScreen.length;
    if (total === 0) return rng() < 0.5;

    // Count how many on-screen pairIds appear at least twice — those bubbles
    // have their partner present.
    const countByPair = new Map<string, number>();
    for (const b of onScreen) countByPair.set(b.pairId, (countByPair.get(b.pairId) ?? 0) + 1);
    const withMatch = onScreen.filter((b) => (countByPair.get(b.pairId) ?? 0) >= 2).length;
    const withoutMatch = total - withMatch;

    // P(spawn a bubble WITH a partner on screen) = withoutMatch / total
    // P(spawn a bubble WITHOUT a partner on screen) = withMatch / total
    return rng() < withoutMatch / total;
}

/**
 * When the board has this many bubbles or fewer, we refuse to spawn a bubble
 * that would immediately complete a match (its partner already on screen).
 * Otherwise a near-empty board lets the player clear the new bubble at once,
 * draining the playfield toward empty instead of keeping it populated.
 */
export const NEAR_EMPTY_SPAWN_THRESHOLD = 3;

/**
 * When the board has this many bubbles or more, we force the next spawn to be one
 * whose partner is ALREADY on screen (a bubble the player can immediately match),
 * so a crowding board gets a relief valve instead of piling on more unmatchable
 * bubbles. Mirror image of NEAR_EMPTY_SPAWN_THRESHOLD: that floor forbids instant
 * matches to keep a sparse board populated; this ceiling requires one to keep a
 * full board from overflowing. Only applied when such a candidate exists.
 */
export const NEAR_FULL_SPAWN_THRESHOLD = 7;

/**
 * Pick the next bubble to launch from `queue`, given what's currently on screen.
 * Returns the chosen bubble (caller is responsible for removing it from the
 * queue), or null when the queue is empty.
 */
export function selectNextBubble(
    queue: BubbleBody[],
    onScreen: BubbleBody[],
    rng: Rng = Math.random
): BubbleBody | null {
    if (queue.length === 0) return null;

    // A queue candidate's partner is "on screen" iff its pairId is present there.
    const onScreenPairIds = new Set(onScreen.map((b) => b.pairId));

    // Hard board-population constraints (mutually exclusive — the thresholds
    // don't overlap), applied before the soft biases:
    //   • Near-empty (≤ NEAR_EMPTY_SPAWN_THRESHOLD): drop any queue bubble that
    //     would match something on screen, so the spawn can't be instantly
    //     cleared and the sparse board stays populated.
    //   • Near-full (≥ NEAR_FULL_SPAWN_THRESHOLD): require a bubble whose partner
    //     is already on screen, giving the crowded board a clearable relief valve.
    // Each is skipped if it would leave nothing to spawn.
    let pool = queue;
    if (onScreen.length <= NEAR_EMPTY_SPAWN_THRESHOLD) {
        const nonMatching = queue.filter((b) => !onScreenPairIds.has(b.pairId));
        if (nonMatching.length > 0) pool = nonMatching;
    } else if (onScreen.length >= NEAR_FULL_SPAWN_THRESHOLD) {
        const matching = queue.filter((b) => onScreenPairIds.has(b.pairId));
        if (matching.length > 0) pool = matching;
    }

    const wantKind = chooseKind(onScreen, rng);
    const wantWithMatch = chooseWantWithMatch(onScreen, rng);

    // Apply both biases together. If no candidate satisfies them, the spec says
    // to pick randomly — fall back to the whole (constrained) pool.
    let candidates = pool.filter(
        (b) => b.kind === wantKind && onScreenPairIds.has(b.pairId) === wantWithMatch
    );
    if (candidates.length === 0) candidates = pool;

    return candidates[Math.floor(rng() * candidates.length)];
}
