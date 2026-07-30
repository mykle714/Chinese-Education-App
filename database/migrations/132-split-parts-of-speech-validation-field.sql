-- Migration 132: split `partsOfSpeech` out of the 'definitions' validation field
--
-- Context (docs/DATA_VALIDATION_SYSTEM.md). Until now the validation system had four
-- fields — 'definitions' and 'exampleSentence0..2' — and the 'definitions' body
-- BUNDLED three det columns:
--
--     Parts of Speech: noun, verb
--
--     Definitions:
--     1. ...
--
--     Long Definition:
--     ...
--
-- That bundling meant a validator could not endorse the POS tags without also
-- endorsing the (much longer, much more churn-prone) definitions text, and any
-- regeneration of `longDefinition` silently invalidated the POS review too. This
-- migration splits POS into its own `validations.field = 'partsOfSpeech'`, alongside
-- two further new fields — 'difficulty' and 'frequencyScore' — which cover the two
-- remaining meta-strip chips. All three are INLINE-ONLY: the Reader-document queue
-- never hands them out, they are reviewed via the chips' Approve/Flag buttons.
--
-- NOTE: `validations.field` is a free-text VARCHAR(50) with no CHECK constraint, so
-- the new field VALUES need no DDL. The only DDL here is a refreshed COMMENT. The
-- real work is the DATA migration below, which preserves existing reviews.
--
-- ⚠️ The read path (DictionaryDAL.enrichFieldApprovalsBatch) decides an approval is
-- still valid by rebuilding the body from TODAY's det columns and comparing it
-- BYTE-FOR-BYTE against `validations.content`. Because the composer changed shape,
-- doing nothing here would silently invalidate every existing 'definitions' approval.
-- Hence the two data steps.

BEGIN;

-- ── 1. Re-file the POS half of every existing 'definitions' review ────────────
-- Each old 'definitions' record covered POS as well, so it becomes TWO records: the
-- original (with the POS block removed, step 2) plus a new 'partsOfSpeech' one that
-- inherits the same validator, action and timestamp — the human's judgement on those
-- tags is unchanged, only its filing.
--
-- Approvals carry the extracted "Parts of Speech: ..." line as their content, which
-- is exactly what composePartsOfSpeechBody now produces, so they survive the
-- byte-for-byte freshness check. Flags carry NULL content (migration 106 made
-- `content` nullable and flags stopped storing a suggestion) and are copied across
-- too — a flag's job is to protect the field from backfill regeneration
-- (validatedClause), and that protection must not be lost by the re-filing.
--
-- Only rows whose content actually starts with the old prefix are split; a
-- non-conforming approval is left alone rather than guessed at.
INSERT INTO validations
    ("entryId", language, field, "validatorUserId", "validatorName", action, content, "createdAt")
SELECT
    val."entryId",
    val.language,
    'partsOfSpeech',
    val."validatorUserId",
    val."validatorName",
    val.action,
    -- Approve → the first line verbatim ("Parts of Speech: noun, verb"); flag → NULL.
    CASE WHEN val.action = 'approve'
         THEN split_part(val.content, E'\n', 1)
         ELSE NULL
    END,
    val."createdAt"
FROM validations val
WHERE val.field = 'definitions'
  AND (val.action = 'flag' OR val.content LIKE 'Parts of Speech: %')
ON CONFLICT ON CONSTRAINT validations_unique_per_user DO NOTHING;

-- ── 2. Drop the POS block from the remaining 'definitions' approvals ──────────
-- The new composeDefinitionsBody starts at "Definitions:", so strip the leading
-- "Parts of Speech: <line>\n\n". Anchored to the start and limited to one line so it
-- cannot eat into the definitions text. Idempotent: re-running matches nothing,
-- because a body already starting with "Definitions:" fails the LIKE.
UPDATE validations
   SET content = regexp_replace(content, '^Parts of Speech: [^\n]*\n\n', '')
 WHERE field = 'definitions'
   AND action = 'approve'
   AND content LIKE 'Parts of Speech: %';

-- ── 3. Refresh the documentation comments ────────────────────────────────────
COMMENT ON TABLE validations IS
    'Human validation records (approve/flag + reviewed content) per (entry, field). field ∈ {definitions, exampleSentence0..2, partsOfSpeech, difficulty, frequencyScore}; the last three are inline-only (never handed out by the Reader-document queue). Kept off the det tables so prod data deploys (TRUNCATE+restore of dictionaryentries_*) never wipe them; backfills skip fields recorded here. See docs/DATA_VALIDATION_SYSTEM.md.';

COMMENT ON COLUMN texts."validationField" IS
    'Which field of the entry this doc validates: definitions | exampleSentence0..2. (The inline-only fields partsOfSpeech/difficulty/frequencyScore never produce a document, so they never appear here.)';

COMMIT;
