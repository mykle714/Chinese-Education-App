-- Migration 37: Add shortDefinitionOverride to dictionaryentries
-- Allows manual override of the computed shortDefinition for a given entry.
-- When non-null, this value is used instead of generateShortDefinition(definitions).

ALTER TABLE dictionaryentries
  ADD COLUMN IF NOT EXISTS "shortDefinitionOverride" TEXT DEFAULT NULL;
