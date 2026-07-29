-- Pre-123 hotfix: collapse duplicate Spanish cards, MERGING their review history.
--
-- Migration 123 swaps vocabentries_es's unique key from
-- (userId, entryKey, language, pos) to (userId, entryKey, language). Under the old
-- key a learner could hold one spelling several times, once per POS — prod has 58
-- such groups (136 cards, 3 users). ADD CONSTRAINT would fail on every one of them,
-- so they must collapse first.
--
-- POLICY (chosen by the user over the runbook's "keep highest totalMarkCount, drop
-- the rest", which would have discarded 6 of the 17 typed marks on prod): the
-- lowest-id card survives and ABSORBS its siblings — nothing is lost.
--
--   * typedMarkHistory : per track, all siblings' marks are concatenated, sorted by
--                        their own `timestamp`, and the newest 8 kept (8 is the per-
--                        track cap in the mastery model — docs/MASTERY_REWORK.md).
--                        Stored ascending, matching how the app appends.
--   * totalMarkCount /
--     totalCorrectCount : summed across the group.
--   * card customization : first non-NULL in id order (iconLayout, snapConfig,
--                        textColors, textLayout, cardColor, author). No prod group
--                        actually has two competing values today.
--   * selectedSense     : deliberately left as-is. 123 §5 does not migrate `pos`
--                        into it, so every merged card lands on its word's default
--                        sense, same as a brand-new card.
--   * starterPackBucket : survivor's own. No collision card is in the 'skip' bucket.
--
-- Idempotent: the temp table only picks up spellings that still have >1 row, so a
-- second run is a no-op.

BEGIN;

-- Every card belonging to a colliding (userId, entryKey) pair, ranked by id.
-- rn 1 is the survivor; rn > 1 are absorbed and deleted.
CREATE TEMP TABLE es_vet_dup ON COMMIT DROP AS
SELECT ve.id, ve."userId", ve."entryKey",
       ROW_NUMBER() OVER (PARTITION BY ve."userId", ve."entryKey" ORDER BY ve.id) AS rn
FROM vocabentries_es ve
WHERE EXISTS (
    SELECT 1 FROM vocabentries_es o
     WHERE o."userId" = ve."userId" AND o."entryKey" = ve."entryKey" AND o.id <> ve.id
);

CREATE INDEX ON es_vet_dup (id);

WITH
-- Flatten every mark of every card in a group into (track, mark, timestamp) rows.
-- The LATERAL join skips any track whose value is not an array (defensive: the
-- column is free-form jsonb with no shape constraint).
marks AS (
    SELECT d."userId", d."entryKey", t.k AS track, m.elem, (m.elem ->> 'timestamp') AS ts
    FROM es_vet_dup d
    JOIN vocabentries_es ve ON ve.id = d.id,
         LATERAL jsonb_each(ve."typedMarkHistory") AS t(k, v),
         LATERAL jsonb_array_elements(t.v) AS m(elem)
    WHERE jsonb_typeof(t.v) = 'array'
),
-- Newest-first within each track so the cap keeps the most recent 8.
ranked AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY "userId", "entryKey", track
                                 ORDER BY ts DESC NULLS LAST) AS mrn
    FROM marks
),
-- Re-emit ascending: the app appends new marks at the end of the array.
per_track AS (
    SELECT "userId", "entryKey", track, jsonb_agg(elem ORDER BY ts NULLS FIRST) AS arr
    FROM ranked WHERE mrn <= 8
    GROUP BY 1, 2, 3
),
merged_hist AS (
    SELECT "userId", "entryKey", jsonb_object_agg(track, arr) AS hist
    FROM per_track GROUP BY 1, 2
),
-- Counters summed; every other card-shaping column takes the first non-NULL in id order.
agg AS (
    SELECT d."userId", d."entryKey",
           SUM(ve."totalMarkCount")                                                              AS "totalMarkCount",
           SUM(ve."totalCorrectCount")                                                           AS "totalCorrectCount",
           (array_agg(ve."iconLayout"    ORDER BY d.rn) FILTER (WHERE ve."iconLayout"    IS NOT NULL))[1] AS "iconLayout",
           (array_agg(ve."snapConfig"    ORDER BY d.rn) FILTER (WHERE ve."snapConfig"    IS NOT NULL))[1] AS "snapConfig",
           (array_agg(ve."textColors"    ORDER BY d.rn) FILTER (WHERE ve."textColors"    IS NOT NULL))[1] AS "textColors",
           (array_agg(ve."textLayout"    ORDER BY d.rn) FILTER (WHERE ve."textLayout"    IS NOT NULL))[1] AS "textLayout",
           (array_agg(ve."cardColor"     ORDER BY d.rn) FILTER (WHERE ve."cardColor"     IS NOT NULL))[1] AS "cardColor",
           (array_agg(ve.author          ORDER BY d.rn) FILTER (WHERE ve.author          IS NOT NULL))[1] AS author,
           MIN(ve."createdAt")                                                                   AS "createdAt"
    FROM es_vet_dup d
    JOIN vocabentries_es ve ON ve.id = d.id
    GROUP BY 1, 2
)
UPDATE vocabentries_es tgt
SET "typedMarkHistory"  = COALESCE(mh.hist, '{}'::jsonb),
    "totalMarkCount"    = a."totalMarkCount",
    "totalCorrectCount" = a."totalCorrectCount",
    "iconLayout"        = a."iconLayout",
    "snapConfig"        = a."snapConfig",
    "textColors"        = a."textColors",
    "textLayout"        = a."textLayout",
    "cardColor"         = a."cardColor",
    author              = a.author,
    "createdAt"         = a."createdAt"
FROM es_vet_dup d
JOIN agg a ON a."userId" = d."userId" AND a."entryKey" = d."entryKey"
LEFT JOIN merged_hist mh ON mh."userId" = d."userId" AND mh."entryKey" = d."entryKey"
WHERE tgt.id = d.id AND d.rn = 1;

-- The absorbed siblings.
DELETE FROM vocabentries_es ve
USING es_vet_dup d
WHERE ve.id = d.id AND d.rn > 1;

COMMIT;
