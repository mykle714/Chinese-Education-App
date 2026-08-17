import type { PoolClient } from 'pg';
import { IDeckDAL } from '../interfaces/IDeckDAL.js';
import { dbManager as defaultDbManager, DatabaseManager } from '../base/DatabaseManager.js';
import type { DeckSummary } from '../../types/decks.js';
import { ValidationError, DuplicateError } from '../../types/dal.js';

/**
 * The `decks` columns a DeckSummary needs, minus `cardCount`.
 * `d` is the alias every query here uses for the decks table.
 */
const DECK_COLS = `d.id, d.language, d.name, d."editMode", d."createdAt", d."updatedAt"`;

/**
 * Membership count as a correlated subquery rather than a
 * `LEFT JOIN deck_cards ... GROUP BY`. Two reasons: the GROUP BY form has to list
 * every selected deck column in its grouping key (noise that grows with the row
 * type), and this form returns 0 for an empty deck without relying on the reader
 * to notice that COUNT of a LEFT JOIN counts the joined column, not `*`.
 * It reads the composite PK's leading column, so it is an index-only scan.
 */
const CARD_COUNT = `(SELECT COUNT(*)::int FROM deck_cards dc WHERE dc."deckId" = d.id) AS "cardCount"`;

/** Postgres unique-violation SQLSTATE — the deck-name index firing. */
const PG_UNIQUE_VIOLATION = '23505';

/**
 * Persists user-authored card sets (`decks` / `deck_cards`, migration 141).
 *
 * See docs/DECKS_FEATURE.md and IDeckDAL.ts for the layering rules this file
 * obeys (no policy, ownership passed in, no vet reads).
 */
export class DeckDAL implements IDeckDAL {

  /** Injected so a test can substitute a manager; defaults to the process singleton. */
  constructor(protected readonly dbManager: DatabaseManager = defaultDbManager) {}

  /** Run `fn` on the caller's client when given one, otherwise on a pooled connection. */
  private async run<T>(
    client: PoolClient | undefined,
    fn: (c: PoolClient) => Promise<any>
  ): Promise<{ rows: T[]; rowCount: number }> {
    if (client) {
      const r = await fn(client);
      return { rows: r.rows || [], rowCount: r.rowCount || 0 };
    }
    const r = await this.dbManager.executeQuery<T>(fn);
    return { rows: r.recordset, rowCount: r.rowsAffected };
  }

  /** Guard a uuid-ish id argument. */
  private requireUserId(value: string | undefined | null): string {
    if (!value || typeof value !== 'string') throw new ValidationError('userId is required');
    return value;
  }

  /**
   * Guard an integer id argument. Rejects NaN and non-positive values before they
   * reach SQL, where a NaN would become the string 'NaN' and error as a type
   * mismatch several layers away from the caller that produced it.
   */
  private requireIntId(value: number | undefined | null, label: string): number {
    if (!Number.isInteger(value) || (value as number) <= 0) {
      throw new ValidationError(`${label} must be a positive integer`);
    }
    return value as number;
  }

  async listDecks(userId: string, language: string, client?: PoolClient): Promise<DeckSummary[]> {
    this.requireUserId(userId);
    if (!language) throw new ValidationError('language is required');

    const { rows } = await this.run<DeckSummary>(client, (c) =>
      c.query(
        `SELECT ${DECK_COLS}, ${CARD_COUNT}
           FROM decks d
          WHERE d."userId" = $1 AND d.language = $2
          ORDER BY d."createdAt" DESC`,
        [userId, language]
      )
    );
    return rows;
  }

  async findDeck(userId: string, deckId: number, client?: PoolClient): Promise<DeckSummary | null> {
    this.requireUserId(userId);
    this.requireIntId(deckId, 'deckId');

    const { rows } = await this.run<DeckSummary>(client, (c) =>
      c.query(
        `SELECT ${DECK_COLS}, ${CARD_COUNT}
           FROM decks d
          WHERE d.id = $1 AND d."userId" = $2`,
        [deckId, userId]
      )
    );
    return rows[0] ?? null;
  }

  async createDeck(
    userId: string,
    language: string,
    name: string,
    client?: PoolClient
  ): Promise<DeckSummary> {
    this.requireUserId(userId);
    if (!language) throw new ValidationError('language is required');
    if (!name || !name.trim()) throw new ValidationError('Deck name is required');

    try {
      const { rows } = await this.run<DeckSummary>(client, (c) =>
        c.query(
          // The RETURNING list is aliased `d` so it can reuse DECK_COLS; a fresh
          // deck is always empty, so `cardCount` is a literal rather than a
          // subquery that would have to run against a row this statement just made.
          `WITH inserted AS (
             INSERT INTO decks ("userId", language, name)
             VALUES ($1, $2, btrim($3))
             RETURNING *
           )
           SELECT ${DECK_COLS}, 0 AS "cardCount" FROM inserted d`,
          [userId, language, name]
        )
      );
      return rows[0];
    } catch (error: any) {
      // decks_user_language_name_uniq. The service checks for a clash first, but two
      // taps of "Create" race past that check; translate so the controller answers
      // 409 rather than 500.
      if (error?.code === PG_UNIQUE_VIOLATION) {
        throw new DuplicateError(`You already have a deck called "${name.trim()}"`);
      }
      throw error;
    }
  }

  async createPresetDeck(
    userId: string,
    language: string,
    name: string,
    vocabEntryIds: number[],
    client?: PoolClient
  ): Promise<DeckSummary> {
    this.requireUserId(userId);
    if (!language) throw new ValidationError('language is required');
    if (!name || !name.trim()) throw new ValidationError('Deck name is required');

    const cardIds = Array.from(
      new Set((vocabEntryIds ?? []).filter((id) => Number.isInteger(id) && id > 0))
    );

    const apply = async (c: PoolClient): Promise<DeckSummary> => {
      // `editMode = 'preset'`: no rename, no delete, no membership change by the
      // user, and it does not count against MAX_DECKS_PER_LANGUAGE (migration 148).
      //
      // No DuplicateError translation here, unlike createDeck: the name index is
      // PARTIAL on `editMode = 'custom'`, so two live challenges against the same
      // friend may both produce a deck called `vs Bob`. That is deliberate — they are
      // told apart by the challenge that owns them and, for the user, by the friend's
      // icon on the tile (Q30). A preset deck can never collide.
      const inserted = await c.query<{ id: number }>(
        `INSERT INTO decks ("userId", language, name, "editMode")
         VALUES ($1, $2, btrim($3), 'preset')
         RETURNING id`,
        [userId, language, name]
      );
      const deckId = inserted.rows[0].id;

      if (cardIds.length > 0) {
        await c.query(
          `INSERT INTO deck_cards ("deckId", "vocabEntryId")
           SELECT $1, id FROM unnest($2::int[]) AS id
           ON CONFLICT ("deckId", "vocabEntryId") DO NOTHING`,
          [deckId, cardIds]
        );
      }

      const { rows } = await c.query<DeckSummary>(
        `SELECT ${DECK_COLS}, ${CARD_COUNT} FROM decks d WHERE d.id = $1`,
        [deckId]
      );
      return rows[0];
    };

    // The deck row and its membership must not be observable half-created — a deck
    // that exists with no cards is a deck the learner cannot study from and cannot
    // delete (preset decks expose no delete control). The challenge accept path
    // always supplies its own client, so this normally enlists in that transaction.
    if (client) return apply(client);
    return this.dbManager.executeInTransaction((tx) => apply(tx.getClient()));
  }

  async countCustomDecks(userId: string, language: string, client?: PoolClient): Promise<number> {
    this.requireUserId(userId);
    if (!language) throw new ValidationError('language is required');

    // The 100-deck cap counts ONLY authored decks (§ 4, Q11). "Their own pool of
    // deck slots" means exactly one thing: generated decks do not detract from the
    // 100. There is no user-visible slot capacity to build.
    const { rows } = await this.run<{ count: string }>(client, (c) =>
      c.query(
        `SELECT COUNT(*) AS count FROM decks
          WHERE "userId" = $1 AND language = $2 AND "editMode" = 'custom'`,
        [userId, language]
      )
    );
    return parseInt(rows[0]?.count ?? '0', 10);
  }

  async findDeckEditMode(
    userId: string,
    deckId: number,
    client?: PoolClient
  ): Promise<string | null> {
    this.requireUserId(userId);
    this.requireIntId(deckId, 'deckId');

    const { rows } = await this.run<{ editMode: string }>(client, (c) =>
      c.query(
        `SELECT "editMode" FROM decks WHERE id = $1 AND "userId" = $2`,
        [deckId, userId]
      )
    );
    return rows[0]?.editMode ?? null;
  }

  async renameDeck(
    userId: string,
    deckId: number,
    name: string,
    client?: PoolClient
  ): Promise<DeckSummary | null> {
    this.requireUserId(userId);
    this.requireIntId(deckId, 'deckId');
    if (!name || !name.trim()) throw new ValidationError('Deck name is required');

    try {
      const { rows } = await this.run<DeckSummary>(client, (c) =>
        c.query(
          // `"userId" = $3` in the WHERE is the defence-in-depth ownership filter:
          // a caller that skipped the service check renames nothing.
          `WITH updated AS (
             UPDATE decks
                SET name = btrim($1), "updatedAt" = now()
              WHERE id = $2 AND "userId" = $3
              RETURNING *
           )
           SELECT ${DECK_COLS}, ${CARD_COUNT} FROM updated d`,
          [name, deckId, userId]
        )
      );
      return rows[0] ?? null;
    } catch (error: any) {
      if (error?.code === PG_UNIQUE_VIOLATION) {
        throw new DuplicateError(`You already have a deck called "${name.trim()}"`);
      }
      throw error;
    }
  }

  async deleteDeck(userId: string, deckId: number, client?: PoolClient): Promise<boolean> {
    this.requireUserId(userId);
    this.requireIntId(deckId, 'deckId');

    // Membership rows go with it via ON DELETE CASCADE (migration 141). The vet
    // rows themselves are untouched — a deck is a view onto cards, never their
    // owner, so deleting a deck must never cost the learner a card or its history.
    const { rowCount } = await this.run(client, (c) =>
      c.query(`DELETE FROM decks WHERE id = $1 AND "userId" = $2`, [deckId, userId])
    );
    return rowCount > 0;
  }

  async listDeckCardIds(userId: string, deckId: number, client?: PoolClient): Promise<number[]> {
    this.requireUserId(userId);
    this.requireIntId(deckId, 'deckId');

    const { rows } = await this.run<{ vocabEntryId: number }>(client, (c) =>
      c.query(
        // The join to `decks` is what scopes this to the caller — `deck_cards` has
        // no userId of its own.
        `SELECT dc."vocabEntryId"
           FROM deck_cards dc
           JOIN decks d ON d.id = dc."deckId"
          WHERE dc."deckId" = $1 AND d."userId" = $2
          ORDER BY dc."addedAt" DESC`,
        [deckId, userId]
      )
    );
    return rows.map((r) => r.vocabEntryId);
  }

  async listDeckIdsForCard(
    userId: string,
    vocabEntryId: number,
    client?: PoolClient
  ): Promise<number[]> {
    this.requireUserId(userId);
    this.requireIntId(vocabEntryId, 'vocabEntryId');

    const { rows } = await this.run<{ deckId: number }>(client, (c) =>
      c.query(
        `SELECT dc."deckId"
           FROM deck_cards dc
           JOIN decks d ON d.id = dc."deckId"
          WHERE dc."vocabEntryId" = $1 AND d."userId" = $2`,
        [vocabEntryId, userId]
      )
    );
    return rows.map((r) => r.deckId);
  }

  async setCardMemberships(
    userId: string,
    vocabEntryId: number,
    deckIds: number[],
    client?: PoolClient
  ): Promise<number[]> {
    this.requireUserId(userId);
    this.requireIntId(vocabEntryId, 'vocabEntryId');

    // Defensive normalization: drop anything non-integer and de-duplicate, so a
    // malformed body cannot reach the query and a repeated id cannot make the
    // INSERT conflict with itself within one statement.
    const wanted = Array.from(
      new Set((deckIds ?? []).filter((id) => Number.isInteger(id) && id > 0))
    );

    const apply = async (c: PoolClient): Promise<number[]> => {
      // DELETE-then-INSERT, both scoped to decks this user owns.
      //
      // The delete's `NOT (dc."deckId" = ANY($3))` keeps rows that should survive
      // rather than clearing everything and re-inserting: re-inserting would reset
      // `addedAt` on decks the user did not touch, silently reordering their
      // collection view (which sorts by addedAt).
      await c.query(
        `DELETE FROM deck_cards dc
          USING decks d
          WHERE d.id = dc."deckId"
            AND d."userId" = $1
            AND dc."vocabEntryId" = $2
            AND NOT (dc."deckId" = ANY($3::int[]))`,
        [userId, vocabEntryId, wanted]
      );

      if (wanted.length > 0) {
        // The SELECT..FROM decks source is what silently ignores ids the user does
        // not own (IDeckDAL contract): a foreign deck id simply matches no row.
        // ON CONFLICT DO NOTHING makes a re-save of an unchanged menu a no-op that
        // preserves `addedAt`.
        await c.query(
          `INSERT INTO deck_cards ("deckId", "vocabEntryId")
           SELECT d.id, $2
             FROM decks d
            WHERE d."userId" = $1 AND d.id = ANY($3::int[])
           ON CONFLICT ("deckId", "vocabEntryId") DO NOTHING`,
          [userId, vocabEntryId, wanted]
        );
      }

      const { rows } = await c.query<{ deckId: number }>(
        `SELECT dc."deckId"
           FROM deck_cards dc
           JOIN decks d ON d.id = dc."deckId"
          WHERE dc."vocabEntryId" = $1 AND d."userId" = $2`,
        [vocabEntryId, userId]
      );
      return rows.map((r) => r.deckId);
    };

    // The delete and the insert must not be observable half-applied — between them
    // the card is in none of its decks, and a concurrent read of the checkbox menu
    // would show every box empty. When the caller supplies a client we join their
    // transaction; otherwise we open one.
    if (client) return apply(client);
    return this.dbManager.executeInTransaction((tx) => apply(tx.getClient()));
  }

  async deleteMembershipsForCard(vocabEntryId: number, client?: PoolClient): Promise<number> {
    this.requireIntId(vocabEntryId, 'vocabEntryId');

    // Deliberately NOT user-scoped — see IDeckDAL.deleteMembershipsForCard.
    const { rowCount } = await this.run(client, (c) =>
      c.query(`DELETE FROM deck_cards WHERE "vocabEntryId" = $1`, [vocabEntryId])
    );
    return rowCount;
  }
}
