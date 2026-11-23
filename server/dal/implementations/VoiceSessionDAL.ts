import type { PoolClient } from 'pg';
import { dbManager as defaultDbManager, DatabaseManager } from '../base/DatabaseManager.js';
import { ValidationError } from '../../types/dal.js';
import { coreCategoryExpr, vetSortedClause, vetTableForLanguage } from '../shared/vetTable.js';
import { dictTableForLanguage } from '../shared/dictTable.js';
import { STREAK_DAY_OFFSET_HOURS } from '../../shared/streakDay.js';
import type {
  IVoiceSessionDAL,
  VoiceBandCounts,
  VoiceSessionListRow,
  VoiceSessionRow,
  VoiceTurnRow,
} from '../interfaces/IVoiceSessionDAL.js';

const SESSION_COLUMNS = `id, "userId", language, "startedAt", "endedAt", "userSeconds", "assistantSeconds", "turnCount"`;

/**
 * Persists the voice tutor (migration 202) and reads the learner's cards for it.
 * LAYER: DAL (SQL only, no policy).
 *
 * Table names for the card reads come from the whitelisting helpers (`vetTableForLanguage`,
 * `dictTableForLanguage`), never from caller text.
 *
 * Referenced by: server/services/voice/VoiceSessionService.ts, server/dal/setup.ts.
 * Docs: docs/VOICE_ASSISTANT.md § 11.
 */
export class VoiceSessionDAL implements IVoiceSessionDAL {
  constructor(protected readonly dbManager: DatabaseManager = defaultDbManager) {}

  private async query<T>(fn: (c: PoolClient) => Promise<any>): Promise<T[]> {
    const r = await this.dbManager.executeQuery<T>(fn);
    return r.recordset;
  }

  private requireId(value: string | undefined | null, label: string): string {
    if (!value || typeof value !== 'string') throw new ValidationError(`${label} is required`);
    return value;
  }

  // ── voice_sessions / voice_turns ───────────────────────────────────────────

  async createSession(userId: string, language: string): Promise<VoiceSessionRow> {
    this.requireId(userId, 'userId');
    const rows = await this.query<VoiceSessionRow>((c) =>
      c.query(`INSERT INTO voice_sessions ("userId", language) VALUES ($1, $2) RETURNING ${SESSION_COLUMNS}`, [userId, language]),
    );
    return rows[0];
  }

  async finalizeSession(
    sessionId: string,
    totals: { userSeconds: number; assistantSeconds: number; turnCount: number },
  ): Promise<void> {
    await this.query((c) =>
      c.query(
        `UPDATE voice_sessions
            SET "endedAt" = COALESCE("endedAt", now()),
                "userSeconds" = $2, "assistantSeconds" = $3, "turnCount" = $4
          WHERE id = $1`,
        [sessionId, totals.userSeconds, totals.assistantSeconds, totals.turnCount],
      ),
    );
  }

  async insertTurn(sessionId: string, turn: VoiceTurnRow): Promise<void> {
    await this.query((c) =>
      c.query(
        `INSERT INTO voice_turns ("sessionId", "turnIndex", role, text, "lowConfidenceWords", recast, interrupted)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT ("sessionId", "turnIndex") DO NOTHING`,
        [
          sessionId,
          turn.turnIndex,
          turn.role,
          turn.text,
          turn.lowConfidenceWords && turn.lowConfidenceWords.length ? JSON.stringify(turn.lowConfidenceWords) : null,
          turn.recast ? JSON.stringify(turn.recast) : null,
          turn.interrupted,
        ],
      ),
    );
  }

  async sumSecondsForDay(userId: string, tz: string, usageDate: string): Promise<number> {
    // The 04:00-local day a session started on: shift the local wall-clock time back by the
    // streak-day offset and take the date (the same boundary as shared/streakDay.ts).
    const rows = await this.query<{ total: number | null }>((c) =>
      c.query(
        `SELECT COALESCE(SUM("userSeconds" + "assistantSeconds"), 0)::float8 AS total
           FROM voice_sessions
          WHERE "userId" = $1
            AND "startedAt" >= now() - interval '2 days'
            AND ((("startedAt" AT TIME ZONE $2) - make_interval(hours => $4))::date) = $3::date`,
        [userId, tz, usageDate, STREAK_DAY_OFFSET_HOURS],
      ),
    );
    return Number(rows[0]?.total ?? 0);
  }

  async listSessions(userId: string, language: string, limit: number): Promise<VoiceSessionListRow[]> {
    return this.query<VoiceSessionListRow>((c) =>
      c.query(
        `SELECT ${SESSION_COLUMNS.split(', ').map((col) => `s.${col}`).join(', ')},
                (SELECT t.text FROM voice_turns t
                  WHERE t."sessionId" = s.id AND t.role = 'user'
                  ORDER BY t."turnIndex" LIMIT 1) AS preview
           FROM voice_sessions s
          WHERE s."userId" = $1 AND s.language = $2 AND s."turnCount" > 0
          ORDER BY s."startedAt" DESC
          LIMIT $3`,
        [userId, language, limit],
      ),
    );
  }

  async findSession(userId: string, sessionId: string): Promise<VoiceSessionRow | null> {
    const rows = await this.query<VoiceSessionRow>((c) =>
      c.query(`SELECT ${SESSION_COLUMNS} FROM voice_sessions WHERE id = $1 AND "userId" = $2`, [sessionId, userId]),
    );
    return rows[0] ?? null;
  }

  async listTurns(sessionId: string): Promise<VoiceTurnRow[]> {
    return this.query<VoiceTurnRow>((c) =>
      c.query(
        `SELECT "turnIndex", role, text, "lowConfidenceWords", recast, interrupted
           FROM voice_turns WHERE "sessionId" = $1 ORDER BY "turnIndex"`,
        [sessionId],
      ),
    );
  }

  // ── Card reads ─────────────────────────────────────────────────────────────

  async countBands(userId: string, language: string): Promise<VoiceBandCounts> {
    const vet = vetTableForLanguage(language);
    const rows = await this.query<{ category: string; n: number }>((c) =>
      c.query(
        `SELECT ${coreCategoryExpr('ve')} AS category, COUNT(*)::int AS n
           FROM ${vet} ve
          WHERE ve."userId" = $1 AND ve.language = $2 AND ${vetSortedClause('ve')}
          GROUP BY 1`,
        [userId, language],
      ),
    );
    const counts: VoiceBandCounts = { unfamiliar: 0, target: 0, comfortable: 0, mastered: 0 };
    for (const r of rows) {
      const key = String(r.category).toLowerCase() as keyof VoiceBandCounts;
      if (key in counts) counts[key] = r.n;
    }
    return counts;
  }

  async findKnownWords(userId: string, language: string, limit: number): Promise<string[]> {
    const vet = vetTableForLanguage(language);
    const det = dictTableForLanguage(language);
    const rows = await this.query<{ word: string }>((c) =>
      c.query(
        `SELECT ve."entryKey" AS word
           FROM ${vet} ve
           LEFT JOIN ${det} de ON de.word1 = ve."entryKey" AND de.language = ve.language
          WHERE ve."userId" = $1 AND ve.language = $2 AND ${vetSortedClause('ve')}
            AND ${coreCategoryExpr('ve')} IN ('Mastered', 'Comfortable')
          ORDER BY de."frequencyScore" DESC NULLS LAST, ve."entryKey"
          LIMIT $3`,
        [userId, language, limit],
      ),
    );
    return rows.map((r) => r.word);
  }

  async findLearningWords(userId: string, language: string, limit: number): Promise<string[]> {
    const vet = vetTableForLanguage(language);
    const rows = await this.query<{ word: string }>((c) =>
      c.query(
        `SELECT ve."entryKey" AS word
           FROM ${vet} ve
          WHERE ve."userId" = $1 AND ve.language = $2 AND ${vetSortedClause('ve')}
            AND ${coreCategoryExpr('ve')} <> 'Mastered'
          ORDER BY ve."createdAt" DESC NULLS LAST, ve.id DESC
          LIMIT $3`,
        [userId, language, limit],
      ),
    );
    return rows.map((r) => r.word);
  }

  async findCardCategories(userId: string, language: string, words: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(words.filter(Boolean))];
    if (unique.length === 0) return new Map();
    const vet = vetTableForLanguage(language);
    const rows = await this.query<{ word: string; category: string }>((c) =>
      c.query(
        `SELECT ve."entryKey" AS word, ${coreCategoryExpr('ve')} AS category
           FROM ${vet} ve
          WHERE ve."userId" = $1 AND ve.language = $2 AND ${vetSortedClause('ve')}
            AND ve."entryKey" = ANY($3::text[])`,
        [userId, language, unique],
      ),
    );
    return new Map(rows.map((r) => [r.word, r.category]));
  }

  async findWordsAddedBetween(userId: string, language: string, from: Date, to: Date): Promise<string[]> {
    const vet = vetTableForLanguage(language);
    // vet."createdAt" is `timestamp without time zone` defaulting to now() in the server's
    // TimeZone, so the bounds are converted the same way (timestamptz → timestamp).
    const rows = await this.query<{ word: string }>((c) =>
      c.query(
        `SELECT ve."entryKey" AS word
           FROM ${vet} ve
          WHERE ve."userId" = $1 AND ve.language = $2 AND ${vetSortedClause('ve')}
            AND ve."createdAt" BETWEEN $3::timestamptz::timestamp AND $4::timestamptz::timestamp
          ORDER BY ve."createdAt"`,
        [userId, language, from.toISOString(), to.toISOString()],
      ),
    );
    return rows.map((r) => r.word);
  }
}
