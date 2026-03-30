-- Migration: Lowercase all pronunciation values for consistency
-- Affects: dictionaryentries (pronunciation, breakdown, expansionMetadata)
--          vocabentries (pronunciation)

-- 1. Lowercase main pronunciation column in dictionaryentries
UPDATE dictionaryentries
SET pronunciation = LOWER(pronunciation)
WHERE pronunciation <> LOWER(pronunciation);

-- 2. Lowercase main pronunciation column in vocabentries
UPDATE vocabentries
SET pronunciation = LOWER(pronunciation)
WHERE pronunciation IS NOT NULL
  AND pronunciation <> LOWER(pronunciation);

-- 3. Lowercase pronunciation values inside breakdown JSONB
UPDATE dictionaryentries
SET breakdown = (
    SELECT jsonb_object_agg(
        key,
        CASE
            WHEN value ? 'pronunciation'
            THEN jsonb_set(value, '{pronunciation}', to_jsonb(LOWER(value->>'pronunciation')))
            ELSE value
        END
    )
    FROM jsonb_each(breakdown)
)
WHERE breakdown IS NOT NULL
  AND breakdown::text ~ '"pronunciation": "[A-Z]';

-- 4. Lowercase pronunciation values inside expansionMetadata JSONB
UPDATE dictionaryentries
SET "expansionMetadata" = (
    SELECT jsonb_object_agg(
        key,
        CASE
            WHEN value ? 'pronunciation'
            THEN jsonb_set(value, '{pronunciation}', to_jsonb(LOWER(value->>'pronunciation')))
            ELSE value
        END
    )
    FROM jsonb_each("expansionMetadata")
)
WHERE "expansionMetadata" IS NOT NULL
  AND "expansionMetadata"::text ~ '"pronunciation": "[A-Z]';
