-- Add wordForms column to store AI-generated English conjugation map per entry.
-- Keys: past, present, future, gerund, adverb, adjective, noun (only applicable keys per entry).
-- Used by example sentence hover text to show contextually correct English forms.
ALTER TABLE dictionaryentries ADD COLUMN IF NOT EXISTS "wordForms" JSONB;
