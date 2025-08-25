-- Add tag columns to VocabEntries table
-- This script adds isCustomTag and hskLevelTag columns with appropriate constraints

-- Add the new tag columns to VocabEntries table
ALTER TABLE VocabEntries 
ADD isCustomTag bit NULL,
    hskLevelTag varchar(10) NULL;

-- Add CHECK constraint for HSK levels to ensure only valid values are allowed
ALTER TABLE VocabEntries 
ADD CONSTRAINT CK_VocabEntries_hskLevelTag 
CHECK (hskLevelTag IN ('HSK1', 'HSK2', 'HSK3', 'HSK4', 'HSK5', 'HSK6'));

-- Verify the changes
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'VocabEntries' 
AND COLUMN_NAME IN ('isCustomTag', 'hskLevelTag');
