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
import { resolveDisplayDefinition, resolveDisplayPronunciation } from './definitionUtils';

/**
 * One row of the lent-cards table shown by the pre-round notice and the end-of-round
 * sort offer: the word itself, its display pinyin, and its dd.
 *
 * Deliberately flat rather than a card type — both producers (a served `VocabEntry`
 * set, and the `DiscoverCard`s the provisionalSet endpoint returns) reduce to these
 * three strings, so the table has exactly one input shape.
 */
export interface ProvisionalCardRow {
    /** word1 / entryKey. */
    word: string;
    /** Display pinyin (sense-resolved where the source carries clusters). */
    pinyin: string | null;
    /** Display definition (dd). */
    dd: string;
}

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

/**
 * The lent cards from a served set as table rows, de-duplicated by word.
 *
 * Used by the surfaces that hold the real `VocabEntry` rows (Bubble Match, Speed
 * Reading), so the table can be rendered without a second round-trip. Surfaces that
 * only hold the lent WORDS (Word Search's grid payload, and every end-of-round
 * offer) fetch their rows instead — see `useProvisionalRows`.
 *
 * dd and pinyin both go through the sense-aware resolvers rather than the flat
 * `definition` / `pronunciation` columns, so the table agrees with the card face the
 * learner is about to meet (docs/DEFINITION_CLUSTERS.md).
 */
export function provisionalRows(
    cards: Array<Pick<VocabEntry, 'starterPackBucket' | 'entryKey' | 'definition' | 'pronunciation' | 'definitionClusters' | 'selectedSense'>>
): ProvisionalCardRow[] {
    const seen = new Set<string>();
    const rows: ProvisionalCardRow[] = [];
    for (const card of cards) {
        if (!isProvisional(card)) continue;
        const word = card.entryKey;
        if (!word || seen.has(word)) continue;
        seen.add(word);
        rows.push({
            word,
            pinyin: resolveDisplayPronunciation(card),
            dd: resolveDisplayDefinition(card),
        });
    }
    return rows;
}
