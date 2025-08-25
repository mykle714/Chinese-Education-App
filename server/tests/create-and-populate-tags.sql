-- Complete script to create and populate tag columns for VocabEntries table
-- This script adds isCustomTag and levelHskTag columns with constraints and populates them with random data

-- Step 1: Add the new tag columns to VocabEntries table
ALTER TABLE VocabEntries
ADD [isCustomTag] bit NULL,
    [levelHskTag] varchar(10) NULL;

-- Step 2: Add CHECK constraint for HSK levels
ALTER TABLE VocabEntries
ADD CONSTRAINT [CK_VocabEntries_levelHskTag] 
CHECK ([levelHskTag] IN ('HSK1', 'HSK2', 'HSK3', 'HSK4', 'HSK5', 'HSK6'));

-- Step 3: Randomly assign HSK levels to existing entries
UPDATE VocabEntries 
SET [levelHskTag] = CASE 
    WHEN ABS(CHECKSUM(NEWID())) % 6 = 0 THEN 'HSK1'
    WHEN ABS(CHECKSUM(NEWID())) % 6 = 1 THEN 'HSK2'
    WHEN ABS(CHECKSUM(NEWID())) % 6 = 2 THEN 'HSK3'
    WHEN ABS(CHECKSUM(NEWID())) % 6 = 3 THEN 'HSK4'
    WHEN ABS(CHECKSUM(NEWID())) % 6 = 4 THEN 'HSK5'
    ELSE 'HSK6'
END
WHERE [levelHskTag] IS NULL;

-- Step 4: Randomly assign isCustomTag values (50% true, 50% false)
UPDATE VocabEntries 
SET [isCustomTag] = CASE 
    WHEN ABS(CHECKSUM(NEWID())) % 2 = 0 THEN 1  -- 50% chance for true (custom)
    ELSE 0                                       -- 50% chance for false (standard)
END
WHERE [isCustomTag] IS NULL;

-- Step 5: Verify HSK level distribution
SELECT 
    'HSK Level Distribution' as ResultType,
    [levelHskTag] as TagValue,
    COUNT(*) as Count,
    CAST(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM VocabEntries) AS DECIMAL(5,2)) as Percentage
FROM VocabEntries 
WHERE [levelHskTag] IS NOT NULL
GROUP BY [levelHskTag]
ORDER BY [levelHskTag];

-- Step 6: Verify isCustomTag distribution
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

-- Step 7: Verify the updated schema
SELECT 
    'Updated Schema' as ResultType,
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
WHERE TABLE_NAME = 'VocabEntries' 
ORDER BY ORDINAL_POSITION;
