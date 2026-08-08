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
    cardCount: number;
    createdAt: string;
    updatedAt: string;
}

/** The caller's decks in their currently selected language, newest first. */
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
