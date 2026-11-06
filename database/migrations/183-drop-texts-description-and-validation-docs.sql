-- Migration 183: drop `texts.description` and the Reader validation-document queue.
--
-- Owner's decisions, 2026-11-05:
--   * The Reader's "New Document" popup is gone. New Document opens a blank page in
--     edit mode; the document is created on its first Save, with a title derived
--     from the content (server/utils/documentTitle.ts). With no popup there is
--     nowhere to enter a description, so the field is removed entirely.
--   * The Reader validation-document queue (validators downloading a composed
--     "Validate - <word1>" document and Approving/Flagging it) is removed. The
--     INLINE Approve/Flag buttons (ValidateFlagButtons → /api/validation/entrySubmit)
--     stay, and so do the `validations` table and every row in it — including rows
--     written by the doc queue, which the backfill guard and read-path approval
--     styling keep reading. See docs/DATA_VALIDATION_SYSTEM.md.
--
-- WHAT THIS DOES
--   1. Deletes the validation documents still sitting in validators' Reader lists
--      (rows with "validationField" set). Nothing can open them as validation docs
--      any more; an Approve/Flag already recorded lives in `validations`, and the
--      queue auto-deleted a doc on submit, so every remaining one is unsubmitted.
--   2. Drops texts."validationEntryId", "validationLanguage", "validationField"
--      (added by migration 104; "validationOriginalContent" was already dropped by 106).
--   3. Drops texts.description.
--
-- DEPLOY ORDER: safe under the standard /deploy, which brings the new code up
-- BEFORE running migrations. The new code neither reads nor writes these columns
-- (INSERT names its columns; SELECT * simply returns fewer). Running this BEFORE the
-- new code is live would break the old code's INSERT, which names `description`.
--
-- Verification (expect 0 rows):
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'texts'
--      AND column_name IN ('description','validationEntryId','validationLanguage','validationField');
--
-- Irreversible: the dropped descriptions and the deleted unsubmitted validation docs
-- are not recoverable without a backup.

BEGIN;

DELETE FROM texts WHERE "validationField" IS NOT NULL;

ALTER TABLE texts
    DROP COLUMN IF EXISTS "validationEntryId",
    DROP COLUMN IF EXISTS "validationLanguage",
    DROP COLUMN IF EXISTS "validationField",
    DROP COLUMN IF EXISTS description;

COMMIT;
