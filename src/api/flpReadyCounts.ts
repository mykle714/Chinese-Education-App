/**
 * flpReadyCounts.ts — the client's read of the fdp study-hand figures.
 *
 * A narrow, fast alternative to deriving Challenge/Review/Study from the full
 * `allCards` fetch: the server computes the same `server/contracts/flpReadiness.ts`
 * formula against a `{ id, typedMarkHistory }`-only read (`vetSortedClause()`, no
 * dictionary join), so this resolves independently of — and much sooner than —
 * `fetchCollectionCards(ALL_COLLECTION_ID)`.
 *
 * Per docs/FRONTEND_LAYERING.md §3.2 it does NOT take a `token`: it goes through
 * src/api/http.ts, which resolves the Authorization header at call time.
 *
 * Server counterpart: `OnDeckVocabController.getFlpReadyCounts` /
 * `OnDeckVocabService.getFlpReadyCounts`.
 *
 * Called by: src/hooks/useFlpReadyCounts.ts
 * Referenced by docs/DECKS_FEATURE.md § "The card hand".
 */
import { apiGet, withFallback } from './http';
import type { FlpForeignTrack } from '../../server/contracts/wire';

export interface FlpReadyCounts {
    /** Ready-now counts keyed by CORE utcm band (Unfamiliar/Target/Comfortable/Mastered). */
    counts: Record<string, number>;
    /** Time until the soonest Comfortable/Mastered card becomes ready, or null if none is resting. */
    reviewNextReadyMs: number | null;
}

export function fetchFlpReadyCounts(foreignTrack: FlpForeignTrack): Promise<FlpReadyCounts> {
    return withFallback(
        apiGet<FlpReadyCounts>('/api/onDeck/flpReadyCounts', { params: { foreignTrack } }),
        'Failed to load card counts'
    );
}
