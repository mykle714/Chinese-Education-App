import type { PoolClient } from 'pg';
import type { DeckSummary } from '../../types/decks.js';

/**
 * Data-access contract for `decks` / `deck_cards` (migration 141) — user-authored
 * card sets.
 *
 * SCOPE: this DAL owns the two deck tables and NOTHING ELSE. It never reads a vet
 * row. "Give me deck N's cards as VocabEntry[]" needs the DICT_JOIN, the utcm
 * category expression and the enrichment pipeline, all of which already live on
 * OnDeckVocabService alongside the other collection reads (mastered / non-mastered
 * library) — so that read stays there and this DAL only answers membership
 * questions (`listDeckCardIds`, `listDeckIdsForCard`).
 *
 * NO POLICY HERE. "Is this deck yours", "is that a supported language", "does a
 * card you are adding actually exist and match the deck's language" are all
 * DeckService's business. This layer only refuses input that would corrupt a row.
 *
 * OWNERSHIP IS AN ARGUMENT, NOT AN ASSUMPTION. Every method that names a deck by
 * id also takes `userId` and filters on it, so a caller that forgets the service's
 * ownership check still cannot read or mutate someone else's deck. That is
 * defence in depth, not a substitute for the service check — the service is what
 * turns "no rows" into a 404 instead of a silent success.
 *
 * Every method takes an optional PoolClient so a caller inside a transaction can
 * enlist the query (docs/BACKEND_LAYERING.md §3). `setCardMemberships` genuinely
 * needs one: its delete + insert must not be observable half-applied.
 *
 * See docs/DECKS_FEATURE.md.
 */
export interface IDeckDAL {
  /** The user's decks in one language, with card counts, newest first. */
  listDecks(userId: string, language: string, client?: PoolClient): Promise<DeckSummary[]>;

  /**
   * One deck by id, scoped to its owner. Returns null when the deck does not
   * exist OR belongs to someone else — the two are deliberately indistinguishable
   * to the caller, so probing ids leaks nothing.
   */
  findDeck(userId: string, deckId: number, client?: PoolClient): Promise<DeckSummary | null>;

  /** Insert a deck. Throws DuplicateError if the name is taken in that language. */
  createDeck(userId: string, language: string, name: string, client?: PoolClient): Promise<DeckSummary>;

  /**
   * Insert a GENERATED deck (`editMode = 'preset'`) with its cards, in one
   * transaction (migration 148, docs/STUDY_CHALLENGE.md § 4).
   *
   * Row and membership together, because a preset deck with no cards is one the
   * learner can neither study from NOR delete — the user-facing delete control does
   * not exist for preset decks.
   *
   * Duplicate names are ALLOWED here and this never throws DuplicateError: the name
   * uniqueness index is partial on `editMode = 'custom'`, so two live challenges
   * against the same friend may both yield `vs Bob` (Q30). Safe because a preset
   * deck never appears in the add-to-deck checkbox menu, which is the only place two
   * same-named decks were ever confusable.
   */
  createPresetDeck(
    userId: string,
    language: string,
    name: string,
    vocabEntryIds: number[],
    client?: PoolClient
  ): Promise<DeckSummary>;

  /**
   * How many AUTHORED decks the user holds in one language — the number the
   * 100-deck cap is checked against.
   *
   * Separate from `listDecks().length` because that list now includes generated
   * decks, and generated decks deliberately do not count (Q11).
   */
  countCustomDecks(userId: string, language: string, client?: PoolClient): Promise<number>;

  /**
   * A deck's `editMode`, or null when the deck is gone or not the caller's — the
   * single read behind DeckService's preset mutation guard.
   */
  findDeckEditMode(userId: string, deckId: number, client?: PoolClient): Promise<string | null>;

  /**
   * Rename a deck and bump `updatedAt`. Returns null if the deck is gone or not
   * the caller's. Throws DuplicateError on a name collision.
   */
  renameDeck(userId: string, deckId: number, name: string, client?: PoolClient): Promise<DeckSummary | null>;

  /** Delete a deck (memberships cascade). Returns true if a row went away. */
  deleteDeck(userId: string, deckId: number, client?: PoolClient): Promise<boolean>;

  /** The vet ids in a deck, most recently added first. */
  listDeckCardIds(userId: string, deckId: number, client?: PoolClient): Promise<number[]>;

  /**
   * Which of the user's decks contain a given card. Drives the checkbox state of
   * the Add-to-deck menu on the cdp and the eip.
   */
  listDeckIdsForCard(userId: string, vocabEntryId: number, client?: PoolClient): Promise<number[]>;

  /**
   * Make the card's membership exactly `deckIds` (whole-set semantics — see
   * SetDeckMembershipsBody). Decks not owned by `userId` are ignored rather than
   * erroring, so a stale menu cannot delete another user's membership rows.
   * Returns the resulting deck ids.
   */
  setCardMemberships(
    userId: string,
    vocabEntryId: number,
    deckIds: number[],
    client?: PoolClient
  ): Promise<number[]>;

  /**
   * Drop every membership row for a vet id, in every deck, for every user.
   *
   * This is the hand-rolled replacement for the ON DELETE CASCADE that
   * `deck_cards."vocabEntryId"` cannot have (the vet is two physical tables
   * sharing one id sequence — see migration 141). Called from the vet row-delete
   * path INSIDE its transaction. It is deliberately not user-scoped: the vet id is
   * globally unique, and a row that no longer exists must not remain in anybody's
   * deck.
   */
  deleteMembershipsForCard(vocabEntryId: number, client?: PoolClient): Promise<number>;
}
