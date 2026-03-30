-- Drop synonymsMetadata column from DictionaryEntries
-- This data is now computed at runtime by batch-reading pronunciation + definition
-- from dictionaryentries for each synonym word.
ALTER TABLE DictionaryEntries DROP COLUMN IF EXISTS "synonymsMetadata";
