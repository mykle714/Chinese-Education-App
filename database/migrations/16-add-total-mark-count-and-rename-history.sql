-- Rename reviewHistory to markHistory and add totalMarkCount column
-- This migration renames the flashcard review tracking column for better clarity
-- and adds a cumulative counter for total marks

-- Rename reviewHistory to markHistory
ALTER TABLE VocabEntries 
RENAME COLUMN "reviewHistory" TO "markHistory";

-- Rename the index
DROP INDEX IF EXISTS idx_vocabentries_review_history;
CREATE INDEX idx_vocabentries_mark_history ON VocabEntries USING gin ("markHistory");

-- Add totalMarkCount column to track cumulative marks
ALTER TABLE VocabEntries 
ADD COLUMN "totalMarkCount" INTEGER DEFAULT 0;

-- Add index for totalMarkCount for efficient queries
CREATE INDEX idx_vocabentries_total_mark_count ON VocabEntries("totalMarkCount");

-- Update column comment
COMMENT ON COLUMN VocabEntries."markHistory" IS 'Last 16 flashcard mark results with timestamps. Format: [{ "timestamp": "ISO-8601", "isCorrect": boolean }]';
COMMENT ON COLUMN VocabEntries."totalMarkCount" IS 'Total cumulative count of all flashcard marks (correct + incorrect) for this card';
