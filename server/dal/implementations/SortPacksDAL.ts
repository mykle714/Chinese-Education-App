import { ISortPacksDAL } from '../interfaces/ISortPacksDAL.js';
import { dbManager } from '../base/DatabaseManager.js';
import { SortPackRow } from '../../types/sortPacks.js';
import { ValidationError } from '../../types/dal.js';

/**
 * Reads authored discover sort packs from `sort_packs` (migration 93).
 *
 * Pure pack selection only — no per-user state. The StarterPacksService layers on the
 * user's seen/vet/skip state, hydrates each pack's cards from the per-language det
 * table, and builds fallback packs-of-1. See docs/SORT_PACKS_IMPLEMENTATION.md §3.
 */
export class SortPacksDAL implements ISortPacksDAL {
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

    const result = await dbManager.executeQuery<any>(async (client) => {
      // $1 language, $2 EXACT level, $3 excludePackIds, $4 limit. excludePackIds passed
      // as an int[] and excluded with != ALL so an empty array is a no-op. The service
      // calls this once per level (nearest-first) so level is honored strictly.
      return await client.query(`
        SELECT id, language, level, "packOrder", "entryIds", "entryWords"
        FROM sort_packs
        WHERE language = $1
          AND level = $2
          AND id != ALL($3::int[])
        ORDER BY "packOrder" ASC, id ASC
        LIMIT $4
      `, [language, level, excludePackIds, limit]);
    });

    return result.recordset.map((r) => this._mapRow(r));
  }

  async listByLanguage(language: string): Promise<SortPackRow[]> {
    if (!language) throw new ValidationError('language is required');

    const result = await dbManager.executeQuery<any>(async (client) => {
      return await client.query(`
        SELECT id, language, level, "packOrder", "entryIds", "entryWords"
        FROM sort_packs
        WHERE language = $1
        ORDER BY level ASC, "packOrder" ASC, id ASC
      `, [language]);
    });

    return result.recordset.map((r) => this._mapRow(r));
  }
}
