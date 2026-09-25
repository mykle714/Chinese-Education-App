-- Migration 164: the learner's gender and date of birth.
--
-- Immersive World NPCs address the learner the way a real vendor would address a real
-- customer — and in Chinese that depends on who is standing there: 小姑娘 / 小伙子 /
-- 大姐 / 大哥 / 阿姨 / 叔叔 are chosen by gender AND age. These two columns are what the
-- server reads to describe the learner to an NPC (docs/IMMERSIVE_WORLD.md § 5.5,
-- server/services/iw/learnerProfile.ts), and `gender` also picks the learner's iw body
-- (`iwPlayerAvatar` in server/contracts/iw.ts).
--
-- BOTH NULLABLE, and NULL means "not told" — which covers two cases deliberately left
-- indistinguishable: an account that predates this migration, and a learner who chose
-- "Prefer not to answer" at signup or in Settings. Nothing downstream treats the two
-- differently (an unset learner keeps the pre-164 behaviour: the default body and no
-- description in the NPC prompt), so storing the difference would be a value no code reads.
--
-- `birthDate` is a DATE rather than an age: an age is wrong a year after it is written.
-- It is PRIVATE — returned only to the account itself (UserDAL.findById is self-only on
-- every client path), and the NPC is told a coarse age band, never the date.
--
-- `gender` is text + CHECK rather than a Postgres enum so adding a value later is a
-- one-line constraint swap, not an ALTER TYPE. Allowed values mirror USER_GENDERS in
-- server/contracts/wire.ts.
--
-- Expand-only. No backfill: every existing row is correctly NULL.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS "gender" text NULL,
  ADD COLUMN IF NOT EXISTS "birthDate" date NULL;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS chk_users_gender;
ALTER TABLE users
  ADD CONSTRAINT chk_users_gender CHECK ("gender" IS NULL OR "gender" IN ('male', 'female'));

-- A floor that rejects typos (0199-05-01) and a ceiling that rejects the future. The
-- ceiling is CURRENT_DATE at write time — CHECK constraints may not reference volatile
-- functions reliably across dumps, so the "not in the future" rule lives in
-- UserService.validateDemographics instead, and this only guards the floor.
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS chk_users_birth_date;
ALTER TABLE users
  ADD CONSTRAINT chk_users_birth_date CHECK ("birthDate" IS NULL OR "birthDate" >= DATE '1900-01-01');

COMMENT ON COLUMN users."gender" IS
  'The learner''s gender: ''male'' | ''female'' | NULL (not told / prefer not to answer). Picks the Immersive World body and is described to NPCs so they address the learner naturally. Mirrors USER_GENDERS in server/contracts/wire.ts. Migration 164, docs/IMMERSIVE_WORLD.md § 5.5.';
COMMENT ON COLUMN users."birthDate" IS
  'The learner''s date of birth, NULL = not told / prefer not to answer. PRIVATE: returned only to the account itself; NPCs are told a coarse age band derived from it (server/services/iw/learnerProfile.ts), never the date. Migration 164, docs/IMMERSIVE_WORLD.md § 5.5.';
