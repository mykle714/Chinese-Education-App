import { RefreshToken } from '../../types/index.js';

/**
 * Data-access contract for the `refresh_tokens` store (migration 85).
 *
 * The DAL deals only in HASHES — callers hash the raw token (SHA-256 hex) before
 * it ever reaches here, so a raw refresh token is never persisted or logged.
 * Rotation / reuse-detection POLICY lives in the service (UserService); this
 * layer is pure storage.
 */
export interface IRefreshTokenDAL {
  /**
   * Persist a freshly issued refresh token (the family root on login, or a
   * successor on rotation). Returns the stored row.
   */
  create(params: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    userAgent?: string | null;
  }): Promise<RefreshToken>;

  /** Look up a token row by its hash, or null if no such row exists. */
  findByHash(tokenHash: string): Promise<RefreshToken | null>;

  /**
   * Mark a single token revoked. `replacedByHash` is set on rotation so the
   * family chain can be walked; pass null for a plain revoke (logout). No-op if
   * the row is already revoked.
   */
  revoke(tokenHash: string, replacedByHash: string | null): Promise<void>;

  /**
   * Revoke every still-valid token for a user. Used for "log out everywhere",
   * account deletion safety, and reuse-detection fallout. Returns the count
   * revoked.
   */
  revokeAllForUser(userId: string): Promise<number>;
}
