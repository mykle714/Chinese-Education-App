-- Migration 30: Reorder dictionaryentries columns and normalize naming
-- - Reorders columns into logical groups (identity, words, enrichment, AI-generated)
-- - Renames createdat → "createdAt" for camelCase consistency
-- - Adds "partsOfSpeech" column (already exists in live DB but was missing from schema)
-- - Ensures numberedPinyin and exampleSentencesMetadata columns exist

BEGIN;

-- 1. Create new table with desired column order
CREATE TABLE dictionaryentries_new (
    id SERIAL PRIMARY KEY,
    language VARCHAR(10) NOT NULL DEFAULT 'zh',
    script VARCHAR(20),
    discoverable BOOLEAN NOT NULL DEFAULT FALSE,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Word forms and pronunciation
    word1 VARCHAR(500) NOT NULL,
    word2 VARCHAR(500),
    pronunciation VARCHAR(500),
    "numberedPinyin" VARCHAR(500),
    tone VARCHAR(20),

    -- Classification
    "partsOfSpeech" JSONB,
    "hskLevelTag" VARCHAR(10),

    -- Definitions
    definitions JSONB NOT NULL,
    "longDefinition" TEXT,

    -- AI-enriched content
    breakdown JSONB,
    synonyms JSONB,
    "exampleSentences" JSONB,
    "exampleSentencesMetadata" JSONB,
    expansion TEXT,
    "expansionMetadata" JSONB
);

-- 2. Copy data from old table
-- Note: old table uses lowercase "createdat", new table uses camelCase "createdAt"
-- Some columns (numberedPinyin, exampleSentencesMetadata, partsOfSpeech) may or may not exist
-- in the live DB, so we use a DO block to handle this dynamically
DO $$
DECLARE
    has_numbered_pinyin BOOLEAN;
    has_example_meta BOOLEAN;
    has_parts_of_speech BOOLEAN;
    insert_cols TEXT;
    select_cols TEXT;
BEGIN
    -- Check which optional columns exist in the old table
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'dictionaryentries' AND column_name = 'numberedPinyin'
    ) INTO has_numbered_pinyin;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'dictionaryentries' AND column_name = 'exampleSentencesMetadata'
    ) INTO has_example_meta;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'dictionaryentries' AND column_name = 'partsOfSpeech'
    ) INTO has_parts_of_speech;

    -- Build the column lists dynamically
    insert_cols := 'id, language, script, discoverable, "createdAt", word1, word2, pronunciation, ';
    select_cols := 'id, language, script, discoverable, createdat, word1, word2, pronunciation, ';

    IF has_numbered_pinyin THEN
        insert_cols := insert_cols || '"numberedPinyin", ';
        select_cols := select_cols || '"numberedPinyin", ';
    END IF;

    insert_cols := insert_cols || 'tone, ';
    select_cols := select_cols || 'tone, ';

    IF has_parts_of_speech THEN
        insert_cols := insert_cols || '"partsOfSpeech", ';
        select_cols := select_cols || '"partsOfSpeech", ';
    END IF;

    insert_cols := insert_cols || '"hskLevelTag", definitions, "longDefinition", breakdown, synonyms, "exampleSentences", ';
    select_cols := select_cols || '"hskLevelTag", definitions, "longDefinition", breakdown, synonyms, "exampleSentences", ';

    IF has_example_meta THEN
        insert_cols := insert_cols || '"exampleSentencesMetadata", ';
        select_cols := select_cols || '"exampleSentencesMetadata", ';
    END IF;

    insert_cols := insert_cols || 'expansion, "expansionMetadata"';
    select_cols := select_cols || 'expansion, "expansionMetadata"';

    -- Execute the dynamic INSERT...SELECT
    EXECUTE format(
        'INSERT INTO dictionaryentries_new (%s) SELECT %s FROM dictionaryentries',
        insert_cols, select_cols
    );
END $$;

-- 3. Reset the sequence to continue from the max id
SELECT setval('dictionaryentries_new_id_seq', (SELECT COALESCE(MAX(id), 1) FROM dictionaryentries_new));

-- 4. Drop old table and rename new one
DROP TABLE dictionaryentries;
ALTER TABLE dictionaryentries_new RENAME TO dictionaryentries;
ALTER SEQUENCE dictionaryentries_new_id_seq RENAME TO dictionaryentries_id_seq;
ALTER INDEX dictionaryentries_new_pkey RENAME TO dictionaryentries_pkey;

-- 5. Recreate indices
CREATE INDEX idx_dictionary_word1 ON dictionaryentries(word1);
CREATE INDEX idx_dictionary_word2 ON dictionaryentries(word2);
CREATE INDEX idx_dictionary_language ON dictionaryentries(language);
CREATE INDEX idx_dictionary_word1_language ON dictionaryentries(word1, language);
CREATE INDEX idx_dictionary_discoverable_language
  ON dictionaryentries(language, discoverable)
  WHERE discoverable = TRUE;

-- 6. Restore table and column comments
COMMENT ON TABLE dictionaryentries IS 'Multi-language dictionary entries';

-- Identity columns
COMMENT ON COLUMN dictionaryentries.id IS 'Auto-incrementing primary key. Populated during data import';
COMMENT ON COLUMN dictionaryentries.language IS 'Language code: zh, ja, ko, vi. Set during data import';
COMMENT ON COLUMN dictionaryentries.script IS 'Writing script variant (e.g. simplified, traditional). Set during data import';
COMMENT ON COLUMN dictionaryentries.discoverable IS 'Whether this entry appears in vocab discovery. Set during data import';
COMMENT ON COLUMN dictionaryentries."createdAt" IS 'Row creation timestamp. Auto-populated by DEFAULT CURRENT_TIMESTAMP';

-- Word forms
COMMENT ON COLUMN dictionaryentries.word1 IS 'Primary word form (simplified Chinese, kanji, hangul, Vietnamese word). Set during data import';
COMMENT ON COLUMN dictionaryentries.word2 IS 'Secondary word form (traditional Chinese, kana, hanja). Set during data import';
COMMENT ON COLUMN dictionaryentries.pronunciation IS 'Pronunciation guide (pinyin, romaji, romanization). Set during data import';
COMMENT ON COLUMN dictionaryentries."numberedPinyin" IS 'Numbered pinyin notation (e.g. "gan1 huo4" from "gān huò"). ü is represented as v. Neutral tone syllables have no number. Computed by backfill-numbered-pinyin.js';
COMMENT ON COLUMN dictionaryentries.tone IS 'Tone digit string derived from pronunciation (e.g. "42" for rèn wu). Computed by backfill-tones.js';

-- Classification
COMMENT ON COLUMN dictionaryentries."partsOfSpeech" IS 'JSONB array of parts of speech (e.g. noun, verb, adj). AI-generated via backfill';
COMMENT ON COLUMN dictionaryentries."hskLevelTag" IS 'HSK proficiency level tag (e.g. "1", "2"). Set during data import';

-- Definitions
COMMENT ON COLUMN dictionaryentries.definitions IS 'JSON array of definition strings. Set during data import';
COMMENT ON COLUMN dictionaryentries."longDefinition" IS 'AI-generated concise definition (25-75 chars). Generated via backfill-short-long-definitions.js using Claude Haiku';

-- AI-enriched content
COMMENT ON COLUMN dictionaryentries.breakdown IS 'Per-character definitions JSONB. AI-generated via backfill-dictionary-breakdown.js';
COMMENT ON COLUMN dictionaryentries.synonyms IS 'JSON array of synonym words. AI-generated via backfill-synonyms.js';
COMMENT ON COLUMN dictionaryentries."exampleSentences" IS 'JSON array of example sentence objects. AI-generated via backfill-example-sentences.js';
COMMENT ON COLUMN dictionaryentries."exampleSentencesMetadata" IS 'Per-character pronunciation data for example sentences. Computed via backfill-example-sentences-metadata.js';
COMMENT ON COLUMN dictionaryentries.expansion IS 'Expanded/fuller form of the word. AI-generated via backfill-enrichment.js';
COMMENT ON COLUMN dictionaryentries."expansionMetadata" IS 'Segment definitions and per-character pronunciation for expansion. Computed via backfill-expansion-definitions.js';

COMMIT;
