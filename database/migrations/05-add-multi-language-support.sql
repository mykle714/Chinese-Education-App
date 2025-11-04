-- Multi-Language Support Migration
-- Adds support for Japanese, Korean, and Vietnamese dictionaries
-- Created: 2025-01-11

-- Step 1: Add selectedLanguage to Users table
ALTER TABLE Users ADD COLUMN IF NOT EXISTS "selectedLanguage" VARCHAR(10) DEFAULT 'zh';

-- Step 2: Modify DictionaryEntries to support multiple languages
-- Add language column
ALTER TABLE DictionaryEntries ADD COLUMN IF NOT EXISTS language VARCHAR(10) DEFAULT 'zh';

-- Rename columns to be more generic
ALTER TABLE DictionaryEntries RENAME COLUMN simplified TO word1;
ALTER TABLE DictionaryEntries RENAME COLUMN traditional TO word2;
ALTER TABLE DictionaryEntries RENAME COLUMN pinyin TO pronunciation;

-- Make word2 and pronunciation nullable for Vietnamese
ALTER TABLE DictionaryEntries ALTER COLUMN word2 DROP NOT NULL;
ALTER TABLE DictionaryEntries ALTER COLUMN pronunciation DROP NOT NULL;

-- Add index on language for efficient filtering
CREATE INDEX IF NOT EXISTS idx_dictionary_language ON DictionaryEntries(language);
CREATE INDEX IF NOT EXISTS idx_dictionary_word1_language ON DictionaryEntries(word1, language);

-- Step 3: Update existing Chinese entries to have language='zh'
UPDATE DictionaryEntries SET language = 'zh' WHERE language IS NULL OR language = 'zh';

-- Step 4: Add comments for clarity
COMMENT ON COLUMN DictionaryEntries.language IS 'Language code: zh (Chinese), ja (Japanese), ko (Korean), vi (Vietnamese)';
COMMENT ON COLUMN DictionaryEntries.word1 IS 'Primary word form - Chinese: simplified, Japanese: kanji, Korean: hangul, Vietnamese: word';
COMMENT ON COLUMN DictionaryEntries.word2 IS 'Secondary word form - Chinese: traditional, Japanese: kana, Korean: hanja, Vietnamese: null';
COMMENT ON COLUMN DictionaryEntries.pronunciation IS 'Pronunciation - Chinese: pinyin, Japanese: romaji, Korean: romanization, Vietnamese: null';

-- Step 5: Ensure VocabEntries language column exists and is indexed
-- (Already exists from init schema, but let's ensure index)
CREATE INDEX IF NOT EXISTS idx_vocabentries_language ON VocabEntries(language);
CREATE INDEX IF NOT EXISTS idx_vocabentries_userid_language ON VocabEntries("userId", language);

COMMENT ON COLUMN Users."selectedLanguage" IS 'User selected study language: zh, ja, ko, or vi';
