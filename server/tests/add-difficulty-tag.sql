-- Script to add and populate difficultyTag column for VocabEntries table
-- This script adds the difficultyTag column with constraints and populates it with random HSK levels

-- Step 1: Add the difficultyTag column to VocabEntries table
ALTER TABLE VocabEntries
ADD [difficultyTag] varchar(10) NULL;

-- Step 2: Add CHECK constraint for HSK levels
ALTER TABLE VocabEntries
ADD CONSTRAINT [CK_VocabEntries_difficultyTag] 
CHECK ([difficultyTag] IN ('HSK1', 'HSK2', 'HSK3', 'HSK4', 'HSK5', 'HSK6'));

-- Step 3: Randomly assign HSK levels to existing entries
UPDATE VocabEntries 
SET [difficultyTag] = CASE 
    WHEN ABS(CHECKSUM(NEWID())) % 6 = 0 THEN 'HSK1'
    WHEN ABS(CHECKSUM(NEWID())) % 6 = 1 THEN 'HSK2'
    WHEN ABS(CHECKSUM(NEWID())) % 6 = 2 THEN 'HSK3'
    WHEN ABS(CHECKSUM(NEWID())) % 6 = 3 THEN 'HSK4'
    WHEN ABS(CHECKSUM(NEWID())) % 6 = 4 THEN 'HSK5'
    ELSE 'HSK6'
END
WHERE [difficultyTag] IS NULL;

-- Step 4: Verify HSK level distribution
SELECT 
    'HSK Level Distribution' as ResultType,
    [difficultyTag] as TagValue,
    COUNT(*) as Count,
    CAST(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM VocabEntries) AS DECIMAL(5,2)) as Percentage
FROM VocabEntries 
WHERE [difficultyTag] IS NOT NULL
GROUP BY [difficultyTag]
ORDER BY [difficultyTag];

-- Step 5: Verify the updated schema for difficultyTag
SELECT 
    'DifficultyTag Schema' as ResultType,
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
WHERE TABLE_NAME = 'VocabEntries' AND COLUMN_NAME = 'difficultyTag';

-- Step 6: Verify CHECK constraint
SELECT 
    'DifficultyTag Constraints' as ResultType,
    cc.CONSTRAINT_NAME as ConstraintName,
    cc.CHECK_CLAUSE as CheckClause
FROM INFORMATION_SCHEMA.CHECK_CONSTRAINTS cc
JOIN INFORMATION_SCHEMA.CONSTRAINT_COLUMN_USAGE ccu 
    ON cc.CONSTRAINT_NAME = ccu.CONSTRAINT_NAME
WHERE ccu.TABLE_NAME = 'VocabEntries' 
    AND ccu.COLUMN_NAME = 'difficultyTag';
