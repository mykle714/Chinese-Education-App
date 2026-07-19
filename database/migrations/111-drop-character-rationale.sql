-- Migration 111: Drop the `characterRationale` feature
--
-- Reverses migration 102's `characterRationale` column. The per-character rationale
-- feature (each char of a multi-char word → the fuller everyday word it abbreviates,
-- e.g. 违 → 违反) has been deprecated and fully removed: the backfill script
-- (server/scripts/backfill/chinese/backfill-character-rationale.js), its pipeline step
-- in requiredScripts.js / mark-discoverable, the "Why These Characters" UX block in the
-- eip breakdown tab (InfoCardPanelBody) and the cdp (VocabCardDetailBody), and all
-- type/DAL/service references are gone.
--
-- zh-only: the column never existed on dictionaryentries_es (the dictJoin substituted a
-- typed NULL for the es UNION branch), so there is nothing to drop there.
--
-- Idempotent: safe to re-run.

ALTER TABLE dictionaryentries_zh
  DROP COLUMN IF EXISTS "characterRationale";
