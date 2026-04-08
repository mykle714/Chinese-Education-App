-- Migration 42: Make starterPackBucket NOT NULL on vocabentries
-- All valid vocab entries must have a starter pack bucket; null is not a valid state.

-- Drop the old check constraint (which allowed NULL) and replace with one that excludes it
ALTER TABLE vocabentries
DROP CONSTRAINT chk_starter_pack_bucket;

ALTER TABLE vocabentries
ADD CONSTRAINT chk_starter_pack_bucket
CHECK ("starterPackBucket" IN ('library', 'learn-later', 'skip'));

-- Enforce NOT NULL at the column level
ALTER TABLE vocabentries
ALTER COLUMN "starterPackBucket" SET NOT NULL;

-- Update column comment
COMMENT ON COLUMN vocabentries."starterPackBucket" IS 'Starter pack sorting bucket: library (active study), learn-later (postponed), skip (ignored). Required on all vocab entries.';
