import { ISortPacksDAL } from '../interfaces/ISortPacksDAL.js';
import { dbManager as defaultDbManager, DatabaseManager } from '../base/DatabaseManager.js';
import { SortPackRow } from '../../types/sortPacks.js';
import { ValidationError } from '../../types/dal.js';
import { dictTableForLanguage } from '../shared/dictTable.js';

/**
 * Reads authored discover sort packs from `sort_packs` (migration 93).
 *
 * Pure pack selection only — no per-user state. The StarterPacksService layers on the
 * user's seen/vet/skip state, hydrates each pack's cards from the per-language det
 * table, and builds fallback packs-of-1. See docs/SORT_PACKS_IMPLEMENTATION.md §3.
 *
 * A pack's level is DERIVED, not stored: MAX(det.difficulty) over its entryIds
 * (migration 177; docs/SORT_PACKS_IMPLEMENTATION.md § 2).
 */
export class SortPacksDAL implements ISortPacksDAL {

  /**
   * The connection manager, injected so the DAL can be substituted in a test.
   * Defaults to the process-wide singleton, so `new SortPacksDAL()` at the composition
   * root (dal/setup.ts) keeps working unchanged.
   * See docs/CORRECTNESS_AND_PERFORMANCE_REVIEW.md finding 2.
   */
  constructor(protected readonly dbManager: DatabaseManager = defaultDbManager) {}

  /**
   * Pack rows for `language` ($1) with their DERIVED `level` = the difficulty of the
   * pack's hardest card. MAX ignores NULL difficulties, so a card that has not been
   * levelled yet does not hold the pack back; a pack whose cards are ALL unlevelled
   * gets level NULL and is never served (scripts/validate-sort-packs.ts flags both).
   * The det table is chosen by language (whitelisted — safe to splice into SQL).
   */
  private _packsWithLevelSql(language: string): string {
    const det = dictTableForLanguage(language);
    return `
      SELECT p.id, p.language, p."packOrder", p."entryIds", p."entryWords",
             (SELECT MAX(d.difficulty) FROM ${det} d WHERE d.id = ANY(p."entryIds"))::int AS level
      FROM sort_packs p
      WHERE p.language = $1`;
  }

  /** Map a DB row (quoted camelCase columns) to the SortPackRow shape. */
  private _mapRow(row: any): SortPackRow {
    return {
      id: row.id,
      language: row.language,
      level: row.level,
      packOrder: row.packOrder,
      entryIds: row.entryIds ?? [],
      entryWords: row.entryWords ?? [],
    };
  }

  async fetchPacksAtLevel(
    language: string,
    level: number,
    excludePackIds: number[],
    limit: number
  ): Promise<SortPackRow[]> {
    if (!language) throw new ValidationError('language is required');
    if (limit <= 0) return [];

    const result = await this.dbManager.executeQuery<any>(async (client) => {
      // $1 language, $2 EXACT derived level, $3 excludePackIds, $4 limit. excludePackIds
      // passed as an int[] and excluded with != ALL so an empty array is a no-op. The
      // service calls this once per level (nearest-first) so level is honored strictly.
      // The level is derived per call (a correlated MAX over ≤4 ids per pack) — the
      // table holds tens of packs, so this costs nothing and can never go stale.
      return await client.query(`
        SELECT * FROM (${this._packsWithLevelSql(language)}) packs
        WHERE level = $2
          AND id != ALL($3::int[])
        ORDER BY "packOrder" ASC, id ASC
        LIMIT $4
      `, [language, level, excludePackIds, limit]);
    });

    return result.recordset.map((r) => this._mapRow(r));
  }
}
