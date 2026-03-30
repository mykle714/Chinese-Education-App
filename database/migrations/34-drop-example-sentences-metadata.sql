-- Migration 34: Drop exampleSentencesMetadata column from dictionaryentries
-- exampleSentencesMetadata is now computed on-the-fly at the service layer
-- via DictionaryDAL.enrichExampleSentencesMetadataBatch()

ALTER TABLE dictionaryentries DROP COLUMN IF EXISTS "exampleSentencesMetadata";
