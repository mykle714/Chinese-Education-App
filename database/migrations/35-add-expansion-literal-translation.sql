-- Migration 35: Add persisted literal translation phrase for expansion strings
-- This replaces on-the-fly expansion metadata generation for UI display.

ALTER TABLE dictionaryentries
ADD COLUMN IF NOT EXISTS "expansionLiteralTranslation" TEXT;

COMMENT ON COLUMN dictionaryentries."expansionLiteralTranslation" IS
'Literal translation phrase derived from expansion that shows how its components build the original meaning. Stored via backfill-expansion.js';
