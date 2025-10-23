-- Migration 10: Expand dictionary column sizes from VARCHAR(100) to VARCHAR(500)
-- This is needed for longer dictionary entries, especially in Vietnamese, Japanese, and Korean

-- Expand word1 column (primary word form, e.g., kanji, hanzi, Korean word)
ALTER TABLE dictionaryentries ALTER COLUMN word1 TYPE VARCHAR(500);

-- Expand word2 column (alternate word form, e.g., kana reading, pinyin, Korean romanization)
ALTER TABLE dictionaryentries ALTER COLUMN word2 TYPE VARCHAR(500);

-- Expand pronunciation column (romanization, pronunciation guide)
ALTER TABLE dictionaryentries ALTER COLUMN pronunciation TYPE VARCHAR(500);

-- Note: definitions column is already JSONB and doesn't need expansion
