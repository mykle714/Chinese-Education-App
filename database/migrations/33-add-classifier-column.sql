-- Migration 33: Add classifier column to dictionaryentries
-- Stores the valid measure words (量词) for Chinese nouns as a JSONB array.
-- NULL means no classifier applies (e.g. verbs, adjectives) or not yet determined.
-- Only discoverable zh entries are backfilled via backfill-classifier.js.

ALTER TABLE dictionaryentries
  ADD COLUMN IF NOT EXISTS classifier JSONB;

COMMENT ON COLUMN dictionaryentries.classifier IS 'JSONB array of valid measure word characters for Chinese nouns (e.g. ["辆"] for 车, ["只","条"] for 鱼). NULL for non-nouns or words without a standard classifier. AI-generated via backfill-classifier.js';
