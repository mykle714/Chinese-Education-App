-- Arena load-test users — 55 synthetic accounts, prod, 2026-08-16.
--
-- Every row is identifiable by the email suffix '@arena-test.local'. That suffix is
-- the ONLY handle teardown uses, so nothing here can reach a real account.
--
-- password is a deliberate non-hash: bcrypt.compare() against it can never succeed,
-- so these 55 accounts cannot be logged into even though their emails are guessable.
-- Do not "fix" it into a real hash.
--
-- Idempotent: ON CONFLICT on email, so re-running adds nothing.

BEGIN;

-- 1. The accounts. All share one timezone so they land in a single
--    (timezone, division) clustering partition — that is what produces multiple
--    full boards instead of 55 users scattered across partitions.
INSERT INTO users (email, name, password, timezone, "selectedLanguage")
SELECT
    'arena-test-' || lpad(n::text, 2, '0') || '@arena-test.local',
    'Arena Test ' || lpad(n::text, 2, '0'),
    'NOLOGIN-arena-test-account',
    'America/Los_Angeles',
    'zh'
FROM generate_series(1, 55) AS n
ON CONFLICT (email) DO NOTHING;

-- 2. Opt each one into the COMING week (2026-08-18), division 1.
--    Scoped by the email suffix, so the 15 real users are untouched — this is the
--    difference between this script and `arena-tick.ts --seed-opt-ins`, which opts
--    in every row in the database.
INSERT INTO user_languages ("userId", language, "arenaOptInWeek", division)
SELECT u.id, 'zh', DATE '2026-08-18', 1
FROM users u
WHERE u.email LIKE '%@arena-test.local'
ON CONFLICT ("userId", language)
DO UPDATE SET "arenaOptInWeek" = EXCLUDED."arenaOptInWeek";

COMMIT;
