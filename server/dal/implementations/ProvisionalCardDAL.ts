import { IProvisionalCardDAL, ProvisionalCandidate } from '../interfaces/IProvisionalCardDAL.js';
import { dbManager as defaultDbManager, DatabaseManager } from '../base/DatabaseManager.js';
import { ValidationError } from '../../types/dal.js';
import { dictTableForLanguage } from '../shared/dictTable.js';
import { vetTableForLanguage, vetPlayableClause, vetProvisionalClause } from '../shared/vetTable.js';

/**
 * Data access for provisional cards — see IProvisionalCardDAL and
 * docs/PROVISIONAL_CARDS.md for the concept.
 *
 * LAYER: DAL. All SQL for the baseline top-up lives here; ProvisionalCardService
 * decides how many rows to ask for.
 *
 * Both table names are resolved from a language via the shared whitelist helpers
 * (`dictTableForLanguage` / `vetTableForLanguage`), which only ever return one of two
 * hard-coded names, so they are safe to splice into SQL. Everything else is bound.
 */
export class ProvisionalCardDAL implements IProvisionalCardDAL {
  constructor(protected readonly dbManager: DatabaseManager = defaultDbManager) {}

  /**
   * Supply-visibility gate, mirroring StarterPacksService._supplyGate: zh lends words
   * that are `sortable` (migration 110, so lazily-enriched words are reachable),
   * every other language falls back to `discoverable`. Keeping the two in step matters
   * — a word we lend must also be a word discover will later offer for sorting, or the
   * end-of-round "sort these cards" hand-off would show an empty flow.
   */
  private _supplyGate(language: string, alias = 'de.'): string {
    const col = language === 'zh' ? 'sortable' : 'discoverable';
    return `${alias}${col} = TRUE`;
  }

  async countPlayable(userId: string, language: string): Promise<number> {
    if (!userId) throw new ValidationError('userId is required');
    if (!language) throw new ValidationError('language is required');

    const result = await this.dbManager.executeQuery<{ count: string }>(async (client) => {
      return await client.query(
        `
        SELECT COUNT(*) AS count
        FROM ${vetTableForLanguage(language)} ve
        WHERE ve."userId" = $1 AND ve.language = $2 AND ${vetPlayableClause()}
        `,
        [userId, language]
      );
    });

    return parseInt(result.recordset[0].count, 10);
  }

  async findCandidates(
    userId: string,
    language: string,
    level: number,
    limit: number,
    opts: { excludeWords?: string[]; includeSkipped?: boolean } = {}
  ): Promise<ProvisionalCandidate[]> {
    if (!userId) throw new ValidationError('userId is required');
    if (!language) throw new ValidationError('language is required');
    if (limit <= 0) return [];

    const det = dictTableForLanguage(language);
    const vet = vetTableForLanguage(language);
    const excludeWords = opts.excludeWords ?? [];

    // $1 language, $2 userId, $3 level, $4 excludeWords, $5 limit.
    const params: unknown[] = [language, userId, level, excludeWords, limit];

    // A word the user deliberately skipped in discover is a word they said they did
    // not want. Lending it back would be tone-deaf, so the normal pass excludes skips
    // entirely; the caller only sets includeSkipped once fresh supply is exhausted,
    // at which point a skipped word beats not being able to play.
    const skipFilter = opts.includeSkipped
      ? ''
      : `AND NOT EXISTS (
            SELECT 1 FROM discover_skips ds
            WHERE ds."userId" = $2 AND ds.language = de.language AND ds."cardId" = de.id
          )`;

    const result = await this.dbManager.executeQuery<ProvisionalCandidate>(async (client) => {
      return await client.query(
        `
        SELECT de.id, de.word1, de."difficulty", de."frequencyScore"
        FROM ${det} de
        WHERE de.language = $1
          AND ${this._supplyGate(language)}
          AND de."difficulty" BETWEEN 1 AND 6
          -- Never lend a word the user already holds, in EITHER bucket: 'library'
          -- means it is already in their deck, 'provisional' means it is already lent.
          AND NOT EXISTS (
            SELECT 1 FROM ${vet} ve
            WHERE ve."userId" = $2 AND ve."entryKey" = de.word1 AND ve.language = de.language
          )
          AND de.word1 <> ALL($4::text[])
          ${skipFilter}
        -- Nearest level first, then most common, then a stable id tiebreak.
        ORDER BY ABS(de."difficulty" - $3) ASC,
                 de."frequencyScore" DESC NULLS LAST,
                 de.id ASC
        LIMIT $5
        `,
        params
      );
    });

    return result.recordset;
  }

  async insertProvisional(userId: string, entryKeys: string[], language: string): Promise<number[]> {
    if (!userId) throw new ValidationError('userId is required');
    if (!language) throw new ValidationError('language is required');
    if (!entryKeys || entryKeys.length === 0) return [];

    const vet = vetTableForLanguage(language);

    // One multi-row INSERT from an unnested array, so the batch is a single round
    // trip. ON CONFLICT DO NOTHING makes it safe against the race where two game
    // entries provision the same word concurrently — the loser simply inserts fewer
    // rows, and the caller re-counts rather than assuming its batch size landed.
    const result = await this.dbManager.executeQuery<{ id: number }>(async (client) => {
      return await client.query(
        `
        INSERT INTO ${vet} ("userId", "entryKey", language, "starterPackBucket")
        SELECT $1, key, $3, 'provisional'
        FROM unnest($2::text[]) AS key
        ON CONFLICT ("userId", "entryKey", language) DO NOTHING
        RETURNING id
        `,
        [userId, entryKeys, language]
      );
    });

    return result.recordset.map((row) => row.id);
  }

  async listProvisionalKeys(userId: string, language: string): Promise<string[]> {
    if (!userId) throw new ValidationError('userId is required');
    if (!language) throw new ValidationError('language is required');

    const result = await this.dbManager.executeQuery<{ entryKey: string }>(async (client) => {
      return await client.query(
        `
        SELECT ve."entryKey"
        FROM ${vetTableForLanguage(language)} ve
        WHERE ve."userId" = $1 AND ve.language = $2 AND ${vetProvisionalClause()}
        ORDER BY ve."createdAt" ASC, ve.id ASC
        `,
        [userId, language]
      );
    });

    return result.recordset.map((row) => row.entryKey);
  }
}
