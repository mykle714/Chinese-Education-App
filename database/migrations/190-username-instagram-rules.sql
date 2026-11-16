-- Migration 190: username shape → Instagram's rules (owner, 2026-11-15).
--
-- WHY: usernames follow Instagram's rules instead of migration 188's narrower shape:
--   OLD  ^[a-z][a-z0-9_]{2,19}$   3–20 chars, a–z / 0–9 / _, starting with a letter
--   NEW  1–30 chars of a–z, 0–9, _ and . ; no period at the start or end; no two periods in a
--        row; may start with a digit or _ (stored lowercase, as before)
-- The same rule is `USERNAME_PATTERN` + `usernameProblem` in server/contracts/wire.ts; change
-- both together (docs/LOGIN_REWORK.md Q21).
--
-- ORDER: the new shape is a strict SUPERSET of the old one, so every stored username already
-- passes and this is safe to auto-run BEFORE the rebuild (the standard /deploy order): the old
-- code keeps offering only old-shape names, which the new CHECK accepts. Running the new code
-- against the OLD check is the one bad order (a name with a period would hit the old CHECK).
--
-- Referenced by: server/contracts/wire.ts (USERNAME_PATTERN), docs/LOGIN_REWORK.md § 4d / Q21.

ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_username_shape;
ALTER TABLE users ADD CONSTRAINT chk_users_username_shape CHECK (
    username ~ '^[a-z0-9._]{1,30}$'
    AND username !~ '^\.'
    AND username !~ '\.$'
    AND username !~ '\.\.'
);
