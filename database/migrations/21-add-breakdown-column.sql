-- Migration 21: Add breakdown column to VocabEntries
-- Stores character-by-character breakdown for Chinese vocabulary
-- Format: {"char1": "definition", "char2": "definition", ...}
-- NULL for non-Chinese entries

ALTER TABLE vocabentries ADD COLUMN IF NOT EXISTS breakdown JSONB DEFAULT NULL;

-- Add index for faster queries on breakdown data
CREATE INDEX IF NOT EXISTS idx_vocabentries_breakdown ON vocabentries USING gin (breakdown);

-- Add comment describing the column
COMMENT ON COLUMN vocabentries.breakdown IS 'Character breakdown for Chinese vocabulary entries. Format: {"char1": "definition1", "char2": "definition2"}. NULL for non-Chinese languages.';
