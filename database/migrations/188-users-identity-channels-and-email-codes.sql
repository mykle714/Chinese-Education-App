-- Migration 188: account identity channels (phone, verification, username) + email_codes.
--
-- WHY: the login rework (docs/LOGIN_REWORK.md § 4d, approved by the owner 2026-11-13) adds
-- phone-number sign-up (passwordless, Firebase-verified), email verification (codes we send
-- through Resend), and a required, globally unique, always-changeable username that is the
-- public handle shown to other users in place of an email.
--
-- WHAT:
--   users
--     email            → nullable (phone-only accounts), CHECK lowercase (the DAL already
--                        lowercases on every write; this makes it a fact). Aborts on a
--                        case-insensitive collision instead of merging accounts.
--     password         → nullable (phone-only accounts have none)
--     name             → nullable (optional since the rework, Q19)
--     + username       text NOT NULL UNIQUE, ^[a-z][a-z0-9_]{2,19}$, backfilled from name
--     + phone          text NULL UNIQUE, E.164
--     + emailVerifiedAt timestamptz (existing email accounts are stamped verified, Q4)
--     + phoneVerifiedAt timestamptz
--     CHECK every account has a channel; CHECK a password belongs to the email channel
--   email_codes (new): one row per emailed 6-digit code (sign-in / sign-up, password reset,
--     verifying a new address, step-up re-auth). Only an HMAC of the code is stored.
--
-- users."isPublic" is NOT dropped here: that is migration 189, a CONTRACT migration that
-- must run after the new code ships (docs/LOGIN_REWORK_DEPLOY_RUNBOOK.md).
--
-- DEPLOY: expand-only, safe before the rebuild with one caveat: between this migration and
-- the rebuild, the OLD register endpoint fails (it inserts no username, which is now NOT
-- NULL). Sign-in and every other read keep working. See the runbook.
--
-- Referenced by: docs/LOGIN_REWORK.md § 4d, docs/LOGIN_REWORK_DEPLOY_RUNBOOK.md,
-- server/dal/implementations/UserDAL.ts, server/dal/implementations/EmailCodeDAL.ts,
-- server/contracts/wire.ts (USERNAME_PATTERN, RESERVED_USERNAMES — keep the reserved list
-- below in step with it).

-- ── Emails: lowercase, and refuse to guess on a collision ──────────────────────────────
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM users GROUP BY lower(email) HAVING count(*) > 1) THEN
        RAISE EXCEPTION 'migration 188: two accounts share an email case-insensitively; resolve by hand first (see docs/LOGIN_REWORK_DEPLOY_RUNBOOK.md pre-check)';
    END IF;
END;
$$;
UPDATE users SET email = lower(email) WHERE email <> lower(email);

ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ALTER COLUMN password DROP NOT NULL;
ALTER TABLE users ALTER COLUMN name DROP NOT NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS "emailVerifiedAt" timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS "phoneVerifiedAt" timestamptz;

-- Every existing account signed up with an email, and the owner chose to treat them all as
-- verified rather than send them through the new verification step (Q4).
UPDATE users SET "emailVerifiedAt" = now() WHERE email IS NOT NULL AND "emailVerifiedAt" IS NULL;

-- ── Username backfill (Q22: derived from the name, no prompt) ──────────────────────────
-- lowercase, runs of anything outside [a-z0-9] → "_", trimmed of "_"; prefixed "u_" when it
-- does not start with a letter; "learner" when nothing usable is left; cut to 20. A clash
-- (or a reserved word) takes the lowest free numeric suffix, the base cut short to fit.
-- One row at a time, oldest account first, so each row sees the names already assigned.
DO $$
DECLARE
    r record;
    base text;
    candidate text;
    n int;
    reserved constant text[] := ARRAY['admin','administrator','support','help','root','system',
                                      'moderator','mod','staff','official','api','null','undefined',
                                      'me','you','everyone'];
BEGIN
    FOR r IN SELECT id, name FROM users WHERE username IS NULL ORDER BY "createdAt", id LOOP
        base := btrim(regexp_replace(lower(coalesce(r.name, '')), '[^a-z0-9]+', '_', 'g'), '_');
        IF base !~ '^[a-z]' THEN
            base := CASE WHEN base = '' THEN 'learner' ELSE 'u_' || base END;
        END IF;
        base := left(base, 20);
        IF length(base) < 3 THEN
            base := rpad(base, 3, '_');
        END IF;
        candidate := base;
        n := 1;
        WHILE candidate = ANY(reserved) OR EXISTS (SELECT 1 FROM users WHERE username = candidate) LOOP
            n := n + 1;
            candidate := left(base, 20 - length(n::text)) || n::text;
        END LOOP;
        UPDATE users SET username = candidate WHERE id = r.id;
    END LOOP;
END;
$$;

ALTER TABLE users ALTER COLUMN username SET NOT NULL;

ALTER TABLE users ADD CONSTRAINT chk_users_username_shape
    CHECK (username ~ '^[a-z][a-z0-9_]{2,19}$');
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_username ON users (username);

ALTER TABLE users ADD CONSTRAINT chk_users_phone_e164
    CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{6,14}$');
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_phone ON users (phone) WHERE phone IS NOT NULL;

ALTER TABLE users ADD CONSTRAINT chk_users_email_lowercase
    CHECK (email IS NULL OR email = lower(email));
ALTER TABLE users ADD CONSTRAINT chk_users_has_channel
    CHECK (email IS NOT NULL OR phone IS NOT NULL);
ALTER TABLE users ADD CONSTRAINT chk_users_password_needs_email
    CHECK (password IS NULL OR email IS NOT NULL);

-- ── email_codes ─────────────────────────────────────────────────────────────────────────
-- purpose:
--   'sign-in'          "Email me a code" — signs a known address in, or starts sign-up for an
--                      unknown one (the response never says which, Q13/Q17)
--   'reset'            forgot password
--   'verify-new-email' adding or changing the account's email (sent to the NEW address)
--   'step-up'          re-authentication before a sensitive change (sent to the CURRENT address)
-- Rules (Q16): 6 digits, valid 10 min, 5 wrong tries kills it, 5 codes per address per hour.
-- The hourly limit is a COUNT over (email, "createdAt"), hence the index.
CREATE TABLE IF NOT EXISTS email_codes (
    id           bigserial PRIMARY KEY,
    email        text NOT NULL CHECK (email = lower(email)),
    purpose      text NOT NULL CHECK (purpose IN ('sign-in', 'reset', 'verify-new-email', 'step-up')),
    "codeHash"   text NOT NULL,
    "expiresAt"  timestamptz NOT NULL,
    attempts     integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    "consumedAt" timestamptz,
    "createdAt"  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_codes_email_created ON email_codes (email, "createdAt" DESC);
