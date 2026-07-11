-- Migration 106: Simplify Validator Flow
--
-- The validator flow no longer supports editing a validation document's body
-- (docs/DATA_VALIDATION_SYSTEM.md). Approve copies the document's displayed
-- content verbatim — no reparse/format-guard needed, since it was never edited.
-- Flag records no content at all, just the flag itself.
--
--   1. validations.content — was NOT NULL (held the approved data version OR the
--      validator's suggested edit). Flag no longer stores a suggestion, so it must
--      become nullable; NULL ⇒ flag with no accompanying content.
--   2. texts.validationOriginalContent — dropped. It existed only to support
--      client-side edit diffing (Approve vs Flag) and Revert, both removed now
--      that validation docs are read-only.

ALTER TABLE validations ALTER COLUMN content DROP NOT NULL;

COMMENT ON COLUMN validations.content IS
    'Content copied verbatim from the validation doc on approve; NULL for flag (no suggested edit).';

ALTER TABLE texts DROP COLUMN IF EXISTS "validationOriginalContent";
