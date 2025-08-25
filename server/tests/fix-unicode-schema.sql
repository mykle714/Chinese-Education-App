-- Fix Unicode support for VocabEntries table
-- This script converts TEXT columns to NVARCHAR(MAX) to support Chinese characters

USE [cow-db];
GO

-- First, let's check current data
SELECT COUNT(*) as TotalEntries FROM VocabEntries;
GO

-- Convert entryKey from TEXT to NVARCHAR(MAX)
ALTER TABLE VocabEntries 
ALTER COLUMN entryKey NVARCHAR(MAX) NOT NULL;
GO

-- Convert entryValue from TEXT to NVARCHAR(MAX)  
ALTER TABLE VocabEntries
ALTER COLUMN entryValue NVARCHAR(MAX) NOT NULL;
GO

-- Verify the schema change
SELECT 
    COLUMN_NAME,
    DATA_TYPE,
    CHARACTER_MAXIMUM_LENGTH,
    IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'VocabEntries' 
AND COLUMN_NAME IN ('entryKey', 'entryValue')
ORDER BY ORDINAL_POSITION;
GO

PRINT 'Schema update completed successfully!';
PRINT 'Note: Existing data with question marks will need to be re-imported with correct encoding.';
