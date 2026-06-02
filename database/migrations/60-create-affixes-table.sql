-- Migration 60: Create the affixes table
--
-- Prefixes and suffixes are kept OUT of the per-language dictionary entry
-- tables (det / Spanish det) because they are bound morphemes, not standalone
-- headwords, and they behave differently in lookup/segmentation. This table is
-- language-scoped so affixes from any language (Spanish, and later others)
-- share one schema.

CREATE TABLE IF NOT EXISTS affixes (
    id          SERIAL PRIMARY KEY,
    language    VARCHAR(10)  NOT NULL,                 -- 'es', 'zh', ...
    affix       VARCHAR(100) NOT NULL,                 -- surface form incl. hyphen, e.g. 'a-', '-mente'
    type        VARCHAR(10)  NOT NULL,                 -- 'prefix' | 'suffix'
    definitions JSONB        NOT NULL,                 -- array of English glosses
    notes       TEXT,                                  -- etymology / usage notes
    "createdAt" TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT affixes_type_check CHECK (type IN ('prefix', 'suffix')),
    CONSTRAINT uq_affixes_language_affix_type UNIQUE (language, affix, type)
);

CREATE INDEX IF NOT EXISTS idx_affixes_language ON affixes(language);
