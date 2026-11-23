import type { PoolClient } from 'pg';
import { dbManager as defaultDbManager, DatabaseManager } from '../base/DatabaseManager.js';
import type {
  ISentenceTilesDAL,
  SentenceTilesGameRow,
  SentenceTilesGameState,
  SentenceTilesMoveRow,
  SentenceTilesPlayerIdentity,
  SentenceTilesVerdictRow,
} from '../interfaces/ISentenceTilesDAL.js';
import { ValidationError } from '../../types/dal.js';

/** Every column of a `sentence_tile_games` row, in SentenceTilesGameRow's shape. */
const GAME_COLUMNS = `g.id, g.language, g."playerAId", g."playerBId", g.status, g."turnUserId", g.board,
  g."rackA", g."rackB", g.bag, g."scoreA", g."scoreB", g."scorelessTurns", g.version, g."judgeStartedAt",
  g."winnerId", g."createdAt", g."updatedAt", g."finishedAt"`;

const UNFINISHED = `('draft', 'pending', 'active')`;

/**
 * Persists Sentence Tiles (migration 204, docs/SENTENCE_TILES_GAME.md § "Data model").
 *
 * jsonb columns (board, racks, bag) come back already parsed by node-postgres and are written
 * with JSON.stringify + an explicit ::jsonb cast.
 *
 * Every method takes an optional PoolClient so the service can enlist it in a transaction —
 * the shape docs/BACKEND_LAYERING.md § 3 prescribes.
 */
export class SentenceTilesDAL implements ISentenceTilesDAL {
  constructor(protected readonly dbManager: DatabaseManager = defaultDbManager) {}

  /** Run `fn` on the caller's client when given one, otherwise on a pooled connection. */
  private async run<T>(client: PoolClient | undefined, fn: (c: PoolClient) => Promise<any>): Promise<T[]> {
    if (client) return ((await fn(client)).rows ?? []) as T[];
    return (await this.dbManager.executeQuery<T>(fn)).recordset;
  }

  private requireId(value: unknown, label: string): string {
    if (!value || typeof value !== 'string') throw new ValidationError(`${label} is required`);
    return value;
  }

  async lockUsers(userIds: string[], client: PoolClient): Promise<void> {
    // Sorted + de-duplicated so every caller takes the locks in the same order (no deadlock).
    // Seed 204 keeps this lock space apart from Study Challenge's (seed 0) on the same ids.
    for (const userId of [...new Set(userIds)].sort()) {
      this.requireId(userId, 'userId');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 204))', [userId]);
    }
  }

  async countUnfinishedGames(userId: string, client?: PoolClient): Promise<number> {
    this.requireId(userId, 'userId');
    const rows = await this.run<{ n: number }>(client, (c) =>
      c.query(
        `SELECT count(*)::int AS n FROM sentence_tile_games
         WHERE ("playerAId" = $1 OR "playerBId" = $1) AND status IN ${UNFINISHED}`,
        [userId]
      )
    );
    return rows[0]?.n ?? 0;
  }

  async insertGame(
    game: Pick<SentenceTilesGameRow, 'language' | 'playerAId' | 'playerBId' | 'turnUserId' | 'rackA' | 'rackB' | 'bag'>,
    client: PoolClient
  ): Promise<SentenceTilesGameRow> {
    const { rows } = await client.query(
      `INSERT INTO sentence_tile_games AS g (language, "playerAId", "playerBId", "turnUserId", "rackA", "rackB", bag)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)
       RETURNING ${GAME_COLUMNS}`,
      [
        game.language, game.playerAId, game.playerBId, game.turnUserId,
        JSON.stringify(game.rackA), JSON.stringify(game.rackB), JSON.stringify(game.bag),
      ]
    );
    return rows[0];
  }

  async findGame(id: string, client?: PoolClient, forUpdate = false): Promise<SentenceTilesGameRow | null> {
    this.requireId(id, 'id');
    const rows = await this.run<SentenceTilesGameRow>(client, (c) =>
      c.query(`SELECT ${GAME_COLUMNS} FROM sentence_tile_games g WHERE g.id = $1 ${forUpdate ? 'FOR UPDATE' : ''}`, [id])
    );
    return rows[0] ?? null;
  }

  async saveState(id: string, s: SentenceTilesGameState, client: PoolClient): Promise<SentenceTilesGameRow> {
    const { rows } = await client.query(
      `UPDATE sentence_tile_games AS g SET
         status = $2, "turnUserId" = $3, board = $4::jsonb, "rackA" = $5::jsonb, "rackB" = $6::jsonb,
         bag = $7::jsonb, "scoreA" = $8, "scoreB" = $9, "scorelessTurns" = $10, "winnerId" = $11,
         "finishedAt" = CASE WHEN $12 THEN now() ELSE g."finishedAt" END,
         version = g.version + 1, "judgeStartedAt" = NULL, "updatedAt" = now()
       WHERE g.id = $1
       RETURNING ${GAME_COLUMNS}`,
      [
        id, s.status, s.turnUserId, JSON.stringify(s.board), JSON.stringify(s.rackA), JSON.stringify(s.rackB),
        JSON.stringify(s.bag), s.scoreA, s.scoreB, s.scorelessTurns, s.winnerId, s.finished,
      ]
    );
    return rows[0];
  }

  async claimJudge(id: string, expectedVersion: number, staleSeconds: number, client?: PoolClient): Promise<boolean> {
    // One statement: the version check and the in-flight check cannot be raced apart.
    const rows = await this.run<{ id: string }>(client, (c) =>
      c.query(
        `UPDATE sentence_tile_games SET "judgeStartedAt" = now()
         WHERE id = $1 AND version = $2
           AND ("judgeStartedAt" IS NULL OR "judgeStartedAt" < now() - make_interval(secs => $3))
         RETURNING id`,
        [id, expectedVersion, staleSeconds]
      )
    );
    return rows.length > 0;
  }

  async releaseJudge(id: string, client?: PoolClient): Promise<void> {
    await this.run(client, (c) => c.query(`UPDATE sentence_tile_games SET "judgeStartedAt" = NULL WHERE id = $1`, [id]));
  }

  async listGamesForUser(userId: string, limit: number) {
    this.requireId(userId, 'userId');
    const rows = await this.run<SentenceTilesGameRow & { oppId: string; oppName: string | null; oppUsername: string }>(
      undefined,
      (c) =>
        c.query(
          `SELECT ${GAME_COLUMNS}, u.id AS "oppId", u.name AS "oppName", u.username AS "oppUsername"
           FROM sentence_tile_games g
           JOIN users u ON u.id = CASE WHEN g."playerAId" = $1 THEN g."playerBId" ELSE g."playerAId" END
           WHERE (g."playerAId" = $1 OR g."playerBId" = $1)
             -- A draft is the challenger's private work in progress until the opening is played.
             AND NOT (g.status = 'draft' AND g."playerBId" = $1)
           ORDER BY (g.status IN ${UNFINISHED}) DESC, g."updatedAt" DESC
           LIMIT $2`,
          [userId, limit]
        )
    );
    return rows.map(({ oppId, oppName, oppUsername, ...game }) => ({
      game: game as SentenceTilesGameRow,
      opponent: { userId: oppId, name: oppName, username: oppUsername },
    }));
  }

  async getPlayerIdentities(userIds: string[]): Promise<SentenceTilesPlayerIdentity[]> {
    return this.run<SentenceTilesPlayerIdentity>(undefined, (c) =>
      c.query(`SELECT id AS "userId", name, username FROM users WHERE id = ANY($1::uuid[])`, [userIds])
    );
  }

  async insertMove(
    m: Pick<SentenceTilesMoveRow, 'gameId' | 'userId' | 'turnNumber' | 'kind' | 'placements' | 'lineWords' | 'points'>,
    client?: PoolClient
  ): Promise<void> {
    await this.run(client, (c) =>
      c.query(
        `INSERT INTO sentence_tile_moves ("gameId", "userId", "turnNumber", kind, placements, "lineWords", points)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::text[], $7)`,
        [m.gameId, m.userId, m.turnNumber, m.kind, m.placements ? JSON.stringify(m.placements) : null, m.lineWords, m.points]
      )
    );
  }

  async listMoves(gameId: string, client?: PoolClient): Promise<SentenceTilesMoveRow[]> {
    return this.run<SentenceTilesMoveRow>(client, (c) =>
      c.query(
        `SELECT id, "gameId", "userId", "turnNumber", kind, placements, "lineWords", points, "createdAt"
         FROM sentence_tile_moves WHERE "gameId" = $1 ORDER BY id`,
        [gameId]
      )
    );
  }

  async countCompletedTurns(gameId: string, client?: PoolClient): Promise<number> {
    const rows = await this.run<{ n: number }>(client, (c) =>
      c.query(`SELECT count(*)::int AS n FROM sentence_tile_moves WHERE "gameId" = $1 AND kind <> 'rejected'`, [gameId])
    );
    return rows[0]?.n ?? 0;
  }

  async countRejected(gameId: string, userId: string, turnNumber: number, client?: PoolClient): Promise<number> {
    const rows = await this.run<{ n: number }>(client, (c) =>
      c.query(
        `SELECT count(*)::int AS n FROM sentence_tile_moves
         WHERE "gameId" = $1 AND "userId" = $2 AND "turnNumber" = $3 AND kind = 'rejected'`,
        [gameId, userId, turnNumber]
      )
    );
    return rows[0]?.n ?? 0;
  }

  async findVerdict(language: string, line: string): Promise<SentenceTilesVerdictRow | null> {
    const rows = await this.run<SentenceTilesVerdictRow>(undefined, (c) =>
      c.query(`SELECT language, line, legal, reason, model FROM sentence_tile_verdicts WHERE language = $1 AND line = $2`, [language, line])
    );
    return rows[0] ?? null;
  }

  async saveVerdict(v: SentenceTilesVerdictRow & { requestedBy: string }): Promise<SentenceTilesVerdictRow> {
    // ON CONFLICT DO NOTHING + re-read: if two games judged the same line at once, the first
    // verdict stored is the one both see, so a line never has two rulings.
    await this.run(undefined, (c) =>
      c.query(
        `INSERT INTO sentence_tile_verdicts (language, line, legal, reason, model, "requestedBy")
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (language, line) DO NOTHING`,
        [v.language, v.line, v.legal, v.reason, v.model, v.requestedBy]
      )
    );
    return (await this.findVerdict(v.language, v.line)) ?? v;
  }

  async countVerdictsLastDay(): Promise<number> {
    const rows = await this.run<{ n: number }>(undefined, (c) =>
      c.query(`SELECT count(*)::int AS n FROM sentence_tile_verdicts WHERE "createdAt" > now() - interval '24 hours'`)
    );
    return rows[0]?.n ?? 0;
  }

  async reserveJudgeCall(userId: string, usageDate: string, limit: number): Promise<boolean> {
    // Conditional upsert: the WHERE on the conflict branch makes "check the cap and take one"
    // a single statement, so parallel requests cannot all slip in under the limit.
    const rows = await this.run<{ count: number }>(undefined, (c) =>
      c.query(
        `INSERT INTO sentence_tile_judge_usage ("userId", "usageDate", count)
         SELECT $1, $2, 1 WHERE $3 > 0
         ON CONFLICT ("userId", "usageDate") DO UPDATE
           SET count = sentence_tile_judge_usage.count + 1
           WHERE sentence_tile_judge_usage.count < $3
         RETURNING count`,
        [userId, usageDate, limit]
      )
    );
    return rows.length > 0;
  }

  async refundJudgeCall(userId: string, usageDate: string): Promise<void> {
    await this.run(undefined, (c) =>
      c.query(
        `UPDATE sentence_tile_judge_usage SET count = GREATEST(count - 1, 0) WHERE "userId" = $1 AND "usageDate" = $2`,
        [userId, usageDate]
      )
    );
  }

  async getJudgeUsage(userId: string, usageDate: string): Promise<number> {
    const rows = await this.run<{ count: number }>(undefined, (c) =>
      c.query(`SELECT count FROM sentence_tile_judge_usage WHERE "userId" = $1 AND "usageDate" = $2`, [userId, usageDate])
    );
    return rows[0]?.count ?? 0;
  }
}
