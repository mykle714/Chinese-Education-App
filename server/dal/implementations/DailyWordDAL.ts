import { IDailyWordDAL, DailyWordRow } from '../interfaces/IDailyWordDAL.js';
import { dbManager as defaultDbManager, DatabaseManager } from '../base/DatabaseManager.js';
import type { WordOfTheDayContent } from '../../contracts/wordOfTheDay.js';
import { ValidationError } from '../../types/dal.js';

/**
 * Persists the global Word of the Day (`daily_words`, migration 169).
 *
 * Chinese-only by construction: the table's FK is to `dictionaryentries_zh`, so the
 * join below names that table directly rather than going through dictTableForLanguage.
 *
 * Docs: docs/READING_WRITING_CENTERS.md § Phase 3.
 */
export class DailyWordDAL implements IDailyWordDAL {
  /** Injected so a test can substitute a manager; defaults to the process singleton. */
  constructor(protected readonly dbManager: DatabaseManager = defaultDbManager) {}

  private requireDay(day: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new ValidationError('day must be YYYY-MM-DD');
  }

  async findByDay(day: string): Promise<DailyWordRow | null> {
    this.requireDay(day);
    const result = await this.dbManager.executeQuery<DailyWordRow>((c) =>
      c.query(
        `SELECT to_char(dw.day, 'YYYY-MM-DD') AS day, dw."detId", dw.content,
                de.word1, de.pronunciation, de.definitions->>0 AS definition,
                de."definitionClusters", de.components
           FROM daily_words dw
           JOIN dictionaryentries_zh de ON de.id = dw."detId"
          WHERE dw.day = $1::date`,
        [day]
      )
    );
    return result.recordset[0] ?? null;
  }

  async pickCandidateDetId(excludeRecentDays: number): Promise<number | null> {
    const result = await this.dbManager.executeQuery<{ id: number }>((c) =>
      c.query(
        // ORDER BY random() over a few hundred rows (discoverable single characters)
        // once a day is cheap; no TABLESAMPLE needed.
        `SELECT de.id
           FROM dictionaryentries_zh de
          WHERE de.discoverable = TRUE
            AND de.language = 'zh'
            AND char_length(de.word1) = 1
            AND NOT EXISTS (
              SELECT 1 FROM daily_words dw
               WHERE dw."detId" = de.id
                 AND dw.day > CURRENT_DATE - $1::int
            )
          ORDER BY random()
          LIMIT 1`,
        [excludeRecentDays]
      )
    );
    return result.recordset[0]?.id ?? null;
  }

  async pinDay(day: string, detId: number): Promise<void> {
    this.requireDay(day);
    await this.dbManager.executeQuery((c) =>
      c.query(
        `INSERT INTO daily_words (day, "detId") VALUES ($1::date, $2)
         ON CONFLICT (day) DO NOTHING`,
        [day, detId]
      )
    );
  }

  async fillContent(day: string, content: WordOfTheDayContent): Promise<void> {
    this.requireDay(day);
    await this.dbManager.executeQuery((c) =>
      c.query(
        `UPDATE daily_words SET content = $2::jsonb WHERE day = $1::date AND content IS NULL`,
        [day, JSON.stringify(content)]
      )
    );
  }
}
