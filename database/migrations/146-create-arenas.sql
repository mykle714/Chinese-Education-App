-- Migration 146: Arena — the weekly global division leaderboard.
--
-- See docs/ARENA_FEATURE.md. Design is fully settled (§ 11 question log has no
-- open items); this migration creates the schema approved in § 9.
--
-- ── Two tables, and bots live INSIDE arena_members ────────────────────────────
-- Synthetic members are rows here with "userId" IS NULL, NOT rows in `users`
-- (§ 6.1). Putting them in `users` would mean every query that reads users --
-- the global leaderboard, friend search, admin counts, validator lists --
-- needs an `AND NOT "isSynthetic"` clause forever, and the first one anybody
-- forgets ships a bot to a real surface. The cost of this choice is that
-- "userId" must be nullable, so every join from arena_members to users is a
-- LEFT JOIN. That cost is local and visible; the other is global and invisible.
--
-- ── An arena is NOT scoped to a language ──────────────────────────────────────
-- There is deliberately no `language` column on `arenas` (§ 5.0). Members may be
-- studying different languages; minutes are minutes. Scoping arenas per language
-- would multiply the bucket count by N and every extra bucket is paid for in
-- synthetic padding. `language` IS denormalised onto each MEMBER row so the
-- board renders its badges without a join.
--
-- ── Division lives on user_languages, not users ───────────────────────────────
-- A learner can be division 2 in Chinese and division 9 in Spanish (§ 7.1).
-- Same reasoning as minute points and streaks, which moved per-language in 130.
--
-- Idempotent: safe to re-run.

-- ─────────────────────────────────────────────────────────────────────────────
-- arenas
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS arenas (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 1-12. Every member shares it AT FORMATION; a member's own division may
  -- diverge later in the week (it only changes at resolution, but a straggler
  -- placed into a partly-empty arena is placed by division, so this stays true).
  division         smallint    NOT NULL CHECK (division BETWEEN 1 AND 12),

  -- The IANA zone this arena's boundaries are computed in. A hard clustering
  -- partition (§ 5, Q22): every member shared this timezone at formation, which
  -- is what lets the arena have ONE unambiguous close instant. A member who
  -- travels afterwards keeps racing on the arena's clock, and the UI labels the
  -- countdown with the arena's tz whenever it differs from the viewer's.
  timezone         text        NOT NULL,

  -- The longest geohash prefix common to this arena's located members, or NULL
  -- for the location-less pool. INFORMATIONAL ONLY -- a diagnostic answering
  -- "how tight did clustering get". No user-facing query may read it, and
  -- nothing about correctness depends on it.
  "geoCellPrefix"  varchar(5),

  -- 'batch'     = formed by the 03:00 sort-and-chunk run (§ 5.1)
  -- 'straggler' = formed from opt-ins that arrived after the snapshot (§ 5.3)
  -- Kept because straggler arenas are geographically worse BY CONSTRUCTION, so
  -- averaging the two together makes any cluster-quality metric meaningless.
  "formationKind"  text        NOT NULL DEFAULT 'batch'
                               CHECK ("formationKind" IN ('batch', 'straggler')),

  -- The UTC instant of Tuesday 04:00 in `timezone` -- the anchor every boundary
  -- derives from.
  "weekStartsAt"   timestamptz NOT NULL,

  -- The UTC instant of Sunday 16:00 in `timezone`. STORED, not recomputed, so a
  -- tz-database update can never move a running arena out from under its members.
  "closesAt"       timestamptz NOT NULL,

  -- Stamped when promotions/demotions were applied. Doubles as the resolution
  -- cron's idempotency guard: resolution selects WHERE "resolvedAt" IS NULL.
  "resolvedAt"     timestamptz,

  "createdAt"      timestamptz NOT NULL DEFAULT now(),

  -- An arena that closes before it starts is a formation bug; refuse it here.
  CONSTRAINT chk_arena_closes_after_start CHECK ("closesAt" > "weekStartsAt")
);

-- Formation asks "does an arena already exist for this (timezone, division,
-- week)?"; resolution sweeps by close time.
CREATE INDEX IF NOT EXISTS idx_arenas_tz_week
  ON arenas (timezone, "weekStartsAt");
CREATE INDEX IF NOT EXISTS idx_arenas_division_week
  ON arenas (division, "weekStartsAt");
-- The resolution cron's working set: unresolved arenas past their close instant.
CREATE INDEX IF NOT EXISTS idx_arenas_unresolved
  ON arenas ("closesAt") WHERE "resolvedAt" IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- arena_members
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS arena_members (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "arenaId"                uuid        NOT NULL REFERENCES arenas(id) ON DELETE CASCADE,

  -- NULL => synthetic (§ 6.1). SET NULL rather than CASCADE: a deleted account
  -- leaves the historical board intact instead of silently reshaping a finished
  -- week's ranks. Such a row is then indistinguishable from a bot with no name,
  -- which is acceptable for history and never occurs on a live board.
  "userId"                 uuid        REFERENCES users(id) ON DELETE SET NULL,

  -- The track this membership competes in. Denormalised onto every row, bots
  -- included, so the board renders language badges without a join.
  language                 varchar(10) NOT NULL,

  "syntheticName"          text,
  "syntheticAvatarIconId"  text,
  -- Drives the deterministic pacing curve (§ 6.2). The curve is PURE: a bot's
  -- displayed score is computed on read from (seed, target, elapsed), never
  -- written, so it cannot drift and needs no cron.
  "syntheticSeed"          integer,
  -- End-of-week score the curve converges to, drawn from the real score
  -- distribution for this division in recent closed arenas.
  "syntheticTarget"        integer,

  -- The stored counter of § 4.1. Humans only; bots leave it 0 and are scored by
  -- their curve. Stored rather than SUM()ed over userminutepoints because the
  -- board is read constantly and the ledger only grows.
  "minutesEarned"          integer     NOT NULL DEFAULT 0,

  -- Written once at close so history never needs re-sorting.
  "finalRank"              smallint,
  -- -1 / 0 / +1, written at close for the Results banner.
  "divisionChange"         smallint    CHECK ("divisionChange" IN (-1, 0, 1)),

  -- The tie-break key (§ 4.2): whoever reached the score first ranks higher.
  "updatedAt"              timestamptz NOT NULL DEFAULT now(),
  "createdAt"              timestamptz NOT NULL DEFAULT now(),

  -- Denormalised from `arenas."resolvedAt" IS NULL`. Exists ONLY to make the
  -- live-membership uniqueness below indexable -- Postgres cannot put a joined
  -- column in a partial index predicate (§ 9, Q21).
  --
  -- !! THE MOST DANGEROUS COLUMN IN THIS SCHEMA !!
  -- Resolution MUST stamp arenas."resolvedAt" AND flip this to false in the SAME
  -- transaction. Miss the flip and every member of that arena is permanently
  -- blocked from ever joining another one -- a silent, spreading lockout that
  -- surfaces weeks later as "why can't I join". One DAL function, one
  -- transaction, with a test that resolves an arena and asserts no live members
  -- remain.
  "isLive"                 boolean     NOT NULL DEFAULT true,

  -- A member is either a real user or a fully-formed bot, never a half of each.
  CONSTRAINT chk_member_synthetic_shape CHECK (
    ("userId" IS NOT NULL
      AND "syntheticName" IS NULL
      AND "syntheticAvatarIconId" IS NULL
      AND "syntheticSeed" IS NULL
      AND "syntheticTarget" IS NULL)
    OR
    ("userId" IS NULL
      AND "syntheticName" IS NOT NULL
      AND "syntheticSeed" IS NOT NULL
      AND "syntheticTarget" IS NOT NULL)
  ),

  CONSTRAINT chk_member_final_rank CHECK (
    "finalRank" IS NULL OR ("finalRank" BETWEEN 1 AND 25)
  )
);

-- One membership per (user, language) per arena.
CREATE UNIQUE INDEX IF NOT EXISTS uq_arena_member_per_arena
  ON arena_members ("arenaId", "userId", language)
  WHERE "userId" IS NOT NULL;

-- Q21: one LIVE membership per (user, language) across ALL arenas. This is the
-- constraint that turns a buggy cron into a loud error instead of a person
-- quietly appearing on two boards.
CREATE UNIQUE INDEX IF NOT EXISTS uq_arena_member_live
  ON arena_members ("userId", language)
  WHERE "userId" IS NOT NULL AND "isLive";

-- "my current arena"
CREATE INDEX IF NOT EXISTS idx_arena_members_user
  ON arena_members ("userId", language, "arenaId");
-- Board reads, plus the duplicate-human pass (§ 5.1) and the Q18 check.
CREATE INDEX IF NOT EXISTS idx_arena_members_arena
  ON arena_members ("arenaId", "userId");

-- ─────────────────────────────────────────────────────────────────────────────
-- Existing tables
-- ─────────────────────────────────────────────────────────────────────────────

-- The ladder rung, per (user, language). Everyone starts at the bottom.
ALTER TABLE user_languages
  ADD COLUMN IF NOT EXISTS division smallint NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_user_languages_division'
  ) THEN
    ALTER TABLE user_languages
      ADD CONSTRAINT chk_user_languages_division CHECK (division BETWEEN 1 AND 12);
  END IF;
END $$;

-- Self-expiring opt-in (§ 8): holds the Tuesday date of the week the user opted
-- into. A stale value is simply not this week, so nobody is ever silently
-- enrolled forever and no cleanup job is needed.
ALTER TABLE user_languages
  ADD COLUMN IF NOT EXISTS "arenaOptInWeek" date;

-- Formation's candidate scan: who opted in for the week being formed.
CREATE INDEX IF NOT EXISTS idx_ul_arena_opt_in
  ON user_languages ("arenaOptInWeek", division)
  WHERE "arenaOptInWeek" IS NOT NULL;

-- A 5-character geohash cell (~5 km x 5 km), NULL = not shared (§ 5.2).
-- On `users`, not `user_languages`: a person has one location regardless of what
-- they study. It is an IDENTIFIER, not a position -- 'gcpvj' names a tile, it
-- cannot locate a home. Never displayed, never used for anything but clustering;
-- a second use is a new consent conversation, not a free ride on this column.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS "geoCell" varchar(5);

-- Guard against a full-precision geohash being written by mistake: the whole
-- privacy argument rests on this column never holding more than 5 characters.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_users_geocell_shape'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT chk_users_geocell_shape
      CHECK ("geoCell" IS NULL OR "geoCell" ~ '^[0-9bcdefghjkmnpqrstuvwxyz]{5}$');
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('arenas') IS NULL OR to_regclass('arena_members') IS NULL THEN
    RAISE EXCEPTION 'migration 146: arena tables were not created';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'uq_arena_member_live'
  ) THEN
    RAISE EXCEPTION 'migration 146: the live-membership uniqueness index is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_languages' AND column_name = 'division'
  ) THEN
    RAISE EXCEPTION 'migration 146: user_languages.division is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'geoCell'
  ) THEN
    RAISE EXCEPTION 'migration 146: users.geoCell is missing';
  END IF;
END $$;
