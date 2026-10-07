import {
  IMemoryMapDAL,
  MemoryMapCandidateRow,
  MemoryMapSlotRow,
  NewSlot,
} from '../interfaces/IMemoryMapDAL.js';
import { dbManager as defaultDbManager, DatabaseManager } from '../base/DatabaseManager.js';
import { ValidationError } from '../../types/dal.js';
import {
  vetTableForLanguage,
  vetSortedClause,
  vetProvisionalClause,
  masteredBarClause,
  typeCategoryExpr,
} from '../shared/vetTable.js';
import { DICT_JOIN } from '../shared/dictJoin.js';

/**
 * Data access for Memory Map (docs/MEMORY_MAP_GAME.md § 8, § 9).
 *
 * LAYER: DAL. All of the feature's SQL and none of its rules. Where a slot hangs is
 * services/memoryMapSpawn.ts; where it is drawn is services/memoryMapLayout.ts; which
 * words are worth placing is MemoryMapService.
 *
 * ── THE TABLE NAME IS DERIVED, NEVER INTERPOLATED FROM INPUT ─────────────────
 * `slotsTableFor` is a two-value whitelist over the language code, the same pattern as
 * `vetTableForLanguage`. Nothing caller-controlled reaches the SQL string; every user
 * value is bound.
 */
export class MemoryMapDAL implements IMemoryMapDAL {
  constructor(protected readonly dbManager: DatabaseManager = defaultDbManager) {}

  /**
   * The slots table for a language. Mirrors `vetTableForLanguage` exactly, including its
   * "anything that isn't Spanish is Chinese" fallback, so a slot table and its vet table
   * can never disagree about which language a row belongs to.
   */
  private slotsTableFor(language: string | null | undefined): string {
    return language === 'es' ? 'memory_map_slots_es' : 'memory_map_slots_zh';
  }

  async getSlots(userId: string, language: string): Promise<MemoryMapSlotRow[]> {
    if (!userId) throw new ValidationError('userId is required');

    const table = this.slotsTableFor(language);
    const vet = vetTableForLanguage(language);

    const result = await this.dbManager.executeQuery<MemoryMapSlotRow>(async (client) =>
      client.query(
        `
        SELECT s.id               AS "slotId",
               s."parentId"       AS "parentSlotId",
               s.link,
               s.angle,
               s.tilt,
               s.bow,
               s.scale,
               s."vocabEntryId",
               s.language,
               ve."entryKey",
               ve."selectedSense",
               -- Resolved in the SERVICE (resolveDisplayDefinition needs the clusters AND
               -- the learner's sense pick together), so both travel out unresolved.
               de.definition,
               de."definitionClusters",
               de.pronunciation
        FROM ${table} s
        -- LEFT: an EMPTY slot (vocabEntryId NULL) is still part of the tree — its
        -- children are positioned off it — so it must come back too.
        LEFT JOIN ${vet} ve ON ve.id = s."vocabEntryId"
        ${DICT_JOIN}
        WHERE s."userId" = $1 AND s.language = $2
        -- LOAD-BEARING ORDER: the layout lays slots in ascending id, and a parent
        -- always has a smaller id than its children (memoryMapLayout.ts → layoutMap).
        ORDER BY s.id ASC
        `,
        [userId, language]
      )
    );
    return result.recordset;
  }

  async getUnplacedCandidates(
    userId: string,
    language: string,
    lentIds: number[] = []
  ): Promise<MemoryMapCandidateRow[]> {
    if (!userId) throw new ValidationError('userId is required');

    const table = this.slotsTableFor(language);

    const result = await this.dbManager.executeQuery<MemoryMapCandidateRow>(async (client) =>
      client.query(
        `
        SELECT ve.id                                   AS "vocabEntryId",
               ve."entryKey",
               ve.language,
               ve."typedMarkHistory",
               ${vetProvisionalClause()}               AS "isLent",
               -- Unresolved dd inputs for the "two words never read the same" guard
               -- (MemoryMapService.selectOccupants).
               ve."selectedSense",
               de.definition,
               de."definitionClusters",
               ${typeCategoryExpr(`'reading'`)}        AS "readingCategory"
        FROM ${vetTableForLanguage(language)} ve
        ${DICT_JOIN}
        WHERE ve."userId" = $1
          AND ve.language = $2
          -- The learner's own SORTED cards, plus exactly the provisional rows this
          -- request lent for the map. Not vetPlayableClause(): that would pull in every
          -- outstanding lent row, which out-competes the learner's own deck
          -- (docs/PROVISIONAL_CARDS.md § 4b). Since 2026-10-06 the map DOES lend — to
          -- stay full at MEMORY_MAP_CAPACITY — but only by name.
          AND (${vetSortedClause()} OR ve.id = ANY($3::int[]))
          -- The reading track decides membership, NOT core mastery (§ 2.1).
          AND NOT ${masteredBarClause('reading')}
          AND NOT EXISTS (
            SELECT 1 FROM ${table} s
            WHERE s."userId" = ve."userId" AND s."vocabEntryId" = ve.id
          )
        -- Stable tiebreak only; the real ordering is rankCardQueue in app code.
        ORDER BY ve."createdAt" DESC
        `,
        [userId, language, lentIds]
      )
    );
    return result.recordset;
  }

  async writeSpawn(
    userId: string,
    language: string,
    expectedSlotCount: number,
    fills: { slotId: number; vocabEntryId: number }[],
    inserts: NewSlot[]
  ): Promise<boolean> {
    if (!userId) throw new ValidationError('userId is required');
    if (fills.length === 0 && inserts.length === 0) return true;

    const table = this.slotsTableFor(language);

    return this.dbManager.executeInTransaction(async (transaction) => {
      const client = transaction.getClient();

      // Serialise spawns for this (user, map). Released automatically on commit or
      // rollback. Keyed on the table too so a learner's zh and es maps don't contend.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', [
        `${table}:${userId}`,
      ]);

      // The plan was computed against `expectedSlotCount` slots. If a concurrent load
      // got here first, the tree has changed under the plan: write nothing.
      const { rows } = await client.query(
        `SELECT COUNT(*) AS count FROM ${table} WHERE "userId" = $1 AND language = $2`,
        [userId, language]
      );
      if (Number(rows[0]?.count ?? 0) !== expectedSlotCount) return false;

      // Fill empty slots first. `vocabEntryId IS NULL` makes a fill never evict an
      // occupant. A fill can still collide with the UNIQUE (userId, vocabEntryId) if the
      // card was placed between the candidate read and here — impossible under the lock
      // for map writes, but a hard error there is the right outcome anyway.
      for (const fill of fills) {
        await client.query(
          `UPDATE ${table} SET "vocabEntryId" = $3
           WHERE id = $1 AND "userId" = $2 AND "vocabEntryId" IS NULL`,
          [fill.slotId, userId, fill.vocabEntryId]
        );
      }

      // One INSERT per slot, in plan order: ids then ascend in the order the layout
      // assumed, and a child planned onto a slot planned earlier in this same batch can
      // look up its parent's real id. ≤ MEMORY_MAP_CAPACITY round trips, once per map.
      const realIdByTempId = new Map<number, number>();
      for (const slot of inserts) {
        const parentId =
          slot.parentSlotId === null ? null : realIdByTempId.get(slot.parentSlotId) ?? slot.parentSlotId;
        const inserted = await client.query(
          `INSERT INTO ${table} ("userId", "vocabEntryId", language, "parentId", link, angle, tilt, bow, scale)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id`,
          [userId, slot.vocabEntryId, language, parentId, slot.link, slot.angle, slot.tilt, slot.bow, slot.scale]
        );
        realIdByTempId.set(slot.tempId, inserted.rows[0].id);
      }
      return true;
    });
  }

  async replaceOccupant(
    userId: string,
    language: string,
    fromVocabEntryId: number,
    toVocabEntryId: number | null
  ): Promise<number | null> {
    if (!userId) throw new ValidationError('userId is required');

    const table = this.slotsTableFor(language);
    const result = await this.dbManager.executeQuery<{ id: number }>(async (client) =>
      client.query(
        `UPDATE ${table} SET "vocabEntryId" = $3
         WHERE "userId" = $1 AND "vocabEntryId" = $2
         RETURNING id`,
        [userId, fromVocabEntryId, toVocabEntryId]
      )
    );
    return result.recordset[0]?.id ?? null;
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
    // No row = the card was deleted mid-run. Not mastered; its slot was already emptied
    // by the FK's ON DELETE SET NULL and the next load refills it.
    return result.recordset[0]?.mastered === true;
  }
}
