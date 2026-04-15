-- Add per-entry override column for example sentence segment display.
-- Allows manually pinning the pronunciation and/or definition shown in the
-- segment popup of example sentences, independently of shortDefinitionPronunciationOverride.
ALTER TABLE dictionaryentries
  ADD COLUMN IF NOT EXISTS "exampleSentenceDefinitionPronunciationOverride" JSONB DEFAULT NULL;

COMMENT ON COLUMN dictionaryentries."exampleSentenceDefinitionPronunciationOverride"
  IS '{ definition?, pronunciation? } — if set, these values are used verbatim in example sentence segment popups instead of the context-matched definition and stored pronunciation';

-- Seed: 到 should always show "to arrive" / "dào" in segment popups,
-- not whatever context-matching picks from its large definition list.
UPDATE dictionaryentries
SET "exampleSentenceDefinitionPronunciationOverride" = '{"definition": "to arrive", "pronunciation": "dào"}'
WHERE word1 = '到' AND language = 'zh';
