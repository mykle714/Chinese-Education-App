-- Delete all vocabulary entries from the database
-- WARNING: This will permanently delete ALL vocabulary entries for ALL users

USE [cow-db];
GO

-- Check current count before deletion
SELECT COUNT(*) as TotalEntriesBeforeDeletion FROM VocabEntries;
GO

-- Delete all entries
DELETE FROM VocabEntries;
GO

-- Check count after deletion
SELECT COUNT(*) as TotalEntriesAfterDeletion FROM VocabEntries;
GO

PRINT 'All vocabulary entries have been deleted.';
