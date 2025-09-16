-- Simple migration script to update column names from lowercase to camelCase
-- This script will rename columns to match the TypeScript interfaces

-- Update Users table
ALTER TABLE Users RENAME COLUMN createdat TO "createdAt";

-- Update VocabEntries table columns
ALTER TABLE VocabEntries RENAME COLUMN userid TO "userId";
ALTER TABLE VocabEntries RENAME COLUMN entrykey TO "entryKey";
ALTER TABLE VocabEntries RENAME COLUMN entryvalue TO "entryValue";
ALTER TABLE VocabEntries RENAME COLUMN iscustomtag TO "isCustomTag";
ALTER TABLE VocabEntries RENAME COLUMN hskleveltag TO "hskLevelTag";
ALTER TABLE VocabEntries RENAME COLUMN createdat TO "createdAt";

-- Update OnDeckVocabSets table columns
ALTER TABLE OnDeckVocabSets RENAME COLUMN userid TO "userId";
ALTER TABLE OnDeckVocabSets RENAME COLUMN featurename TO "featureName";
ALTER TABLE OnDeckVocabSets RENAME COLUMN vocabentryids TO "vocabEntryIds";
ALTER TABLE OnDeckVocabSets RENAME COLUMN updatedat TO "updatedAt";

-- Drop old indexes
DROP INDEX IF EXISTS idx_vocabentries_userid;
DROP INDEX IF EXISTS idx_vocabentries_key;
DROP INDEX IF EXISTS idx_vocabentries_key_trgm;
DROP INDEX IF EXISTS idx_vocabentries_value_trgm;
DROP INDEX IF EXISTS idx_ondeckvocabsets_userid;

-- Create new indexes with camelCase column names
CREATE INDEX idx_vocabentries_userid ON VocabEntries("userId");
CREATE INDEX idx_vocabentries_key ON VocabEntries("entryKey");
CREATE INDEX idx_vocabentries_key_trgm ON VocabEntries USING gin ("entryKey" gin_trgm_ops);
CREATE INDEX idx_vocabentries_value_trgm ON VocabEntries USING gin ("entryValue" gin_trgm_ops);
CREATE INDEX idx_ondeckvocabsets_userid ON OnDeckVocabSets("userId");

-- Update foreign key constraints
-- Drop old constraints
ALTER TABLE VocabEntries DROP CONSTRAINT IF EXISTS vocabentries_userid_fkey;
ALTER TABLE OnDeckVocabSets DROP CONSTRAINT IF EXISTS ondeckvocabsets_userid_fkey;

-- Create new foreign key constraints
ALTER TABLE VocabEntries ADD CONSTRAINT vocabentries_userid_fkey 
    FOREIGN KEY ("userId") REFERENCES Users(id) ON DELETE CASCADE;
ALTER TABLE OnDeckVocabSets ADD CONSTRAINT ondeckvocabsets_userid_fkey 
    FOREIGN KEY ("userId") REFERENCES Users(id) ON DELETE CASCADE;

-- Update primary key constraint for OnDeckVocabSets
ALTER TABLE OnDeckVocabSets DROP CONSTRAINT IF EXISTS ondeckvocabsets_pkey;
ALTER TABLE OnDeckVocabSets ADD CONSTRAINT ondeckvocabsets_pkey 
    PRIMARY KEY ("userId", "featureName");
