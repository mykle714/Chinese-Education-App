import { IEmailCodeDAL, EmailCodePurpose, EmailCodeRow } from '../interfaces/IEmailCodeDAL.js';
import { dbManager as defaultDbManager, DatabaseManager } from '../base/DatabaseManager.js';
import { ValidationError } from '../../types/dal.js';

/**
 * Persists `email_codes` (migration 188). Pure storage over code HMACs; policy is in
 * SignInService (docs/LOGIN_REWORK.md § 4b).
 */
export class EmailCodeDAL implements IEmailCodeDAL {
  constructor(protected readonly dbManager: DatabaseManager = defaultDbManager) {}

  private static readonly COLUMNS =
    'id, email, purpose, "codeHash", "expiresAt", attempts, "consumedAt", "createdAt"';

  async create(params: { email: string; purpose: EmailCodePurpose; codeHash: string; expiresAt: Date }): Promise<EmailCodeRow> {
    if (!params.email) throw new ValidationError('email is required');
    if (!params.codeHash) throw new ValidationError('codeHash is required');
    const result = await this.dbManager.executeQuery<EmailCodeRow>(async (client) => {
      return await client.query(
        `INSERT INTO email_codes (email, purpose, "codeHash", "expiresAt")
         VALUES ($1, $2, $3, $4)
         RETURNING ${EmailCodeDAL.COLUMNS}`,
        [params.email, params.purpose, params.codeHash, params.expiresAt],
      );
    });
    return result.recordset[0];
  }

  async countSince(email: string, since: Date): Promise<number> {
    const result = await this.dbManager.executeQuery<{ n: string }>(async (client) => {
      // Served by idx_email_codes_email_created.
      return await client.query(
        'SELECT count(*)::text AS n FROM email_codes WHERE email = $1 AND "createdAt" >= $2',
        [email, since],
      );
    });
    return Number(result.recordset[0]?.n ?? 0);
  }

  async findLatest(email: string, purpose: EmailCodePurpose): Promise<EmailCodeRow | null> {
    const result = await this.dbManager.executeQuery<EmailCodeRow>(async (client) => {
      return await client.query(
        `SELECT ${EmailCodeDAL.COLUMNS} FROM email_codes
         WHERE email = $1 AND purpose = $2
         ORDER BY "createdAt" DESC, id DESC
         LIMIT 1`,
        [email, purpose],
      );
    });
    return result.recordset[0] ?? null;
  }

  async incrementAttempts(id: string): Promise<number> {
    const result = await this.dbManager.executeQuery<{ attempts: number }>(async (client) => {
      return await client.query('UPDATE email_codes SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts', [id]);
    });
    return result.recordset[0]?.attempts ?? Number.MAX_SAFE_INTEGER;
  }

  async consume(id: string): Promise<boolean> {
    const result = await this.dbManager.executeQuery(async (client) => {
      // The `"consumedAt" IS NULL` guard makes redemption single-use under concurrency.
      return await client.query('UPDATE email_codes SET "consumedAt" = now() WHERE id = $1 AND "consumedAt" IS NULL', [id]);
    });
    return result.rowsAffected > 0;
  }
}
