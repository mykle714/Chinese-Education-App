import { IRefreshTokenDAL } from '../interfaces/IRefreshTokenDAL.js';
import { dbManager } from '../base/DatabaseManager.js';
import { RefreshToken } from '../../types/index.js';
import { ValidationError } from '../../types/dal.js';

/**
 * Persists the `refresh_tokens` store (migration 85). Pure storage: it stores
 * and returns whatever hashes it is given and never sees a raw token. All
 * rotation / reuse-detection policy lives in UserService.
 */
export class RefreshTokenDAL implements IRefreshTokenDAL {
  async create(params: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    userAgent?: string | null;
  }): Promise<RefreshToken> {
    if (!params.userId) throw new ValidationError('userId is required');
    if (!params.tokenHash) throw new ValidationError('tokenHash is required');
    if (!params.expiresAt) throw new ValidationError('expiresAt is required');

    const result = await dbManager.executeQuery<RefreshToken>(async (client) => {
      return await client.query(`
        INSERT INTO refresh_tokens ("userId", "tokenHash", "expiresAt", "userAgent")
        VALUES ($1, $2, $3, $4)
        RETURNING id, "userId", "tokenHash", "expiresAt", "createdAt", "revokedAt", "replacedByHash", "userAgent"
      `, [params.userId, params.tokenHash, params.expiresAt, params.userAgent ?? null]);
    });

    return result.recordset[0];
  }

  async findByHash(tokenHash: string): Promise<RefreshToken | null> {
    if (!tokenHash) throw new ValidationError('tokenHash is required');

    const result = await dbManager.executeQuery<RefreshToken>(async (client) => {
      return await client.query(`
        SELECT id, "userId", "tokenHash", "expiresAt", "createdAt", "revokedAt", "replacedByHash", "userAgent"
        FROM refresh_tokens
        WHERE "tokenHash" = $1
      `, [tokenHash]);
    });

    return result.recordset[0] ?? null;
  }

  async revoke(tokenHash: string, replacedByHash: string | null): Promise<void> {
    if (!tokenHash) throw new ValidationError('tokenHash is required');

    await dbManager.executeQuery(async (client) => {
      // Only stamp revokedAt the first time; preserve the original revoke moment
      // (and replacedByHash) if this row was already retired.
      return await client.query(`
        UPDATE refresh_tokens
        SET "revokedAt" = COALESCE("revokedAt", now()),
            "replacedByHash" = COALESCE("replacedByHash", $2)
        WHERE "tokenHash" = $1
      `, [tokenHash, replacedByHash]);
    });
  }

  async revokeAllForUser(userId: string): Promise<number> {
    if (!userId) throw new ValidationError('userId is required');

    const result = await dbManager.executeQuery(async (client) => {
      return await client.query(`
        UPDATE refresh_tokens
        SET "revokedAt" = now()
        WHERE "userId" = $1 AND "revokedAt" IS NULL
      `, [userId]);
    });

    return result.rowsAffected ?? 0;
  }
}
