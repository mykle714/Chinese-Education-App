-- Migration 102: Replace the `expansion` feature with per-character `characterRationale`
--
-- The old "expansion" enrichment (migrations 23 + 35) produced, per multi-char zh
-- word, a single vernacularized phrase (`expansion`, e.g. 违规 → 违反规矩) plus an
-- English gloss of that phrase (`expansionLiteralTranslation`). Its display unit was
-- the whole blended phrase, and the raw phrase had to be GSA-segmented + def-looked-up
-- at RUNTIME (DictionaryDAL.enrichExpansionMetadataBatch) before it could render.
--
-- This replaces it with a CHARACTER-level explanation. For each character of a
-- multi-char word we store why that character is there — a short English learner-facing
-- reason that folds in an implied longer word when it is genuinely illuminating
-- (e.g. 违 → "to violate — short for 违反"). Unlike expansion, the column is already
-- display-ready: no runtime segmentation/lookup step is needed.
--
-- Shape: jsonb array aligned to the word's characters, one object per character:
--   [ {"char": "违", "reason": "to violate — short for 违反"},
--     {"char": "规", "reason": "rules/norms — short for 规矩"} ]
--
-- Sentinel convention (mirrors expansion's '' sentinel):
--   NULL          = never attempted
--   '[]'::jsonb   = attempted, no worthwhile per-character breakdown (opaque word,
--                   single-char, or transliteration) — future runs skip it
--
-- zh-only: the Spanish det (dictionaryentries_es) does NOT get this column, exactly
-- like `breakdown`, `classifier`, and `definitionClusters` (the dictJoin substitutes a
-- typed NULL for the es UNION branch).
--
-- Written by server/scripts/backfill/chinese/backfill-character-rationale.js.
-- See docs/CHARACTER_RATIONALE.md.
--
-- Idempotent: safe to re-run.
--
-- ⚠️ DEPLOY NOTE: this migration DROPS `expansion` + `expansionLiteralTranslation`.
-- On prod, run the character-rationale backfill (bundled reference-data sync) so the
-- new column is populated BEFORE the old feature disappears from the UI.

ALTER TABLE dictionaryentries_zh
  ADD COLUMN IF NOT EXISTS "characterRationale" jsonb;

COMMENT ON COLUMN dictionaryentries_zh."characterRationale" IS
  'Per-character rationale for multi-char words: jsonb array of {char, reason} aligned to word1''s characters. reason is a short English learner-facing gloss, optionally citing an implied longer word. NULL = never attempted, ''[]'' = attempted/nothing. Replaces expansion. See docs/CHARACTER_RATIONALE.md.';

ALTER TABLE dictionaryentries_zh
  DROP COLUMN IF EXISTS expansion,
  DROP COLUMN IF EXISTS "expansionLiteralTranslation";
