-- Migration 41: Add vernacularScore column to dictionaryentries
-- AI-generated register score: how everyday/spoken this word is vs. literary/formal.
-- 5 = natural vernacular everyday speech, 1 = formal/literary/written language only.
-- NULL = not yet scored. Populated via backfill-vernacular-score.js.

ALTER TABLE dictionaryentries
  ADD COLUMN IF NOT EXISTS "vernacularScore" SMALLINT;

COMMENT ON COLUMN dictionaryentries."vernacularScore" IS
  'AI-generated vernacular score (1–5): 5=natural everyday spoken word, 4=informal-leaning, 3=neutral register, 2=formal/written-leaning, 1=literary/classical/formal only. NULL = not yet scored. See backfill-vernacular-score.js';
