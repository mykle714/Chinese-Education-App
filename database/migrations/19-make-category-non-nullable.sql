-- Make category column non-nullable with default value
-- This ensures all flashcards have a category, defaulting to 'Unfamiliar'

-- First, backfill any existing NULL categories to 'Unfamiliar'
UPDATE vocabentries 
SET category = 'Unfamiliar' 
WHERE category IS NULL;

-- Set default value for new entries
ALTER TABLE vocabentries 
ALTER COLUMN category SET DEFAULT 'Unfamiliar';

-- Make column non-nullable
ALTER TABLE vocabentries 
ALTER COLUMN category SET NOT NULL;

-- Update comment to reflect new constraint
COMMENT ON COLUMN vocabentries.category IS 'Flashcard category based on last 8 marks (zero-padded): 0-2 correct=Unfamiliar, 3-5=Target, 6-7=Comfortable, 8=Mastered. Defaults to Unfamiliar for new cards.';
