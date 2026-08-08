/**
 * provisional.ts — the client's typed calls for PROVISIONAL (temporary) cards.
 *
 * A provisional card is one the server LENT the player so a game or the flashcards
 * learn page could reach its baseline card count instead of refusing to start. It is
 * a real vet row that accepts marks, but it is not in the player's deck until they
 * sort it. See docs/PROVISIONAL_CARDS.md.
 *
 * The client never asks for cards to be lent — that happens server-side, implicitly,
 * whenever a surface fetches its card set. The only thing the client asks for is the
 * SORT SET: the temporary cards it should offer at the end of a round.
 *
 * Per docs/FRONTEND_LAYERING.md §3.2 nothing here takes a `token`: it goes through
 * src/api/http.ts, which resolves the Authorization header at call time.
 */
import { apiGet } from './http';
import type { DiscoverCard } from '../types';

/** Response shape of GET /api/starterPacks/:language/provisionalSet. */
export interface ProvisionalSetResponse {
    /**
     * The temporary cards still awaiting a sort decision, as discover cards ready to
     * feed the sort flow. Empty means there is nothing left to sort — every card was
     * already promoted (possibly in another tab), and the caller should not open the
     * sort flow at all.
     */
    cards: DiscoverCard[];
}

/**
 * Fetch the temporary cards to offer in the sort flow.
 *
 * `words` narrows the set to the cards ONE round actually played; omit it to offer
 * every temporary card the player is currently holding. The server intersects
 * whatever is asked for with what the player genuinely holds, so a stale list here
 * can only ever return fewer cards, never smuggle in extra ones.
 */
export function fetchProvisionalSortSet(
    language: string,
    words?: string[]
): Promise<ProvisionalSetResponse> {
    return apiGet<ProvisionalSetResponse>(`/api/starterPacks/${language}/provisionalSet`, {
        params: words && words.length > 0 ? { words: words.join(',') } : undefined,
    });
}
