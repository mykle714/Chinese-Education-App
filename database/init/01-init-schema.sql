-- Consolidated schema: creates all tables at their current state.
-- Mirrors database/deploy/01-schema.sql exactly.
-- Idempotent — safe to re-run on an empty database.
-- Does NOT include test data (see 02-test-users.sql, 03-reader-vocab-test-user.sql).

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
    "isValidator"              BOOLEAN NOT NULL DEFAULT FALSE,
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
-- via JOIN with dictionaryentries on entryKey = word1 AND language.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vocabentries (
    id                  SERIAL PRIMARY KEY,
    "userId"            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    "entryKey"          TEXT NOT NULL,
    language            VARCHAR(10) DEFAULT 'zh',
    "markHistory"       JSONB DEFAULT '[]',
    "totalMarkCount"    INTEGER DEFAULT 0,
    "totalCorrectCount" INTEGER DEFAULT 0,
    "totalSuccessRate"  NUMERIC(5,4),
    "last8SuccessRate"  NUMERIC(5,4),
    "last16SuccessRate" NUMERIC(5,4),
    category            VARCHAR(20) NOT NULL DEFAULT 'Unfamiliar',
    "starterPackBucket" VARCHAR(20) NOT NULL
        CHECK ("starterPackBucket" IN ('library', 'skip')),
    "createdAt"         TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vocabentries_userid   ON vocabentries("userId");
CREATE INDEX IF NOT EXISTS idx_vocabentries_key      ON vocabentries("entryKey");
CREATE INDEX IF NOT EXISTS idx_vocabentries_language ON vocabentries(language);
-- Trigram index on entryKey for fuzzy search. Definition search joins det
-- and expands definitions via jsonb_array_elements_text at query time.
CREATE INDEX IF NOT EXISTS idx_vocabentries_key_trgm   ON vocabentries USING GIN ("entryKey"   gin_trgm_ops);

-- ─────────────────────────────────────────────────────────────
-- texts
-- User-created reading materials.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS texts (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "userId"         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title            VARCHAR(255) NOT NULL,
    description      TEXT DEFAULT '',
    content          TEXT NOT NULL,
    language         VARCHAR(10) DEFAULT 'zh',
    "characterCount" INTEGER DEFAULT 0,
    "isUserCreated"  BOOLEAN DEFAULT TRUE,
    -- Validation-doc linkage (migration 104). NULL ⇒ ordinary user document.
    -- validationEntryId is the SERIAL integer id of the reviewed det row.
    "validationEntryId"          INTEGER,
    "validationLanguage"         VARCHAR(10),
    "validationField"            VARCHAR(50),
    "createdAt"      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_texts_userid ON texts("userId");

-- ─────────────────────────────────────────────────────────────
-- validations
-- Human review records (approve/flag) for AI-enriched dictionary fields
-- (migration 104; docs/DATA_VALIDATION_SYSTEM.md). Deliberately a standalone
-- table, NOT a column on dictionaryentries_* — those are TRUNCATE+restored on
-- every prod data deploy, which would wipe review data. Keyed by the det row's
-- surrogate id (stable across data deploys) + language.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS validations (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "entryId"         INTEGER      NOT NULL,   -- dictionaryentries_<language>.id
    language          VARCHAR(10)  NOT NULL,
    field             VARCHAR(50)  NOT NULL,   -- definitions | exampleSentence0..2
    "validatorUserId" UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    "validatorName"   TEXT         NOT NULL,
    action            VARCHAR(20)  NOT NULL CHECK (action IN ('approve','flag')),
    content           TEXT,        -- approved data version (copied verbatim); NULL for flag
    "createdAt"       TIMESTAMP    DEFAULT NOW(),
    CONSTRAINT validations_unique_per_user UNIQUE ("entryId", language, field, "validatorUserId")
);
CREATE INDEX IF NOT EXISTS idx_validations_entry ON validations ("entryId", language);
CREATE INDEX IF NOT EXISTS idx_validations_user  ON validations ("validatorUserId");

-- ─────────────────────────────────────────────────────────────
-- userminutepoints
-- Daily minute-points tracking per user, per language. Aggregates across devices.
-- "streakDate" is the user-local 4 AM-bounded day label
-- (e.g. activity at 03:30 local on the 13th counts toward the 12th).
-- "language" attributes each earned minute to the language the user was
-- studying; the streak itself stays global (any language keeps it alive).
-- "penaltyMinutes" records minutes deducted by a streak break that
-- was attributed to this missed day.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS userminutepoints (
    "userId"            UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    "streakDate"        DATE    NOT NULL,
    "language"          VARCHAR(10) NOT NULL DEFAULT 'zh',
    "minutesEarned"     INTEGER NOT NULL DEFAULT 0,
    "penaltyMinutes"    INTEGER NOT NULL DEFAULT 0,
    "lastSyncTimestamp" TIMESTAMP DEFAULT NOW(),
    "updatedAt"         TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY ("userId", "streakDate", "language")
);

-- ─────────────────────────────────────────────────────────────
-- schema_migrations
-- Tracks which migration files have been applied to this database.
-- Populated automatically by database/deploy/migrate.sh.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,           -- migration number (e.g. 36)
    name       VARCHAR(255) NOT NULL,         -- filename (e.g. "36-add-foo.sql")
    applied_at TIMESTAMP NOT NULL DEFAULT NOW()
);
