-- Migration 192: a third gender answer, 'nonbinary' (owner, 2026-11-15).
--
-- WHY: the sign-up form (src/pages/login/DetailsStep.tsx) and Settings → About you
-- (src/pages/settings/AboutYouSections.tsx) offer Female · Male · Non-binary · Prefer not to
-- answer. "Prefer not to answer" and "skipped" both stay NULL (the absence of an answer), as
-- migration 164 defined. Mirrors USER_GENDERS in server/contracts/wire.ts; extend both together.
--
-- ORDER: widening a CHECK only loosens the schema, so it is safe to auto-run BEFORE the rebuild
-- (standard /deploy). The new code against the OLD check is the one bad order (saving
-- 'nonbinary' would fail).
--
-- Referenced by: server/contracts/wire.ts (USER_GENDERS), src/utils/demographics.ts
-- (GENDER_CHOICES), docs/LOGIN_REWORK.md Q19.

ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_gender;
ALTER TABLE users ADD CONSTRAINT chk_users_gender CHECK ("gender" IS NULL OR "gender" IN ('male', 'female', 'nonbinary'));

COMMENT ON COLUMN users."gender" IS
  'The learner''s gender: ''male'' | ''female'' | ''nonbinary'' | NULL (not told / prefer not to answer). Mirrors USER_GENDERS in server/contracts/wire.ts. Migrations 164, 192.';
