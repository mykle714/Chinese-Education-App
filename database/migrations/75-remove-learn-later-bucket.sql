-- Migration 75: Remove the 'learn-later' starter-pack bucket
--
-- WHY
-- The "Learn Later" concept has been removed from the product. Cards are now
-- sorted only into 'library' (Learn Now) or 'skip' during Discover; the dedicated
-- Learn Later decks section, the CDP cycle toggle, and the
-- /api/onDeck/learn-later-cards endpoint are all gone. The StarterPackBucket type
-- is now 'library' | 'skip' (with 'already-learned' still mapping to 'library' at
-- sort time).
--
-- WHAT
--   1. Hard-delete every vocabentries row currently in the 'learn-later' bucket
--      (per the product decision to discard, not migrate, those cards).
--   2. Tighten the CHECK constraints on both per-language vet tables to only allow
--      ('library','skip').
--
-- Idempotent: safe to re-run. The deletes no-op once the bucket is empty, and the
-- constraints are dropped IF EXISTS before being recreated.

-- 1. Discard existing learn-later cards.
DELETE FROM vocabentries_zh WHERE "starterPackBucket" = 'learn-later';
DELETE FROM vocabentries_es WHERE "starterPackBucket" = 'learn-later';

-- 2. Recreate the bucket CHECK constraints without 'learn-later'.
ALTER TABLE vocabentries_zh DROP CONSTRAINT IF EXISTS chk_zh_starter_pack_bucket;
ALTER TABLE vocabentries_zh
  ADD CONSTRAINT chk_zh_starter_pack_bucket
  CHECK ("starterPackBucket" IN ('library','skip'));

ALTER TABLE vocabentries_es DROP CONSTRAINT IF EXISTS chk_es_starter_pack_bucket;
ALTER TABLE vocabentries_es
  ADD CONSTRAINT chk_es_starter_pack_bucket
  CHECK ("starterPackBucket" IN ('library','skip'));
