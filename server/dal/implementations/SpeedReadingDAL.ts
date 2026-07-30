import { ISpeedReadingDAL } from '../interfaces/ISpeedReadingDAL.js';
import { dbManager as defaultDbManager, DatabaseManager } from '../base/DatabaseManager.js';
import { DistractorChar } from '../../contracts/wire.js';
import { ValidationError } from '../../types/dal.js';

/**
 * Data access for the Speed Reading game. See docs/SPEED_READING_GAME.md.
 *
 * LAYER: DAL. The game owns no tables — it reads the player's existing library
 * (`vocabentries_zh`) and the det table — so all of its SQL is this one query.
 * SpeedReadingService holds the policy.
 */
export class SpeedReadingDAL implements ISpeedReadingDAL {

  /**
   * The connection manager, injected so the DAL can be substituted in a test.
   * Defaults to the process-wide singleton, so `new SpeedReadingDAL()` at the
   * composition root (dal/setup.ts) keeps working unchanged.
   * See docs/CORRECTNESS_AND_PERFORMANCE_REVIEW.md finding 2.
   */
  constructor(protected readonly dbManager: DatabaseManager = defaultDbManager) {}

  async getLibraryDistractors(
    userId: string,
    language: string
  ): Promise<{ chars: DistractorChar[]; masteredReadingExcluded: number }> {
    if (!userId) throw new ValidationError('userId is required');
    // The vet tables are per-language and the name is derived from a validated
    // language (never raw input) — same pattern as ValidationService.
    if (language !== 'zh') {
      // Speed Reading is zh-only: the round is built by substituting ONE
      // character of the headword, which presupposes a character-based script.
      // A non-zh caller is a bug upstream, but an empty pool degrades to "skip
      // the card" rather than throwing mid-game.
      return { chars: [], masteredReadingExcluded: 0 };
    }

    const result = await this.dbManager.executeQuery<{
      char: string;
      difficultyBand: number | null;
      readingMastered: boolean;
    }>(async (client) => {
      return await client.query(
        `
        WITH library AS (
          SELECT v."entryKey",
                 compute_type_category(v."typedMarkHistory", 'reading') = 'Mastered'
                     AS "readingMastered"
          FROM vocabentries_zh v
          WHERE v."userId" = $1
            AND v.language = 'zh'
            AND v."starterPackBucket" = 'library'
        ),
        -- Explode each library word into its constituent characters. A 2-char
        -- word contributes both characters independently — the game replaces ONE
        -- character position, so single characters are the unit of interest.
        chars AS (
          SELECT ch AS char, l."readingMastered"
          FROM library l,
               LATERAL regexp_split_to_table(l."entryKey", '') AS ch
          WHERE ch ~ '[\\u4e00-\\u9fff]'   -- CJK only: drop punctuation/latin
        )
        SELECT c.char,
               -- Difficulty band (1..6, = HSK level for zh) of the SINGLE-CHARACTER
               -- dictionary entry for this character — the character's own intrinsic
               -- difficulty. The column is "difficulty", NOT "hskLevel": migration
               -- 79/92 renamed it when the band was generalized across languages.
               -- (No backticks in this comment — it lives in a JS template literal.)
               -- NULL when the character has no standalone det row (it only ever
               -- appears inside multi-char words); the client's ladder treats NULL
               -- as "no band preference possible".
               MAX(d.difficulty) AS "difficultyBand",
               -- A character is only reading-mastered if EVERY library word
               -- containing it is: seeing it inside a still-weak word means the
               -- player has not actually retired it.
               bool_and(c."readingMastered") AS "readingMastered"
        FROM chars c
        LEFT JOIN dictionaryentries_zh d
               ON d.word1 = c.char AND d.language = 'zh'
        GROUP BY c.char
        `,
        [userId]
      );
    });

    const chars: DistractorChar[] = [];
    let masteredReadingExcluded = 0;
    for (const row of result.recordset) {
      // Reading-mastered characters are FLAGGED, not dropped: they are the last
      // rung of the client's fallback ladder, and only the client — which knows
      // the prompt word — can tell whether the earlier rungs produced anything.
      if (row.readingMastered) masteredReadingExcluded += 1;
      chars.push({
        char: row.char,
        difficultyBand: row.difficultyBand === null ? null : Number(row.difficultyBand),
        readingMastered: row.readingMastered === true,
      });
    }
    return { chars, masteredReadingExcluded };
  }
}
