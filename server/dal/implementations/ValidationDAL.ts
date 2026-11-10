import type { IValidationDAL, DetFieldRow, ValidationVoteKey } from '../interfaces/IValidationDAL.js';
import { dbManager as defaultDbManager, DatabaseManager } from '../base/DatabaseManager.js';
import { ValidationError } from '../../types/dal.js';
import type { Language, ValidationRecord } from '../../types/index.js';
import { discoverSupplyGate } from '../shared/dictTable.js';

// The two det tables carry the same relevant columns. Unlike `dictTableForLanguage`
// (which falls back to zh), an unsupported language is REJECTED here: a vote recorded
// against the wrong table's id would attach to an unrelated word.
const TABLE_BY_LANGUAGE: Record<Language, string> = {
  zh: 'dictionaryentries_zh',
  es: 'dictionaryentries_es',
};

// The columns every det-row read for validation needs (DetFieldRow).
const DET_FIELD_COLUMNS =
  `id, word1, pronunciation, "partsOfSpeech", definitions, "longDefinition", ` +
  `"exampleSentences", difficulty, "frequencyScore", "definitionClusters"`;

// The WHERE clause shared by the vote reads/writes — one validator's row for one field.
const VOTE_WHERE =
  `"entryId" = $1 AND language = $2 AND field = $3 AND "senseLabel" = $4 AND "validatorUserId" = $5`;

/**
 * Data access for data validation — see IValidationDAL.
 *
 * LAYER: DAL. Moved here verbatim from `ValidationService` (2026-11-09).
 */
export class ValidationDAL implements IValidationDAL {
  constructor(protected readonly dbManager: DatabaseManager = defaultDbManager) {}

  private async rows<T>(sql: string, params: unknown[]): Promise<T[]> {
    const result = await this.dbManager.executeQuery<T>((client) => client.query(sql, params));
    return result.recordset;
  }

  private keyParams(key: ValidationVoteKey): unknown[] {
    return [key.entryId, key.language, key.field, key.senseLabel, key.validatorUserId];
  }

  async findDiscoverableFieldRow(language: Language, word1: string): Promise<DetFieldRow | null> {
    const table = TABLE_BY_LANGUAGE[language];
    if (!table) throw new ValidationError(`Unsupported validation language: ${language}`);
    const rows = await this.rows<DetFieldRow>(
      `SELECT ${DET_FIELD_COLUMNS}
         FROM ${table} WHERE word1 = $1 AND language = $2 AND ${discoverSupplyGate('')}`,
      [word1, language]
    );
    return rows[0] ?? null;
  }

  async upsertVote(
    key: ValidationVoteKey,
    vote: { validatorName: string; action: 'approve' | 'flag'; content: string | null }
  ): Promise<ValidationRecord> {
    const rows = await this.rows<ValidationRecord>(
      `INSERT INTO validations
         ("entryId", language, field, "senseLabel", "validatorUserId", "validatorName", action, content)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT ON CONSTRAINT validations_unique_per_user
         DO UPDATE SET action = EXCLUDED.action, content = EXCLUDED.content,
                       "validatorName" = EXCLUDED."validatorName"
       RETURNING id, "entryId", language, field, "senseLabel", "validatorUserId", "validatorName", action, content, "createdAt"`,
      [...this.keyParams(key), vote.validatorName, vote.action, vote.content]
    );
    return rows[0];
  }

  async deleteVote(key: ValidationVoteKey): Promise<void> {
    await this.rows(`DELETE FROM validations WHERE ${VOTE_WHERE}`, this.keyParams(key));
  }

  async findVoteAction(key: ValidationVoteKey): Promise<'approve' | 'flag' | null> {
    const rows = await this.rows<{ action: 'approve' | 'flag' }>(
      `SELECT action FROM validations WHERE ${VOTE_WHERE}`,
      this.keyParams(key)
    );
    return rows[0]?.action ?? null;
  }
}
