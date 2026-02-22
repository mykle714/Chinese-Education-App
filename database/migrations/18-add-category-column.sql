-- Add category column to vocabentries table
-- This categorizes flashcards based on last 8 mark performance (with zero-padding)

-- Add category column as VARCHAR
ALTER TABLE vocabentries 
ADD COLUMN category VARCHAR(20);

-- Add index for filtering/sorting by category
CREATE INDEX idx_vocabentries_category ON vocabentries(category);

-- Add column comment
COMMENT ON COLUMN vocabentries.category IS 'Flashcard category based on last 8 marks (zero-padded): 0-2 correct=Unfamiliar, 3-5=Target, 6-7=Comfortable, 8=Mastered';
