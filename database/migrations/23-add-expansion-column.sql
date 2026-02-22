-- Migration 23: Add expansion column to vocabentries
-- Stores expanded/fuller form of Chinese words
-- Example: 不知不觉 → 不知道不觉得, 违规 → 违反规矩
-- NULL for words that cannot be meaningfully expanded

ALTER TABLE vocabentries ADD COLUMN IF NOT EXISTS expansion TEXT DEFAULT NULL;

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_vocabentries_expansion ON vocabentries(expansion) WHERE expansion IS NOT NULL;

-- Add comment describing the column
COMMENT ON COLUMN vocabentries.expansion IS 'Expanded/fuller form of Chinese word. Example: 不知不觉 → 不知道不觉得. NULL if word cannot be meaningfully expanded.';
