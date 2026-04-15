-- Dictionary Entries Table Schema for PostgreSQL
-- Supports Chinese, Japanese, Korean, and Vietnamese dictionaries.
-- This file reflects the current schema after all migrations have been applied.
-- For production deployment use database/deploy/01-schema.sql instead.

CREATE TABLE IF NOT EXISTS DictionaryEntries (
    id SERIAL PRIMARY KEY,

    -- Identity
    language        VARCHAR(10) NOT NULL DEFAULT 'zh',  -- zh | ja | ko | vi
    script          VARCHAR(20),                        -- e.g. 'simplified', 'traditional'
    discoverable    BOOLEAN NOT NULL DEFAULT FALSE,     -- appears in vocab discovery
    "createdAt"     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Word forms and pronunciation
    word1           VARCHAR(500) NOT NULL,   -- primary form (simplified Chinese, kanji, hangul, Vietnamese)
    word2           VARCHAR(500),            -- secondary form (traditional Chinese, kana, hanja)
    pronunciation   VARCHAR(500),            -- diacritic pinyin, romaji, etc.
    "numberedPinyin" VARCHAR(500),           -- e.g. "gan1 huo4"; ü → v; neutral tone has no number
    tone            VARCHAR(20),             -- digit string, e.g. "42" for rèn wu

    -- Classification
    "partsOfSpeech" JSONB,                  -- e.g. ["noun", "verb"]
    "hskLevel"      VARCHAR(10),            -- e.g. "HSK1", "HSK2", "HSK3"

    -- Definitions
    definitions     JSONB NOT NULL,          -- array of definition strings from source data
    "longDefinition" TEXT,                   -- AI-generated 25-75 char definition

    -- AI-enriched content (populated via backfill scripts)
    breakdown       JSONB,                   -- per-character definitions
    synonyms        JSONB,                   -- array of synonym word strings
    "exampleSentences" JSONB,               -- array of {usage, chinese, english} objects
    expansion       TEXT,                    -- fuller/expanded form of the word
    classifier      JSONB,                   -- measure words for nouns, e.g. ["辆"] for 车
    "expansionLiteralTranslation" TEXT,      -- literal translation of expansion components
    "matchException" JSONB DEFAULT '[]',                     -- multi-char tokens to skip during GSA matching (manual override)
    "shortDefinitionPronunciationOverride" JSONB DEFAULT NULL, -- { definition?, pronunciation? } — manual overrides for computed shortDefinition and/or pronunciation
    "exampleSentenceDefinitionPronunciationOverride" JSONB DEFAULT NULL -- { definition?, pronunciation? } — manual overrides for example sentence segment popup display
);

CREATE INDEX IF NOT EXISTS idx_dictionary_word1 ON DictionaryEntries(word1);
CREATE INDEX IF NOT EXISTS idx_dictionary_word2 ON DictionaryEntries(word2);
CREATE INDEX IF NOT EXISTS idx_dictionary_language ON DictionaryEntries(language);
CREATE INDEX IF NOT EXISTS idx_dictionary_word1_language ON DictionaryEntries(word1, language);
CREATE INDEX IF NOT EXISTS idx_dictionary_discoverable_language
    ON DictionaryEntries(language, discoverable)
    WHERE discoverable = TRUE;

COMMENT ON TABLE DictionaryEntries IS 'Multi-language dictionary entries';

-- Identity columns
COMMENT ON COLUMN DictionaryEntries.id IS 'Auto-incrementing primary key. Populated during data import';
COMMENT ON COLUMN DictionaryEntries.language IS 'Language code: zh, ja, ko, vi. Set during data import';
COMMENT ON COLUMN DictionaryEntries.script IS 'Writing script variant (e.g. simplified, traditional). Set during data import';
COMMENT ON COLUMN DictionaryEntries.discoverable IS 'Whether this entry appears in vocab discovery. Set during data import';
COMMENT ON COLUMN DictionaryEntries."createdAt" IS 'Row creation timestamp. Auto-populated by DEFAULT CURRENT_TIMESTAMP';

-- Word forms and pronunciation
COMMENT ON COLUMN DictionaryEntries.word1 IS 'Primary word form (simplified Chinese, kanji, hangul, Vietnamese word). Set during data import';
COMMENT ON COLUMN DictionaryEntries.word2 IS 'Secondary word form (traditional Chinese, kana, hanja). Set during data import';
COMMENT ON COLUMN DictionaryEntries.pronunciation IS 'Pronunciation guide (pinyin, romaji, romanization). Set during data import';
COMMENT ON COLUMN DictionaryEntries."numberedPinyin" IS 'Numbered pinyin notation (e.g. "gan1 huo4" from "gān huò"). ü is represented as v. Neutral tone syllables have no number. Computed by backfill-numbered-pinyin.js';
COMMENT ON COLUMN DictionaryEntries.tone IS 'Tone digit string derived from pronunciation (e.g. "42" for rèn wu). Computed by backfill-tones.js';

-- Classification
COMMENT ON COLUMN DictionaryEntries."partsOfSpeech" IS 'JSONB array of parts of speech (e.g. noun, verb, adj). AI-generated via backfill';
COMMENT ON COLUMN DictionaryEntries."hskLevel" IS 'HSK proficiency level tag (HSK1-HSK6). Set during data import or AI backfill';

-- Definitions
COMMENT ON COLUMN DictionaryEntries.definitions IS 'JSON array of definition strings. Set during data import';
COMMENT ON COLUMN DictionaryEntries."longDefinition" IS 'AI-generated concise definition (25-75 chars). Generated via backfill-short-long-definitions.js using Claude Haiku';

-- AI-enriched content
COMMENT ON COLUMN DictionaryEntries.breakdown IS 'Per-character definitions JSONB. AI-generated via backfill-dictionary-breakdown.js';
COMMENT ON COLUMN DictionaryEntries.synonyms IS 'JSON array of synonym words. AI-generated via backfill-synonyms.js';
COMMENT ON COLUMN DictionaryEntries."exampleSentences" IS 'JSON array of example sentence objects. AI-generated via backfill-example-sentences.js';
COMMENT ON COLUMN DictionaryEntries.expansion IS 'Expanded/fuller form of the word. AI-generated via backfill-enrichment.js';
COMMENT ON COLUMN DictionaryEntries."expansionLiteralTranslation" IS 'Literal translation phrase of expansion showing how components combine to original meaning. AI-generated via backfill-expansion.js';
COMMENT ON COLUMN DictionaryEntries.classifier IS 'JSONB array of valid measure word characters for Chinese nouns (e.g. ["辆"] for 车, ["只","条"] for 鱼). NULL for non-nouns or words without a standard classifier. AI-generated via backfill-classifier.js';
