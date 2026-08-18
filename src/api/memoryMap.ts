/**
 * memoryMap.ts — the client's typed calls against /api/memoryMap/*.
 *
 * Mirrors server/contracts/wire.ts; the types are IMPORTED from there rather than
 * restated, so the two sides cannot drift on a field name. See docs/MEMORY_MAP_GAME.md.
 *
 * Per docs/FRONTEND_LAYERING.md §3.2 neither of these takes a `token`: they go through
 * src/api/http.ts, which resolves the Authorization header at call time.
 */
import { apiGet, apiPost } from './http';
import type {
    MemoryMapGraduateResponse,
    MemoryMapResponse,
    MemoryMapWord,
} from '../../server/contracts/wire';

export type { MemoryMapGraduateResponse, MemoryMapResponse, MemoryMapWord };

/**
 * Load the map, topping it up to capacity server-side.
 *
 * ONE call per game entry — spawning happens as part of the load, so there is no
 * separate "spawn" step a caller could forget. `newlyPlaced` names the words this call
 * created, which is what the growth toast announces (§ 2.5).
 *
 * The language is taken from the ACCOUNT server-side; there is deliberately no
 * parameter for it. Each language owns an independent map (Q28), and a client that
 * could name the language could read and mutate the other one.
 */
export async function fetchMemoryMap(): Promise<MemoryMapResponse> {
    return apiGet<MemoryMapResponse>('/api/memoryMap');
}

/**
 * Tell the server a word was answered, so it can retire it if that mark completed its
 * reading track and refill the freed slot.
 *
 * Called after EVERY correct answer, not only the ones that graduate: the client cannot
 * know which mark is the eighth. `graduated: false` is the normal response and is not
 * an error. The server re-reads mastery itself rather than trusting the claim.
 */
export async function graduateMemoryMapWord(
    vocabEntryId: number
): Promise<MemoryMapGraduateResponse> {
    return apiPost<MemoryMapGraduateResponse>('/api/memoryMap/graduate', { vocabEntryId });
}
