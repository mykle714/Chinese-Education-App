/**
 * Wire + row types for user-authored card sets (`decks` / `deck_cards`,
 * migration 141).
 *
 * See docs/DECKS_FEATURE.md. Depended on by:
 *   server/dal/interfaces/IDeckDAL.ts
 *   server/dal/implementations/DeckDAL.ts
 *   server/services/DeckService.ts
 *   server/controllers/DecksController.ts
 *   src/api/decks.ts (client mirror — keep the two in step)
 *
 * These live here rather than in `server/contracts/wire.ts` because nothing in
 * them crosses the boundary in a shape the two sides disagree about: the client
 * mirror is a straight copy, exactly as `friends.ts` does it.
 */

/**
 * One deck as the deck list needs it: the row plus its membership count.
 *
 * `cardCount` is computed per read (a COUNT over `deck_cards`) rather than stored
 * as a column on `decks`. A denormalized counter would need updating from three
 * write paths — add, remove, and the vet-delete cleanup — and a missed one shows
 * the user a deck size that is simply wrong. The count is over an indexed
 * composite PK on a table with at most a few thousand rows per user.
 *
 * NOTE: the count is of MEMBERSHIP ROWS, so it includes a card only while that
 * card exists; see the deleteEntry cleanup referenced in migration 141.
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

/** Body of POST /api/decks. */
export interface CreateDeckBody {
  name?: string;
}

/** Body of PATCH /api/decks/:id. */
export interface UpdateDeckBody {
  name?: string;
}

/**
 * Body of PUT /api/decks/memberships — the checkbox menu's single save.
 *
 * WHOLE-SET SEMANTICS, not a diff: `deckIds` is the complete list of decks the
 * card should be in afterwards, and the service adds/removes to match. The menu
 * is a set of checkboxes with no intermediate save, so sending the resulting set
 * is both the natural shape and the one that cannot drift — a diff-based API
 * would resolve two menus open on the same card into a state neither user chose.
 */
export interface SetDeckMembershipsBody {
  vocabEntryId?: number;
  deckIds?: number[];
}

/**
 * Which set of cards a launch surface (a game, or flp) should draw from.
 *
 * Parsed from the query string by `parseCollectionRef` and threaded down to the
 * vet read as an optional deck filter. `kind: 'deck'` is the only variant that
 * narrows anything — the two built-in collections are exactly the pools those
 * surfaces already used, so they carry no extra filter.
 */
export type CollectionRef =
  | { kind: 'deck'; deckId: number }
  | { kind: 'learn-now' }
  | { kind: 'mastered' };
