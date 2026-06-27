import { IWinsDAL } from '../interfaces/IWinsDAL.js';
import { dbManager } from '../base/DatabaseManager.js';
import { Win, WinAggregate } from '../../types/wins.js';
import { ValidationError } from '../../types/dal.js';
// Most-recent-Sunday-04:00 week boundary, shared with community-layout votes so "this week"
// is identical across the app. See server/dal/shared/weekBoundary.ts.
import { WEEK_BOUNDARY } from '../shared/weekBoundary.js';

/**
 * Persists the append-only `wins` event log (one row per game win). All tallies
 * are derived here via aggregate queries rather than stored counters.
 */
export class WinsDAL implements IWinsDAL {
  async recordWin(userId: string, game: string, level: string): Promise<Win> {
    if (!userId) throw new ValidationError('userId is required');
    if (!game) throw new ValidationError('game is required');
    if (!level) throw new ValidationError('level is required');

    const result = await dbManager.executeQuery<Win>(async (client) => {
      return await client.query(`
        INSERT INTO wins ("userId", game, level)
        VALUES ($1, $2, $3)
        RETURNING id, "userId", game, level, "wonAt"
      `, [userId, game, level]);
    });

    return result.recordset[0];
  }

  async getWeeklyWins(userId: string): Promise<Array<{ game: string; level: string }>> {
    if (!userId) throw new ValidationError('userId is required');

    const result = await dbManager.executeQuery<{ game: string; level: string }>(async (client) => {
      // Join users for the per-user timezone the week boundary depends on.
      return await client.query(`
        SELECT DISTINCT w.game, w.level
        FROM wins w
        JOIN users u ON u.id = w."userId"
        WHERE w."userId" = $1
          AND w."wonAt" >= ${WEEK_BOUNDARY}
        ORDER BY w.game, w.level
      `, [userId]);
    });

    return result.recordset;
  }

  async getLifetimeCounts(userId: string): Promise<WinAggregate[]> {
    if (!userId) throw new ValidationError('userId is required');

    const result = await dbManager.executeQuery<{ game: string; level: string; winCount: number; lastWin: Date }>(async (client) => {
      return await client.query(`
        SELECT game, level, COUNT(*)::int AS "winCount", MAX("wonAt") AS "lastWin"
        FROM wins
        WHERE "userId" = $1
        GROUP BY game, level
        ORDER BY game, level
      `, [userId]);
    });

    return result.recordset;
  }

  async getWeeklyCountsByUser(): Promise<Map<string, number>> {
    const result = await dbManager.executeQuery<{ userId: string; count: string }>(async (client) => {
      // One grouped scan: per user, how many DISTINCT (game, level) pairs were
      // won since that user's own week boundary. COUNT(*) comes back as a string.
      return await client.query(`
        SELECT w."userId" AS "userId", COUNT(DISTINCT (w.game, w.level)) AS count
        FROM wins w
        JOIN users u ON u.id = w."userId"
        WHERE w."wonAt" >= ${WEEK_BOUNDARY}
        GROUP BY w."userId"
      `);
    });

    const counts = new Map<string, number>();
    for (const row of result.recordset) {
      counts.set(row.userId, parseInt(row.count, 10));
    }
    return counts;
  }
}
