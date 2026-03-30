-- Migration 32: Drop expansionMetadata column from dictionaryentries
-- expansionMetadata is now computed on-the-fly at the service layer via
-- DictionaryDAL.enrichExpansionMetadataBatch() — no longer stored in the DB.

ALTER TABLE dictionaryentries DROP COLUMN IF EXISTS "expansionMetadata";
