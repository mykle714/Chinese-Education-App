import type {
  FocusCardRow,
  FocusSnapshot,
  FocusState,
  IFocusModeDAL,
} from '../interfaces/IFocusModeDAL.js';
import type { MasteryWorldId, TypedMarkHistory } from '../../contracts/wire.js';
import { dbManager as defaultDbManager, DatabaseManager } from '../base/DatabaseManager.js';
import { ValidationError } from '../../types/dal.js';
import {
  vetReadFrom,
  vetSortedClause,
  WRITING_FLP_WORD_CLAUSE,
  WRITING_MASTERY_SELECT,
} from '../shared/vetTable.js';
import { DICT_JOIN } from '../shared/dictJoin.js';

/**
 * Data access for focus mode (docs/FOCUS_MODE.md § 2). LAYER: DAL.
 *
 * Tables: user_languages."focusWorlds" / ."focusEndedNotices" and focus_daily_snapshots
 * (migration 176). Every value is bound; the only interpolated SQL is the vet table
 * name, which `vetReadFrom` whitelists.
 */
export class FocusModeDAL implements IFocusModeDAL {
  constructor(protected readonly dbManager: DatabaseManager = defaultDbManager) {}

  async getState(userId: string, language: string): Promise<FocusState> {
    if (!userId) throw new ValidationError('userId is required');
    // LEFT JOIN from users: a learner who has never earned a minute in this language
    // has no user_languages row yet, which simply means focus is off everywhere.
    const result = await this.dbManager.executeQuery<{
      timezone: string | null;
      focusWorlds: MasteryWorldId[] | null;
      focusEndedNotices: MasteryWorldId[] | null;
    }>((client) => client.query(
      `SELECT u.timezone, ul."focusWorlds", ul."focusEndedNotices"
         FROM users u
         LEFT JOIN user_languages ul ON ul."userId" = u.id AND ul.language = $2
        WHERE u.id = $1`,
      [userId, language]
    ));
    const row = result.recordset[0];
    return {
      timezone: row?.timezone || 'UTC',
      focusWorlds: row?.focusWorlds ?? [],
      focusEndedNotices: row?.focusEndedNotices ?? [],
    };
  }

  async setWorldOn(userId: string, language: string, world: MasteryWorldId, on: boolean): Promise<void> {
    if (!userId) throw new ValidationError('userId is required');
    // Upsert: turning focus on must work for a learner with no user_languages row yet.
    // array_remove + append keeps the array duplicate-free whichever way it is flipped.
    await this.dbManager.executeQuery((client) => client.query(
      `INSERT INTO user_languages ("userId", language, "focusWorlds")
       VALUES ($1, $2, CASE WHEN $4 THEN ARRAY[$3]::text[] ELSE '{}'::text[] END)
       ON CONFLICT ("userId", language) DO UPDATE
         SET "focusWorlds" = CASE
               WHEN $4 THEN array_append(array_remove(user_languages."focusWorlds", $3), $3)
               ELSE array_remove(user_languages."focusWorlds", $3)
             END`,
      [userId, language, world, on]
    ));
  }

  async endWithNotice(userId: string, language: string, world: MasteryWorldId): Promise<void> {
    if (!userId) throw new ValidationError('userId is required');
    // UPDATE, not upsert: focus can only have been on if the row exists.
    await this.dbManager.executeQuery((client) => client.query(
      `UPDATE user_languages
          SET "focusWorlds"       = array_remove("focusWorlds", $3),
              "focusEndedNotices" = array_append(array_remove("focusEndedNotices", $3), $3)
        WHERE "userId" = $1 AND language = $2`,
      [userId, language, world]
    ));
  }

  async clearNotices(userId: string, language: string, worlds: MasteryWorldId[]): Promise<void> {
    if (!userId) throw new ValidationError('userId is required');
    if (worlds.length === 0) return;
    await this.dbManager.executeQuery((client) => client.query(
      `UPDATE user_languages
          SET "focusEndedNotices" = ARRAY(
                SELECT w FROM unnest("focusEndedNotices") AS w WHERE NOT (w = ANY($3::text[]))
              )
        WHERE "userId" = $1 AND language = $2`,
      [userId, language, worlds]
    ));
  }

  async getSnapshot(userId: string, language: string, world: MasteryWorldId): Promise<FocusSnapshot | null> {
    if (!userId) throw new ValidationError('userId is required');
    const result = await this.dbManager.executeQuery<FocusSnapshot>((client) => client.query(
      `SELECT to_char("streakDate", 'YYYY-MM-DD') AS "streakDate", "vetIds"
         FROM focus_daily_snapshots
        WHERE "userId" = $1 AND language = $2 AND world = $3`,
      [userId, language, world]
    ));
    return result.recordset[0] ?? null;
  }

  async claimSnapshot(
    userId: string,
    language: string,
    world: MasteryWorldId,
    streakDate: string,
    vetIds: number[]
  ): Promise<FocusSnapshot> {
    if (!userId) throw new ValidationError('userId is required');
    // The conditional DO UPDATE is the whole race guard: an older day's row is replaced,
    // but a row already holding THIS day is left alone and RETURNING yields nothing — in
    // which case the stored set is read back and wins.
    const claimed = await this.dbManager.executeQuery<FocusSnapshot>((client) => client.query(
      `INSERT INTO focus_daily_snapshots ("userId", language, world, "streakDate", "vetIds")
       VALUES ($1, $2, $3, $4::date, $5::int[])
       ON CONFLICT ("userId", language, world) DO UPDATE
         SET "streakDate" = EXCLUDED."streakDate",
             "vetIds"     = EXCLUDED."vetIds",
             "takenAt"    = now()
         WHERE focus_daily_snapshots."streakDate" <> EXCLUDED."streakDate"
       RETURNING to_char("streakDate", 'YYYY-MM-DD') AS "streakDate", "vetIds"`,
      [userId, language, world, streakDate, vetIds]
    ));
    if (claimed.recordset[0]) return claimed.recordset[0];
    const stored = await this.getSnapshot(userId, language, world);
    return stored ?? { streakDate, vetIds };
  }

  async listWorldCards(userId: string, language: string, world: MasteryWorldId): Promise<FocusCardRow[]> {
    if (!userId) throw new ValidationError('userId is required');
    // Same population as OnDeckVocabService.getFlpReadyCounts (the tower's own figure),
    // ordered by id so ties in the queue ranking are deterministic. DICT_JOIN supplies
    // the stale tier's ease keys (cardQueueRanking.rankCardQueue). Sorted-only, so no
    // row here is lent and starterPackBucket is not needed.
    const result = await this.dbManager.executeQuery<CardRowSource>((client) => client.query(
      `SELECT ve.id, ve."typedMarkHistory", ${WRITING_MASTERY_SELECT},
              de."difficulty", de."maxCharStrokeCount"
         FROM ${vetReadFrom(language)} ${DICT_JOIN}
        WHERE ve."userId" = $1
          AND ve."language" = $2
          ${world === 'writing' ? WRITING_FLP_WORD_CLAUSE : ''}
          AND ${vetSortedClause()}
        ORDER BY ve.id`,
      [userId, language]
    ));
    return result.recordset.map(toCardRow);
  }

  async listCardsByIds(userId: string, language: string, ids: number[]): Promise<FocusCardRow[]> {
    if (!userId) throw new ValidationError('userId is required');
    if (ids.length === 0) return [];
    const result = await this.dbManager.executeQuery<CardRowSource>((client) => client.query(
      `SELECT ve.id, ve."typedMarkHistory", ${WRITING_MASTERY_SELECT}
         FROM ${vetReadFrom(language)}
        WHERE ve."userId" = $1
          AND ve."language" = $2
          AND ve.id = ANY($3::int[])
          AND ${vetSortedClause()}`,
      [userId, language, ids]
    ));
    return result.recordset.map(toCardRow);
  }
}

/** The raw row both card reads return; the ease keys are only selected by listWorldCards. */
interface CardRowSource {
  id: number;
  typedMarkHistory: TypedMarkHistory | null;
  writingMastery: number | null;
  difficulty?: number | null;
  maxCharStrokeCount?: number | null;
}

function toCardRow(row: CardRowSource): FocusCardRow {
  return {
    id: row.id,
    typedMarkHistory: row.typedMarkHistory ?? undefined,
    writingMastery: row.writingMastery,
    difficulty: row.difficulty,
    maxCharStrokeCount: row.maxCharStrokeCount,
  };
}
