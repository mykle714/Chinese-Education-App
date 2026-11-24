/**
 * collectionRef.ts — what a built-in "collection of cards" is on the client.
 *
 * Three kinds, each a set of the learner's sorted cards:
 *
 *   all        — every sorted card, mastered or not (the Deck Tower cards page's
 *                library — `fetchCollectionCards(ALL_COLLECTION_ID)`).
 *   learn-now  — the sorted cards NOT mastered in one bar (core / reading / writing).
 *   mastered   — the cards mastered in one bar (migration 143).
 *
 * Today the refs name the Deck Tower cards page's two filter keys
 * (`lensCollectionEntries`, builtinCollections.ts) and their counts. Until 2026-11-04
 * a collection could also be OPENED (CollectionViewPage) and LAUNCHED against
 * (`?collection=` / `?deck=` on the flp and every game), and a fourth kind, `deck`,
 * named a user-authored deck; all of that was deleted with the old Home page and Decks.
 *
 * The wire ids are shared, not mirrored: `ALL_COLLECTION_ID`, `LEARN_NOW_COLLECTION_IDS`
 * and `MASTERED_COLLECTION_IDS` live in server/contracts/wire.ts.
 *
 * Depended on by: builtinCollections.ts, collectionGlyph.ts, src/api/collections.ts.
 * (The card detail page's `?world=` lens param, `withLens` / `lensFromSearch`, went with
 * that route on 2026-11-23: td's card view takes its world as a prop.)
 */
import {
    ALL_COLLECTION_ID,
    LEARN_NOW_COLLECTION_IDS,
    MASTERED_COLLECTION_IDS,
    type MasteryWorldId,
} from '../../../server/contracts/wire';
import type { BuiltinCollectionId } from '../../../server/dal/shared/vetTable';

/** A built-in set of the learner's cards. */
export type CollectionRef =
    | { kind: 'all' }
    | { kind: 'learn-now'; world: MasteryWorldId }
    | { kind: 'mastered'; world: MasteryWorldId };

/** A built-in collection's wire id (`all`, `learn-now-reading`, `mastered`, …). */
export type BuiltinCollection = BuiltinCollectionId;

/** Human-readable title for a collection — the cards page's filter key label and title. */
export function collectionTitle(ref: CollectionRef): string {
    switch (ref.kind) {
        case 'all':
            return 'All Cards';
        case 'learn-now':
            // "Learning" is the user-facing name of the `library` bucket and this
            // `learn-now` collection (CLAUDE.md § Terminology) — the internal
            // identifiers stay `library` / `learn-now` everywhere.
            //
            // All three bars share the ONE title: a Learning set is only ever shown
            // on the surface that is already about its bar (a Deck Tower world's
            // cards page), so the world supplies the qualifier.
            return 'Learning';
        case 'mastered':
            // Same rule as Learning: one title for all three bars. A Mastered set is
            // only shown on a Deck Tower world's cards page, whose world already says
            // which skill was mastered, so "Mastered Reading" / "Mastered Writing"
            // repeated it. (Core was already plain "Mastered", not "Mastered Cards".)
            return 'Mastered';
    }
}

/** The wire id naming a collection. */
export function builtinCollectionId(ref: CollectionRef): BuiltinCollection {
    switch (ref.kind) {
        case 'all':
            return ALL_COLLECTION_ID;
        case 'learn-now':
            return LEARN_NOW_COLLECTION_IDS[ref.world];
        case 'mastered':
            return MASTERED_COLLECTION_IDS[ref.world];
    }
}
