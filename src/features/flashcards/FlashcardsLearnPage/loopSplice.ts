/**
 * loopSplice.ts — pure edits of the flp working loop that keep the card on FRONT where it is.
 *
 * Used by `useWorkingLoop` → `replaceGameCleared`, which takes the cards an flp game break
 * cleared out of the loop and splices their replacements in (docs/FLP_GAME_BREAKS.md § 4a).
 * Kept pure (no React) so the index math is unit-tested on its own
 * (`src/features/flashcards/FlashcardsLearnPage/__tests__/loopSplice.test.ts`).
 *
 * The loop is a ring: `index` is the front card, `index + 1` the back (peeking) card.
 */
import type { VocabEntry } from "../types";

export interface LoopState {
    loop: VocabEntry[];
    index: number;
}

/**
 * Remove every card in `ids` from the loop. The front card stays on front when it
 * survives; when it is removed, the first survivor after it takes the front, so the ring
 * order is unchanged. An emptied loop is `{ loop: [], index: 0 }`.
 */
export function removeFromLoop({ loop, index }: LoopState, ids: ReadonlySet<number>): LoopState {
    const next = loop.filter((card) => !ids.has(card.id));
    if (next.length === 0) return { loop: [], index: 0 };
    // Walk the ring from the front to the first card that survives.
    for (let step = 0; step < loop.length; step += 1) {
        const card = loop[(index + step) % loop.length];
        if (!ids.has(card.id)) return { loop: next, index: next.findIndex((c) => c.id === card.id) };
    }
    return { loop: next, index: 0 };
}

/**
 * Insert `cards` just BEHIND the front card, i.e. as the last cards of the ring before the
 * front comes round again, so the front and back cards do not change. Cards already in
 * the loop are skipped (the same dedupe the swipe refill applies).
 */
export function insertBehindFront({ loop, index }: LoopState, cards: readonly VocabEntry[]): LoopState {
    const present = new Set(loop.map((card) => card.id));
    const fresh = cards.filter((card) => !present.has(card.id));
    if (fresh.length === 0) return { loop, index };
    if (loop.length === 0) return { loop: [...fresh], index: 0 };
    return {
        loop: [...loop.slice(0, index), ...fresh, ...loop.slice(index)],
        index: index + fresh.length,
    };
}
