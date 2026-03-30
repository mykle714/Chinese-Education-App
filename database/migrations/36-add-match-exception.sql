-- Migration 36: Add matchException to dictionaryentries
-- JSONB array of multi-char tokens the GSA should skip when matching.
-- Allows manual override of incorrect segmentation caused by bad dictionary data.
-- Example: set matchException = '["不知", "不觉"]' on the 不知不觉 row to prevent
-- those sub-words from being matched as separate segments in any example sentence.

ALTER TABLE dictionaryentries
  ADD COLUMN IF NOT EXISTS "matchException" JSONB DEFAULT '[]';
