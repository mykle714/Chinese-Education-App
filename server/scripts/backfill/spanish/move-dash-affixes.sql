-- Move leftover dash-prefixed affixes out of dictionaryentries_es into affixes.
--
-- Context: the original Spanish affix extraction only moved rows whose source
-- pos was 'prefix'/'suffix'. Inflected/derived bound morphemes carried other
-- pos tags ('part', 'adj', 'n', 'interfix', 'infix') and so were stranded in
-- dictionaryentries_es even though their headword (word1) is hyphenated. This
-- script promotes every remaining hyphen-bounded entry to the affixes table,
-- deriving:
--   * type   from the hyphen position / source pos:
--       both-side hyphen + pos 'interfix'/'infix'  -> 'interfix'/'infix'
--       leading hyphen only                        -> 'suffix'
--   * gender from the es-dict combined token ('f-s'/'f-p'/'m-p') -> 'm'|'f'
--   * number from the same token                                -> 's'|'p'
--   * notes  from the source etymology (NULL when blank)
--
-- Requires migration 60 (gender/number columns + interfix/infix in the type
-- CHECK constraint). Idempotent: ON CONFLICT DO NOTHING collapses the duplicate
-- '-entes' rows (pos adj + n, identical gloss) into a single suffix and makes
-- re-runs safe.

BEGIN;

INSERT INTO affixes (language, affix, type, definitions, notes, gender, "number")
SELECT
    'es' AS language,
    word1 AS affix,
    CASE
        WHEN pos IN ('interfix', 'infix') THEN pos   -- both-side hyphen positions
        ELSE 'suffix'                                -- leading hyphen -> suffix
    END AS type,
    definitions,
    NULLIF(etymology, '') AS notes,
    CASE
        WHEN gender LIKE 'm%' THEN 'm'
        WHEN gender LIKE 'f%' THEN 'f'
    END AS gender,
    CASE
        WHEN gender LIKE '%-s' THEN 's'
        WHEN gender LIKE '%-p' THEN 'p'
    END AS "number"
FROM dictionaryentries_es
WHERE word1 LIKE '-%' OR word1 LIKE '%-'
ON CONFLICT (language, affix, type) DO NOTHING;

DELETE FROM dictionaryentries_es
WHERE word1 LIKE '-%' OR word1 LIKE '%-';

COMMIT;
