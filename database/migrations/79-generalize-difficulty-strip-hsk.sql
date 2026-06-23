-- Migration 79: Generalize the difficulty scale — strip the 'HSK' prefix from
-- Chinese difficulty so both supported languages share ONE integer scale (1..6).
--
-- Runs AFTER migration 76 (which renamed the column hskLevel -> difficulty). At that
-- point difficulty was still encoded differently per language —
--   - dictionaryentries_zh (cdet): 'HSK1'..'HSK6'
--   - dictionaryentries_es (sdet): bare '1'..'5'
-- The leveling logic had to special-case each encoding. Unifying on a bare integer
-- '1'..'6' lets the difficulty math stay language-agnostic (see _levelConfig in
-- StarterPacksService / LEVEL_CONFIG in SortCardsPage).
--
-- The Chinese values ARE still HSK proficiency levels — only the textual label is
-- dropped (HSK3 -> 3). HSK1..HSK6 maps 1:1 onto 1..6, so the level numbers and the
-- ceiling (6) are unchanged; this is a pure relabel, not a re-scale.
--
-- Spanish needs NO data change here: it already stores bare integers and is a
-- subset of 1..6. Its scale ceiling is raised 5 -> 6 in application config so both
-- languages use the same 1..6 range; existing Spanish backfill values are untouched.
--
-- Idempotent: the WHERE clause only matches rows still carrying the 'HSK' prefix, so
-- re-running is a no-op. Reversible by re-prefixing ("HSK" || difficulty) the 1..6 rows.

UPDATE dictionaryentries_zh
SET "difficulty" = SUBSTRING("difficulty" FROM 4)  -- 'HSK3' -> '3'
WHERE "difficulty" ~ '^HSK[1-6]$';

-- Refresh the column comments left by migration 76 (which still described the old
-- 'HSK1'..'HSK6' encoding) to reflect the generalized bare-integer scale.
COMMENT ON COLUMN dictionaryentries_zh."difficulty"
  IS 'Generalized difficulty 1..6 driving the discover band. zh values ARE HSK levels (1=HSK1..6=HSK6); the ''HSK'' label was dropped in migration 79 but the UI re-adds an HSK badge.';
COMMENT ON COLUMN dictionaryentries_es."difficulty"
  IS 'Generalized difficulty 1..6 driving the discover band. es encoding: learner-acquisition difficulty (1=easiest); not an HSK label.';
