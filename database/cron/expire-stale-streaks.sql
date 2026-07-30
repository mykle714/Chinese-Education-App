-- Hourly escalating inactivity-penalty cron (prod only).
--
-- PER LANGUAGE as of migration 134. The unit of penalty is a (user, language) row in
-- user_language_minute_totals, NOT a user. A learner who keeps up their Chinese and
-- abandons their Spanish loses Spanish minutes only, and the two languages escalate on
-- independent clocks. One tick can therefore penalize several rows for the same user.
--
-- ONE branch: an escalating penalty for consecutive full local days that a LANGUAGE
-- spent BELOW the RETENTION_MINUTES (3-min) threshold. "Missing" a day means that
-- language did not reach the threshold that day, tracked purely by that language's
-- "lastStreakDate" (the last local day it hit 3 min ON ITS OWN — the threshold is no
-- longer a cross-language sum). "lastStreakDate" is advanced ONLY by the minute-points
-- increment path -- this cron never touches it -- so the day gap grows by exactly one
-- each continued local day and snaps back to 0 the moment that language hits the
-- threshold again.
--
-- Tier is DERIVED from dates, not stored:
--     tier = today_local - lastStreakDate - 1     (# of full missed days for THAT language)
-- Penalty schedule by tier (minutes):
--     1 -> 3    2 -> 15   3 -> 30   4 -> 60   5 -> 90   6 -> 120
--     7+ -> everything remaining (that language's balance set to 0)
-- Cumulative through tier 6 = 318; tier 7 wipes any remainder. Keep this
-- schedule in sync with STREAK_CONFIG.PENALTY_SCHEDULE_MINUTES in
-- server/constants.ts (and the client mirror in src/constants.ts).
--
-- Applied at most once per (user, language) per local day, guarded by that row's
-- "lastPenaltyDate". Each tick, for each eligible language:
--   * debits the tier penalty from that language's "netMinutePoints", floored at 0;
--   * stamps the ACTUAL amount removed (total - new_total) as penaltyMinutes on
--     the just-completed missed day (yesterday local = today_local - 1) for THAT
--     language, so the calendar shows the real deduction even when a small balance
--     underflows the nominal tier;
--   * resets that language's "currentStreak" to 0 (a missed day always breaks it);
--   * bumps that row's "lastPenaltyDate" to today_local (idempotency -- later ticks
--     the same local day are no-ops).
--
-- NEVER touches "lifetimeMinutesEarned". Gross is monotonic by definition: it records
-- what was earned, which a penalty does not undo. Only "netMinutePoints" moves here.
--
-- The local-day boundary still comes from users.timezone (one timezone per user; the
-- languages share it), which is why this joins users.
--
-- Logging: when >= 1 language row is penalized, a NOTICE line names the count, user IDs,
-- languages, stamped missed dates, and the number of night-market occupants decayed.
-- Idle ticks print only BEGIN / DO / COMMIT.
--
-- ── Night-market unlock decay (second branch) ────────────────────────────────
-- In the SAME transaction that debits minutes, trim each penalized user's night-
-- market OCCUPANTS (nightmarketunlocks rows) down to their new entitlement
-- target = unlocks(new GLOBAL total). This mirrors the grant flow
-- (NightMarketPlacementService.grantUnlocks): earning minutes fills slots, losing
-- minutes frees them.
--
-- ENTITLEMENT IS PER (USER, LANGUAGE) as of migration 136. Each language has its own market
-- (nightmarkettemplatelocations.language / nightmarketunlocks.language), so each penalized
-- language decays its OWN market from its OWN post-debit balance -- matching what the
-- application-side grant path feeds grantUnlocks(userId, language, net). Decaying Spanish must
-- never delete a Chinese occupant, which is why every join below carries the language.
--
-- Only OCCUPANTS are deleted -- placed templates (nightmarkettemplatelocations) are
-- append-only and NEVER removed, so an emptied template simply renders its unoccupied
-- version on the next layout read (recompute-on-read settles the version; this SQL stays
-- pure -- it never computes a version). Freed slots return to the pool and a future grant
-- backfills them.
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
    -- One candidate per (user, language) balance, not per user. timezone is a user
    -- attribute, so the local-day boundary is shared across that user's languages.
    SELECT t."userId"   AS user_id,
           t.language   AS language,
           t."netMinutePoints" AS total_points,
           (((now() AT TIME ZONE u.timezone) - INTERVAL '4 hours')::date) AS today_local,
           t."lastStreakDate"::date AS last_streak_date,
           t."lastPenaltyDate"      AS last_penalty_date
    FROM user_language_minute_totals t
    JOIN users u ON u.id = t."userId"
    WHERE t."netMinutePoints" > 0          -- nothing to debit
      AND t."lastStreakDate" IS NOT NULL   -- never qualified: no reference day to escalate from
  ),
  eligible AS (
    SELECT user_id, language, total_points, today_local,
           (today_local - last_streak_date - 1) AS tier,          -- # of full missed days
           (today_local - 1)::date              AS missed_date    -- the day that just completed
    FROM candidates
    WHERE (today_local - last_streak_date) >= 2                    -- at least one full missed day
      AND (last_penalty_date IS NULL OR last_penalty_date < today_local)  -- once per language per local day
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
             ELSE total_points          -- tier >= 7: wipe that language's remaining balance
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
    -- Audit row on the missed day, attributed to the language actually penalized
    -- (previously the user's selectedLanguage, which was a guess).
    INSERT INTO userminutepoints ("userId", "streakDate", "language", "minutesEarned", "penaltyMinutes", "updatedAt")
    SELECT user_id, missed_date, language, 0, actual_penalty, now() FROM final
    ON CONFLICT ("userId", "streakDate", "language")
    DO UPDATE SET "penaltyMinutes" = userminutepoints."penaltyMinutes" + EXCLUDED."penaltyMinutes",
                  "updatedAt"      = now()
    RETURNING "userId"
  ),
  totals_update AS (
    UPDATE user_language_minute_totals t
    SET "netMinutePoints" = f.new_total,
        "currentStreak"   = 0,
        "lastPenaltyDate" = f.today_local,
        "updatedAt"       = now()
    FROM final f
    WHERE t."userId" = f.user_id AND t.language = f.language
    RETURNING f.user_id, f.language, f.missed_date, f.tier
  ),
  -- Night-market decay: each penalized LANGUAGE's new unlock entitlement, computed from that
  -- language's own post-debit balance (`final.new_total`, already the floored per-language
  -- result). The schedule itself lives ONLY in server/dal/shared/unlockSchedule.ts — this calls
  -- the function generated from it above, so the cron and the grant flow cannot disagree.
  decay_targets AS (
    SELECT user_id, language, nightmarket_unlocks_for_minutes(new_total) AS target
    FROM final
  ),
  -- Rank each MARKET's occupants randomly; anything ranked beyond that market's `target` is
  -- surplus to delete. Partitioning and joining by (userId, language) keeps each language's
  -- decay independent -- a global partition would let one language's target trim another's stalls.
  decay_ranked AS (
    SELECT u.id AS unlock_id,
           row_number() OVER (PARTITION BY l."userId", l.language ORDER BY random()) AS rn,
           dt.target
    FROM nightmarketunlocks u
    JOIN nightmarkettemplatelocations l ON l.id = u."placedTemplateId"
    JOIN decay_targets dt ON dt.user_id = l."userId" AND dt.language = l.language
  ),
  -- Delete surplus occupants at random (rn > target). Templates are untouched (append-only);
  -- the unlocks→locations FK cascades the OTHER way, so no placement is removed here.
  decay_delete AS (
    DELETE FROM nightmarketunlocks
    WHERE id IN (SELECT unlock_id FROM decay_ranked WHERE rn > target)
    RETURNING id
  )
  -- Reference BOTH data-modifying CTEs so each executes; scalar sub-selects keep the counts
  -- independent (totals_update drives the penalty log, decay_delete the decay count).
  SELECT (SELECT COUNT(*)               FROM totals_update),
         (SELECT array_agg(user_id)     FROM totals_update),
         (SELECT array_agg(language)    FROM totals_update),
         (SELECT array_agg(missed_date) FROM totals_update),
         (SELECT COUNT(*)               FROM decay_delete)
  INTO   penalty_count, penalty_ids, penalty_langs, penalty_dates, decay_count;

  IF penalty_count > 0 THEN
    RAISE NOTICE 'inactivity-cron escalating-penalty % count=% user_ids=% languages=% missed_dates=% decayed_unlocks=%',
                 now(), penalty_count, penalty_ids, penalty_langs, penalty_dates, decay_count;
  END IF;
END
$$;

COMMIT;
