-- Hourly escalating inactivity-penalty cron (prod only).
--
-- PER-LANGUAGE since migration 130 (docs/PER_LANGUAGE_STREAKS.md). Every unit of
-- state this cron reads and writes is keyed (userId, language) via
-- user_language_points: the wallet, the streak, the reference day and the
-- once-per-day guard. A user studying zh and es has two INDEPENDENT tracks, and a
-- lapse in both debits both on the same tick. The old global columns on `users`
-- (totalMinutePoints / currentStreak / lastStreakDate / lastPenaltyDate) are no
-- longer read here and are dropped by migration 131.
--
-- ONE branch: an escalating penalty for consecutive full local days spent
-- BELOW the RETENTION_MINUTES (3-min) streak threshold IN THAT LANGUAGE. "Missing"
-- a day means not reaching the threshold in that language that day, tracked purely
-- by user_language_points."lastStreakDate" (the last local day the user hit 3 min
-- in that language). lastStreakDate is advanced ONLY by the minute-points increment
-- path -- this cron never touches it -- so the day gap grows by exactly one each
-- continued local day and snaps back to 0 the moment the user hits the threshold
-- in that language again.
--
-- Tier is DERIVED from dates, not stored:
--     tier = today_local - lastStreakDate - 1     (# of full missed days)
-- Penalty schedule by tier (minutes):
--     1 -> 3    2 -> 15   3 -> 30   4 -> 60   5 -> 90   6 -> 120
--     7+ -> everything remaining down to the checkpoint (see below)
-- Cumulative through tier 6 = 318. Keep this schedule in sync with
-- STREAK_CONFIG.PENALTY_SCHEDULE_MINUTES in server/constants.ts (and the client
-- mirror in src/constants.ts).
--
-- CHECKPOINTS (24 h = 1440 minute points). No penalty -- not even the tier-7 wipe --
-- may take a balance below the highest multiple of 1440 at or under it. 1560 (26 h)
-- floors at 1440; 3300 (55 h) floors at 2880 (48 h); anything under 1440 is
-- unprotected and can still reach 0. Consequences worth knowing:
--   * a checkpoint is ABSORBING. Once a balance lands exactly on one it can never be
--     debited again, so the wallet -- and the night market entitlement that Branch 2
--     derives from it -- freezes there for good, no matter how long the lapse runs.
--     "An inactive account zeroes out within a week" is now true only below 24 h.
--   * no high-water column is needed: the balance only rises by earning and falls by
--     this cron, and this cron can no longer cross a checkpoint, so the checkpoint of
--     the CURRENT balance is always the highest one ever reached.
--   * the author dev tool (UserMinutePointsService.adjustMinutesForAuthor, the nmp
--     -N button) deliberately does NOT honour checkpoints -- it is a raw test signal
--     that must be able to drive a balance anywhere.
--
-- Applied at most once per (user, language) per local day, guarded by
-- user_language_points."lastPenaltyDate". Each tick, for each eligible pair:
--   * debits the tier penalty from THAT LANGUAGE's totalMinutePoints, floored at the
--     balance's CHECKPOINT (see below), which is 0 below the first checkpoint;
--   * stamps the ACTUAL amount removed (total - new_total) as penaltyMinutes on
--     the just-completed missed day (yesterday local = today_local - 1) for THAT
--     language, so the calendar shows the real deduction even when a small balance
--     underflows or a checkpoint absorbs part of the tier. A FULLY absorbed penalty
--     (0 removed) stamps NOTHING -- an all-zero row is indistinguishable from an absent
--     one in this table, so it would be dead weight written daily and forever.
--     The language is now KNOWN rather than guessed from
--     users."selectedLanguage" -- that guess was the write/read mismatch this
--     design replaces;
--   * resets that language's currentStreak to 0 (a missed day always breaks it);
--   * bumps that language's lastPenaltyDate to today_local (idempotency -- later
--     ticks the same local day are no-ops).
--
-- Timezone still comes from users.timezone: the local-day boundary is a property
-- of the person, not of the language they are studying.
--
-- Languages that have never crossed the threshold (lastStreakDate IS NULL) are
-- exempt -- there is no reference day to escalate from. This is what implements
-- the "only languages ever studied" scope: a language enters the penalty system
-- the first time it hits 3 minutes.
--
-- Logging: when >= 1 (user, language) pair is penalized, a NOTICE line names the
-- count, user IDs, languages, stamped missed dates, and the number of night-market
-- occupants decayed. Idle ticks print only BEGIN / DO / COMMIT.
--
-- -- Night-market unlock decay (second branch) --------------------------------
-- In the SAME transaction that debits minutes, trim each penalized (user, language)
-- pair's night-market OCCUPANTS (nightmarketunlocks rows for THAT language) down to
-- target = unlocks(new_total_for_that_language). Each language grows its own market
-- (migration 130), so decay is partitioned by (userId, language) and one language's
-- lapse never touches another language's stalls. This mirrors the grant flow
-- (NightMarketPlacementService.grantUnlocks): earning minutes fills slots, losing
-- minutes frees them. Only OCCUPANTS are deleted -- placed templates
-- (nightmarkettemplatelocations) are append-only and NEVER removed, so an emptied
-- template simply renders its unoccupied version on the next layout read
-- (recompute-on-read settles the version; this SQL stays pure -- it never computes
-- a version). Freed slots return to the pool and a future grant backfills them.
--
-- The unlocks(m) schedule is NOT restated here. This file installs (CREATE OR REPLACE,
-- every tick) the SQL function nightmarket_unlocks_for_minutes(int) from a GENERATED
-- block below whose single source is server/dal/shared/unlockSchedule.ts, and the decay
-- CTE just calls it. To change a breakpoint: edit that TS table, run
-- `npm run gen:unlock-schedule-sql` (rewrites the block), redeploy this file. The guard
-- test src/__tests__/unlockScheduleSqlSync.test.ts fails while the block is stale.

BEGIN;

-- >>> BEGIN GENERATED: nightmarket_unlocks_for_minutes >>>
-- GENERATED — DO NOT EDIT BY HAND.
--   source:     server/dal/shared/unlockSchedule.ts (UNLOCK_BREAKPOINTS + steady state)
--   regenerate: npm run gen:unlock-schedule-sql
-- Guarded by src/__tests__/unlockScheduleSqlSync.test.ts, which fails if this block is stale.
CREATE OR REPLACE FUNCTION nightmarket_unlocks_for_minutes(minutes int)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT GREATEST(0,
    CASE
      WHEN minutes >= 60 THEN 17 + floor((minutes - 60) / 60)::int
      WHEN minutes >= 52 THEN 16
      WHEN minutes >= 47 THEN 15
      WHEN minutes >= 42 THEN 14
      WHEN minutes >= 38 THEN 13
      WHEN minutes >= 34 THEN 12
      WHEN minutes >= 30 THEN 11
      WHEN minutes >= 26 THEN 10
      WHEN minutes >= 22 THEN 9
      WHEN minutes >= 18 THEN 8
      WHEN minutes >= 14 THEN 7
      WHEN minutes >= 10 THEN 6
      WHEN minutes >= 7 THEN 5
      WHEN minutes >= 5 THEN 4
      WHEN minutes >= 3 THEN 3
      WHEN minutes >= 2 THEN 2
      WHEN minutes >= 1 THEN 1
      ELSE 0
    END)
$fn$;
-- <<< END GENERATED <<<

DO $$
DECLARE
  penalty_count  int;
  penalty_ids    uuid[];
  penalty_langs  text[];
  penalty_dates  date[];
  decay_count    int;
BEGIN
  WITH candidates AS (
    -- One candidate row per (user, language) progress row with something to lose.
    -- users is joined only for the timezone: the local-day boundary belongs to the
    -- person, not the language.
    SELECT p."userId" AS user_id,
           p.language,
           p."totalMinutePoints" AS total_points,
           (((now() AT TIME ZONE u.timezone) - INTERVAL '4 hours')::date) AS today_local,
           p."lastStreakDate"::date AS last_streak_date,
           p."lastPenaltyDate" AS last_penalty_date
    FROM user_language_points p
    JOIN users u ON u.id = p."userId"
    WHERE p."totalMinutePoints" > 0
      AND p."lastStreakDate" IS NOT NULL
  ),
  eligible AS (
    SELECT user_id, language, total_points, today_local,
           (today_local - last_streak_date - 1) AS tier,          -- # of full missed days
           (today_local - 1)::date              AS missed_date    -- the day that just completed
    FROM candidates
    WHERE (today_local - last_streak_date) >= 2                    -- at least one full missed day
      AND (last_penalty_date IS NULL OR last_penalty_date < today_local)  -- once per local day
  ),
  computed AS (
    SELECT user_id, language, total_points, today_local, missed_date, tier,
           CASE
             WHEN tier = 1 THEN 3
             WHEN tier = 2 THEN 15
             WHEN tier = 3 THEN 30
             WHEN tier = 4 THEN 60
             WHEN tier = 5 THEN 90
             WHEN tier = 6 THEN 120
             ELSE total_points          -- tier >= 7: everything down to the checkpoint
           END AS nominal_penalty,
           -- CHECKPOINT FLOOR: the highest whole day of minute points (24 h = 1440)
           -- at or below the current balance. Penalties may never cross it, so a
           -- balance of 1560 (26 h) stops at 1440 and one of 3300 (55 h) stops at
           -- 2880 (48 h). Integer division truncates, and totals are non-negative,
           -- so this is floor(). Keep 1440 in sync with
           -- STREAK_CONFIG.CHECKPOINT_MINUTES in server/constants.ts (mirrored in
           -- src/constants.ts).
           ((total_points / 1440) * 1440) AS checkpoint_floor
    FROM eligible
  ),
  final AS (
    -- The debit floors at the checkpoint, not at 0, and the amount charged is always
    -- DERIVED (total - new_total) rather than the nominal tier value: it is exactly what
    -- it took to reach the floor. A balance already sitting on a checkpoint therefore
    -- loses nothing (new_total = total_points, actual_penalty = 0) but STILL breaks its
    -- streak below -- that is why such rows stay in scope, and why penalty_insert
    -- filters on actual_penalty > 0 rather than stamping a 0 every day.
    SELECT user_id, language, today_local, missed_date, tier,
           GREATEST(checkpoint_floor, total_points - nominal_penalty) AS new_total,
           total_points
             - GREATEST(checkpoint_floor, total_points - nominal_penalty) AS actual_penalty  -- what actually left the wallet
    FROM computed
  ),
  penalty_insert AS (
    -- Only a penalty that actually removed minutes gets a ledger line. A row with
    -- minutesEarned = 0 AND penaltyMinutes = 0 carries no information this table can
    -- express -- there is no missed-day flag here, and the calendar blanks such a cell
    -- (src/components/MonthlyCalendar.tsx) -- so a fully absorbed penalty would write
    -- one dead row per parked (user, language) per day, forever. The streak break for
    -- those rows still happens in progress_update below.
    INSERT INTO userminutepoints ("userId", "streakDate", "language", "minutesEarned", "penaltyMinutes", "updatedAt")
    SELECT user_id, missed_date, language, 0, actual_penalty, now() FROM final
    WHERE actual_penalty > 0
    ON CONFLICT ("userId", "streakDate", "language")
    DO UPDATE SET "penaltyMinutes" = userminutepoints."penaltyMinutes" + EXCLUDED."penaltyMinutes",
                  "updatedAt"      = now()
    RETURNING "userId"
  ),
  progress_update AS (
    UPDATE user_language_points p
    SET "totalMinutePoints" = f.new_total,
        "currentStreak"     = 0,
        "lastPenaltyDate"   = f.today_local,
        "updatedAt"         = now()
    FROM final f
    WHERE p."userId" = f.user_id AND p.language = f.language
    RETURNING f.user_id, f.language, f.missed_date, f.tier
  ),
  -- Night-market decay: each penalized (user, language) pair's new unlock entitlement
  -- from that language's post-debit total. Calls the generated function installed at the
  -- top of this file, so the ladder is single-sourced from
  -- server/dal/shared/unlockSchedule.ts rather than mirrored by hand here.
  decay_targets AS (
    SELECT user_id, language,
           nightmarket_unlocks_for_minutes(new_total) AS target
    FROM final
  ),
  -- Rank each pair's occupants randomly WITHIN ITS OWN MARKET; anything ranked
  -- beyond `target` is surplus to delete. Partitioning by (userId, language) is what
  -- keeps one language's lapse from trimming another language's stalls.
  decay_ranked AS (
    SELECT u.id AS unlock_id,
           row_number() OVER (
             PARTITION BY u."userId", u.language ORDER BY random()
           ) AS rn,
           dt.target
    FROM nightmarketunlocks u
    JOIN decay_targets dt
      ON dt.user_id = u."userId" AND dt.language = u.language
  ),
  -- Delete surplus occupants at random (rn > target). Templates are untouched
  -- (append-only); the unlocks->locations FK cascades the OTHER way, so no placement
  -- is removed here.
  decay_delete AS (
    DELETE FROM nightmarketunlocks
    WHERE id IN (SELECT unlock_id FROM decay_ranked WHERE rn > target)
    RETURNING id
  )
  -- Reference BOTH data-modifying CTEs so each executes; scalar sub-selects keep the
  -- counts independent (progress_update drives the penalty log, decay_delete the decay count).
  SELECT (SELECT COUNT(*)               FROM progress_update),
         (SELECT array_agg(user_id)     FROM progress_update),
         (SELECT array_agg(language)    FROM progress_update),
         (SELECT array_agg(missed_date) FROM progress_update),
         (SELECT COUNT(*)               FROM decay_delete)
  INTO   penalty_count, penalty_ids, penalty_langs, penalty_dates, decay_count;

  IF penalty_count > 0 THEN
    RAISE NOTICE 'inactivity-cron escalating-penalty % count=% user_ids=% languages=% missed_dates=% decayed_unlocks=%',
                 now(), penalty_count, penalty_ids, penalty_langs, penalty_dates, decay_count;
  END IF;
END
$$;

COMMIT;
