import type { ISentenceExplanationDAL, SentenceExplanationRow } from '../interfaces/ISentenceExplanationDAL.js';
import type { LongDefinitionCitation } from '../../contracts/wire.js';
import { dbManager as defaultDbManager, DatabaseManager } from '../base/DatabaseManager.js';
import { ValidationError } from '../../types/dal.js';

/**
 * sentence_explanation_cache (migration 195) — see ISentenceExplanationDAL.
 * Depended on by: SentenceExplanationService.
 * Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Sentence Explain".
 */
export class SentenceExplanationDAL implements ISentenceExplanationDAL {
  constructor(protected readonly dbManager: DatabaseManager = defaultDbManager) {}

  async find(userId: string, sentence: string, language: string, promptVersion: number): Promise<SentenceExplanationRow | null> {
    if (!userId) throw new ValidationError('userId is required');
    const result = await this.dbManager.executeQuery(async (client) =>
      client.query(
        `SELECT explanation, citations, model, "createdAt"
           FROM sentence_explanation_cache
          WHERE "userId" = $1 AND sentence = $2 AND language = $3 AND "promptVersion" = $4`,
        [userId, sentence, language, promptVersion]
      )
    );
    const row = result.recordset[0];
    if (!row) return null;
    return {
      explanation: row.explanation,
      // jsonb arrives parsed; anything that is not an array is treated as "no citations".
      citations: Array.isArray(row.citations) ? (row.citations as LongDefinitionCitation[]) : null,
      model: row.model ?? null,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    };
  }

  async upsert(
    userId: string,
    sentence: string,
    language: string,
    promptVersion: number,
    explanation: string,
    citations: LongDefinitionCitation[] | null,
    model: string
  ): Promise<void> {
    if (!userId) throw new ValidationError('userId is required');
    await this.dbManager.executeQuery(async (client) =>
      client.query(
        `INSERT INTO sentence_explanation_cache ("userId", sentence, language, "promptVersion", explanation, citations, model)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT ("userId", sentence, language, "promptVersion") DO UPDATE
            SET explanation = EXCLUDED.explanation,
                citations   = EXCLUDED.citations,
                model       = EXCLUDED.model,
                "createdAt" = now()`,
        [userId, sentence, language, promptVersion, explanation, citations?.length ? JSON.stringify(citations) : null, model]
      )
    );
  }
}
