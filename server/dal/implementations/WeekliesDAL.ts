import { IWeekliesDAL } from '../interfaces/IWeekliesDAL.js';
import { dbManager } from '../base/DatabaseManager.js';
import { Weekly } from '../../types/weeklies.js';
import { ValidationError } from '../../types/dal.js';

/**
 * Persists per-user weekly achievement flags (the `weeklies` table).
 * Generic: `activity` is an opaque key, so the same three methods serve every
 * weekly achievement (Bubble Match's 'bubbleMatch', and any future ones).
 */
export class WeekliesDAL implements IWeekliesDAL {
  async record(userId: string, activity: string): Promise<Weekly> {
    if (!userId) throw new ValidationError('userId is required');
    if (!activity) throw new ValidationError('activity is required');

    const result = await dbManager.executeQuery<Weekly>(async (client) => {
      // Upsert on (userId, activity): re-earning in the same week just bumps the
      // timestamp instead of inserting a duplicate row.
      return await client.query(`
        INSERT INTO weeklies ("userId", activity, "achievedAt")
        VALUES ($1, $2, NOW())
        ON CONFLICT ("userId", activity) DO UPDATE SET
          "achievedAt" = NOW()
        RETURNING id, "userId", activity, "achievedAt"
      `, [userId, activity]);
    });

    return result.recordset[0];
  }

  async remove(userId: string, activity: string): Promise<void> {
    if (!userId) throw new ValidationError('userId is required');
    if (!activity) throw new ValidationError('activity is required');

    await dbManager.executeQuery(async (client) => {
      return await client.query(
        `DELETE FROM weeklies WHERE "userId" = $1 AND activity = $2`,
        [userId, activity]
      );
    });
  }

  async listByUser(userId: string): Promise<Weekly[]> {
    if (!userId) throw new ValidationError('userId is required');

    const result = await dbManager.executeQuery<Weekly>(async (client) => {
      return await client.query(`
        SELECT id, "userId", activity, "achievedAt"
        FROM weeklies
        WHERE "userId" = $1
        ORDER BY "achievedAt" DESC
      `, [userId]);
    });

    return result.recordset;
  }
}
