-- Migration 191: any account may have a password, phone accounts included (owner, 2026-11-15).
--
-- WHY: the password moved off the sign-in path. Every account signs in with a code (email or
-- SMS) or, optionally, a password set at sign-up or later in Settings, for BOTH channels; the
-- verification window offers "Sign in with password" for a phone number as well as an email
-- (docs/LOGIN_REWORK.md Q3 / Q9 amended). Migration 188's rule that a password needs an email
-- no longer holds.
--
-- ORDER: dropping a CHECK only loosens the schema, so it is safe to auto-run BEFORE the rebuild
-- (standard /deploy): the old code never writes a password to a phone account anyway. The new
-- code against the OLD check is the one bad order (a phone sign-up with a password would fail).
--
-- Referenced by: server/services/UserService.ts (createUser), docs/LOGIN_REWORK.md § 4d.

ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_password_needs_email;
