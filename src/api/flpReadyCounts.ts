/**
 * flpReadyCounts.ts — the client's read of the off-cooldown card counts per utcm band
 * (the Deck Tower's deck figures).
 *
 * A narrow, fast alternative to deriving them from the full library fetch: the server
 * computes the same `server/contracts/flpReadiness.ts` formula against a `{ id, typedMarkHistory }`-only read (`vetSortedClause()`, no
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
 * Referenced by docs/DECK_TOWER.md.
 */
import { apiGet, withFallback } from './http';
import type { FlpWorld } from '../../server/contracts/studyMode';

export interface FlpReadyCounts {
    /** Ready-now counts keyed by the requested bar's utcm band (Unfamiliar/Target/Comfortable/Mastered). */
    counts: Record<string, number>;
    /**
     * Focus mode is on in this world, so `counts` cover only today's remaining focus set
     * (docs/FOCUS_MODE.md § 4). Optional: an older server omits it.
     */
    focusOn?: boolean;
}

/** `world` — the session world the figures describe: core, reading or writing (a Deck Tower world). */
export function fetchFlpReadyCounts(world: FlpWorld = 'core'): Promise<FlpReadyCounts> {
    return withFallback(
        apiGet<FlpReadyCounts>('/api/onDeck/flpReadyCounts', world === 'core' ? undefined : { params: { world } }),
        'Failed to load card counts'
    );
}
