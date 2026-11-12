/**
 * workingLoop.ts — the flp's initial deal (`GET /api/onDeck/distributedWorkingLoop`) and
 * its break refill (`GET /api/onDeck/loopRefill`, `fetchLoopRefill` below).
 *
 * The flp runs only inside the Deck Tower, always in Study Mix over the whole library,
 * so a request is just the session's WORLD (which mastery bar the loop is dealt on).
 * Until 2026-11-04 it also carried a `?category=` filter, a Review/Challenge `?mode=` and a
 * launch collection, all of which came from surfaces deleted that day (the old Home
 * page's study hand, the Centers, collection pages); and Home preloaded loops for the
 * flp to adopt, matched on a request key.
 *
 * Takes no `token` (docs/FRONTEND_LAYERING.md § 3.2) — `apiGet` reads auth at call time.
 *
 * Docs: docs/DECK_TOWER.md § "Studying the tower", docs/FLP_GAME_BREAKS.md § 4a.
 */
import { apiGet } from './http';
import type { VocabEntry } from '../types';
import type { FlpWorld } from '../../server/contracts/studyMode';

export interface WorkingLoopRequest {
    /** The session's flp bar — the Deck Tower world being studied. */
    world: FlpWorld;
    /**
     * The session's LEND SWITCH: on once the learner has run out of off-cooldown cards
     * (docs/DECK_TOWER.md § "Running out of ready cards"). Off, the server deals only
     * the learner's own ready cards and may come back short or empty.
     */
    lend: boolean;
}

/** The request's query params. `core` and no lending are the server defaults, so neither is sent. */
function workingLoopParams(request: WorkingLoopRequest): URLSearchParams {
    const params = new URLSearchParams();
    if (request.world !== 'core') params.set('world', request.world);
    if (request.lend) params.set('lend', '1');
    return params;
}

/** Fetch a fresh working loop. Always resolves to an array (the server may send one card bare). */
export async function fetchDistributedWorkingLoop(request: WorkingLoopRequest): Promise<VocabEntry[]> {
    const data = await apiGet<VocabEntry[] | VocabEntry>('/api/onDeck/distributedWorkingLoop', {
        params: Object.fromEntries(workingLoopParams(request)),
    });
    if (data == null) return [];
    return Array.isArray(data) ? data : [data];
}

/**
 * Replacements for the loop cards an flp game break cleared — `GET /api/onDeck/loopRefill`
 * (docs/FLP_GAME_BREAKS.md § 4a). Sent with the loop's OWN world (via `workingLoopParams`)
 * so the server resolves the same pool the loop was dealt from. Returns at most one card
 * per replaced id, fewer when the pool is spent.
 */
export async function fetchLoopRefill(
    request: WorkingLoopRequest,
    replacedIds: number[],
    excludeIds: number[]
): Promise<VocabEntry[]> {
    if (replacedIds.length === 0) return [];
    const params = workingLoopParams(request);
    params.set('replace', replacedIds.join(','));
    if (excludeIds.length > 0) params.set('exclude', excludeIds.join(','));
    const data = await apiGet<VocabEntry[]>('/api/onDeck/loopRefill', { params: Object.fromEntries(params) });
    return Array.isArray(data) ? data : [];
}
