-- Dictionary Entries Table Schema for PostgreSQL
-- Stores CC-CEDICT Chinese-English dictionary entries
-- Created: 2025-01-11

-- Create DictionaryEntries table
CREATE TABLE IF NOT EXISTS DictionaryEntries (
    id SERIAL PRIMARY KEY,
    simplified VARCHAR(100) NOT NULL,
    traditional VARCHAR(100) NOT NULL,
    pinyin VARCHAR(200) NOT NULL,
    definitions JSONB NOT NULL, -- Stored as JSON array
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create index on simplified for fast lookups
CREATE INDEX IF NOT EXISTS idx_dictionary_simplified ON DictionaryEntries(simplified);

-- Create index on traditional for potential future lookups
CREATE INDEX IF NOT EXISTS idx_dictionary_traditional ON DictionaryEntries(traditional);

-- Add comment describing the table
COMMENT ON TABLE DictionaryEntries IS 'Stores CC-CEDICT Chinese-English dictionary entries for word lookup in the reader feature';
COMMENT ON COLUMN DictionaryEntries.simplified IS 'Simplified Chinese characters';
COMMENT ON COLUMN DictionaryEntries.traditional IS 'Traditional Chinese characters';
COMMENT ON COLUMN DictionaryEntries.pinyin IS 'Pinyin pronunciation with tone marks';
COMMENT ON COLUMN DictionaryEntries.definitions IS 'JSON array of English definitions';
