-- Migration 120: drop the users FK on validations."validatorUserId" (keep the column).
--
-- Context: prod is now the SOURCE OF TRUTH for the data tables, and we pull them
-- DOWN to dev boxes with the /data-pull skill (the reverse of the deprecated
-- /data-deploy). `validations` is one of the pulled tables. Its `validatorUserId`
-- FK-referenced users(id) ON DELETE CASCADE, which broke the pull: a dev box that
-- lacks a prod validator's account would abort the restore mid-COPY and leave the
-- local table empty (the same failure mode /template-pull's author pre-check
-- guards against).
--
-- We never JOIN `validatorUserId` to `users` — it is used ONLY as a scalar identity
-- (the unique constraint (entryId, language, field, validatorUserId) and the
-- "did I already validate this?" WHERE filters in ValidationService.ts). The
-- validator's display name is stored denormalized in `validatorName`. So the FK
-- buys us nothing on reads; it only enforced referential integrity + cascade-delete.
--
-- Dropping it:
--   * KEEPS the column exactly as-is (UUID NOT NULL) — no data change, just un-FK'd.
--     Now consistent with `validations.entryId` / `texts.validationEntryId`, which
--     are DELIBERATELY unconstrained ids rather than FKs (see migration 104).
--   * Lets a prod snapshot restore into any dev box regardless of which accounts
--     exist locally — no validator pre-check needed.
--   * Loses ON DELETE CASCADE: deleting a user no longer auto-removes their
--     validation rows. Harmless — reads use the denormalized `validatorName`, so
--     orphaned rows still display; arguably better, since validation history now
--     outlives account deletion.
--
-- Idempotent (IF EXISTS). The constraint name is Postgres's auto-generated default
-- for the migration-104 inline REFERENCES.

ALTER TABLE validations
    DROP CONSTRAINT IF EXISTS "validations_validatorUserId_fkey";

COMMENT ON COLUMN validations."validatorUserId" IS
    'UUID of the validator who submitted this record. NOT a FK (migration 120): the '
    'referenced user need not exist locally, so prod snapshots restore onto any dev '
    'box via /data-pull. Used only as a scalar identity (unique constraint + '
    '"did I already validate?" filters); display uses the denormalized validatorName.';
