/**
 * provisionalCards.ts — deriving "was I lent temporary cards?" from a served set.
 *
 * A PROVISIONAL card is one the server lent the player so a surface could reach its
 * baseline card count rather than refusing to start (docs/PROVISIONAL_CARDS.md).
 * Nothing extra rides on the wire to announce this: a lent card is simply a card
 * whose `starterPackBucket` is `'provisional'` instead of `'library'`, so every
 * surface derives its own notice from the cards it was handed.
 *
 * Referenced by: the pre-round notice (src/components/ProvisionalCardsNotice.tsx),
 * every game page, and FlashcardsLearnPage.
 */
import type { VocabEntry } from '../types';

/** True when this card was lent by the server rather than sorted by the player. */
export function isProvisional(card: Pick<VocabEntry, 'starterPackBucket'>): boolean {
    return card.starterPackBucket === 'provisional';
}

/** Just the lent cards from a served set, in the order they were served. */
export function provisionalCards<T extends Pick<VocabEntry, 'starterPackBucket'>>(cards: T[]): T[] {
    return cards.filter(isProvisional);
}

/**
 * The lent WORDS from a served set, de-duplicated and order-preserving.
 *
 * This is what a round hands to the sort flow when the player taps "Sort these
 * cards", and what the pre-round notice lists. `entryKey` is used rather than the
 * vet id because the sort flow addresses cards by word (a det lookup), not by the
 * player's row id.
 */
export function provisionalWords(cards: Array<Pick<VocabEntry, 'starterPackBucket' | 'entryKey'>>): string[] {
    const seen = new Set<string>();
    const words: string[] = [];
    for (const card of cards) {
        if (!isProvisional(card)) continue;
        const word = card.entryKey;
        if (!word || seen.has(word)) continue;
        seen.add(word);
        words.push(word);
    }
    return words;
}
