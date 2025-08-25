-- Script to randomly assign HSK levels and custom tags to existing vocabulary entries
-- This provides test data for the new hskLevelTag and isCustomTag columns

-- Update existing entries with random HSK levels
-- Using NEWID() for randomization and modulo operation for distribution
UPDATE VocabEntries 
SET hskLevelTag = CASE 
    WHEN ABS(CHECKSUM(NEWID())) % 6 = 0 THEN 'HSK1'
    WHEN ABS(CHECKSUM(NEWID())) % 6 = 1 THEN 'HSK2'
    WHEN ABS(CHECKSUM(NEWID())) % 6 = 2 THEN 'HSK3'
    WHEN ABS(CHECKSUM(NEWID())) % 6 = 3 THEN 'HSK4'
    WHEN ABS(CHECKSUM(NEWID())) % 6 = 4 THEN 'HSK5'
    ELSE 'HSK6'
END
WHERE hskLevelTag IS NULL;

-- Randomly assign isCustomTag values (true/false) for existing entries
UPDATE VocabEntries 
SET isCustomTag = CASE 
    WHEN ABS(CHECKSUM(NEWID())) % 2 = 0 THEN 1  -- 50% chance for true (custom)
    ELSE 0                                       -- 50% chance for false (standard)
END
WHERE isCustomTag IS NULL;

-- Verify the distribution of HSK levels
SELECT 
    hskLevelTag,
    COUNT(*) as count,
    CAST(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM VocabEntries) AS DECIMAL(5,2)) as percentage
FROM VocabEntries 
WHERE hskLevelTag IS NOT NULL
GROUP BY hskLevelTag
ORDER BY hskLevelTag;

-- Verify isCustomTag distribution
SELECT 
    isCustomTag,
    COUNT(*) as count
FROM VocabEntries 
GROUP BY isCustomTag
ORDER BY isCustomTag;
