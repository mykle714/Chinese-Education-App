import {
  IMemoryMapDAL,
  MemoryMapCandidateRow,
  MemoryMapPlacedRow,
} from '../interfaces/IMemoryMapDAL.js';
import { dbManager as defaultDbManager, DatabaseManager } from '../base/DatabaseManager.js';
import { MemoryMapPlacement } from '../../contracts/wire.js';
import { ValidationError } from '../../types/dal.js';
import {
  vetTableForLanguage,
  vetSortedClause,
  masteredBarClause,
  typeCategoryExpr,
} from '../shared/vetTable.js';
import { DICT_JOIN } from '../shared/dictJoin.js';

/**
 * Data access for Memory Map (docs/MEMORY_MAP_GAME.md § 8, § 9).
 *
 * LAYER: DAL. All of the feature's SQL and none of its rules. Where a word LANDS is
 * services/memoryMapSpawn.ts; which words are worth placing is MemoryMapService.
 *
 * ── THE TABLE NAME IS DERIVED, NEVER INTERPOLATED FROM INPUT ─────────────────
 * `placementsTableFor` is a two-value whitelist over a validated language code, the
 * same pattern as `vetTableForLanguage`. Nothing caller-controlled reaches the SQL
 * string; every user value is bound.
 */
export class MemoryMapDAL implements IMemoryMapDAL {
  constructor(protected readonly dbManager: DatabaseManager = defaultDbManager) {}

  /**
   * The placements table for a language. Mirrors `vetTableForLanguage` exactly,
   * including its "anything that isn't Spanish is Chinese" fallback, so a placement
   * table and its vet table can never disagree about which language a row belongs to.
   */
  private placementsTableFor(language: string | null | undefined): string {
    return language === 'es' ? 'memory_map_placements_es' : 'memory_map_placements_zh';
  }

  /**
   * SELECT list shared by every read that returns a placed word. Kept in one place
   * because the two queries that use it (`getPlacements` and the RETURNING hydration
   * in `insertPlacements`) must produce the identical row shape — the client cannot
   * tell a newly-spawned word from a long-placed one, and neither should the wire.
   */
  private static readonly PLACED_COLUMNS = `
    p."vocabEntryId",
    p.x,
    p.y,
    p.scale,
    ve."entryKey",
    ve.language,
    ve."selectedSense",
    -- The dd is resolved in the SERVICE (resolveDisplayDefinition needs the clusters
    -- AND the learner's sense pick together, which SQL cannot express), so both the
    -- raw definition and the cluster array travel out of here unresolved.
    de.definition,
    de."definitionClusters",
    de.pronunciation
  `;

  async getPlacements(userId: string, language: string): Promise<MemoryMapPlacedRow[]> {
    if (!userId) throw new ValidationError('userId is required');

    const table = this.placementsTableFor(language);
    const vet = vetTableForLanguage(language);

    const result = await this.dbManager.executeQuery<MemoryMapPlacedRow>(async (client) =>
      client.query(
        `
        SELECT ${MemoryMapDAL.PLACED_COLUMNS}
        FROM ${table} p
        JOIN ${vet} ve ON ve.id = p."vocabEntryId"
        ${DICT_JOIN}
        WHERE p."userId" = $1 AND p.language = $2
        -- Placement order, not display order: the client positions by (x, y). This
        -- only makes the payload deterministic so a diff of two loads is meaningful.
        ORDER BY p."createdAt" ASC, p.id ASC
        `,
        [userId, language]
      )
    );
    return result.recordset;
  }

  async getUnplacedCandidates(
    userId: string,
    language: string
  ): Promise<MemoryMapCandidateRow[]> {
    if (!userId) throw new ValidationError('userId is required');

    const table = this.placementsTableFor(language);

    const result = await this.dbManager.executeQuery<MemoryMapCandidateRow>(async (client) =>
      client.query(
        `
        SELECT ve.id                                   AS "vocabEntryId",
               ve."entryKey",
               ve.language,
               ve."typedMarkHistory",
               ${typeCategoryExpr(`'reading'`)}        AS "readingCategory"
        FROM ${vetTableForLanguage(language)} ve
        WHERE ve."userId" = $1
          AND ve.language = $2
          -- SORTED, not PLAYABLE — and Memory Map is the FIRST game to want this.
          -- Every other game pool is vetPlayableClause() because a lent provisional
          -- card is fine for one round. Here selection creates a DURABLE artifact: a
          -- borrowed word would take permanent residence on a map meant to portray the
          -- learner's own library (§ 2.1, Q12). See docs/PROVISIONAL_CARDS.md.
          AND ${vetSortedClause()}
          -- The reading track decides membership, NOT core mastery: the map is a
          -- portrait of the learner's READING journey specifically (§ 2.1). Goal-
          -- independent since migration 143, so this works with readingGoal off.
          AND NOT ${masteredBarClause('reading')}
          AND NOT EXISTS (
            SELECT 1 FROM ${table} p
            WHERE p."userId" = ve."userId" AND p."vocabEntryId" = ve.id
          )
        -- Stable tiebreak only; the real ordering is rankCardQueue in app code, which
        -- reads mark TIMESTAMPS out of jsonb that SQL cannot usefully sort on.
        ORDER BY ve."createdAt" DESC
        `,
        [userId, language]
      )
    );
    return result.recordset;
  }

  async insertPlacements(
    userId: string,
    language: string,
    placements: MemoryMapPlacement[]
  ): Promise<MemoryMapPlacedRow[]> {
    if (!userId) throw new ValidationError('userId is required');
    if (placements.length === 0) return [];

    const table = this.placementsTableFor(language);
    const ids = placements.map((p) => p.vocabEntryId);

    await this.dbManager.executeQuery(async (client) =>
      client.query(
        `
        INSERT INTO ${table} ("userId", "vocabEntryId", language, x, y, scale)
        SELECT $1, incoming.id, $2, incoming.x, incoming.y, incoming.scale
        FROM UNNEST($3::int[], $4::real[], $5::real[], $6::real[])
             AS incoming(id, x, y, scale)
        -- A placement is written ONCE and never moved (§ 2.3). Two concurrent game
        -- loads would otherwise race to spawn the same card and the loser would
        -- TELEPORT a word the learner has already looked at, so the first spawn wins.
        ON CONFLICT ("userId", "vocabEntryId") DO NOTHING
        `,
        [
          userId,
          language,
          ids,
          placements.map((p) => p.x),
          placements.map((p) => p.y),
          placements.map((p) => p.scale),
        ]
      )
    );

    return this.hydratePlacements(userId, language, ids);
  }

  /**
   * Read placements back by vet id, in the same shape `getPlacements` returns.
   *
   * A SEPARATE STATEMENT FROM THE INSERT, AND IT HAS TO BE. The obvious version of
   * this — a data-modifying CTE (`WITH inserted AS (INSERT ... RETURNING ...) SELECT
   * ... FROM placements`) — silently returns ZERO ROWS: every part of a statement sees
   * the same snapshot, taken before the statement ran, so the outer SELECT cannot see
   * the rows the CTE just wrote. It was written that way first, and the symptom was a
   * map that persisted 20 placements to the database and handed the client an empty
   * map (2026-08-18).
   *
   * Reading by the ids we were ASKED to place, rather than by what the INSERT returned,
   * is also what makes the conflict path correct: a row some concurrent request placed
   * a millisecond ago still belongs in this response, with its real coordinates.
   */
  private async hydratePlacements(
    userId: string,
    language: string,
    vocabEntryIds: number[]
  ): Promise<MemoryMapPlacedRow[]> {
    const table = this.placementsTableFor(language);
    const vet = vetTableForLanguage(language);

    const result = await this.dbManager.executeQuery<MemoryMapPlacedRow>(async (client) =>
      client.query(
        `
        SELECT ${MemoryMapDAL.PLACED_COLUMNS}
        FROM ${table} p
        JOIN ${vet} ve ON ve.id = p."vocabEntryId"
        ${DICT_JOIN}
        WHERE p."userId" = $1
          AND p.language = $2
          AND p."vocabEntryId" = ANY($3::int[])
        ORDER BY p."createdAt" ASC, p.id ASC
        `,
        [userId, language, vocabEntryIds]
      )
    );
    return result.recordset;
  }

  async deletePlacement(
    userId: string,
    language: string,
    vocabEntryId: number
  ): Promise<boolean> {
    if (!userId) throw new ValidationError('userId is required');

    const table = this.placementsTableFor(language);
    const result = await this.dbManager.executeQuery(async (client) =>
      client.query(
        `DELETE FROM ${table} WHERE "userId" = $1 AND "vocabEntryId" = $2`,
        [userId, vocabEntryId]
      )
    );
    return result.rowsAffected > 0;
  }

  async isReadingMastered(
    userId: string,
    language: string,
    vocabEntryId: number
  ): Promise<boolean> {
    if (!userId) throw new ValidationError('userId is required');

    const result = await this.dbManager.executeQuery<{ mastered: boolean }>(async (client) =>
      client.query(
        `
        SELECT ${masteredBarClause('reading')} AS mastered
        FROM ${vetTableForLanguage(language)} ve
        WHERE ve.id = $1 AND ve."userId" = $2 AND ve.language = $3
        `,
        [vocabEntryId, userId, language]
      )
    );
    // No row = the card was deleted mid-run. Not mastered, and the caller's delete is
    // a no-op anyway because the FK cascade already removed the placement.
    return result.recordset[0]?.mastered === true;
  }
}
