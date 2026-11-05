/**
 * builtinCollections.ts — the built-in collections one mastery LENS offers, and their
 * figures.
 *
 * `lensCollectionEntries(lens)` is ONE bar's two sets — that bar's Learning and that
 * bar's Mastered — which the Deck Tower's cards page draws as its two filter keys
 * (TowerFilterKeys), one world per lens. There is no **All Cards** entry: the page's
 * unfiltered grid already IS the whole library.
 *
 * The per-band collections (Unfamiliar / Target / Comfortable) were removed: a utcm
 * band is a property of one card's progress, not a set a learner studies. See the note
 * in server/contracts/wire.ts.
 *
 * Layer: feature module (src/features/flashcards).
 *
 * Depended on by:
 *   src/features/flashcards/useCardLibrary.ts    (the lens's entry list + key figures)
 *   src/features/deckTower/TowerFilterKeys.tsx   (the entry type)
 *   src/features/deckTower/DeckTowerPage.tsx     (`builtinCollectionCount`)
 * See docs/DECK_TOWER.md § "The cards page".
 */
import type { MasteryWorldId } from '../../utils/masteryCompute';
import { collectionTitle, type CollectionRef } from './collectionRef';

export interface BuiltinCollectionEntry {
    /** Stable per-entry key — a React key, and the class-name/test suffix each surface appends. */
    key: string;
    ref: CollectionRef;
    label: string;
}

/**
 * The built-in collections ONE LENS offers, in display order: that bar's Learning and
 * that bar's Mastered — two tiles, whichever bar it is.
 *
 * A lens-scoped surface never shows another bar's sets: each Deck Tower world answers
 * its own skill's question. No **All Cards** entry — the unfiltered grid is it.
 */
export function lensCollectionEntries(lens: MasteryWorldId): BuiltinCollectionEntry[] {
    const learning: CollectionRef = { kind: 'learn-now', world: lens };
    const mastered: CollectionRef = { kind: 'mastered', world: lens };
    return [
        {
            key: `learn-now-${lens}`,
            ref: learning,
            label: collectionTitle(learning),
        },
        {
            key: `mastered-${lens}`,
            ref: mastered,
            label: collectionTitle(mastered),
        },
    ];
}

/**
 * The card count shown for a built-in collection, from the two count hooks its host
 * already loads — no extra request, and no third endpoint to keep in step.
 *
 *   all       — the sum of the four core bands, which is exactly what its page lists
 *   learn-now — the three UNMASTERED bands (the collection's own SQL is
 *               `<that bar's> category <> 'Mastered'`, so this mirrors it by
 *               construction — PROVIDED the caller hands in counts banded by the
 *               same bar, which is why useCardLibrary fetches them per lens)
 *   mastered  — that bar's own total, from `useMasteredCounts`
 *
 */
export function builtinCollectionCount(
    ref: CollectionRef,
    categoryCounts: Record<string, number>,
    masteredCounts: Record<MasteryWorldId, number>
): number | undefined {
    const band = (name: string) => categoryCounts[name] || 0;
    const unmastered = band('Unfamiliar') + band('Target') + band('Comfortable');

    switch (ref.kind) {
        case 'all':
            return unmastered + band('Mastered');
        case 'learn-now':
            return unmastered;
        case 'mastered':
            return masteredCounts[ref.world];
    }
}
