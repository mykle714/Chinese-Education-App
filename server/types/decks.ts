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
  /**
   * What the USER may do to this deck (migration 148,
   * docs/STUDY_CHALLENGE.md § 4).
   *
   * 'custom' — they authored it: rename, delete, add and remove cards.
   * 'preset' — it was generated for them (a Study Challenge's study deck): none of
   *   those, and it does not count against the 100-deck cap.
   *
   * The restriction is expressed in the UI by the ABSENCE of controls, not by a
   * lock badge — a lock icon invites a tap that does nothing and needs its own
   * explanatory copy, while a control that isn't there needs neither.
   *
   * Deliberately NOT a `challengeId`: this describes the deck itself and generalises
   * to any future generated set (a curated pack, a weakness drill). The pointer to
   * the owning challenge lives on the challenge (`presetDeckIds`), so `decks` learns
   * nothing about challenges.
   */
  editMode: 'custom' | 'preset';
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

// NOTE: a `CollectionRef` union used to live here, describing which set a launch
// surface draws from. It had no importers — the real one is `CollectionFilter` in
// OnDeckVocabService, which is what every launch path actually threads — and it had
// already drifted (a `parseCollectionRef` that does not exist, a 'mastered' variant
// the service no longer has). Removed rather than re-synced.
