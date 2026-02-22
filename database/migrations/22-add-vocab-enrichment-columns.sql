-- Migration: Add vocabulary enrichment columns
-- Created: 2026-02-17
-- Description: Adds synonyms, example sentences, and parts of speech columns to vocabentries

-- Add synonyms column (array of Chinese synonym words)
ALTER TABLE vocabentries 
ADD COLUMN IF NOT EXISTS synonyms JSONB DEFAULT '[]'::jsonb;

-- Add exampleSentences column (array of sentence objects with chinese, english, usage)
ALTER TABLE vocabentries 
ADD COLUMN IF NOT EXISTS examplesentences JSONB DEFAULT '[]'::jsonb;

-- Add partsOfSpeech column (array of part of speech strings like "noun", "verb", etc.)
ALTER TABLE vocabentries 
ADD COLUMN IF NOT EXISTS partsofspeech JSONB DEFAULT '[]'::jsonb;

-- Create GIN indexes for efficient JSONB queries
CREATE INDEX IF NOT EXISTS idx_vocabentries_synonyms ON vocabentries USING GIN (synonyms);
CREATE INDEX IF NOT EXISTS idx_vocabentries_examplesentences ON vocabentries USING GIN (examplesentences);
CREATE INDEX IF NOT EXISTS idx_vocabentries_partsofspeech ON vocabentries USING GIN (partsofspeech);

-- Add comments
COMMENT ON COLUMN vocabentries.synonyms IS 'JSONB array of Chinese synonym words';
COMMENT ON COLUMN vocabentries.examplesentences IS 'JSONB array of example sentence objects with chinese, english, and usage fields';
COMMENT ON COLUMN vocabentries.partsofspeech IS 'JSONB array of possible parts of speech (noun, verb, adj, etc)';
