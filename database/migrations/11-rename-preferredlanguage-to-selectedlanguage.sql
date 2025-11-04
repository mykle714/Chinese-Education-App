-- Migration to fix missing selectedLanguage column
-- Adds selectedLanguage column to Users table to match backend code expectations
-- Created: 2025-11-04

-- Add the selectedLanguage column if it doesn't exist
ALTER TABLE Users ADD COLUMN IF NOT EXISTS "selectedLanguage" VARCHAR(10) DEFAULT 'zh';

-- Add comment for clarity
COMMENT ON COLUMN Users."selectedLanguage" IS 'User selected study language: zh, ja, ko, or vi';
