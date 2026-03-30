-- Drop the shortDefinition column — now computed at runtime from definitions JSONB
-- via generateShortDefinition() in server/utils/definitions.ts
ALTER TABLE dictionaryentries DROP COLUMN IF EXISTS "shortDefinition";

-- Add column comments to document how each column is populated
-- Populated during data import (dictionaryentries-data.sql / import-data.js)
COMMENT ON COLUMN dictionaryentries.id IS 'Auto-incrementing primary key. Populated during data import';
COMMENT ON COLUMN dictionaryentries.language IS 'Language code: zh, ja, ko, vi. Set during data import';
COMMENT ON COLUMN dictionaryentries.word1 IS 'Primary word form (simplified Chinese, kanji, hangul, Vietnamese word). Set during data import';
COMMENT ON COLUMN dictionaryentries.word2 IS 'Secondary word form (traditional Chinese, kana, hanja). Set during data import';
COMMENT ON COLUMN dictionaryentries.pronunciation IS 'Pronunciation guide (pinyin, romaji, romanization). Set during data import';
COMMENT ON COLUMN dictionaryentries.definitions IS 'JSON array of definition strings. Set during data import';
COMMENT ON COLUMN dictionaryentries.discoverable IS 'Whether this entry appears in vocab discovery. Set during data import';
COMMENT ON COLUMN dictionaryentries.script IS 'Writing script variant (e.g. simplified, traditional). Set during data import';
COMMENT ON COLUMN dictionaryentries."hskLevelTag" IS 'HSK proficiency level tag (e.g. "1", "2"). Set during data import';
COMMENT ON COLUMN dictionaryentries.createdat IS 'Row creation timestamp. Auto-populated by DEFAULT CURRENT_TIMESTAMP';

-- Populated by backfill scripts (deterministic, no AI)
COMMENT ON COLUMN dictionaryentries.tone IS 'Tone digit string derived from pronunciation (e.g. "42" for rèn wu). Computed by backfill-tones.js';
COMMENT ON COLUMN dictionaryentries.toneless IS 'Pronunciation with tone diacritics stripped (e.g. "pin yin" from "pīn yīn"). Computed by backfill-toneless.js';

-- Populated by backfill scripts (AI-generated via Claude Haiku)
COMMENT ON COLUMN dictionaryentries.breakdown IS 'Per-character definitions JSONB. AI-generated via backfill-dictionary-breakdown.js';
COMMENT ON COLUMN dictionaryentries.synonyms IS 'JSON array of synonym words. AI-generated via backfill-synonyms.js';
COMMENT ON COLUMN dictionaryentries."synonymsMetadata" IS 'Per-character pronunciation and definition data for synonyms. AI-generated via backfill-synonyms.js';
COMMENT ON COLUMN dictionaryentries."exampleSentences" IS 'JSON array of example sentence objects. AI-generated via backfill-example-sentences.js';
COMMENT ON COLUMN dictionaryentries."exampleSentencesMetadata" IS 'Per-character pronunciation data for example sentences. Computed via backfill-example-sentences-metadata.js';
COMMENT ON COLUMN dictionaryentries.expansion IS 'Expanded/fuller form of the word. AI-generated via backfill-enrichment.js';
COMMENT ON COLUMN dictionaryentries."expansionMetadata" IS 'Segment definitions and per-character pronunciation for expansion. Computed via backfill-expansion-definitions.js';
COMMENT ON COLUMN dictionaryentries."longDefinition" IS 'AI-generated concise definition (25-75 chars). Generated via backfill-short-long-definitions.js using Claude Haiku';
