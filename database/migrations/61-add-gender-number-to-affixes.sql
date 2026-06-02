-- Migration 61: Add gender + grammatical number to affixes, and allow
--               interfix/infix affix types. (Runs after 59 creates the table.)
--
-- Some Spanish bound morphemes are inflected forms of other affixes and carry
-- the same singular/plural + gender caveats that headwords do (e.g. the
-- participle suffix "-eada" is the feminine singular of "-eado"). These were
-- missed by the original prefix/suffix-only move because their source pos tag
-- was "part"/"adj"/"n" rather than "prefix"/"suffix", so they were left behind
-- in dictionaryentries_es. Promoting them needs two new columns plus room for
-- two affix positions Spanish actually uses:
--   * interfix  — joins stems inside compounds (e.g. "-i-")
--   * infix     — inserted within a word (e.g. the gender-neutral "-x-")
--
-- gender / number mirror the single-letter convention used elsewhere for
-- Spanish: gender IN ('m','f'), number IN ('s','p'). Both are NULL for affixes
-- that are not gender/number specific (the vast majority).

ALTER TABLE affixes
    ADD COLUMN IF NOT EXISTS gender VARCHAR(10),   -- 'm' | 'f' | NULL
    ADD COLUMN IF NOT EXISTS "number" VARCHAR(10); -- 's' | 'p' | NULL  (grammatical number)

-- Widen the type CHECK to admit interfix/infix alongside prefix/suffix.
ALTER TABLE affixes DROP CONSTRAINT IF EXISTS affixes_type_check;
ALTER TABLE affixes ADD CONSTRAINT affixes_type_check
    CHECK (type IN ('prefix', 'suffix', 'interfix', 'infix'));
