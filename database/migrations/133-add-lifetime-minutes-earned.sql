-- Migration 133: users."lifetimeMinutesEarned" — maintained lifetime-earned counter
--
-- WHY
--   The "lifetime minutes earned" figure (shown on the tdp beside the net balance)
--   was computed as SUM("minutesEarned") over every userminutepoints row the user
--   had ever written. That was the ONLY aggregate in the minute-points system whose
--   cost grows without bound — linearly with account age (~365 rows/user/language/
--   year) — and it ran on every language-summary load. Every other read of that
--   table is bounded either to a single day or to a single calendar month.
--
--   It was also a second source of truth: users."totalMinutePoints" is already a
--   maintained counter (incremented on each earn, debited by the hourly penalty
--   cron), so the system had one number kept as a counter and its sibling kept as
--   a scan. This migration makes them symmetrical.
--
-- THE TWO COUNTERS (both on users, both global across languages)
--   "totalMinutePoints"    NET   — earns raise it, penalties lower it (floored at 0).
--                                  Drives the night-market unlock entitlement.
--   "lifetimeMinutesEarned" GROSS — earns raise it; NOTHING lowers it. Monotonic.
--   Invariant: lifetimeMinutesEarned >= totalMinutePoints, always.
--
-- WHAT DOES *NOT* CHANGE
--   userminutepoints stays exactly as it is. It remains the per-day ledger behind
--   the study calendar, the per-language fire badge, per-language study totals, the
--   global streak-threshold check, and the cron's per-day penalty attribution.
--   Those are all day- or month-scoped reads on the (userId, streakDate, language)
--   PK and were never the scaling concern. Only the unbounded lifetime SUM is
--   retired (IUserMinutePointsDAL.getGrossMinutesEarned, deleted in this change).
--
-- WRITE SITES (server/services/UserMinutePointsService.ts)
--   :75  study tick +1        → both counters rise (UserDAL.incrementTotalMinutePoints)
--   :141 author adjust +delta → both counters rise (same method)
--   :146 author adjust -delta → NET only (UserDAL.adjustTotalMinutePoints)
--   hourly penalty cron       → NET only (see docs/STREAK_EXPIRATION_CRON.md)
--   The split is enforced by which DAL method a caller reaches for: the earn-only
--   increment (which already rejects negative input) bumps both in ONE statement so
--   the pair cannot drift; the signed adjust deliberately touches net alone.
--
-- BACKFILL
--   Seeded from the same SUM it replaces, so no user's displayed figure moves.
--   Penalties are correctly ignored: gross has never included them.
--
-- Idempotent: safe to re-run. The backfill is guarded so a re-run does not clobber
-- counter increments that happened after the column was first added.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS "lifetimeMinutesEarned" INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN users."lifetimeMinutesEarned" IS
  'GROSS lifetime minutes earned across all languages. Monotonic — earns raise it, penalties never lower it. Maintained counter; replaced SUM(userminutepoints."minutesEarned"). Pairs with the penalty-debited net "totalMinutePoints". See docs/MINUTE_POINTS_SYSTEM.md';

-- One-time seed from the ledger. The `= 0` guard makes a re-run a no-op for any
-- user whose counter has already moved, while still catching users who were at a
-- genuine zero (SUM over their rows is 0 too, so writing 0 again is harmless).
UPDATE users u
SET "lifetimeMinutesEarned" = COALESCE(
      (SELECT SUM(m."minutesEarned") FROM userminutepoints m WHERE m."userId" = u.id),
      0
    )
WHERE u."lifetimeMinutesEarned" = 0;
