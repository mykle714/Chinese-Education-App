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
-- and stamped missed dates. Idle ticks print only BEGIN / DO / COMMIT.

BEGIN;

DO $$
DECLARE
  penalty_count  int;
  penalty_ids    uuid[];
  penalty_dates  date[];
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
  )
  SELECT COUNT(*), array_agg(user_id), array_agg(missed_date)
  INTO   penalty_count, penalty_ids, penalty_dates
  FROM   user_update;

  IF penalty_count > 0 THEN
    RAISE NOTICE 'inactivity-cron escalating-penalty % count=% user_ids=% missed_dates=%',
                 now(), penalty_count, penalty_ids, penalty_dates;
  END IF;
END
$$;

COMMIT;
