-- Migration 189: drop users."isPublic" — CONTRACT migration, runs AFTER the new code ships.
--
-- WHY: the owner removed public/private accounts as a concept on 2026-11-13
-- (docs/LOGIN_REWORK.md Q7): every account is public. The column's one live effect was hiding
-- a private user's streak on the leaderboard, and its client reading ("demo account":
-- ProtectedRoute requireFullAccount, the 'account' route access level, games' requiresAuth)
-- was dead code. All of it was removed in the same change.
--
-- ORDER: the code that ships with migration 188 no longer selects "isPublic" anywhere. The OLD
-- code still does (UserDAL.findById, getLeaderboardRoster), so this must not run until the
-- containers are rebuilt — see docs/LOGIN_REWORK_DEPLOY_RUNBOOK.md. It is the highest number
-- in its batch for that reason (migrate.sh applies in order and cannot skip).
--
-- Referenced by: docs/LOGIN_REWORK.md § 7, docs/LOGIN_REWORK_DEPLOY_RUNBOOK.md,
-- docs/PUBLIC_PRIVATE_USERS_IMPLEMENTATION.md (now a tombstone).

ALTER TABLE users DROP COLUMN IF EXISTS "isPublic";
