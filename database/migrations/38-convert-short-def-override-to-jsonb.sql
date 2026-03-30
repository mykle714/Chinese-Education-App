-- Migration 38: Convert shortDefinitionOverride from TEXT to JSONB and rename to shortDefinitionPronunciationOverride.
-- Now stores { definition?, pronunciation? } for manual per-entry display overrides.
-- definition: replaces the computed shortDefinition for this entry
-- pronunciation: replaces DictionaryEntry.pronunciation (space-separated diacritic pinyin, e.g. "fēng kuáng")

ALTER TABLE dictionaryentries
  DROP COLUMN IF EXISTS "shortDefinitionOverride";

ALTER TABLE dictionaryentries
  ADD COLUMN IF NOT EXISTS "shortDefinitionPronunciationOverride" JSONB DEFAULT NULL;
