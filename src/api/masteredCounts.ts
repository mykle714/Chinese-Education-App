/**
 * masteredCounts.ts — the client's read of how many cards are Mastered in EACH mastery bar
 * (core / reading / writing): the Deck Tower's Mastered deck heights and its cards page's
 * Mastered filter key.
 *
 * Per docs/FRONTEND_LAYERING.md §3.2 it does NOT take a `token`: it goes through
 * src/api/http.ts, which resolves the Authorization header at call time.
 *
 * Server counterpart: `GET /api/onDeck/masteredCounts` (OnDeckVocabController).
 *
 * Called by: src/hooks/useMasteredCounts.ts.
 * Referenced by docs/DECK_TOWER.md, docs/MASTERY_REWORK.md § "Three bars".
 */
import { apiGet, withFallback } from './http';
import type { MasteryWorldId } from '../utils/masteryCompute';

export type MasteredCounts = Record<MasteryWorldId, number>;

/**
 * Fetch the three bars' Mastered totals. Each value is coerced to a number (a missing or
 * malformed field reads as 0); a response that is not an object at all throws, so the
 * caller can tell "not loaded" from "0 mastered".
 */
export async function fetchMasteredCounts(): Promise<MasteredCounts> {
    const data = await withFallback(
        apiGet<Partial<Record<MasteryWorldId, unknown>> | null>('/api/onDeck/masteredCounts'),
        'Failed to load mastered counts'
    );
    if (!data || typeof data !== 'object') throw new Error('Malformed mastered counts response');
    return {
        core: Number(data.core) || 0,
        reading: Number(data.reading) || 0,
        writing: Number(data.writing) || 0,
    };
}
