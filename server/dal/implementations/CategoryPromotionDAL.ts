import type { PoolClient } from 'pg';
import { ICategoryPromotionDAL, VelocityBucket } from '../interfaces/ICategoryPromotionDAL.js';
import { dbManager as defaultDbManager, DatabaseManager } from '../base/DatabaseManager.js';
import { CategoryPromotion, CategoryPromotionInput } from '../../types/velocity.js';
import type { MasteryBarId } from '../../contracts/wire.js';
import { ValidationError } from '../../types/dal.js';

/**
 * Persists the append-only `category_promotions` log (one row per upward utcm band
 * move) and derives velocity from it. No stored counters — velocity is always a
 * SUM over the sliding window.
 *
 * Every method accepts an optional PoolClient so a caller already inside a
 * transaction (undoLastMark) or holding its own connection (the mark handler) can
 * enlist the query rather than grabbing a second connection from the pool. This is
 * the client-passing shape docs/BACKEND_LAYERING.md §3 prescribes.
 */
export class CategoryPromotionDAL implements ICategoryPromotionDAL {

  /**
   * The connection manager, injected so the DAL can be substituted in a test.
   * Defaults to the process-wide singleton (mirrors WinsDAL).
   */
  constructor(protected readonly dbManager: DatabaseManager = defaultDbManager) {}

  /**
   * Run `fn` on the caller's client when given one, otherwise on a pooled
   * connection. Keeps every method below to a single query body.
   */
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

  async recordPromotion(input: CategoryPromotionInput, client?: PoolClient): Promise<CategoryPromotion> {
    if (!input?.userId) throw new ValidationError('userId is required');
    if (!input.language) throw new ValidationError('language is required');
    if (typeof input.vocabEntryId !== 'number') throw new ValidationError('vocabEntryId is required');
    // The CHECK constraint would reject this anyway; failing here names the caller's bug.
    if (!(input.bandsClimbed > 0)) throw new ValidationError('bandsClimbed must be positive');

    const result = await this.run<CategoryPromotion>(client, (c) => c.query(`
      INSERT INTO category_promotions
        ("userId", language, "vocabEntryId", bar, "fromCategory", "toCategory",
         "bandsClimbed", "markType", "markTimestamp")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, "userId", language, "vocabEntryId", bar, "fromCategory", "toCategory",
                "bandsClimbed", "markType", "markTimestamp", "promotedAt"
    `, [
      input.userId,
      input.language,
      input.vocabEntryId,
      input.bar,
      input.fromCategory,
      input.toCategory,
      input.bandsClimbed,
      input.markType,
      input.markTimestamp,
    ]));

    return result.rows[0];
  }

  async deleteForMark(vocabEntryId: number, markTimestamp: string, client?: PoolClient): Promise<number> {
    if (typeof vocabEntryId !== 'number') throw new ValidationError('vocabEntryId is required');
    if (!markTimestamp) throw new ValidationError('markTimestamp is required');

    // (vocabEntryId, markTimestamp) is unique in practice — one mark promotes a card
    // at most once — but DELETE is written to remove all matches so a hypothetical
    // duplicate can never leave a stranded row inflating velocity forever.
    const result = await this.run(client, (c) => c.query(`
      DELETE FROM category_promotions
      WHERE "vocabEntryId" = $1 AND "markTimestamp" = $2
    `, [vocabEntryId, markTimestamp]));

    return result.rowCount;
  }

  async getVelocityByLanguage(
    userId: string,
    windowDays: number,
    bars: MasteryBarId[] = ['core']
  ): Promise<Map<string, number>> {
    if (!userId) throw new ValidationError('userId is required');

    // Restricted to the bars the account is PURSUING (migration 143). Promotions in a
    // bar whose goal is off stay in the log — turning that goal on later brings the
    // learner's real recent work with it, instead of resetting velocity to zero — but
    // they must not inflate a number for a skill the learner never opted into.
    // `bars` is a list of union values, bound as a text[] rather than interpolated.
    const result = await this.run<{ language: string; steps: string }>(undefined, (c) => c.query(`
      SELECT language, SUM("bandsClimbed") AS steps
      FROM category_promotions
      WHERE "userId" = $1
        AND "promotedAt" >= now() - make_interval(days => $2::int)
        AND bar = ANY($3::text[])
      GROUP BY language
    `, [userId, windowDays, bars]));

    const byLanguage = new Map<string, number>();
    for (const row of result.rows) {
      // SUM() of a smallint comes back as a bigint string from pg.
      byLanguage.set(row.language, parseInt(row.steps, 10));
    }
    return byLanguage;
  }

  async getVelocityBuckets(userIds: string[], windowDays: number): Promise<VelocityBucket[]> {
    if (!Array.isArray(userIds) || userIds.length === 0) return [];

    // Grouped by bar as well as language because the caller applies each user's OWN
    // goal flags — see the interface note. Users with no promotions in the window
    // simply produce no rows; the caller reads those as zero.
    const result = await this.run<{
      userId: string;
      language: string;
      bar: MasteryBarId;
      steps: string;
    }>(undefined, (c) => c.query(`
      SELECT "userId", language, bar, SUM("bandsClimbed") AS steps
      FROM category_promotions
      WHERE "userId" = ANY($1::uuid[])
        AND "promotedAt" >= now() - make_interval(days => $2::int)
      GROUP BY "userId", language, bar
    `, [userIds, windowDays]));

    return result.rows.map((row) => ({
      userId: row.userId,
      language: row.language,
      bar: row.bar,
      // SUM() of a smallint arrives as a bigint string from pg.
      bandsClimbed: parseInt(row.steps, 10),
    }));
  }
}
