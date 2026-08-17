/**
 * decks.ts — the client's typed calls against /api/decks/*.
 *
 * Mirrors server/types/decks.ts; keep the two in step. See docs/DECKS_FEATURE.md.
 *
 * Per docs/FRONTEND_LAYERING.md §3.2 none of these take a `token`: they go through
 * src/api/http.ts, which resolves the Authorization header at call time.
 */
import { apiGet, apiPost, apiPatch, apiPut, apiDelete, withFallback } from './http';
import type { VocabEntry } from '../types';

/**
 * One deck as the deck list renders it. There is no `color` field: a deck's
 * pastel is DERIVED from its id (see deckAccentColor) rather than stored, so the
 * same deck is always the same color without a column to migrate or keep in sync.
 */
export interface DeckSummary {
    id: number;
    /** 'zh' | 'es'. A deck holds cards of exactly one language. */
    language: string;
    name: string;
    /**
     * What the USER may do to this deck (docs/STUDY_CHALLENGE.md § 4).
     *
     * 'custom' — they authored it: rename, delete, add and remove cards.
     * 'preset' — generated for them (a Study Challenge study deck): none of those, and
     *   it does not count against the 100-deck cap.
     *
     * ⚠️ EVERY CONSUMER OF `fetchDecks` MUST DECIDE what it does with 'preset', because
     * the list contains both kinds:
     *   * `/decks` renders them as their own section, ABOVE the user's own Decks;
     *   * the games collection selector and the collection view page treat them like any
     *     other deck — playing and viewing a challenge deck is the whole point of it;
     *   * the add-to-deck checkbox menu must EXCLUDE them — they cannot be added to, so a
     *     tickable row there would be a control that does nothing;
     *   * rename/delete controls must not be offered for one.
     *
     * The restriction is expressed by the ABSENCE of controls, never by a lock badge: a
     * lock invites a tap that does nothing and needs its own copy.
     */
    editMode: 'custom' | 'preset';
    cardCount: number;
    createdAt: string;
    updatedAt: string;
}

/**
 * The caller's decks in their currently selected language, newest first.
 *
 * Includes BOTH authored and generated decks — see `DeckSummary.editMode` for what
 * each caller is expected to do about that.
 */
export function fetchDecks(): Promise<DeckSummary[]> {
    return withFallback(apiGet<DeckSummary[]>('/api/decks'), 'Could not load your decks');
}

/** Create a deck in the caller's current language. */
export function createDeck(name: string): Promise<DeckSummary> {
    return apiPost<DeckSummary>('/api/decks', { name });
}

/** Rename a deck. */
export function renameDeck(deckId: number, name: string): Promise<DeckSummary> {
    return apiPatch<DeckSummary>(`/api/decks/${deckId}`, { name });
}

/**
 * Delete a deck. This removes the SET, never the cards in it — the learner keeps
 * every card and its whole mark history.
 */
export function deleteDeck(deckId: number): Promise<void> {
    return apiDelete<void>(`/api/decks/${deckId}`);
}

/**
 * A deck's cards, in the same enriched shape the Learn Now and Mastered
 * collections return — which is what lets one CollectionViewPage render all three.
 */
export function fetchDeckCards(deckId: number): Promise<VocabEntry[]> {
    return withFallback(
        apiGet<VocabEntry[]>(`/api/decks/${deckId}/cards`),
        'Could not load this deck'
    );
}

/** Which of the caller's decks contain a card — the checkbox menu's initial state. */
export function fetchDeckMemberships(vocabEntryId: number): Promise<number[]> {
    return withFallback(
        apiGet<number[]>('/api/decks/memberships', { params: { vocabEntryId } }),
        'Could not load this card’s decks'
    );
}

/**
 * Save the checkbox menu.
 *
 * WHOLE-SET semantics: `deckIds` is what the card's membership should BE
 * afterwards, not a delta. Returns the resulting deck ids, which the menu should
 * adopt rather than trusting its own optimistic state — the server drops ids for
 * decks that were deleted while the menu was open.
 */
export function setDeckMemberships(vocabEntryId: number, deckIds: number[]): Promise<number[]> {
    return apiPut<number[]>('/api/decks/memberships', { vocabEntryId, deckIds });
}
