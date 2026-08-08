import { IDeckDAL } from '../dal/interfaces/IDeckDAL.js';
import { ValidationError, NotFoundError } from '../types/dal.js';
import type { DeckSummary } from '../types/decks.js';
import type { Language } from '../types/index.js';
import type { VocabEntry } from '../types/index.js';
import type { OnDeckVocabService } from './OnDeckVocabService.js';

/**
 * The longest a deck name may be. Mirrors `decks.name varchar(64)` (migration 141)
 * so an over-long name is a 400 with a readable message rather than a Postgres
 * string-too-long error surfaced as a 500.
 */
const MAX_DECK_NAME_LENGTH = 64;

/**
 * How many decks one account may hold per language. Not a database constraint —
 * it is a product limit whose only job is to stop a runaway client (or a bored
 * tester) from making the Add-to-deck checkbox menu unusable, and it should be
 * changeable without a migration.
 */
const MAX_DECKS_PER_LANGUAGE = 100;

/**
 * User-authored card sets (docs/DECKS_FEATURE.md).
 *
 * LAYER: service. Owns every rule about decks; writes no SQL and touches no
 * Express types (docs/BACKEND_LAYERING.md §2).
 *
 * The rules, in one place:
 *   • A deck belongs to exactly one account and one language. Both are taken from
 *     the caller's session, never from the request body — a client cannot create
 *     a deck for another user or slip a card of the wrong language into one.
 *   • A deck is a SET OF CARDS AND NOTHING ELSE. Deleting one never deletes a
 *     card or its mark history; it removes membership rows only.
 *   • Ownership is checked before every read and write, and a deck the caller
 *     does not own is reported as NotFound, not Forbidden — the two are
 *     indistinguishable to a client, so deck ids leak nothing.
 *   • Membership is saved as a WHOLE SET (see SetDeckMembershipsBody), because
 *     the UI is a checkbox menu with one save.
 *
 * ── Why the card READ lives on OnDeckVocabService ──────────────────────────────
 * `listDeckCards` returns fully-enriched VocabEntry rows — DICT_JOIN columns, the
 * computed utcm category, and the enrichment pipeline. All of that already exists
 * on OnDeckVocabService next to the other two collection reads (mastered /
 * non-mastered library), and a deck is simply a third collection. Duplicating that
 * machinery in a deck-specific DAL would have been the third copy of the same
 * query. So this service owns the POLICY (is it yours, which language) and
 * delegates the READ.
 */
export class DeckService {
  constructor(
    private deckDAL: IDeckDAL,
    private onDeckVocabService: OnDeckVocabService
  ) {}

  /**
   * Validate and normalize a user-supplied deck name.
   * Trimmed here as well as in SQL so the length check measures what is stored.
   */
  private normalizeName(raw: unknown): string {
    if (typeof raw !== 'string') throw new ValidationError('Deck name is required');
    const name = raw.trim();
    if (!name) throw new ValidationError('Deck name is required');
    if (name.length > MAX_DECK_NAME_LENGTH) {
      throw new ValidationError(`Deck name must be ${MAX_DECK_NAME_LENGTH} characters or fewer`);
    }
    return name;
  }

  /** Coerce a route/query id to a positive integer, or reject it. */
  private requireDeckId(raw: unknown): number {
    const id = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
    if (!Number.isInteger(id) || id <= 0) throw new ValidationError('Invalid deck id');
    return id;
  }

  /** The user's decks in one language, newest first, with card counts. */
  async listDecks(userId: string, language: Language): Promise<DeckSummary[]> {
    return this.deckDAL.listDecks(userId, language);
  }

  /**
   * One deck, or NotFound. Every other method that names a deck goes through this,
   * so the ownership rule is written once.
   */
  async getDeck(userId: string, rawDeckId: unknown): Promise<DeckSummary> {
    const deckId = this.requireDeckId(rawDeckId);
    const deck = await this.deckDAL.findDeck(userId, deckId);
    if (!deck) throw new NotFoundError('Deck not found');
    return deck;
  }

  /** Create a deck in the caller's current language. */
  async createDeck(userId: string, language: Language, rawName: unknown): Promise<DeckSummary> {
    const name = this.normalizeName(rawName);

    // Checked here rather than as a database constraint: it is a product limit, and
    // the count is cheap (the deck list is already indexed by user+language).
    const existing = await this.deckDAL.listDecks(userId, language);
    if (existing.length >= MAX_DECKS_PER_LANGUAGE) {
      throw new ValidationError(
        `You already have ${MAX_DECKS_PER_LANGUAGE} decks in this language. Delete one to make room.`
      );
    }

    // A friendly duplicate message before the unique index fires. The index is
    // still the authority — two simultaneous creates race past this check and the
    // DAL translates the violation — but this path produces the better error for
    // the ordinary case.
    const clash = existing.find((d) => d.name.trim().toLowerCase() === name.toLowerCase());
    if (clash) throw new ValidationError(`You already have a deck called "${name}"`);

    return this.deckDAL.createDeck(userId, language, name);
  }

  /** Rename a deck the caller owns. */
  async renameDeck(userId: string, rawDeckId: unknown, rawName: unknown): Promise<DeckSummary> {
    const deckId = this.requireDeckId(rawDeckId);
    const name = this.normalizeName(rawName);

    const updated = await this.deckDAL.renameDeck(userId, deckId, name);
    if (!updated) throw new NotFoundError('Deck not found');
    return updated;
  }

  /**
   * Delete a deck the caller owns. Membership rows cascade; NO CARD IS DELETED.
   */
  async deleteDeck(userId: string, rawDeckId: unknown): Promise<void> {
    const deckId = this.requireDeckId(rawDeckId);
    const deleted = await this.deckDAL.deleteDeck(userId, deckId);
    if (!deleted) throw new NotFoundError('Deck not found');
  }

  /**
   * A deck's cards as fully-enriched entries, in the same shape the Learn Now and
   * Mastered collections return, so one client component renders all three.
   *
   * The deck's OWN language is used for the read, not the caller's currently
   * selected one: a user who switches to Spanish and follows a stale link to a
   * Chinese deck should see that deck, not an empty list produced by joining the
   * wrong vet table.
   */
  async listDeckCards(userId: string, rawDeckId: unknown): Promise<VocabEntry[]> {
    const deck = await this.getDeck(userId, rawDeckId);
    return this.onDeckVocabService.getDeckCards(userId, deck.language as Language, deck.id);
  }

  /** Which of the caller's decks contain a card — the checkbox menu's initial state. */
  async listDeckIdsForCard(userId: string, rawVocabEntryId: unknown): Promise<number[]> {
    const vocabEntryId = this.requireDeckId(rawVocabEntryId); // same positive-int rule
    return this.deckDAL.listDeckIdsForCard(userId, vocabEntryId);
  }

  /**
   * Save the checkbox menu: make the card's membership exactly `deckIds`.
   *
   * Deck ids the caller does not own are IGNORED, not rejected (IDeckDAL contract).
   * A menu left open across a deck deletion would otherwise fail to save at all,
   * losing the ticks the user did make; dropping the dead id saves what they meant.
   */
  async setCardMemberships(
    userId: string,
    rawVocabEntryId: unknown,
    rawDeckIds: unknown
  ): Promise<number[]> {
    const vocabEntryId = this.requireDeckId(rawVocabEntryId);
    if (rawDeckIds != null && !Array.isArray(rawDeckIds)) {
      throw new ValidationError('deckIds must be an array');
    }
    const deckIds = (rawDeckIds as unknown[] | null | undefined ?? [])
      .map((v) => (typeof v === 'number' ? v : parseInt(String(v), 10)))
      .filter((n) => Number.isInteger(n) && n > 0);

    return this.deckDAL.setCardMemberships(userId, vocabEntryId, deckIds);
  }
}
