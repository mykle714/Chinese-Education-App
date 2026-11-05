/**
 * collections.ts — the client's typed read of a BUILT-IN collection's cards
 * (all / learn-now / mastered-*), as the shared enriched `VocabEntry[]`.
 *
 * Per docs/FRONTEND_LAYERING.md §3.2 it does NOT take a `token`: it goes through
 * src/api/http.ts, which resolves the Authorization header at call time — so a
 * silent refresh never changes this function's identity and never re-triggers a
 * caller's load effect (CLAUDE.md "Never reload on token refresh").
 *
 * Server counterpart: `OnDeckVocabController.getCollectionCards`.
 *
 * Called by: src/features/flashcards/cardLibrary.ts (`loadCardLibrary`, the `all`
 * collection — the learner's whole card library).
 */
import { apiGet, withFallback } from './http';
import type { VocabEntry } from '../types';
import type { BuiltinCollection } from '../features/flashcards/collectionRef';

/** Every card in one built-in collection, in the shared enriched shape. */
export function fetchCollectionCards(collection: BuiltinCollection): Promise<VocabEntry[]> {
    return withFallback(
        apiGet<VocabEntry[]>('/api/onDeck/collectionCards', { params: { collection } }),
        'Failed to load cards'
    );
}
