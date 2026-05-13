-- Hourly streak-expiration cron (prod only).
--
-- For every user whose streak has not been touched in >= 2 of their own local
-- 4 AM-bounded days, this script:
--   1. Stamps a 10-minute penalty row on the first missed day in
--      userminutepoints.
--   2. Resets users.currentStreak to 0, deducts 10 from totalMinutePoints,
--      and updates users.lastStreakDate to "today" (in the user's tz) so the
--      next run treats the penalty as already applied.
--
-- This mirrors UserMinutePointsService.newDayOperation() — the same logic
-- the client invokes on app load. The job is idempotent: once lastStreakDate
-- is bumped to today, the user falls out of the candidate set until they
-- start a new streak.
--
-- The penalty amount (10) is hard-coded to match the current
-- STREAK_CONFIG.DAILY_PENALTY_MINUTES default. If that constant changes,
-- update this SQL too.
--
-- Logging: when >=1 user is penalized, a single NOTICE line is emitted with
-- the affected user IDs and missed dates. Idle runs print nothing extra.
-- The crontab redirects stderr into logs/streak-expire.log, so the NOTICE
-- lands in the log file alongside the standard BEGIN / DO / COMMIT output.

BEGIN;

DO $$
DECLARE
  penalized_count  int;
  penalized_ids    uuid[];
  penalized_missed date[];
BEGIN
  WITH candidates AS (
    -- "Today" in each user's local day with a 4 AM boundary. Subtracting 4
    -- hours before casting to date matches streakDateOf() server-side.
    SELECT id AS user_id,
           "lastStreakDate"::date AS last_streak_date,
           (((now() AT TIME ZONE timezone) - INTERVAL '4 hours')::date) AS today_local
    FROM users
    WHERE "currentStreak" > 0
      AND "lastStreakDate" IS NOT NULL
      -- Cheap server-tz pre-filter; the authoritative gap check is below.
      AND "lastStreakDate" < (CURRENT_DATE - INTERVAL '1 day')
  ),
  expired AS (
    SELECT user_id,
           last_streak_date,
           today_local,
           (last_streak_date + INTERVAL '1 day')::date AS missed_date
    FROM candidates
    WHERE (today_local - last_streak_date) >= 2
  ),
  penalty_insert AS (
    INSERT INTO userminutepoints ("userId", "streakDate", "minutesEarned", "penaltyMinutes", "updatedAt")
    SELECT user_id, missed_date, 0, 10, now() FROM expired
    ON CONFLICT ("userId", "streakDate")
    DO UPDATE SET "penaltyMinutes" = userminutepoints."penaltyMinutes" + 10,
                  "updatedAt"      = now()
    RETURNING "userId"
  ),
  user_update AS (
    UPDATE users u
    SET "currentStreak"     = 0,
        "totalMinutePoints" = GREATEST(0, u."totalMinutePoints" - 10),
        "lastStreakDate"    = e.today_local
    FROM expired e
    WHERE u.id = e.user_id
    RETURNING e.user_id, e.missed_date
  )
  SELECT COUNT(*), array_agg(user_id), array_agg(missed_date)
  INTO   penalized_count, penalized_ids, penalized_missed
  FROM   user_update;

  IF penalized_count > 0 THEN
    RAISE NOTICE 'streak-expire % penalized=% user_ids=% missed_dates=%',
                 now(), penalized_count, penalized_ids, penalized_missed;
  END IF;
END
$$;

COMMIT;
