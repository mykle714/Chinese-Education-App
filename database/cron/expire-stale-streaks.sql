-- Hourly inactivity-penalty cron (prod only).
--
-- Two independent branches run in one transaction:
--
--   A) Streak break (legacy behavior). For users with an active streak
--      whose lastStreakDate is >= 2 of their own local days behind:
--      stamp a 10-minute penalty row on the first missed day, reset
--      currentStreak to 0, deduct 10 from totalMinutePoints, and roll
--      lastStreakDate to today_local. Also stamps lastPenaltyDate =
--      today_local so branch B does not double-charge them today.
--
--   B) Daily inactivity penalty (new). For users with totalMinutePoints
--      > 0 and lastMinutePointIncrement >= 2 local days behind, whose
--      lastPenaltyDate is NULL or < today_local: stamp a 10-minute row
--      keyed by today_local, deduct 10 from totalMinutePoints, and set
--      lastPenaltyDate = today_local. This fires once per local day of
--      continued inactivity, indefinitely, until totalMinutePoints
--      reaches 0 (at which point the user falls out of scope).
--
-- (There used to be a Branch C that wiped each user's `weeklies` rows at
-- their local week rollover. That table is gone: weekly achievements are
-- now derived as a timestamp filter over the persistent append-only
-- `wins` log -- see WinsDAL.getWeeklyCountsByUser -- so nothing needs to
-- be wiped and lifetime win history is preserved.)
--
-- The job is idempotent: branch A bumps lastStreakDate and branch B bumps
-- lastPenaltyDate, so each subsequent hourly tick within the same local
-- day is a no-op.
--
-- First-run behavior: lastPenaltyDate starts NULL for every existing
-- user. The first tick after deploy charges each currently-inactive
-- user exactly one 10-minute penalty (not a per-day backlog) and stamps
-- lastPenaltyDate. We don't care about catching up missed history --
-- only steady-state behavior matters.
--
-- The penalty amount (10) is hard-coded to match the current
-- STREAK_CONFIG.DAILY_PENALTY_MINUTES default in server/constants.ts.
-- Keep both in sync.
--
-- Logging: when >= 1 user is penalized in either branch, a NOTICE line
-- is emitted naming the branch, count, user IDs, and stamped dates.
-- Idle ticks print only BEGIN / DO / COMMIT.

BEGIN;

DO $$
DECLARE
  streak_count   int;
  streak_ids     uuid[];
  streak_missed  date[];
  penalty_count  int;
  penalty_ids    uuid[];
  penalty_dates  date[];
BEGIN
  ------------------------------------------------------------------
  -- Branch A: streak break (resets currentStreak, deducts 10).
  ------------------------------------------------------------------
  WITH candidates AS (
    SELECT id AS user_id,
           COALESCE("selectedLanguage", 'zh') AS language,
           "lastStreakDate"::date AS last_streak_date,
           (((now() AT TIME ZONE timezone) - INTERVAL '4 hours')::date) AS today_local
    FROM users
    WHERE "currentStreak" > 0
      AND "lastStreakDate" IS NOT NULL
      AND "lastStreakDate" < (CURRENT_DATE - INTERVAL '1 day')
  ),
  expired AS (
    SELECT user_id,
           language,
           last_streak_date,
           today_local,
           (last_streak_date + INTERVAL '1 day')::date AS missed_date
    FROM candidates
    WHERE (today_local - last_streak_date) >= 2
  ),
  -- The streak is global, but the row needs a language: attribute the penalty
  -- to whatever language the user currently has selected.
  penalty_insert AS (
    INSERT INTO userminutepoints ("userId", "streakDate", "language", "minutesEarned", "penaltyMinutes", "updatedAt")
    SELECT user_id, missed_date, language, 0, 10, now() FROM expired
    ON CONFLICT ("userId", "streakDate", "language")
    DO UPDATE SET "penaltyMinutes" = userminutepoints."penaltyMinutes" + 10,
                  "updatedAt"      = now()
    RETURNING "userId"
  ),
  user_update AS (
    UPDATE users u
    SET "currentStreak"     = 0,
        "totalMinutePoints" = GREATEST(0, u."totalMinutePoints" - 10),
        "lastStreakDate"    = e.today_local,
        -- Stamp lastPenaltyDate too so branch B treats the user as
        -- already charged for today and skips them this tick.
        "lastPenaltyDate"   = e.today_local
    FROM expired e
    WHERE u.id = e.user_id
    RETURNING e.user_id, e.missed_date
  )
  SELECT COUNT(*), array_agg(user_id), array_agg(missed_date)
  INTO   streak_count, streak_ids, streak_missed
  FROM   user_update;

  IF streak_count > 0 THEN
    RAISE NOTICE 'inactivity-cron streak-break % count=% user_ids=% missed_dates=%',
                 now(), streak_count, streak_ids, streak_missed;
  END IF;

  ------------------------------------------------------------------
  -- Branch B: daily inactivity penalty (independent of streak).
  --
  -- Inactivity is measured from lastMinutePointIncrement -- the only
  -- signal that captures "the user opened the app and earned points,"
  -- independent of whether they ever had a streak. The 2-local-day
  -- threshold matches branch A: today_local - last_active_local >= 2
  -- means the user missed at least one full local day.
  ------------------------------------------------------------------
  WITH candidates AS (
    SELECT id AS user_id,
           COALESCE("selectedLanguage", 'zh') AS language,
           (((now() AT TIME ZONE timezone) - INTERVAL '4 hours')::date) AS today_local,
           ((("lastMinutePointIncrement" AT TIME ZONE 'UTC' AT TIME ZONE timezone)
              - INTERVAL '4 hours')::date) AS last_active_local,
           "lastPenaltyDate" AS last_penalty_date
    FROM users
    WHERE "totalMinutePoints" > 0
      AND "lastMinutePointIncrement" IS NOT NULL
  ),
  eligible AS (
    SELECT user_id, language, today_local
    FROM candidates
    WHERE (today_local - last_active_local) >= 2
      AND (last_penalty_date IS NULL OR last_penalty_date < today_local)
  ),
  -- Attribute the inactivity penalty to the user's currently selected language.
  penalty_insert AS (
    INSERT INTO userminutepoints ("userId", "streakDate", "language", "minutesEarned", "penaltyMinutes", "updatedAt")
    SELECT user_id, today_local, language, 0, 10, now() FROM eligible
    ON CONFLICT ("userId", "streakDate", "language")
    DO UPDATE SET "penaltyMinutes" = userminutepoints."penaltyMinutes" + 10,
                  "updatedAt"      = now()
    RETURNING "userId"
  ),
  user_update AS (
    UPDATE users u
    SET "totalMinutePoints" = GREATEST(0, u."totalMinutePoints" - 10),
        "lastPenaltyDate"   = e.today_local
    FROM eligible e
    WHERE u.id = e.user_id
    RETURNING e.user_id, e.today_local
  )
  SELECT COUNT(*), array_agg(user_id), array_agg(today_local)
  INTO   penalty_count, penalty_ids, penalty_dates
  FROM   user_update;

  IF penalty_count > 0 THEN
    RAISE NOTICE 'inactivity-cron daily-penalty % count=% user_ids=% penalty_dates=%',
                 now(), penalty_count, penalty_ids, penalty_dates;
  END IF;
END
$$;

COMMIT;
