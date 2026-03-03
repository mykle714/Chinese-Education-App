-- Dictionary Entries Table Schema for PostgreSQL
-- Supports Chinese, Japanese, Korean, and Vietnamese dictionaries

CREATE TABLE IF NOT EXISTS DictionaryEntries (
    id SERIAL PRIMARY KEY,
    language VARCHAR(10) NOT NULL DEFAULT 'zh',
    word1 VARCHAR(500) NOT NULL,
    word2 VARCHAR(500),
    pronunciation VARCHAR(500),
    tone VARCHAR(20),
    definitions JSONB NOT NULL,
    discoverable BOOLEAN NOT NULL DEFAULT FALSE,
    script VARCHAR(20),
    "hskLevelTag" VARCHAR(10),
    breakdown JSONB,
    synonyms JSONB,
    "exampleSentences" JSONB,
    "partsOfSpeech" JSONB,
    expansion TEXT,
    "expansionMetadata" JSONB,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dictionary_word1 ON DictionaryEntries(word1);
CREATE INDEX IF NOT EXISTS idx_dictionary_word2 ON DictionaryEntries(word2);
CREATE INDEX IF NOT EXISTS idx_dictionary_language ON DictionaryEntries(language);
CREATE INDEX IF NOT EXISTS idx_dictionary_word1_language ON DictionaryEntries(word1, language);
CREATE INDEX IF NOT EXISTS idx_dictionary_discoverable_language
  ON DictionaryEntries(language, discoverable)
  WHERE discoverable = TRUE;

COMMENT ON TABLE DictionaryEntries IS 'Multi-language dictionary entries';
COMMENT ON COLUMN DictionaryEntries.language IS 'Language code: zh, ja, ko, vi';
COMMENT ON COLUMN DictionaryEntries.word1 IS 'Primary word form (simplified Chinese, kanji, hangul, Vietnamese word)';
COMMENT ON COLUMN DictionaryEntries.word2 IS 'Secondary word form (traditional Chinese, kana, hanja)';
COMMENT ON COLUMN DictionaryEntries.pronunciation IS 'Pronunciation guide (pinyin, romaji, romanization)';
COMMENT ON COLUMN DictionaryEntries.definitions IS 'JSON array of definitions';
