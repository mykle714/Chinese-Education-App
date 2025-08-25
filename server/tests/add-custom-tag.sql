-- Script to add and populate isCustomTag column for VocabEntries table
-- This script adds the isCustomTag column and populates it with random boolean values

-- Step 1: Add the isCustomTag column to VocabEntries table
ALTER TABLE VocabEntries
ADD [isCustomTag] bit NULL;

-- Step 2: Randomly assign isCustomTag values (50% true, 50% false)
UPDATE VocabEntries 
SET [isCustomTag] = CASE 
    WHEN ABS(CHECKSUM(NEWID())) % 2 = 0 THEN 1  -- 50% chance for true (custom)
    ELSE 0                                       -- 50% chance for false (standard)
END
WHERE [isCustomTag] IS NULL;

-- Step 3: Verify isCustomTag distribution
SELECT 
    'Custom Tag Distribution' as ResultType,
    CASE 
        WHEN [isCustomTag] = 1 THEN 'Custom (True)'
        WHEN [isCustomTag] = 0 THEN 'Standard (False)'
        ELSE 'NULL'
    END as TagValue,
    COUNT(*) as Count,
    CAST(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM VocabEntries) AS DECIMAL(5,2)) as Percentage
FROM VocabEntries 
GROUP BY [isCustomTag]
ORDER BY [isCustomTag];

-- Step 4: Verify the updated schema for isCustomTag
SELECT 
    'CustomTag Schema' as ResultType,
    COLUMN_NAME as ColumnName,
    DATA_TYPE as DataType,
    CASE 
        WHEN CHARACTER_MAXIMUM_LENGTH = -1 THEN 'MAX'
        WHEN CHARACTER_MAXIMUM_LENGTH IS NOT NULL THEN CAST(CHARACTER_MAXIMUM_LENGTH AS VARCHAR(10))
        ELSE 'N/A'
    END as MaxLength,
    IS_NULLABLE as IsNullable,
    ISNULL(COLUMN_DEFAULT, 'NULL') as DefaultValue
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'VocabEntries' AND COLUMN_NAME = 'isCustomTag';

-- Step 5: Show sample entries with isCustomTag values
SELECT TOP 10
    'Sample Entries' as ResultType,
    id,
    entryKey,
    CASE 
        WHEN isCustomTag = 1 THEN 'Custom'
        WHEN isCustomTag = 0 THEN 'Standard'
        ELSE 'NULL'
    END as CustomStatus
FROM VocabEntries
ORDER BY id;

-- Step 6: Count entries by custom status
SELECT 
    'Summary by Custom Status' as ResultType,
    CASE 
        WHEN isCustomTag = 1 THEN 'User Created (Custom)'
        WHEN isCustomTag = 0 THEN 'System/Import (Standard)'
        ELSE 'Unassigned (NULL)'
    END as EntryType,
    COUNT(*) as TotalEntries
FROM VocabEntries
GROUP BY isCustomTag
ORDER BY isCustomTag DESC;
