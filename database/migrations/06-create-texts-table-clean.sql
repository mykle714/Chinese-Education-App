-- Create texts table with language support (CLEAN VERSION - NO SAMPLE DATA)
-- This version creates the table structure only, without any default texts
-- Migration: 06-create-texts-table-clean.sql

CREATE TABLE IF NOT EXISTS texts (
    id VARCHAR(50) PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    content TEXT NOT NULL,
    language VARCHAR(10) NOT NULL DEFAULT 'zh',
    "characterCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
);

-- Create index for language filtering
CREATE INDEX IF NOT EXISTS idx_texts_language ON texts(language);

-- Note: This migration INTENTIONALLY does not insert any sample data
-- Users should create their own documents from the UI
