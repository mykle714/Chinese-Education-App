-- Migration 123: Spanish det/vet converge on the Chinese clustered-sense model
--
-- WHAT CHANGES
--   `dictionaryentries_es` (sdet) stops being keyed by (word1, pos, gender) and becomes
--   one row per `word1`, exactly like `dictionaryentries_zh`. The POS/gender split that
--   used to be expressed as SEPARATE ROWS moves INTO the row as `definitionClusters` —
--   the same jsonb sense-cluster column Chinese has carried since migration 90
--   (docs/DEFINITION_CLUSTERS.md).
--
-- WHY
--   The row split forced a whole parallel code path to exist purely so a saved card could
--   remember WHICH row it meant: `vocabentries_es.pos` in the identity key, the `ve.pos`
--   wrapper in server/dal/shared/vetTable.ts, the `match_rank` preference ordering in
--   server/dal/shared/dictJoin.ts, per-(word1,pos) exclusion/deletion branches throughout
--   StarterPacksService, and the `hasMultiplePos` / `alternateGender` / `alternateMeaning`
--   columns behind the POS badge. Chinese already solved the same problem — a headword
--   with mutually-unrelated meanings — with clusters plus a per-card `selectedSense` label
--   (migration 99). Collapsing es onto that model deletes the parallel path outright.
--
-- THE CLUSTER SHAPE gains `gender` (NULL for Chinese). For Chinese the hard sense boundary
-- is `reading` (heteronyms never share a cluster); for Spanish it is pos + gender, because
-- gender carries distinct meaning (cura/m "priest" vs cura/f "cure"). `reading` is NULL on
-- Spanish clusters — Spanish pronunciation is not per-sense.
--
-- SEEDING IS MECHANICAL, NOT AI. Each surviving row gets ONE CLUSTER PER SOURCE ROW,
-- carrying that row's own definitions/pos/gender/frequencyScore verbatim. Nothing is
-- invented and nothing is dropped, so the merge is lossless and reviewable. The AI
-- clusterer (the es twin of backfill-cluster-definitions.js) then re-clusters the ~843
-- discoverable words as a separate pass.
--
-- ONLY MULTI-ROW WORDS ARE SEEDED (9,087 of 111,597). A single-row word has exactly one
-- sense, so a 1-element cluster array would add nothing: `sortedSenseClusters` /
-- `resolveSelectedCluster` both return null below 2 clusters and fall back to the flat
-- `definitions[0]` dd. Leaving them NULL also keeps NULL meaning "not yet clustered" for
-- the 102,510 words the AI pass has never touched.
--
-- DELETING THE LOSING ROWS: there are no FKs to `dictionaryentries_es`, but THREE tables
-- hold SOFT references to its ids — `validations.entryId`, `discover_skips."cardId"`, and
-- `sort_packs."entryIds"` (an int[]). On the dev database all three contain zh rows only,
-- but that is a property of the DATA, not the schema, so step 6 REMAPS any es reference
-- from a deleted row onto its survivor before the delete. That step is a no-op when the
-- tables carry no es rows, and correct when they do.
--
-- Idempotent: guarded throughout, so re-running is a no-op.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The cluster column (es twin of migration 90's zh column)
-- ---------------------------------------------------------------------------
ALTER TABLE dictionaryentries_es
    ADD COLUMN IF NOT EXISTS "definitionClusters" jsonb;

COMMENT ON COLUMN dictionaryentries_es."definitionClusters" IS
    'Orthogonal sense clusters, es twin of dictionaryentries_zh.definitionClusters (migration 90). Each cluster: {sense, reading (NULL for es), pos[], gender, frequencyScore, glosses[]}. NULL = not yet clustered. See docs/DEFINITION_CLUSTERS.md.';

-- ---------------------------------------------------------------------------
-- 2. Choose one surviving row per multi-row word1
--
-- The survivor is not just the row that keeps its id — it defines the merged word's
-- DEFAULT sense, because its glosses lead the merged `definitions` array and its cluster
-- leads `definitionClusters` (clusters tie on frequencyScore, and both sorters are stable).
-- So the ordering below has to answer "which of these rows IS the word?".
--
-- Survivor preference, most-authoritative first:
--   a. discoverable    — the row learners actually see keeps its id and its enrichment
--   b. frequencyScore  — the existing "how common is this sense" signal, highest first
--   c. POS priority    — the citation-form sense. Verbs outrank nouns because a Spanish
--      infinitive that is also listed as a noun is ALWAYS the nominalized verb (comer =
--      "to eat", not "eating, food"); nouns then outrank modifiers (perro = "dog", not
--      the adjective "awful"), and closed-class//interjection senses come last (leche =
--      "milk", not the interjection "shit").
--   d. most definitions — the richest sense block wins among true equals
--   e. lowest id — deterministic tiebreak, so re-running picks the same survivor
--
-- This only has to be SANE, not perfect: once the es AI clusterer scores each cluster's
-- frequencyScore independently, `sortedSenseClusters` re-derives the default sense from
-- the scores and the seed ordering stops mattering.
--
-- `rn` doubles as the merge precedence for every column below: rn 1 wins scalars, and
-- array/object merges concatenate in rn order (survivor's values first).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE es_merge ON COMMIT DROP AS
SELECT id, word1, pos, gender, definitions, "frequencyScore", rn
FROM (
    SELECT id, word1, pos, gender, definitions, "frequencyScore",
           ROW_NUMBER() OVER (
               PARTITION BY word1
               ORDER BY discoverable DESC,
                        "frequencyScore" DESC NULLS LAST,
                        COALESCE(array_position(
                            ARRAY['v','n','adj','adv','pron','prep','conj','determiner','art',
                                  'num','part','particle','phrase','proverb','interj',
                                  'contraction','prop','letter','symbol','punct','diacrit'],
                            pos), 99),
                        jsonb_array_length(definitions) DESC,
                        id
           ) AS rn,
           COUNT(*) OVER (PARTITION BY word1) AS n
    FROM dictionaryentries_es
) ranked
WHERE n > 1;

CREATE INDEX ON es_merge (word1);
CREATE INDEX ON es_merge (id);

-- ---------------------------------------------------------------------------
-- 3. Build one cluster per source row
--
-- `sense` is the row's lead gloss verbatim — the same convention the zh clusterer's
-- single-definition fast path uses (the raw source gloss, not a model-cleaned label).
-- Because `selectedSense` addresses a cluster BY LABEL, labels must be unique within a
-- word: sibling rows can share a lead gloss (tanto/adv and tanto/pron are both "so much"),
-- so a colliding label is suffixed with its pos/gender. That suffix cannot itself collide —
-- the outgoing uq_es_word1_pos_gender constraint guarantees (word1, pos, gender) is unique.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE es_clusters ON COMMIT DROP AS
WITH labeled AS (
    SELECT m.word1, m.rn, m.pos, m.gender, m.definitions, m."frequencyScore",
           trim(m.definitions->>0) AS lead_gloss,
           COUNT(*) OVER (PARTITION BY m.word1, trim(m.definitions->>0)) AS label_dupes
    FROM es_merge m
)
SELECT word1,
       jsonb_agg(
           jsonb_build_object(
               'sense', CASE WHEN label_dupes > 1
                             THEN lead_gloss || ' (' || COALESCE(pos, '?')
                                             || COALESCE('/' || gender, '') || ')'
                             ELSE lead_gloss END,
               'reading', NULL,
               'pos', CASE WHEN pos IS NULL THEN NULL ELSE jsonb_build_array(pos) END,
               'gender', gender,
               'frequencyScore', "frequencyScore",
               'glosses', definitions
           )
           ORDER BY rn
       ) AS clusters
FROM labeled
GROUP BY word1;

-- ---------------------------------------------------------------------------
-- 4. Merge the sibling rows' data onto the survivor
--
-- Merge rules by column kind:
--   • definitions / partsOfSpeech — union in rn order, first occurrence of each value wins
--     (a sibling's duplicate gloss must not appear twice in the merged list)
--   • exampleSentences / raw      — plain concatenation in rn order; every element is a
--     distinct sense-specific object, so de-duplication would be wrong
--   • longDefinition / enrichmentLog — per-key object merge, lowest rn wins a contested key
--     (es longDefinition is keyed by POS name: {"noun": "…", "verb": "…"}, so sibling rows
--     contribute disjoint keys and the merge is naturally lossless)
--   • everything else — first non-NULL in rn order
--   • discoverable — OR across the group; the merged row is discoverable if ANY row was
-- ---------------------------------------------------------------------------
WITH def_union AS (
    SELECT word1, jsonb_agg(gloss ORDER BY rn, ord) AS definitions
    FROM (
        SELECT DISTINCT ON (m.word1, e.gloss) m.word1, e.gloss, m.rn, e.ord
        FROM es_merge m, LATERAL jsonb_array_elements(m.definitions) WITH ORDINALITY AS e(gloss, ord)
        ORDER BY m.word1, e.gloss, m.rn, e.ord
    ) d
    GROUP BY word1
),
pos_union AS (
    SELECT word1, jsonb_agg(p ORDER BY rn, ord) AS "partsOfSpeech"
    FROM (
        SELECT DISTINCT ON (m.word1, e.p) m.word1, e.p, m.rn, e.ord
        FROM es_merge m
        JOIN dictionaryentries_es de ON de.id = m.id
        , LATERAL jsonb_array_elements(de."partsOfSpeech") WITH ORDINALITY AS e(p, ord)
        ORDER BY m.word1, e.p, m.rn, e.ord
    ) p
    GROUP BY word1
),
-- Each concatenation gets its OWN CTE: unnesting both arrays in one FROM would cross-
-- product them (a row with 3 sentences and 5 raw blocks would emit each 15 times).
sentence_concat AS (
    SELECT m.word1, jsonb_agg(s.el ORDER BY m.rn, s.ord) AS "exampleSentences"
    FROM es_merge m
    JOIN dictionaryentries_es de ON de.id = m.id,
         LATERAL jsonb_array_elements(de."exampleSentences") WITH ORDINALITY AS s(el, ord)
    GROUP BY m.word1
),
raw_concat AS (
    SELECT m.word1, jsonb_agg(r.el ORDER BY m.rn, r.ord) AS raw
    FROM es_merge m
    JOIN dictionaryentries_es de ON de.id = m.id,
         LATERAL jsonb_array_elements(de.raw) WITH ORDINALITY AS r(el, ord)
    GROUP BY m.word1
),
longdef_merge AS (
    SELECT word1, jsonb_object_agg(k, v) AS "longDefinition"
    FROM (
        SELECT DISTINCT ON (m.word1, e.k) m.word1, e.k, e.v, m.rn
        FROM es_merge m
        JOIN dictionaryentries_es de ON de.id = m.id
        , LATERAL jsonb_each(de."longDefinition") AS e(k, v)
        ORDER BY m.word1, e.k, m.rn
    ) l
    GROUP BY word1
),
log_merge AS (
    SELECT word1, jsonb_object_agg(k, v) AS "enrichmentLog"
    FROM (
        SELECT DISTINCT ON (m.word1, e.k) m.word1, e.k, e.v, m.rn
        FROM es_merge m
        JOIN dictionaryentries_es de ON de.id = m.id
        , LATERAL jsonb_each(de."enrichmentLog") AS e(k, v)
        ORDER BY m.word1, e.k, m.rn
    ) l
    GROUP BY word1
),
-- First non-NULL in rn order for every plain column. array_agg(...) FILTER strips the
-- NULLs, so element [1] is the highest-precedence row that actually had a value.
scalars AS (
    SELECT m.word1,
           bool_or(de.discoverable)                                                             AS discoverable,
           min(de."createdAt")                                                                  AS "createdAt",
           (array_agg(de.script    ORDER BY m.rn) FILTER (WHERE de.script    IS NOT NULL))[1]   AS script,
           (array_agg(de.word2     ORDER BY m.rn) FILTER (WHERE de.word2     IS NOT NULL))[1]   AS word2,
           (array_agg(de.pronunciation ORDER BY m.rn) FILTER (WHERE de.pronunciation IS NOT NULL))[1] AS pronunciation,
           (array_agg(de."numberedPinyin" ORDER BY m.rn) FILTER (WHERE de."numberedPinyin" IS NOT NULL))[1] AS "numberedPinyin",
           (array_agg(de.tone      ORDER BY m.rn) FILTER (WHERE de.tone      IS NOT NULL))[1]   AS tone,
           (array_agg(de.difficulty ORDER BY m.rn) FILTER (WHERE de.difficulty IS NOT NULL))[1] AS difficulty,
           (array_agg(de.breakdown ORDER BY m.rn) FILTER (WHERE de.breakdown IS NOT NULL))[1]   AS breakdown,
           (array_agg(de.synonyms  ORDER BY m.rn) FILTER (WHERE de.synonyms  IS NOT NULL))[1]   AS synonyms,
           (array_agg(de.expansion ORDER BY m.rn) FILTER (WHERE de.expansion IS NOT NULL))[1]   AS expansion,
           (array_agg(de.classifier ORDER BY m.rn) FILTER (WHERE de.classifier IS NOT NULL))[1] AS classifier,
           (array_agg(de."expansionLiteralTranslation" ORDER BY m.rn) FILTER (WHERE de."expansionLiteralTranslation" IS NOT NULL))[1] AS "expansionLiteralTranslation",
           (array_agg(de."matchException" ORDER BY m.rn) FILTER (WHERE de."matchException" IS NOT NULL))[1] AS "matchException",
           (array_agg(de."shortDefinitionPronunciationOverride" ORDER BY m.rn) FILTER (WHERE de."shortDefinitionPronunciationOverride" IS NOT NULL))[1] AS "shortDefinitionPronunciationOverride",
           (array_agg(de."frequencyScore" ORDER BY m.rn) FILTER (WHERE de."frequencyScore" IS NOT NULL))[1] AS "frequencyScore",
           (array_agg(de."exampleSentenceDefinitionPronunciationOverride" ORDER BY m.rn) FILTER (WHERE de."exampleSentenceDefinitionPronunciationOverride" IS NOT NULL))[1] AS "exampleSentenceDefinitionPronunciationOverride",
           (array_agg(de."wordForms" ORDER BY m.rn) FILTER (WHERE de."wordForms" IS NOT NULL))[1] AS "wordForms",
           (array_agg(de."ttsVoice" ORDER BY m.rn) FILTER (WHERE de."ttsVoice" IS NOT NULL))[1]  AS "ttsVoice",
           (array_agg(de.etymology ORDER BY m.rn) FILTER (WHERE de.etymology IS NOT NULL))[1]    AS etymology,
           (array_agg(de."iconId"  ORDER BY m.rn) FILTER (WHERE de."iconId"  IS NOT NULL))[1]    AS "iconId",
           (array_agg(de."defaultIconResults" ORDER BY m.rn) FILTER (WHERE de."defaultIconResults" IS NOT NULL))[1] AS "defaultIconResults"
    FROM es_merge m
    JOIN dictionaryentries_es de ON de.id = m.id
    GROUP BY m.word1
)
UPDATE dictionaryentries_es tgt
SET definitions          = du.definitions,
    "definitionClusters" = c.clusters,
    "partsOfSpeech"      = pu."partsOfSpeech",
    "exampleSentences"   = sc."exampleSentences",
    raw                  = rc.raw,
    "longDefinition"     = ld."longDefinition",
    "enrichmentLog"      = COALESCE(lg."enrichmentLog", '{}'::jsonb),
    discoverable         = s.discoverable,
    "createdAt"          = s."createdAt",
    script               = s.script,
    word2                = s.word2,
    pronunciation        = s.pronunciation,
    "numberedPinyin"     = s."numberedPinyin",
    tone                 = s.tone,
    difficulty           = s.difficulty,
    breakdown            = s.breakdown,
    synonyms             = s.synonyms,
    expansion            = s.expansion,
    classifier           = s.classifier,
    "expansionLiteralTranslation" = s."expansionLiteralTranslation",
    "matchException"     = s."matchException",
    "shortDefinitionPronunciationOverride" = s."shortDefinitionPronunciationOverride",
    "frequencyScore"    = s."frequencyScore",
    "exampleSentenceDefinitionPronunciationOverride" = s."exampleSentenceDefinitionPronunciationOverride",
    "wordForms"          = s."wordForms",
    "ttsVoice"           = s."ttsVoice",
    etymology            = s.etymology,
    "iconId"             = s."iconId",
    "defaultIconResults" = s."defaultIconResults"
FROM es_merge m
JOIN es_clusters  c  ON c.word1  = m.word1
JOIN def_union    du ON du.word1 = m.word1
JOIN scalars      s  ON s.word1  = m.word1
LEFT JOIN pos_union       pu ON pu.word1 = m.word1
LEFT JOIN sentence_concat sc ON sc.word1 = m.word1
LEFT JOIN raw_concat      rc ON rc.word1 = m.word1
LEFT JOIN longdef_merge   ld ON ld.word1 = m.word1
LEFT JOIN log_merge       lg ON lg.word1 = m.word1
WHERE tgt.id = m.id AND m.rn = 1;

-- ---------------------------------------------------------------------------
-- 5. Saved Spanish cards are NOT migrated pos → selectedSense — deliberately.
--
-- The obvious move is to translate each vet row's `pos` into the label of the cluster
-- carrying that pos, since `pos` was the old way of saying "I mean THIS sense". Doing so
-- was tried and REJECTED: the saved `pos` values are not trustworthy. On the dev data
-- every one of `leche`(interj), `hombre`(interj), `noche`(adv), `comer`(n), `perro`(adj)
-- pointed at the word's SECONDARY sense, and `amigo` was saved as `interj` when the
-- dictionary has no interjection row for it at all — so the value cannot have come from
-- the det row the card was created against. Migrating that faithfully would have pinned
-- learners' cards to "shit" for leche and "awful" for perro.
--
-- Leaving `selectedSense` NULL puts every Spanish card on its word's default/starred sense
-- — the same place a brand-new card lands, and the same behavior Chinese cards have had
-- since migration 99. A learner who wants a different sense picks it once from the flp
-- sense picker, which now writes a stable LABEL instead of an unreliable pos.
--
-- (That this column was silently wrong is itself an argument for the change: nothing in
-- the split model ever verified that a card's pos matched the row it was displaying.)
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 6. Repoint soft id references from a losing row onto its survivor
--
-- Three tables store `dictionaryentries_es.id` values WITHOUT a foreign key, so nothing
-- would stop the delete below from stranding them:
--   validations."entryId"      — a validator's approve/flag on one entry's field
--   discover_skips."cardId"    — "skip for now" in the sort flow
--   sort_packs."entryIds"      — the authored card list for a pack (int[])
-- A stranded id is not a crash but a silent wrong answer: a skip stops suppressing its
-- card, a pack loses a slot, a validation detaches from the row it reviewed.
--
-- On the dev database all three hold zh rows only, so all of this is a no-op there. It
-- exists for prod, whose es data is not the same data. Both single-id tables carry a
-- UNIQUE constraint that the remap could collide with (the survivor may already have its
-- own row), so each remap DELETEs the colliding loser first, then updates the rest.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE es_id_remap ON COMMIT DROP AS
SELECT loser.id AS old_id, winner.id AS new_id
FROM es_merge loser
JOIN es_merge winner ON winner.word1 = loser.word1 AND winner.rn = 1
WHERE loser.rn > 1;

CREATE INDEX ON es_id_remap (old_id);

-- validations: keyed UNIQUE (entryId, language, field, validatorUserId). If the same
-- validator already reviewed the same field on the survivor, their review of the folded
-- row is redundant — drop it rather than the survivor's.
DELETE FROM validations v
USING es_id_remap r
WHERE v."entryId" = r.old_id AND v.language = 'es'
  AND EXISTS (
    SELECT 1 FROM validations keep
    WHERE keep."entryId" = r.new_id AND keep.language = v.language
      AND keep.field = v.field AND keep."validatorUserId" = v."validatorUserId"
  );

UPDATE validations v
SET "entryId" = r.new_id
FROM es_id_remap r
WHERE v."entryId" = r.old_id AND v.language = 'es';

-- discover_skips: keyed UNIQUE (userId, language, cardId). Two skips of what is now one
-- card collapse into one; keep the survivor's row.
DELETE FROM discover_skips ds
USING es_id_remap r
WHERE ds."cardId" = r.old_id AND ds.language = 'es'
  AND EXISTS (
    SELECT 1 FROM discover_skips keep
    WHERE keep."userId" = ds."userId" AND keep.language = ds.language AND keep."cardId" = r.new_id
  );

UPDATE discover_skips ds
SET "cardId" = r.new_id
FROM es_id_remap r
WHERE ds."cardId" = r.old_id AND ds.language = 'es';

-- sort_packs."entryIds" is an int[]: rewrite each element through the remap, then drop
-- any duplicate the rewrite created (a pack that listed two POS of one word now lists it
-- once, so that pack legitimately shrinks). Assigning entryIds fires the existing
-- trg_sort_packs_sync_entry_words trigger, which re-derives entryWords to match.
UPDATE sort_packs sp
SET "entryIds" = remapped."entryIds"
FROM (
    SELECT sp2.id,
           (SELECT array_agg(DISTINCT COALESCE(r.new_id, e.elem) ORDER BY COALESCE(r.new_id, e.elem))
              FROM unnest(sp2."entryIds") AS e(elem)
              LEFT JOIN es_id_remap r ON r.old_id = e.elem) AS "entryIds"
    FROM sort_packs sp2
    WHERE sp2.language = 'es'
      AND EXISTS (SELECT 1 FROM unnest(sp2."entryIds") AS e(elem)
                   JOIN es_id_remap r ON r.old_id = e.elem)
) remapped
WHERE sp.id = remapped.id;

-- ---------------------------------------------------------------------------
-- 7. Delete the losing rows, then make word1 the key
-- ---------------------------------------------------------------------------
DELETE FROM dictionaryentries_es de
USING es_merge m
WHERE de.id = m.id AND m.rn > 1;

ALTER TABLE dictionaryentries_es
    DROP CONSTRAINT IF EXISTS uq_es_word1_pos_gender;

-- Matches the shape every read already uses: DICT_JOIN and the DAL both look a Spanish
-- entry up by (word1, language). `language` is 'es' for every row today, but it is part of
-- the table's own identity contract, so it stays part of the key (mirrors zh).
ALTER TABLE dictionaryentries_es
    ADD CONSTRAINT uq_es_word1_language UNIQUE (word1, language);

-- The standalone word1 index existed because word1 alone was NOT unique and every lookup
-- had to scan its duplicates. The new constraint's index is leading-column word1, so it
-- serves those lookups; keeping both just doubles the write cost.
DROP INDEX IF EXISTS idx_es_word1;

-- ---------------------------------------------------------------------------
-- 8. Drop the columns the row split existed to support
--
-- `pos` / `gender` now live per-cluster; `hasMultiplePos` was a denormalized "does this
-- spelling have sibling rows?" flag for the POS badge, and sibling rows no longer exist;
-- `alternateGender` / `alternateMeaning` folded a gender-homograph's SECOND sense into
-- scalar columns on the first — that second sense is now simply its own cluster.
-- ---------------------------------------------------------------------------
ALTER TABLE dictionaryentries_es
    DROP COLUMN IF EXISTS pos,
    DROP COLUMN IF EXISTS gender,
    DROP COLUMN IF EXISTS "hasMultiplePos",
    DROP COLUMN IF EXISTS "alternateGender",
    DROP COLUMN IF EXISTS "alternateMeaning";

-- ---------------------------------------------------------------------------
-- 9. Spanish saved cards key like Chinese ones: (userId, entryKey, language)
--
-- The old key also carried `pos`, which let one learner hold `vivir`(v) and `vivir`(n) as
-- two separate cards. Under the clustered model those are one card with a sense pick — the
-- same way a learner holds ONE 会 card and chooses between its senses.
-- ---------------------------------------------------------------------------
ALTER TABLE vocabentries_es
    DROP CONSTRAINT IF EXISTS vocabentries_es_user_key_language_pos_unique;

ALTER TABLE vocabentries_es
    ADD CONSTRAINT vocabentries_es_user_key_language_unique
    UNIQUE ("userId", "entryKey", language);

ALTER TABLE vocabentries_es
    DROP COLUMN IF EXISTS pos;

COMMIT;
