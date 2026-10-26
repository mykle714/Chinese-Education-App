-- Migration 178: users."isFeatureTester" — the gate for FEATURE-TESTING tools.
--
-- Until now every tester lever rode users."isValidator" (104), which was created for
-- DATA VALIDATION (curating dictionary entries, docs/DATA_VALIDATION_SYSTEM.md). The
-- feature-testing tools that piggy-backed on it move to this flag:
--   - Study Challenge "Allow anytime" hatch (docs/STUDY_CHALLENGE.md § 2a)
--   - Soft-intro override toggle (docs/SOFT_INTRODUCTION.md)
--   - Daily-banking "always play" toggle (docs/DAILY_MINUTE_BANKING.md)
--   - Tester Dashboard tile + page (isFeatureTester || isAdmin)
--   - Arena manual tick (docs/ARENA_FEATURE.md)
-- The other grants are unchanged and independent:
--   isValidator      (104) — curate dictionary data (validate downloads, lazy AI enrichment).
--   isTemplateAuthor (115) — author Night Market / Immersive World content.
--   isAdmin          (168) — cross-user operator views (User Usage dashboard).
--
-- Mirrors the 104/115/168 shape: NOT NULL DEFAULT false.
--
-- BACKFILL: every current validator is made a feature tester, so nobody who has the
-- tester tools today loses them when the gates move. After this, the two flags are
-- granted/revoked independently by UPDATE-ing the row — no code change.
--
-- Expand-only and idempotent (ADD COLUMN IF NOT EXISTS; the backfill only ever sets
-- true). It must run BEFORE the container rebuild: the shipped UserDAL.findById selects
-- users."isFeatureTester" by name, so old schema + new code would 500 every
-- authenticated request (the 152 / 157 / 168 shape).

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS "isFeatureTester" BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN users."isFeatureTester" IS
    'Whether this user may use feature-testing tools (Study Challenge anytime hatch, soft-intro override, banking always-play, tester dashboard, arena manual tick). Distinct from isValidator (data validation only), isTemplateAuthor and isAdmin. Default false. Migration 178.';

UPDATE users SET "isFeatureTester" = true WHERE "isValidator" = true AND "isFeatureTester" = false;
