-- Add flashcard review history to VocabEntries table
-- This tracks the last 16 review marks for spaced repetition algorithms

ALTER TABLE VocabEntries
ADD COLUMN "reviewHistory" JSONB DEFAULT '[]';

-- Add GIN index for efficient JSONB queries (optional but recommended)
CREATE INDEX idx_vocabentries_review_history ON VocabEntries USING gin ("reviewHistory");

-- Add comment explaining the column
COMMENT ON COLUMN VocabEntries."reviewHistory" IS 'Last 16 flashcard review results with timestamps. Format: [{ "timestamp": "ISO-8601", "isCorrect": boolean }]';
