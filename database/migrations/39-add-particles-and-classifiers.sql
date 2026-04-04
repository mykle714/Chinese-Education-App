-- Migration 39: Add particlesandclassifiers reference table.
-- Stores contextual definitions for Chinese grammatical particles and classifiers.
-- Keyed on (character, language, type) to allow one character to serve both roles.
-- Seeded via backfill-particles-and-classifiers.js using Claude Sonnet.

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
