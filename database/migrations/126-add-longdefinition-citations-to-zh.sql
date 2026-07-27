-- Migration 126: Add `longDefinitionCitations` to dictionaryentries_zh
--
-- An AI long definition may cite Chinese inline ("as in 开会, to hold a meeting"). At read
-- time `DictionaryDAL.segmentLongDefinitionTexts` splits those Han runs out as `foreign`
-- parts and the client renders them as cpcd. Until now a tap on such a run popped the
-- SEGMENT's dictionary gloss, which reads as a word list rather than as the phrase the
-- definition is actually citing.
--
-- This column stores, per entry, an English translation for each embedded Han run found
-- anywhere in that entry's `longDefinition` (across ALL senses — the runs are keyed by
-- their exact Chinese text, which is unique enough within one headword's definitions).
-- At read time the enricher attaches the matching translation to its `foreign` part; the
-- client then highlights the WHOLE run on tap and shows the translation.
--
-- Shape: jsonb array of { zh, en }
--   [ { "zh": "他会说中文", "en": "He can speak Chinese." },
--     { "zh": "开会",       "en": "to hold a meeting" } ]
--
-- Deliberately a SEPARATE column rather than a field inside `longDefinition`: the
-- validation system's `definitionsApproved` check (migration 104,
-- docs/DATA_VALIDATION_SYSTEM.md) compares the raw `partsOfSpeech` + `definitions` +
-- `longDefinition` columns against the approved snapshot, so writing into `longDefinition`
-- would invalidate every existing approval. Translations are a rendering aid, not part of
-- the reviewed definition text.
--
-- Chinese-only: `dictionaryentries_es` long definitions carry no Han runs and the parts
-- splitter short-circuits for non-zh, so no es counterpart exists.
--
-- Written by server/scripts/backfill/chinese/backfill-longdef-citations.js, which runs
-- immediately AFTER backfill-long-definitions.js in the /mark-discoverable pipeline.
--
-- Idempotent: safe to re-run.

ALTER TABLE dictionaryentries_zh
  ADD COLUMN IF NOT EXISTS "longDefinitionCitations" jsonb;

COMMENT ON COLUMN dictionaryentries_zh."longDefinitionCitations" IS
  'jsonb array of { zh, en }: English translations for the Chinese runs embedded in longDefinition, keyed by the exact run text. Attached to longDefinitionParts at read time so a tap highlights the whole run and shows its translation. Written by backfill-longdef-citations.js. See docs/DEFINITION_MAPPING.md.';
