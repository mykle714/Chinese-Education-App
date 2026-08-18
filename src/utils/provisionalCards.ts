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
import type { DiscoverCard, VocabEntry } from '../types';

/**
 * The preview surfaces (pre-round notice, end-of-round offer) render lent cards with
 * the app's own `MiniVocabCard`, so their input shape is simply `VocabEntry` — no
 * bespoke row type. The flat `ProvisionalCardRow` (word / pinyin / dd) this module
 * used to export is gone with it: it could only ever describe a card the learner
 * could not recognise as one of their cards.
 */

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
 * The lent cards from a served set, de-duplicated by word, ready to hand straight to
 * `ProvisionalCardGrid` (and through it to `MiniVocabCard`).
 *
 * Used by the surfaces that hold the real `VocabEntry` rows (Bubble Match, Speed
 * Reading), so the preview renders without a second round-trip. Surfaces that only
 * hold the lent WORDS (Word Search's grid payload, and every end-of-round offer)
 * fetch theirs instead — see `useProvisionalEntries`.
 *
 * Unlike `provisionalCards` above this DEDUPES: a served pool can carry the same word
 * twice (Match Speed deals repeats), and the preview must show each card once.
 * Nothing is flattened — the whole entry rides through, so the mini card can resolve
 * its own dd/pinyin, icon layout, card color and mastery bars exactly as the deck
 * page does (docs/DEFINITION_CLUSTERS.md, docs/CARD_ICON_LAYOUT.md).
 */
export function provisionalEntries(cards: VocabEntry[]): VocabEntry[] {
    const seen = new Set<string>();
    const entries: VocabEntry[] = [];
    for (const card of cards) {
        if (!isProvisional(card)) continue;
        const word = card.entryKey;
        if (!word || seen.has(word)) continue;
        seen.add(word);
        entries.push(card);
    }
    return entries;
}

/**
 * Adapt one `DiscoverCard` (what `GET /provisionalSet` returns) into the `VocabEntry`
 * the mini card consumes.
 *
 * The sort-set endpoint answers in the DISCOVER shape because the sort flow is its
 * primary consumer, so the preview has to bridge the two. Only the fields the mini
 * card reads are mapped; everything else stays undefined, which the card already
 * handles (it renders the utcm badge and the mastery strip only when the entry
 * carries them).
 *
 * KNOWN GAP: a discover card carries no `typedMarkHistory`/`category`, so a preview
 * built this way shows no mastery strip even though the learner may have earned marks
 * on the card during the round they just played. The surfaces holding real vet rows
 * (Bubble Match, Speed Reading) do show it. Fixing this properly means serving vet
 * rows from the provisionalSet endpoint — see docs/PROVISIONAL_CARDS.md § 5.
 */
export function discoverCardToProvisionalEntry(card: DiscoverCard): VocabEntry {
    return {
        id: card.id,
        entryKey: card.entryKey,
        language: card.language,
        definition: card.definition,
        pronunciation: card.pronunciation ?? null,
        iconId: card.iconId ?? null,
        frequencyScore: card.frequencyScore ?? null,
        difficulty: card.difficulty ?? null,
        // Required by the client-side VocabEntry widening but never read by the
        // preview; the discover shape does not carry the vet row's creation time.
        createdAt: "",
    };
}
