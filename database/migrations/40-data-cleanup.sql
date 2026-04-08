-- Data cleanup migration
-- Operation 1: Remove standalone "CL:..." entries and inline " (CL:...)" patterns
-- from the definitions JSONB array in dictionaryentries.
UPDATE dictionaryentries
SET definitions = (
  SELECT jsonb_agg(to_jsonb(cleaned_def))
  FROM (
    SELECT
      trim(regexp_replace(def_text, '\s*\(CL:[^)]*\)', '', 'g')) AS cleaned_def
    FROM jsonb_array_elements_text(definitions) AS def_text
    WHERE def_text !~ '^CL:'
  ) sub
  WHERE cleaned_def != '' AND cleaned_def IS NOT NULL
)
WHERE definitions::text ~ 'CL:';

-- Operation 2: Remove inline "(abbr. for ...)" patterns from definitions.
UPDATE dictionaryentries
SET definitions = (
  SELECT jsonb_agg(to_jsonb(cleaned_def))
  FROM (
    SELECT
      trim(regexp_replace(def_text, '\s*\(abbr\. for [^)]*\)', '', 'g')) AS cleaned_def
    FROM jsonb_array_elements_text(definitions) AS def_text
    WHERE def_text !~ '^abbr\. for '
  ) sub
  WHERE cleaned_def != '' AND cleaned_def IS NOT NULL
)
WHERE definitions::text ~ '\(abbr\. for ';

-- Operation 3: Remove entire definition entries matching "abbr. for .*"
-- Entries left with no definitions are set to [].
UPDATE dictionaryentries
SET definitions = COALESCE(
  (
    SELECT jsonb_agg(to_jsonb(def_text))
    FROM jsonb_array_elements_text(definitions) AS def_text
    WHERE def_text !~ '^abbr\. for '
  ),
  '[]'::jsonb
)
WHERE EXISTS (
  SELECT 1 FROM jsonb_array_elements_text(definitions) AS def
  WHERE def ~ '^abbr\. for '
);
