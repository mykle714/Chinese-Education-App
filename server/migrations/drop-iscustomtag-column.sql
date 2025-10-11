-- Migration script to drop isCustomTag column from VocabEntries table
-- This removes the custom tag feature entirely as all cards are now "your cards"

-- Drop the isCustomTag column from VocabEntries table
ALTER TABLE VocabEntries
DROP COLUMN isCustomTag;

-- Verify the column has been dropped
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'VocabEntries'
ORDER BY ORDINAL_POSITION;
