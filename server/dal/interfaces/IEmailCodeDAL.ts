/**
 * Data-access contract for `email_codes` (migration 188, docs/LOGIN_REWORK.md § 4b, § 4d).
 *
 * Pure storage: the DAL only ever sees an HMAC of a code, never the code. Every POLICY
 * (6 digits, 10-minute life, 5 wrong tries, 5 sends per address per hour) lives in
 * SignInService.
 */

export type EmailCodePurpose = 'sign-in' | 'reset' | 'verify-new-email' | 'step-up';

export interface EmailCodeRow {
  id: string;
  email: string;
  purpose: EmailCodePurpose;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  consumedAt: Date | null;
  createdAt: Date;
}

export interface IEmailCodeDAL {
  /** Store a new code. `email` must already be lowercase. */
  create(params: { email: string; purpose: EmailCodePurpose; codeHash: string; expiresAt: Date }): Promise<EmailCodeRow>;
  /** How many codes (any purpose) were created for this address since `since`. */
  countSince(email: string, since: Date): Promise<number>;
  /** The newest code for (email, purpose), consumed or not, or null. */
  findLatest(email: string, purpose: EmailCodePurpose): Promise<EmailCodeRow | null>;
  /** Count one wrong guess; returns the new attempt count. */
  incrementAttempts(id: string): Promise<number>;
  /**
   * Mark a code used. Returns false if it was already consumed (a concurrent verify won),
   * so a code can never be redeemed twice.
   */
  consume(id: string): Promise<boolean>;
}
