import type {
  IStarterPacksDAL, DiscoverDetRow, PackCardRow, LevelMasteryCount,
} from '../interfaces/IStarterPacksDAL.js';
import { dbManager as defaultDbManager, DatabaseManager } from '../base/DatabaseManager.js';
import { dictTableForLanguage, discoverSupplyGate } from '../shared/dictTable.js';
import { vetTableForLanguage, CORE_CATEGORY_EXPR, vetSortedClause } from '../shared/vetTable.js';

/**
 * The det columns behind a discover card (DiscoverDetRow), aliased `de`.
 * One list so the five card reads cannot drift apart.
 */
const DISCOVER_COLS = `
  de.id, de.word1, de.word2, de.pronunciation, de.tone, de.definitions,
  de."definitionClusters",
  de.language, de.script, de."difficulty", de."frequencyScore", de.breakdown, de.synonyms,
  de."exampleSentences",
  de."iconId"`;

/**
 * The integer difficulty level of a det row, and the predicate for a row that HAS a valid
 * one. Every language shares ONE scale, '1'..'6' (migration 79; for zh the integer IS the
 * HSK level). `difficulty` is a smallint since migration 92, so it is used as-is. The
 * ceiling must match `StarterPacksService.MAX_LEVEL`.
 */
const LEVEL_EXPR = `de."difficulty"`;
const VALID_LEVEL = `de."difficulty" BETWEEN 1 AND 6`;

/**
 * Data access for the discover / add-cards flow — see IStarterPacksDAL.
 *
 * LAYER: DAL. Moved here from `StarterPacksService` (2026-11-09), which opened its own pool
 * client for each of these statements. The SQL is unchanged. Table names come from the
 * whitelisted helpers (`dictTableForLanguage`, `vetTableForLanguage`) and every spliced
 * fragment is a module constant; everything caller-supplied is bound.
 */
export class StarterPacksDAL implements IStarterPacksDAL {
  constructor(protected readonly dbManager: DatabaseManager = defaultDbManager) {}

  /** Run one statement and hand back its rows. */
  private async rows<T>(sql: string, params: unknown[]): Promise<T[]> {
    const result = await this.dbManager.executeQuery<T>((client) => client.query(sql, params));
    return result.recordset;
  }

  /** Run one statement and hand back its affected-row count. */
  private async affected(sql: string, params: unknown[]): Promise<number> {
    const result = await this.dbManager.executeQuery((client) => client.query(sql, params));
    return result.rowsAffected;
  }

  // ── Supply ────────────────────────────────────────────────────────────

  async countSortedByLevel(userId: string, language: string): Promise<LevelMasteryCount[]> {
    // CORE BAR (migration 143): "how much of this level does the learner already know" is
    // a recognition/production question — see StarterPacksService.estimateLevel.
    const rows = await this.rows<{ lvl: number; mastered: string; learning: string }>(`
      SELECT ${LEVEL_EXPR} AS lvl,
             COUNT(*) FILTER (WHERE ${CORE_CATEGORY_EXPR} = 'Mastered')  AS mastered,
             COUNT(*) FILTER (WHERE ${CORE_CATEGORY_EXPR} <> 'Mastered') AS learning
      FROM ${vetTableForLanguage(language)} ve
      JOIN ${dictTableForLanguage(language)} de
        ON ve."entryKey" = de.word1 AND de.language = ve.language
      WHERE ve."userId" = $1
        AND ve.language = $2
        AND ${VALID_LEVEL}
        -- SORTED only: a provisional card carries no statement of intent about the
        -- user's level, so it must not drag the cold-start estimate around.
        AND ${vetSortedClause()}
      GROUP BY lvl
    `, [userId, language]);
    return rows.map((r) => ({
      level: r.lvl,
      mastered: parseInt(r.mastered, 10),
      learning: parseInt(r.learning, 10),
    }));
  }

  async findSupplyRows(
    language: string,
    userId: string,
    level: number,
    excludeIds: number[],
    opts: { includeSkips: boolean; limit: number; exactLevel?: number }
  ): Promise<DiscoverDetRow[]> {
    if (opts.limit <= 0) return [];

    // $1 language, $2 userId, $3 level (for the nearest-first distance ordering),
    // then optional excludeIds, then optional exactLevel, then the limit.
    const params: unknown[] = [language, userId, level];
    let excludeFilter = '';
    if (excludeIds.length > 0) {
      params.push(excludeIds);
      excludeFilter = ` AND de.id != ALL($${params.length}::int[])`;
    }

    // When the caller pins an exact level (pack supply drives level drift itself),
    // constrain to that band so level is honored before any pack-vs-single ordering.
    let exactLevelFilter = '';
    if (typeof opts.exactLevel === 'number') {
      params.push(opts.exactLevel);
      exactLevelFilter = ` AND ${LEVEL_EXPR} = $${params.length}`;
    }

    // Skip phase: fresh supply EXCLUDES skipped cards; recycle phase keeps ONLY them.
    // `recycleOrder` pulls the oldest skip back first when recycling.
    const skipFilter = opts.includeSkips
      ? `AND EXISTS (SELECT 1 FROM discover_skips ds WHERE ds."userId" = $2 AND ds.language = de.language AND ds."cardId" = de.id)`
      : `AND NOT EXISTS (SELECT 1 FROM discover_skips ds WHERE ds."userId" = $2 AND ds.language = de.language AND ds."cardId" = de.id)`;
    const recycleOrder = opts.includeSkips
      ? `(SELECT ds."createdAt" FROM discover_skips ds WHERE ds."userId" = $2 AND ds.language = de.language AND ds."cardId" = de.id) ASC,`
      : '';

    // Both languages are one det row per word1 (es since migration 123), so a card is
    // "already sorted" when the user holds a sorted vet row for that word — full stop.
    params.push(opts.limit);
    const limitParam = `$${params.length}`;

    return this.rows<DiscoverDetRow>(`
      SELECT ${DISCOVER_COLS}
      FROM ${dictTableForLanguage(language)} de
      WHERE de.language = $1
        AND ${discoverSupplyGate()}
        AND ${VALID_LEVEL}
        AND NOT EXISTS (
          SELECT 1 FROM ${vetTableForLanguage(language)} ve
          WHERE ve."userId" = $2 AND ve."entryKey" = de.word1 AND ve.language = de.language
            -- SORTED only. A provisional card (migration 140) has a vet row but the
            -- user has not sorted it, so discover MUST keep offering it — that is how
            -- a temporary card earned in a game gets promoted into the real deck.
            AND ${vetSortedClause()}
        )
        ${skipFilter}
        ${excludeFilter}
        ${exactLevelFilter}
      ORDER BY ${recycleOrder} ABS(${LEVEL_EXPR} - $3) ASC, de."frequencyScore" DESC NULLS LAST, de.id ASC
      LIMIT ${limitParam}
    `, params);
  }

  async findQuickMarkPage(
    language: string,
    userId: string,
    level: number,
    cursor: { score: number | null; id: number } | null,
    limit: number
  ): Promise<DiscoverDetRow[]> {
    // $1 language, $2 userId, $3 level, then optional cursor score+id, then limit.
    const params: unknown[] = [language, userId, level];
    let cursorFilter = '';
    if (cursor) {
      params.push(cursor.score); // may be null (the NULL-score tail)
      const scoreIdx = params.length;
      params.push(cursor.id);
      const idIdx = params.length;
      // Resume strictly AFTER (cursor.score, cursor.id) under DESC-NULLS-LAST / id-ASC:
      //   - a NULL cursor score means we're already in the trailing NULL-score block,
      //     so continue by id within it;
      //   - otherwise take everything with a lower score, the same score with a larger
      //     id, or any NULL score (which sorts after every non-NULL score).
      cursorFilter = `
        AND CASE
              WHEN $${scoreIdx}::int IS NULL THEN (de."frequencyScore" IS NULL AND de.id > $${idIdx})
              ELSE (
                de."frequencyScore" < $${scoreIdx}::int
                OR (de."frequencyScore" = $${scoreIdx}::int AND de.id > $${idIdx})
                OR de."frequencyScore" IS NULL
              )
            END`;
    }
    params.push(limit);
    const limitIdx = params.length;

    return this.rows<DiscoverDetRow>(`
      SELECT ${DISCOVER_COLS}
      FROM ${dictTableForLanguage(language)} de
      WHERE de.language = $1
        AND ${discoverSupplyGate()}
        AND ${VALID_LEVEL}
        AND ${LEVEL_EXPR} = $3
        AND NOT EXISTS (
          SELECT 1 FROM ${vetTableForLanguage(language)} ve
          WHERE ve."userId" = $2 AND ve."entryKey" = de.word1 AND ve.language = de.language
            -- SORTED only (see findSupplyRows).
            AND ${vetSortedClause()}
        )
        ${cursorFilter}
      ORDER BY de."frequencyScore" DESC NULLS LAST, de.id ASC
      LIMIT $${limitIdx}
    `, params);
  }

  async countDiscoverable(language: string): Promise<number> {
    const rows = await this.rows<{ count: string }>(`
      SELECT COUNT(*) AS count
      FROM ${dictTableForLanguage(language)}
      WHERE language = $1 AND ${discoverSupplyGate('')}
    `, [language]);
    return parseInt(rows[0]?.count ?? '0', 10);
  }

  async countSortedOrSkipped(userId: string, language: string): Promise<number> {
    // "Sorted" = cards the user has acted on = sorted vet rows PLUS current skips. Skips
    // moved out of vet into discover_skips (migration 80), so both must be counted to keep
    // progress faithful to the pre-split behaviour.
    const rows = await this.rows<{ count: string }>(`
      SELECT
        (SELECT COUNT(*) FROM ${vetTableForLanguage(language)} ve
           WHERE ve."userId" = $1 AND ve.language = $2 AND ${vetSortedClause()})
      + (SELECT COUNT(*) FROM discover_skips
           WHERE "userId" = $1 AND language = $2) AS count
    `, [userId, language]);
    return parseInt(rows[0]?.count ?? '0', 10);
  }

  // ── Card lookups ──────────────────────────────────────────────────────

  async findDiscoverableWordById(cardId: number, language: string): Promise<{ word1: string; language: string } | null> {
    const rows = await this.rows<{ word1: string; language: string }>(`
      SELECT word1, language FROM ${dictTableForLanguage(language)}
      WHERE id = $1 AND ${discoverSupplyGate('')}
    `, [cardId]);
    return rows[0] ?? null;
  }

  async findWordById(cardId: number, language: string): Promise<string | null> {
    const rows = await this.rows<{ word1: string }>(
      `SELECT word1 FROM ${dictTableForLanguage(language)} WHERE id = $1`,
      [cardId]
    );
    return rows[0]?.word1 ?? null;
  }

  async findDiscoverableByWords(words: string[], language: string): Promise<DiscoverDetRow[]> {
    if (words.length === 0) return [];
    return this.rows<DiscoverDetRow>(`
      SELECT ${DISCOVER_COLS}
      FROM ${dictTableForLanguage(language)} de
      WHERE de.word1 = ANY($1::text[]) AND de.language = $2
        AND ${discoverSupplyGate()}
      ORDER BY array_position($1::text[], de.word1)
    `, [words, language]);
  }

  async findCardsWithPackState(ids: number[], userId: string, language: string): Promise<PackCardRow[]> {
    if (ids.length === 0) return [];
    const rows = await this.rows<PackCardRow>(`
      SELECT ${DISCOVER_COLS},
             EXISTS (
               SELECT 1 FROM ${vetTableForLanguage(language)} ve
               WHERE ve."userId" = $2 AND ve."entryKey" = de.word1 AND ve.language = de.language
                 AND ${vetSortedClause()}
             ) AS sorted,
             EXISTS (
               SELECT 1 FROM discover_skips ds
               WHERE ds."userId" = $2 AND ds.language = de.language AND ds."cardId" = de.id
             ) AS skipped
      FROM ${dictTableForLanguage(language)} de
      WHERE de.id = ANY($1::int[]) AND de.language = $3
      ORDER BY array_position($1::int[], de.id)
    `, [ids, userId, language]);
    return rows.map((r) => ({ ...r, sorted: r.sorted === true, skipped: r.skipped === true }));
  }

  async findSkippedCards(userId: string, language: string): Promise<DiscoverDetRow[]> {
    return this.rows<DiscoverDetRow>(`
      SELECT ${DISCOVER_COLS}
      FROM discover_skips ds
      JOIN ${dictTableForLanguage(language)} de ON de.id = ds."cardId" AND de.language = ds.language
      WHERE ds."userId" = $1 AND ds.language = $2
      ORDER BY ds."createdAt" DESC
    `, [userId, language]);
  }

  // ── discover_skips ────────────────────────────────────────────────────

  async insertSkips(userId: string, language: string, cardIds: number[]): Promise<void> {
    if (cardIds.length === 0) return;
    await this.affected(`
      INSERT INTO discover_skips ("userId", language, "cardId")
      SELECT $1, $2, UNNEST($3::int[])
      ON CONFLICT ("userId", language, "cardId") DO NOTHING
    `, [userId, language, cardIds]);
  }

  async deleteSkip(userId: string, language: string, cardId: number): Promise<boolean> {
    const n = await this.affected(
      `DELETE FROM discover_skips WHERE "userId" = $1 AND language = $2 AND "cardId" = $3`,
      [userId, language, cardId]
    );
    return n > 0;
  }

  async deleteAllSkips(userId: string, language: string): Promise<number> {
    return this.affected(
      `DELETE FROM discover_skips WHERE "userId" = $1 AND language = $2`,
      [userId, language]
    );
  }

  // ── users."seenPacks" ─────────────────────────────────────────────────

  async findSeenPackIds(userId: string): Promise<number[]> {
    const rows = await this.rows<{ seenPacks: number[] | null }>(
      `SELECT "seenPacks" FROM users WHERE id = $1`,
      [userId]
    );
    return rows[0]?.seenPacks ?? [];
  }

  async addSeenPack(userId: string, packId: number): Promise<void> {
    await this.affected(
      `UPDATE users SET "seenPacks" = array_append("seenPacks", $2)
       WHERE id = $1 AND NOT ($2 = ANY("seenPacks"))`,
      [userId, packId]
    );
  }

  async removeSeenPack(userId: string, packId: number): Promise<void> {
    await this.affected(
      `UPDATE users SET "seenPacks" = array_remove("seenPacks", $2) WHERE id = $1`,
      [userId, packId]
    );
  }
}
