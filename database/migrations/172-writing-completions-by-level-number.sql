-- Migration 172: writing_practice_completions.level → the level NUMBER (SMALLINT 1..8)
--
-- WHY (docs/WRITING_PRACTICE_REWORK.md § 1, approved 2026-10-04): a star used to be
-- keyed by the level's mode NAME ('trace', 'watch', …). The level list was reshuffled
-- the same day — `watch` (Level 2) removed, Trace moved from 1 to 2, a new Level 1
-- `snap` added — and a name-keyed star either strands (a 'watch' row no level shows)
-- or silently changes level (a 'trace' star now sitting on Level 2). Keying by the
-- POSITION the learner sees ("Level 3") makes the star belong to the level number, so
-- future reshuffles never strand one. The mode ↔ number mapping is the shared contract
-- server/contracts/writingLevels.ts → WRITING_LEVELS.
--
-- DESTRUCTIVE, BY DECISION: every existing star (every user) is erased rather than
-- translated, so everyone restarts on the new level list. Writing MASTERY marks
-- (vet "typedMarkHistory" 'writing') are NOT touched here.
--
-- Deploy ordering: apply BEFORE the container rebuild (the standard /deploy order).
-- New code on the old schema would store '1'..'8' as text and read them back as
-- strings; old code on the new schema only fails its completion INSERT (a mode string
-- into SMALLINT), which the client treats as non-fatal.
--
-- No BEGIN/COMMIT here: migrate.sh wraps each file in its own transaction.

TRUNCATE writing_practice_completions;

-- The table is empty, so the cast never runs on a row; USING is still required for a
-- VARCHAR → SMALLINT change.
ALTER TABLE writing_practice_completions
    ALTER COLUMN level TYPE SMALLINT USING level::smallint;

ALTER TABLE writing_practice_completions
    ADD CONSTRAINT writing_practice_completions_level_range CHECK (level BETWEEN 1 AND 8);

-- The unique index (userId, language, entryKey, level) and the lookup index carry over
-- unchanged: an index survives a column type change (Postgres rebuilds it).

COMMENT ON COLUMN writing_practice_completions.level
  IS 'Level NUMBER 1..8 (server/contracts/writingLevels.ts → WRITING_LEVELS), not the mode name. Since migration 172.';
COMMENT ON TABLE writing_practice_completions
  IS 'Writing-practice completion state. One row per first successful Verify of a (userId, language, entryKey, level number). Bounded <=8 rows/character/user; stars = COUNT grouped by entryKey. State, not history.';
