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
 * This module also owns the `?world=` LENS param of the card detail page (`withLens`,
 * `lensFromSearch`).
 *
 * Depended on by: builtinCollections.ts, collectionGlyph.ts, src/api/collections.ts,
 * VocabCardDetailPage.tsx, src/features/deckTower/DeckTowerPage.tsx.
 */
import {
    ALL_COLLECTION_ID,
    LEARN_NOW_COLLECTION_IDS,
    MASTERED_COLLECTION_IDS,
    parseMasteryWorld,
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

/**
 * Human-readable name for each bar's Mastered collection.
 *
 * All three lead with the word "Mastered" and end with what was mastered. The
 * reading/writing names used to read the other way round ("Reading Mastered"),
 * which sorted badly next to the core name and put the qualifier first. One word
 * order for all three, so every Mastered tile wraps to the same shape: "MASTERED"
 * then what was mastered.
 *
 * CORE names the skill-less set, so it has nothing to append: it is plain
 * **"Mastered"**, not "Mastered Cards". The old suffix said only that a card is a
 * card — every collection here is cards — and it made the shortest of the three
 * names the longest one on the tile, which is exactly backwards for the set that
 * needs no qualifier.
 */
const MASTERED_TITLES: Record<MasteryWorldId, string> = {
    core: 'Mastered',
    reading: 'Mastered Reading',
    writing: 'Mastered Writing',
};

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
            return MASTERED_TITLES[ref.world];
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

/**
 * The `?world=` LENS param of the card detail page (`/flashcards/card/:id`).
 *
 * A lens does not change WHICH card a page shows, only which mastery bar it reads it
 * through. The Deck Tower's cards page opens a card through its world's lens
 * (DeckTowerPage → `withLens`); the card page reads it back (`lensFromSearch`).
 *
 * `core` is the default everywhere, so it is never written into a URL.
 */
export const LENS_PARAM = 'world';

/** Append the lens param to a path, unless it is the default (`core`). */
export function withLens(path: string, lens: MasteryWorldId): string {
    if (lens === 'core') return path;
    const [base, existing] = path.split('?');
    const search = new URLSearchParams(existing ?? '');
    search.set(LENS_PARAM, lens);
    return `${base}?${search.toString()}`;
}

/** Read a lens off a URL's search params. Anything unrecognized means `core`. */
export function lensFromSearch(search: URLSearchParams): MasteryWorldId {
    return parseMasteryWorld(search.get(LENS_PARAM)) ?? 'core';
}
