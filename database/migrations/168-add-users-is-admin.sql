-- Migration 168: users."isAdmin" — the gate for cross-user operator views.
--
-- The first consumer is the User Usage section on the tester dashboard
-- (docs/USAGE_DASHBOARD.md), which reads EVERY account's activity. That is a
-- different class of access from the two existing grants:
--   isValidator      (104) — curate dictionary data; sees only their own rows.
--   isTemplateAuthor (115) — author Night Market / Immersive World content.
-- Neither grant should imply "may see other people's usage", so this is its own flag.
--
-- Mirrors the 104/115 shape: NOT NULL DEFAULT false, so every account is a non-admin.
--
-- The single grant below is keyed by EMAIL, so it is a no-op on any database where the
-- account does not exist (dev boxes today). On PPE it grants exactly the one operator
-- account. To grant or revoke later, UPDATE the row directly — no code change.
--
-- Expand-only and idempotent. It must run BEFORE the container rebuild: the shipped
-- UserDAL.findById selects users."isAdmin" by name, so old schema + new code would 500
-- every authenticated request (the 152 / 157 shape).

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS "isAdmin" BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN users."isAdmin" IS
    'Whether this user may open cross-user operator views (the User Usage dashboard, docs/USAGE_DASHBOARD.md). Distinct from isValidator and isTemplateAuthor. Default false. Migration 168.';

-- The same operator account is also made a VALIDATOR (migration 104's flag). The tester
-- dashboard already admits admins on its own (isValidator || isAdmin), so this is not
-- needed to see the page; it is granted so the account gets the validator-only tools
-- too: the Reader "Validate" download, lazy AI enrichment, and the Study Challenge
-- "anytime" hatch. Idempotent — a no-op if the account is already a validator.
UPDATE users SET "isAdmin" = true, "isValidator" = true WHERE email = 'michaelren1928@gmail.com';
