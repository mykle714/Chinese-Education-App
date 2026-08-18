/**
 * collections.ts — the client's typed read of a BUILT-IN collection's cards.
 *
 * A deck's cards come from `src/api/decks.ts` (`fetchDeckCards`); the built-in
 * collections (all / learn-now / mastered-*) come from the OnDeck route below.
 * Both return the SAME enriched `VocabEntry[]`, which is what lets one
 * CollectionViewPage — and now the /decks sheet's inline Cards section — render
 * either without caring which kind it holds (docs/DECKS_FEATURE.md).
 *
 * It lives in its own module rather than in decks.ts because the endpoint is
 * `/api/onDeck/*`, not `/api/decks/*`, and decks.ts is documented as the calls
 * against the latter.
 *
 * Per docs/FRONTEND_LAYERING.md §3.2 it does NOT take a `token`: it goes through
 * src/api/http.ts, which resolves the Authorization header at call time — so a
 * silent refresh never changes this function's identity and never re-triggers a
 * caller's load effect (CLAUDE.md "Never reload on token refresh").
 *
 * Server counterpart: `OnDeckVocabController.getCollectionCards`.
 *
 * Called by:
 *   src/features/flashcards/CollectionViewPage.tsx
 *   src/features/flashcards/FlashcardsDecksPage.tsx  (the sheet's Cards section)
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
