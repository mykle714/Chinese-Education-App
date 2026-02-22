-- Migration 20: Replace OnDeckVocabSets with starterPackBucket column on VocabEntries
-- This simplifies the architecture by storing bucket status directly on each vocab entry
-- instead of maintaining separate arrays in OnDeckVocabSets

-- Step 1: Add starterPackBucket column to vocabentries table
ALTER TABLE vocabentries 
ADD COLUMN "starterPackBucket" VARCHAR(20);

-- Step 2: Migrate existing data from OnDeckVocabSets to the new column
-- Priority order for conflicts: library > learn-later > skip
-- (if a card is in multiple buckets, we take the highest priority one)

-- Migrate library cards
UPDATE vocabentries v
SET "starterPackBucket" = 'library'
FROM "OnDeckVocabSets" o,
     jsonb_array_elements_text(o."vocabEntryIds"::jsonb) AS entry_id
WHERE v.id = entry_id::integer
  AND o."featureName" LIKE '%-library'
  AND v."starterPackBucket" IS NULL;

-- Migrate learn-later cards (only if not already set)
UPDATE vocabentries v
SET "starterPackBucket" = 'learn-later'
FROM "OnDeckVocabSets" o,
     jsonb_array_elements_text(o."vocabEntryIds"::jsonb) AS entry_id
WHERE v.id = entry_id::integer
  AND o."featureName" LIKE '%-learn-later'
  AND v."starterPackBucket" IS NULL;

-- Migrate skip cards (only if not already set)
UPDATE vocabentries v
SET "starterPackBucket" = 'skip'
FROM "OnDeckVocabSets" o,
     jsonb_array_elements_text(o."vocabEntryIds"::jsonb) AS entry_id
WHERE v.id = entry_id::integer
  AND o."featureName" LIKE '%-skip'
  AND v."starterPackBucket" IS NULL;

-- Step 3: Drop the OnDeckVocabSets table (no longer needed)
DROP TABLE IF EXISTS "OnDeckVocabSets";

-- Step 4: Add index on new column for query performance
CREATE INDEX idx_vocabentries_starter_pack_bucket ON vocabentries("starterPackBucket");

-- Step 5: Add check constraint to ensure valid values
ALTER TABLE vocabentries
ADD CONSTRAINT chk_starter_pack_bucket 
CHECK ("starterPackBucket" IN ('library', 'learn-later', 'skip') OR "starterPackBucket" IS NULL);

-- Step 6: Add column comment
COMMENT ON COLUMN vocabentries."starterPackBucket" IS 'Starter pack sorting bucket: library (active study), learn-later (postponed), skip (ignored), or NULL (unsorted)';
