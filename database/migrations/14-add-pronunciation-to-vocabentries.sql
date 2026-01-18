-- Add pronunciation column to VocabEntries table
-- This will store pronunciation data (pinyin, romaji, romanization, etc.) for flashcards

ALTER TABLE VocabEntries 
ADD COLUMN pronunciation VARCHAR(200);

-- Add index for better query performance
CREATE INDEX idx_vocabentries_pronunciation ON VocabEntries(pronunciation);

-- Add comment explaining the column
COMMENT ON COLUMN VocabEntries.pronunciation IS 'Pronunciation guide - Chinese: pinyin, Japanese: romaji, Korean: romanization, Vietnamese: null or pronunciation guide';
