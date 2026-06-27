-- Migration 85: Create the `refresh_tokens` table backing the proper
-- access-token / refresh-token auth scheme.
--
-- WHY THIS TABLE EXISTS
-- Before this migration auth was a single 24h JWT in an httpOnly cookie with no
-- renewal: when it lapsed the user was bounced to /login. We now issue a SHORT
-- 15-minute access token (still a stateless JWT, verified by authMiddleware) plus
-- a LONG 30-day refresh token. The refresh token is the part that must be
-- revocable and rotatable, which a stateless JWT cannot be — hence this table.
--
-- SECURITY MODEL (stateful + rotation + reuse detection)
--   * We NEVER store the raw refresh token. The client holds the raw random
--     token (in an httpOnly cookie); we store only its SHA-256 hex hash. A DB
--     leak therefore does not hand out usable refresh tokens.
--   * Every successful /api/auth/refresh ROTATES: the presented token is revoked
--     ("revokedAt" set) and a brand-new token is issued. "replacedByHash" links
--     the old row to its successor, forming a per-login chain ("family").
--   * Reuse detection: if an ALREADY-revoked token is presented again, that means
--     either a replay or a stolen-then-rotated token. The service revokes the
--     ENTIRE family (revokeFamily) so neither attacker nor victim can continue —
--     they must re-login. This is the standard refresh-token-rotation defense.
--
-- LIFECYCLE
--   login            -> INSERT one row (the family root)
--   refresh          -> revoke presented row, INSERT successor (chain continues)
--   logout           -> revoke the presented row
--   delete-account   -> CASCADE removes all rows (FK ON DELETE CASCADE)
--   expired/old rows -> harmless; a periodic cleanup MAY prune WHERE
--                       "expiresAt" < now() OR "revokedAt" IS NOT NULL, but is
--                       not required for correctness (expiry is checked at use).
--
-- Idempotent: guarded on table existence so re-running is a no-op.

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- SHA-256 hex of the raw refresh token. Unique so a presented token maps to at
  -- most one row; this is the lookup key used by the refresh/logout flows.
  "tokenHash"      text NOT NULL,
  "expiresAt"      timestamptz NOT NULL,
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  -- Set when the token is rotated (on refresh) or invalidated (logout / reuse
  -- detection / log-out-all). NULL means "currently valid".
  "revokedAt"      timestamptz,
  -- On rotation, the SHA-256 hash of the successor token. Lets us walk a family
  -- forward; presence also marks "this token was already spent".
  "replacedByHash" text,
  -- Best-effort device label (request User-Agent) for future "active sessions" UI.
  "userAgent"      text
);

-- Primary lookup: a presented raw token is hashed then matched here.
CREATE UNIQUE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens("tokenHash");
-- Revoke-all-for-user (logout everywhere, account actions) and family scans.
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens("userId");

COMMENT ON TABLE refresh_tokens IS
  'Stateful refresh-token store for rotating 30-day refresh tokens (access tokens stay stateless 15m JWTs). Stores only the SHA-256 hash of each token. Rotation on every refresh; reuse of a revoked token revokes the whole family (theft detection). Migration 85.';
