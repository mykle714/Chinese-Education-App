-- Add success rate tracking columns to VocabEntries table
-- This tracks lifetime correct count and calculates success rates for different windows

-- Add totalCorrectCount column to track lifetime correct marks
ALTER TABLE VocabEntries 
ADD COLUMN "totalCorrectCount" INTEGER DEFAULT 0;

-- Add success rate columns (stored as DECIMAL between 0 and 1)
ALTER TABLE VocabEntries 
ADD COLUMN "totalSuccessRate" DECIMAL(5,4),
ADD COLUMN "last8SuccessRate" DECIMAL(5,4),
ADD COLUMN "last16SuccessRate" DECIMAL(5,4);

-- Add indexes for potential queries/sorting
CREATE INDEX idx_vocabentries_total_correct_count ON VocabEntries("totalCorrectCount");
CREATE INDEX idx_vocabentries_total_success_rate ON VocabEntries("totalSuccessRate");
CREATE INDEX idx_vocabentries_last8_success_rate ON VocabEntries("last8SuccessRate");
CREATE INDEX idx_vocabentries_last16_success_rate ON VocabEntries("last16SuccessRate");

-- Add column comments
COMMENT ON COLUMN VocabEntries."totalCorrectCount" IS 'Lifetime count of correct marks for this card';
COMMENT ON COLUMN VocabEntries."totalSuccessRate" IS 'Lifetime success rate: totalCorrectCount / totalMarkCount (0.0 to 1.0)';
COMMENT ON COLUMN VocabEntries."last8SuccessRate" IS 'Success rate for the last 8 marks in markHistory (0.0 to 1.0)';
COMMENT ON COLUMN VocabEntries."last16SuccessRate" IS 'Success rate for the last 16 marks in markHistory (0.0 to 1.0)';
