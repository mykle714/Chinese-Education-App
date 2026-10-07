/**
 * bucketQueue — Bucket Drop's run model: which words are still in play, and which
 * word's bucket sits in each perimeter slot (docs/BUCKET_DROP_GAME.md § 3).
 *
 * Pure and immutable: every operation returns a new state, and randomness comes in as
 * an `rng` argument so the tests can pin it. No React, no DOM.
 *
 * ── Every word is on the board; only some buckets are ───────────────────────
 * All of a run's words are dealt onto the field at load and any of them can be dragged,
 * but the perimeter holds only as many buckets as the screen fits (perimeterLayout). A
 * word whose bucket is not showing simply cannot be placed YET — the player sorts the
 * placeable words out of the pile. Since every showing bucket belongs to a word still in
 * play, there is always at least one placeable word until the run ends.
 *
 * ── Refills are random ───────────────────────────────────────────────────────
 * A freed slot takes a RANDOM word whose bucket is not showing. It must never be chosen
 * by what the player is doing (e.g. "the word they are holding next"), or the slot that
 * just emptied would point at an answer.
 *
 * Referenced by: BucketDropStage. Tested by src/__tests__/bucketDropQueue.test.ts.
 */

/** A word in the run — the vet id, which is unique within a dealt pool. */
export type WordId = number;

export interface BucketQueueState {
    /** Words not yet dropped into their bucket. */
    remaining: WordId[];
    /** One entry per perimeter slot: the word whose bucket is there, or null (empty). */
    slots: (WordId | null)[];
}

export type Rng = () => number;

function shuffled<T>(items: readonly T[], rng: Rng): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

/** Remaining words with no bucket showing. */
export function unshownWords(state: BucketQueueState): WordId[] {
    const shown = new Set(state.slots.filter((id): id is WordId => id !== null));
    return state.remaining.filter((id) => !shown.has(id));
}

/**
 * Put a random unshown word into every empty slot, visiting the empty slots in random
 * order (so on a short run the leftover empties are scattered, not all at one edge).
 */
function fillEmptySlots(state: BucketQueueState, rng: Rng): BucketQueueState {
    const slots = [...state.slots];
    const pool = shuffled(unshownWords(state), rng);
    const empties = shuffled(slots.map((id, i) => (id === null ? i : -1)).filter((i) => i >= 0), rng);
    empties.forEach((slotIndex, n) => {
        if (n < pool.length) slots[slotIndex] = pool[n];
    });
    return { ...state, slots };
}

/** Deal a run: random buckets into `slotCount` slots. */
export function dealQueue(words: readonly WordId[], slotCount: number, rng: Rng = Math.random): BucketQueueState {
    return fillEmptySlots({
        remaining: [...words],
        slots: Array.from({ length: Math.max(0, slotCount) }, () => null),
    }, rng);
}

/**
 * `word` was dropped into the bucket at `slotIndex`. When that bucket is the word's own:
 * retire the word and refill the slot with a random unshown word. Otherwise (a wrong
 * drop) the state is returned unchanged — the caller compares identity to tell.
 */
export function resolveDrop(state: BucketQueueState, slotIndex: number, word: WordId, rng: Rng = Math.random): BucketQueueState {
    if (state.slots[slotIndex] !== word) return state;
    const slots = [...state.slots];
    slots[slotIndex] = null;
    return fillEmptySlots({ remaining: state.remaining.filter((id) => id !== word), slots }, rng);
}

/**
 * The field was re-measured and now has `slotCount` slots. Existing buckets keep their
 * slot where it still exists (a bucket must not jump under the player's finger on a
 * trivial resize); a shrink returns the cut buckets' words to the unshown pool, and new
 * slots are filled from it.
 */
export function resizeQueue(state: BucketQueueState, slotCount: number, rng: Rng = Math.random): BucketQueueState {
    const count = Math.max(0, slotCount);
    const slots: (WordId | null)[] = Array.from({ length: count }, (_, i) => state.slots[i] ?? null);
    return fillEmptySlots({ ...state, slots }, rng);
}
