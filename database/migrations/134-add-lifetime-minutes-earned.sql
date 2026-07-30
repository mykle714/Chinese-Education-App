-- Migration 134: user_language_points."lifetimeMinutesEarned" — maintained
--                lifetime-earned counter, per language
--
-- WHY
--   The "lifetime minutes earned" figure (shown on the tdp beside the net balance)
--   was computed as SUM("minutesEarned") over every userminutepoints row the user
--   had ever written. That was the ONLY aggregate in the minute-points system whose
--   cost grows without bound — linearly with account age (~365 rows/user/language/
--   year) — and it ran on every language-summary load. Every other read of that
--   table is bounded either to a single day or to a single calendar month.
--
--   It was also a second source of truth: the net wallet is already a maintained
--   counter (incremented on each earn, debited by the hourly penalty cron), so the
--   system had one number kept as a counter and its sibling kept as a scan. This
--   migration makes them symmetrical.
--
-- WHY IT LIVES ON user_language_points AND NOT ON users
--   Migration 130 moved the net wallet + streak state off `users` and onto
--   user_language_points, keyed (userId, language). The gross counter belongs
--   beside its net sibling for two reasons:
--     1. Drift. Every earn must raise BOTH counters. Same row => one UPDATE, so the
--        pair cannot drift. A global counter on `users` would need a second
--        statement against a second table on every study tick.
--     2. Both counters are read together, always for the same (userId, language).
--   A user's global gross is SUM over their language rows — bounded by how many
--   languages they study (~1–2 rows), not by account age, so the scaling goal that
--   motivated this counter is preserved.
--
-- ⚠️ THE gross >= net INVARIANT IS GLOBAL, NOT PER-ROW
--   You would expect lifetimeMinutesEarned >= totalMinutePoints on every row, since
--   gross only ever rises and net is gross-minus-penalties. That holds for every
--   write path, but NOT for migration 130's backfill of a multi-language account:
--   130 step 3a moves the user's whole pre-split global wallet onto their PRIMARY
--   language and starts every other language at 0 (step 3b). Gross, by contrast, is
--   seeded from the per-language ledger, which is genuinely per-language. A user who
--   earned 100 in zh and 50 in es therefore lands on net(zh)=150 / gross(zh)=100.
--   So the row-level check would fire on exactly the accounts the split was for.
--   What IS true immediately after backfill, and is what this migration asserts:
--       SUM(lifetimeMinutesEarned) >= SUM(totalMinutePoints)   -- per user
--   because global gross = all minutes ever earned and global net = that minus
--   penalties. The per-row relation self-heals as the user keeps studying (each earn
--   raises gross while net can only fall from penalties), and it holds from the
--   start for the single-language accounts that are the overwhelming majority.
--
-- THE TWO COUNTERS (both on user_language_points, both per language)
--   "totalMinutePoints"     NET   — earns raise it, penalties lower it (floored at 0).
--                                   Drives the night-market unlock entitlement.
--   "lifetimeMinutesEarned" GROSS — earns raise it; NOTHING lowers it. Monotonic.
--
-- WHAT DOES *NOT* CHANGE
--   userminutepoints stays exactly as it is. It remains the per-day ledger behind
--   the study calendar, the per-language fire badge, per-language study totals, the
--   streak-threshold check, and the cron's per-day penalty attribution. Those are
--   all day- or month-scoped reads on the (userId, streakDate, language) PK and were
--   never the scaling concern. Only the unbounded lifetime SUM is retired
--   (IUserMinutePointsDAL.getGrossMinutesEarned, deleted in this change).
--
-- WRITE SITES (server/services/UserMinutePointsService.ts)
--   study tick +1        → both counters rise (one UPDATE on user_language_points)
--   author adjust +delta → both counters rise (same statement)
--   author adjust -delta → NET only
--   hourly penalty cron  → NET only (see docs/STREAK_EXPIRATION_CRON.md)
--   The split is enforced by which DAL method a caller reaches for: the earn-only
--   increment (which already rejects negative input) bumps both in ONE statement so
--   the pair cannot drift; the signed adjust deliberately touches net alone.
--
-- BACKFILL
--   Seeded per (userId, language) from the same SUM it replaces, so no user's
--   displayed figure moves. Penalties are correctly ignored: gross has never
--   included them, and migration 130 left "minutesEarned" untouched.
--
-- ORDERING
--   Must run AFTER migration 130, which creates user_language_points and inserts a
--   row for every language the user has earned a minute in (its step 3b). This
--   migration therefore has a row to update for every ledger language.
--
-- Idempotent: safe to re-run. The backfill is guarded so a re-run does not clobber
-- counter increments that happened after the column was first added.

BEGIN;

ALTER TABLE user_language_points
  ADD COLUMN IF NOT EXISTS "lifetimeMinutesEarned" INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN user_language_points."lifetimeMinutesEarned" IS
  'GROSS lifetime minutes earned in this language. Monotonic — earns raise it, penalties never lower it. Maintained counter; replaced SUM(userminutepoints."minutesEarned"). Pairs with the penalty-debited net "totalMinutePoints" in the same row. See docs/MINUTE_POINTS_SYSTEM.md';

-- One-time seed from the ledger, per language. The `= 0` guard makes a re-run a
-- no-op for any row whose counter has already moved, while still catching rows at a
-- genuine zero (SUM over their ledger rows is 0 too, so writing 0 again is harmless).
UPDATE user_language_points p
SET "lifetimeMinutesEarned" = COALESCE(
      (SELECT SUM(m."minutesEarned")
       FROM userminutepoints m
       WHERE m."userId" = p."userId"
         AND m.language = p.language),
      0
    )
WHERE p."lifetimeMinutesEarned" = 0;

-- Guard: per USER, gross must not sit below net (see the invariant note in the header
-- for why this is checked per user and not per row). A failure here means this
-- backfill and migration 130's wallet backfill disagree — investigate before
-- shipping a figure that reads as "earned less than I currently hold".
DO $$
DECLARE
  bad bigint;
BEGIN
  SELECT COUNT(*) INTO bad
  FROM (
    SELECT "userId"
    FROM user_language_points
    GROUP BY "userId"
    HAVING SUM("lifetimeMinutesEarned") < SUM("totalMinutePoints")
  ) offenders;

  IF bad > 0 THEN
    RAISE EXCEPTION 'migration 134: % users have total gross < total net minutes', bad;
  END IF;

  RAISE NOTICE 'migration 134 OK: % rows seeded, % gross minutes total',
               (SELECT COUNT(*) FROM user_language_points),
               (SELECT COALESCE(SUM("lifetimeMinutesEarned"), 0) FROM user_language_points);
END
$$;

COMMIT;
