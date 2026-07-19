-- Hourly escalating inactivity-penalty cron (prod only).
--
-- ONE branch: an escalating penalty for consecutive full local days spent
-- BELOW the RETENTION_MINUTES (3-min) streak threshold. "Missing" a day means
-- not reaching the threshold that day, tracked purely by users.lastStreakDate
-- (the last local day the user hit 3 min). lastStreakDate is advanced ONLY by
-- the minute-points increment path -- this cron never touches it -- so the day
-- gap grows by exactly one each continued local day and snaps back to 0 the
-- moment the user hits the threshold again.
--
-- Tier is DERIVED from dates, not stored:
--     tier = today_local - lastStreakDate - 1     (# of full missed days)
-- Penalty schedule by tier (minutes):
--     1 -> 3    2 -> 15   3 -> 30   4 -> 60   5 -> 90   6 -> 120
--     7+ -> everything remaining (account set to 0)
-- Cumulative through tier 6 = 318; tier 7 wipes any remainder. Keep this
-- schedule in sync with STREAK_CONFIG.PENALTY_SCHEDULE_MINUTES in
-- server/constants.ts (and the client mirror in src/constants.ts).
--
-- Applied at most once per user per local day (guarded by users.lastPenaltyDate).
-- Each tick:
--   * debits the tier penalty from totalMinutePoints, floored at 0;
--   * stamps the ACTUAL amount removed (total - new_total) as penaltyMinutes on
--     the just-completed missed day (yesterday local = today_local - 1), so the
--     calendar shows the real deduction even when a small balance underflows;
--   * resets currentStreak to 0 (a missed day always breaks the streak);
--   * bumps lastPenaltyDate to today_local (idempotency -- later ticks the same
--     local day are no-ops).
--
-- (There used to be a Branch C that wiped each user's `weeklies` rows at their
-- local week rollover. That table is gone: weekly achievements are now derived
-- as a timestamp filter over the persistent append-only `wins` log -- see
-- WinsDAL.getWeeklyCountsByUser -- so nothing needs to be wiped.)
--
-- Deploy note: because the tier is derived from lastStreakDate, a user inactive
-- for many days lands on their true tier on the very first tick. In steady state
-- the previous flat-10/day cron already drained most long-inactive balances to
-- 0, so few users carry a balance into this change; those that do are recently
-- inactive and sit at low tiers. Users who have never hit the threshold
-- (lastStreakDate IS NULL) are exempt -- there is no reference day to escalate
-- from.
--
-- Logging: when >= 1 user is penalized, a NOTICE line names the count, user IDs,
-- stamped missed dates, and the number of night-market occupants decayed. Idle ticks
-- print only BEGIN / DO / COMMIT.
--
-- ── Night-market unlock decay (second branch) ────────────────────────────────
-- In the SAME transaction that debits minutes, trim each penalized user's night-
-- market OCCUPANTS (nightmarketunlocks rows) down to their new entitlement
-- target = unlocks(new_total). This mirrors the grant flow
-- (NightMarketPlacementService.grantUnlocks): earning minutes fills slots, losing
-- minutes frees them. Only OCCUPANTS are deleted -- placed templates
-- (nightmarkettemplatelocations) are append-only and NEVER removed, so an emptied
-- template simply renders its unoccupied version on the next layout read
-- (recompute-on-read settles the version; this SQL stays pure -- it never computes
-- a version). Freed slots return to the pool and a future grant backfills them.
--
-- The unlocks(m) schedule below is a HARD-CODED MIRROR of
-- server/dal/shared/unlockSchedule.ts (SQL can't import TS). Keep the breakpoints
-- in sync with UNLOCK_BREAKPOINTS + the steady-state formula there.

BEGIN;

DO $$
DECLARE
  penalty_count  int;
  penalty_ids    uuid[];
  penalty_dates  date[];
  decay_count    int;
BEGIN
  WITH candidates AS (
    SELECT id AS user_id,
           COALESCE("selectedLanguage", 'zh') AS language,
           "totalMinutePoints" AS total_points,
           (((now() AT TIME ZONE timezone) - INTERVAL '4 hours')::date) AS today_local,
           "lastStreakDate"::date AS last_streak_date,
           "lastPenaltyDate" AS last_penalty_date
    FROM users
    WHERE "totalMinutePoints" > 0
      AND "lastStreakDate" IS NOT NULL
  ),
  eligible AS (
    SELECT user_id, language, total_points, today_local,
           (today_local - last_streak_date - 1) AS tier,          -- # of full missed days
           (today_local - 1)::date              AS missed_date    -- the day that just completed
    FROM candidates
    WHERE (today_local - last_streak_date) >= 2                    -- at least one full missed day
      AND (last_penalty_date IS NULL OR last_penalty_date < today_local)  -- once per local day
  ),
  -- The streak is global, but the audit row needs a language: attribute the
  -- penalty to whatever language the user currently has selected.
  computed AS (
    SELECT user_id, language, total_points, today_local, missed_date, tier,
           CASE
             WHEN tier = 1 THEN 3
             WHEN tier = 2 THEN 15
             WHEN tier = 3 THEN 30
             WHEN tier = 4 THEN 60
             WHEN tier = 5 THEN 90
             WHEN tier = 6 THEN 120
             ELSE total_points          -- tier >= 7: wipe the remaining balance
           END AS nominal_penalty
    FROM eligible
  ),
  final AS (
    SELECT user_id, language, today_local, missed_date, tier,
           GREATEST(0, total_points - nominal_penalty) AS new_total,      -- floored debit
           LEAST(nominal_penalty, total_points)        AS actual_penalty  -- what actually left the balance
    FROM computed
  ),
  penalty_insert AS (
    INSERT INTO userminutepoints ("userId", "streakDate", "language", "minutesEarned", "penaltyMinutes", "updatedAt")
    SELECT user_id, missed_date, language, 0, actual_penalty, now() FROM final
    ON CONFLICT ("userId", "streakDate", "language")
    DO UPDATE SET "penaltyMinutes" = userminutepoints."penaltyMinutes" + EXCLUDED."penaltyMinutes",
                  "updatedAt"      = now()
    RETURNING "userId"
  ),
  user_update AS (
    UPDATE users u
    SET "totalMinutePoints" = f.new_total,
        "currentStreak"     = 0,
        "lastPenaltyDate"   = f.today_local
    FROM final f
    WHERE u.id = f.user_id
    RETURNING f.user_id, f.missed_date, f.tier
  ),
  -- Night-market decay: each penalized user's new unlock entitlement from their post-debit
  -- total. unlocks(m) mirrors server/dal/shared/unlockSchedule.ts (keep in sync).
  decay_targets AS (
    SELECT user_id,
           CASE
             WHEN new_total >= 60 THEN 17 + floor((new_total - 60) / 60)::int
             WHEN new_total >= 52 THEN 16
             WHEN new_total >= 47 THEN 15
             WHEN new_total >= 42 THEN 14
             WHEN new_total >= 38 THEN 13
             WHEN new_total >= 34 THEN 12
             WHEN new_total >= 30 THEN 11
             WHEN new_total >= 26 THEN 10
             WHEN new_total >= 22 THEN 9
             WHEN new_total >= 18 THEN 8
             WHEN new_total >= 14 THEN 7
             WHEN new_total >= 10 THEN 6
             WHEN new_total >= 7  THEN 5
             WHEN new_total >= 5  THEN 4
             WHEN new_total >= 3  THEN 3
             WHEN new_total >= 2  THEN 2
             WHEN new_total >= 1  THEN 1
             ELSE 0
           END AS target
    FROM final
  ),
  -- Rank each user's occupants randomly; anything ranked beyond `target` is surplus to delete.
  decay_ranked AS (
    SELECT u.id AS unlock_id,
           row_number() OVER (PARTITION BY l."userId" ORDER BY random()) AS rn,
           dt.target
    FROM nightmarketunlocks u
    JOIN nightmarkettemplatelocations l ON l.id = u."placedTemplateId"
    JOIN decay_targets dt ON dt.user_id = l."userId"
  ),
  -- Delete surplus occupants at random (rn > target). Templates are untouched (append-only);
  -- the unlocks→locations FK cascades the OTHER way, so no placement is removed here.
  decay_delete AS (
    DELETE FROM nightmarketunlocks
    WHERE id IN (SELECT unlock_id FROM decay_ranked WHERE rn > target)
    RETURNING id
  )
  -- Reference BOTH data-modifying CTEs so each executes; scalar sub-selects keep the counts
  -- independent (user_update drives the penalty log, decay_delete the decay count).
  SELECT (SELECT COUNT(*)             FROM user_update),
         (SELECT array_agg(user_id)   FROM user_update),
         (SELECT array_agg(missed_date) FROM user_update),
         (SELECT COUNT(*)             FROM decay_delete)
  INTO   penalty_count, penalty_ids, penalty_dates, decay_count;

  IF penalty_count > 0 THEN
    RAISE NOTICE 'inactivity-cron escalating-penalty % count=% user_ids=% missed_dates=% decayed_unlocks=%',
                 now(), penalty_count, penalty_ids, penalty_dates, decay_count;
  END IF;
END
$$;

COMMIT;
