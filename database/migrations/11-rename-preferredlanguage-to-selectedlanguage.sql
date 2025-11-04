-- Migration to fix column name mismatch
-- Renames preferredLanguage to selectedLanguage to match backend code expectations
-- Created: 2025-11-04

-- Rename the column in Users table
ALTER TABLE Users RENAME COLUMN "preferredLanguage" TO "selectedLanguage";

-- Update the comment for clarity
COMMENT ON COLUMN Users."selectedLanguage" IS 'User selected study language: zh, ja, ko, or vi';
