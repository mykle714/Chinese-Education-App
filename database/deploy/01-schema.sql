-- Consolidated schema: creates all tables at their current state.
-- Idempotent (safe to re-run on an empty database).
-- Does NOT include test data.
--
-- Extensions required: uuid-ossp, pg_trgm (both pre-installed in the Docker postgres image).
-- Run after 00-reset.sql for a clean deployment.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─────────────────────────────────────────────────────────────
-- users
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id                         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email                      VARCHAR(255) NOT NULL UNIQUE,
    name                       VARCHAR(100) NOT NULL,
    password                   VARCHAR(255) NOT NULL,
    "selectedLanguage"         VARCHAR(10) DEFAULT 'zh',
    "totalMinutePoints"        INTEGER DEFAULT 0,
    "lastMinutePointIncrement" TIMESTAMP,
    "isPublic"                 BOOLEAN DEFAULT TRUE,
    "currentStreak"            INTEGER NOT NULL DEFAULT 0,
    "lastStreakDate"           DATE,
    "createdAt"                TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_last_minute_point_increment
    ON users("lastMinutePointIncrement");

-- ─────────────────────────────────────────────────────────────
-- vocabentries
-- Per-user vocabulary entries with learning history.
-- Enrichment data (breakdown, synonyms, etc.) is fetched at runtime
-- via JOIN with dictionaryentries on entryKey = word1.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vocabentries (
    id                 SERIAL PRIMARY KEY,
    "userId"           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    "entryKey"         TEXT NOT NULL,
    "entryValue"       TEXT NOT NULL,
    language           VARCHAR(10) DEFAULT 'zh',
    "markHistory"      JSONB DEFAULT '[]',
    "totalMarkCount"   INTEGER DEFAULT 0,
    "totalCorrectCount" INTEGER DEFAULT 0,
    "totalSuccessRate" NUMERIC(5,4),
    "last8SuccessRate" NUMERIC(5,4),
    "last16SuccessRate" NUMERIC(5,4),
    category           VARCHAR(20) NOT NULL DEFAULT 'Unfamiliar',
    "starterPackBucket" VARCHAR(20) NOT NULL
        CHECK ("starterPackBucket" IN ('library', 'learn-later', 'skip')),
    "createdAt"        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vocabentries_userid  ON vocabentries("userId");
CREATE INDEX IF NOT EXISTS idx_vocabentries_key     ON vocabentries("entryKey");
CREATE INDEX IF NOT EXISTS idx_vocabentries_language ON vocabentries(language);
-- Trigram indexes for fuzzy search
CREATE INDEX IF NOT EXISTS idx_vocabentries_key_trgm   ON vocabentries USING GIN ("entryKey"   gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_vocabentries_value_trgm ON vocabentries USING GIN ("entryValue" gin_trgm_ops);

-- ─────────────────────────────────────────────────────────────
-- texts
-- User-created reading materials.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS texts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "userId"        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title           VARCHAR(255) NOT NULL,
    description     TEXT DEFAULT '',
    content         TEXT NOT NULL,
    language        VARCHAR(10) DEFAULT 'zh',
    "characterCount" INTEGER DEFAULT 0,
    "isUserCreated" BOOLEAN DEFAULT TRUE,
    "createdAt"     TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_texts_userid ON texts("userId");

-- ─────────────────────────────────────────────────────────────
-- userminutepoints
-- Daily minute-points tracking per user. Aggregates across devices.
-- "streakDate" is the user-local 4 AM-bounded day label
-- (e.g. activity at 03:30 local on the 13th counts toward the 12th).
-- "penaltyMinutes" records minutes deducted by a streak break that
-- was attributed to this missed day.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS userminutepoints (
    "userId"            UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    "streakDate"        DATE    NOT NULL,
    "minutesEarned"     INTEGER NOT NULL DEFAULT 0,
    "penaltyMinutes"    INTEGER NOT NULL DEFAULT 0,
    "lastSyncTimestamp" TIMESTAMP DEFAULT NOW(),
    "updatedAt"         TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY ("userId", "streakDate")
);

-- ─────────────────────────────────────────────────────────────
-- dictionaryentries
-- Multi-language dictionary. Populated via data import, not user activity.
-- AI-enriched columns (breakdown, synonyms, etc.) are backfilled separately.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dictionaryentries (
    id              SERIAL PRIMARY KEY,

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
    "partsOfSpeech" JSONB,                   -- e.g. ["noun", "verb"]
    "hskLevel"      VARCHAR(10),             -- e.g. "HSK1", "HSK2", "HSK3"

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
    "matchException" JSONB DEFAULT '[]',     -- multi-char tokens to skip during GSA matching (manual override)
    "shortDefinitionPronunciationOverride" JSONB DEFAULT NULL, -- { definition?, pronunciation? } — manual overrides for computed shortDefinition and/or pronunciation
    vernacularScore SMALLINT,               -- AI-scored vernacular/colloquial usage level
    "exampleSentenceDefinitionPronunciationOverride" JSONB DEFAULT NULL -- { definition?, pronunciation? } — manual overrides for example sentence segment popup display
);

CREATE INDEX IF NOT EXISTS idx_dictionary_word1 ON dictionaryentries(word1);
CREATE INDEX IF NOT EXISTS idx_dictionary_word2 ON dictionaryentries(word2);
CREATE INDEX IF NOT EXISTS idx_dictionary_language ON dictionaryentries(language);
CREATE INDEX IF NOT EXISTS idx_dictionary_word1_language ON dictionaryentries(word1, language);
CREATE INDEX IF NOT EXISTS idx_dictionary_discoverable_language
    ON dictionaryentries(language, discoverable)
    WHERE discoverable = TRUE;

-- ─────────────────────────────────────────────────────────────
-- schema_migrations
-- Tracks which migration files have been applied to this database.
-- Populated automatically by the migrate.sh script.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schema_migrations (
    version     INTEGER PRIMARY KEY,            -- migration number (e.g. 36)
    name        VARCHAR(255) NOT NULL,          -- filename (e.g. "36-add-foo.sql")
    applied_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- particlesandclassifiers
-- Reference table for Chinese grammatical particles and classifiers.
-- Seeded via backfill-particles-and-classifiers.js using Claude Sonnet.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS particlesandclassifiers (
    id          SERIAL PRIMARY KEY,
    character   VARCHAR(10)  NOT NULL,   -- single function-word character, e.g. 的, 辆
    language    VARCHAR(10)  NOT NULL DEFAULT 'zh',
    type        VARCHAR(20)  NOT NULL    -- 'particle' or 'classifier'
                CHECK (type IN ('particle', 'classifier')),
    definition  TEXT         NOT NULL,   -- concise contextual description, e.g. "possessive/attributive particle"
    "createdAt" TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Primary lookup: (character, language, type) is unique — a char can be both a particle and a classifier
CREATE UNIQUE INDEX IF NOT EXISTS idx_pac_char_lang_type
    ON particlesandclassifiers(character, language, type);

-- Secondary index for batch lookup by character + language (used in enrichExampleSentencesMetadataBatch)
CREATE INDEX IF NOT EXISTS idx_pac_char_lang
    ON particlesandclassifiers(character, language);
