-- Migration 134: per-language minute-points counters + per-language streaks
--
-- See docs/MINUTE_POINTS_SYSTEM.md for the full model.
--
-- WHAT CHANGES
--   Every minute-points counter and the streak move from ONE global row on `users`
--   to one row per (userId, language) in the new `user_language_minute_totals`.
--   A user studying zh and es now has two independent balances, two streaks, and
--   two penalty schedules.
--
--   users."totalMinutePoints"      → user_language_minute_totals."netMinutePoints"
--   users."lifetimeMinutesEarned"  → user_language_minute_totals."lifetimeMinutesEarned"
--   users."currentStreak"          → user_language_minute_totals."currentStreak"
--   users."lastStreakDate"         → user_language_minute_totals."lastStreakDate"
--   users."lastPenaltyDate"        → user_language_minute_totals."lastPenaltyDate"
--
-- WHY PER LANGUAGE
--   Two reasons, one per column family:
--     • Counters: the per-language study total was the last figure still computed
--       as a SUM over the whole userminutepoints history (getTotalMinutesForLanguage),
--       so its cost grew with account age. As a counter it is O(1).
--     • Streak/penalty: a learner studying two languages should keep and lose each
--       language's streak on its own merits. The tier is now derived from THAT
--       language's lastStreakDate, so neglecting Spanish penalises Spanish only.
--
-- SEMANTIC CHANGE — THE THRESHOLD IS NOW PER LANGUAGE
--   The daily RETENTION_MINUTES threshold used to be evaluated on the day's total
--   summed ACROSS languages (any 3 minutes kept the single global streak alive).
--   It is now evaluated per language: 3 minutes of zh advance the zh streak only.
--   A user splitting 2 minutes zh + 2 minutes es previously advanced their streak
--   and now advances neither. This is intended, but it IS a behaviour change.
--
-- EXPAND ONLY
--   This migration creates and backfills. It does NOT drop the superseded `users`
--   columns — migration 135 does, and should only run once the code that reads the
--   new table is deployed and verified. Splitting them keeps the rollout safe: old
--   and new code can both run against the database in between.
--
-- Idempotent: safe to re-run. The backfill only inserts rows that do not exist.

CREATE TABLE IF NOT EXISTS user_language_minute_totals (
  "userId"                UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  language                VARCHAR(10) NOT NULL,
  -- NET: earns raise it, penalties lower it (floored at 0). Drives this language's
  -- night-market unlock entitlement.
  "netMinutePoints"       INTEGER     NOT NULL DEFAULT 0,
  -- GROSS: monotonic lifetime earned for this language. Nothing ever lowers it.
  -- Invariant: "lifetimeMinutesEarned" >= "netMinutePoints".
  "lifetimeMinutesEarned" INTEGER     NOT NULL DEFAULT 0,
  -- Consecutive qualifying days for THIS language.
  "currentStreak"         INTEGER     NOT NULL DEFAULT 0,
  -- Last day this language reached RETENTION_MINUTES. Advanced only by the earn
  -- path; the penalty cron never moves it (it derives the escalating tier from the
  -- gap `today - lastStreakDate`, exactly as the global version did).
  "lastStreakDate"        DATE,
  -- Idempotency guard for the hourly penalty cron, per language per local day.
  "lastPenaltyDate"       DATE,
  "createdAt"             TIMESTAMP   DEFAULT NOW(),
  "updatedAt"             TIMESTAMP   DEFAULT NOW(),
  PRIMARY KEY ("userId", language)
);

COMMENT ON TABLE user_language_minute_totals IS
  'Per-(user,language) minute-points counters and streak state. Replaces the global counters on users (migration 134). Counters are maintained, never aggregated from userminutepoints. See docs/MINUTE_POINTS_SYSTEM.md';

-- The cron sweeps by language across all users, so it needs a language-leading index;
-- the PK only serves userId-leading lookups.
CREATE INDEX IF NOT EXISTS idx_ulmt_language_last_streak
  ON user_language_minute_totals (language, "lastStreakDate");

-- ── Backfill ──────────────────────────────────────────────────────────────────
-- One row per (user, language) the user has ever earned a minute in.
--
-- GROSS is taken straight from the ledger (Σ minutesEarned per language) — that IS
-- the definition of gross, and the ledger is authoritative for it.
--
-- NET IS APPORTIONED FROM users."totalMinutePoints", NOT recomputed from the ledger.
-- This looks like the harder route and is the correct one: measured on real data, the
-- live counter and the ledger reconstruction (Σ minutesEarned − Σ penaltyMinutes)
-- disagree in BOTH directions, so the ledger cannot reconstruct net. Two known causes:
--   • Over-stamped penalties. UserMinutePointsDAL.addPenaltyMinutesForDate writes the
--     full requested amount while adjustTotalMinutePoints floors the debit at 0, so a
--     user penalised below zero has more penaltyMinutes on the ledger than was ever
--     actually taken (one dev user reconstructs to −28 against a live balance of 1).
--     The hourly cron avoids this by stamping `total − new_total`; the author tool does not.
--   • Historical debits that never stamped a ledger row at all (the removed
--     UserDAL.applyStreakPenalty), leaving the counter lower than the reconstruction.
-- users."totalMinutePoints" is what drives the night-market entitlement today, so it is
-- the number that must be preserved: Σ per-language net == the old global net, exactly.
--
-- Apportionment: split the live net across languages in proportion to each language's
-- gross, floor each share, then hand the rounding remainder to the language with the
-- most gross (deterministic, tie-broken by language name). A user with gross 0 in every
-- language gets 0 everywhere.
--
-- lastStreakDate is recomputed exactly: the most recent day that language ON ITS OWN
-- reached RETENTION_MINUTES (3). Under the old cross-language threshold a user could
-- hold a streak without any single language qualifying, so this can legitimately differ
-- from users.lastStreakDate in either direction — that is the behaviour change, not a bug.
WITH per_lang AS (
  SELECT
    m."userId",
    m.language,
    COALESCE(SUM(m."minutesEarned"), 0)                              AS gross,
    MAX(m."streakDate") FILTER (WHERE m."minutesEarned" >= 3)        AS last_qualifying
  FROM userminutepoints m
  GROUP BY m."userId", m.language
),
ranked AS (
  SELECT
    p.*,
    GREATEST(0, COALESCE(u."totalMinutePoints", 0))                  AS net_total,
    u."lastPenaltyDate",
    SUM(p.gross)  OVER (PARTITION BY p."userId")                     AS user_gross,
    ROW_NUMBER()  OVER (PARTITION BY p."userId"
                        ORDER BY p.gross DESC, p.language)           AS rn
  FROM per_lang p
  JOIN users u ON u.id = p."userId"
),
apportioned AS (
  SELECT
    r.*,
    CASE WHEN r.user_gross = 0 THEN 0
         ELSE FLOOR(r.net_total::numeric * r.gross / r.user_gross)::int
    END AS net_floor
  FROM ranked r
)
INSERT INTO user_language_minute_totals
  ("userId", language, "netMinutePoints", "lifetimeMinutesEarned", "lastStreakDate", "lastPenaltyDate")
SELECT
  a."userId",
  a.language,
  -- Largest-gross language absorbs the floor remainder so the per-user total is exact.
  a.net_floor + CASE WHEN a.rn = 1
                     THEN a.net_total - SUM(a.net_floor) OVER (PARTITION BY a."userId")
                     ELSE 0 END,
  a.gross,
  a.last_qualifying,
  -- Seed every language with the user's existing global penalty guard so migration day
  -- cannot double-penalise a user the old cron already hit today.
  a."lastPenaltyDate"
FROM apportioned a
ON CONFLICT ("userId", language) DO NOTHING;

-- currentStreak cannot be reconstructed per language: that history was never kept, and
-- counting back through the ledger would invent a number the old system never computed.
-- The existing global streak is therefore carried onto the single language that earned
-- the user's most recent qualifying day; every other language starts at 0 and rebuilds
-- from its next qualifying day. Deliberately conservative — under-credits, never fabricates.
UPDATE user_language_minute_totals t
SET "currentStreak" = u."currentStreak"
FROM users u,
     LATERAL (
       SELECT t2.language
       FROM user_language_minute_totals t2
       WHERE t2."userId" = u.id AND t2."lastStreakDate" IS NOT NULL
       ORDER BY t2."lastStreakDate" DESC, t2.language
       LIMIT 1
     ) most_recent
WHERE t."userId" = u.id
  AND t.language = most_recent.language
  AND COALESCE(u."currentStreak", 0) > 0
  AND t."currentStreak" = 0;
