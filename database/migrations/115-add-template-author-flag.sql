-- Migration 115: split the Night Market template-editor gate onto its own flag.
--
-- The template-authoring editor (/night-market/template-editor + its server save
-- endpoints) was previously gated by users."isValidator" — the same flag that gates
-- the data-approval / dictionary-validation flows (migration 104). Those are two
-- unrelated responsibilities (curating dictionary data vs. authoring market layouts),
-- so this migration gives the template editor its OWN flag and leaves everything under
-- isValidator (Reader "Validate" button, ValidationService, ValidateFlagButtons,
-- LazyEnrichment gating) unchanged.
--
-- Additive + idempotent. Mirrors the isValidator shape (migration 104 §1): NOT NULL
-- DEFAULT false so every existing user is a non-author. No backfill UPDATE needed.
-- (If any account was granted isValidator solely to author templates, set
-- isTemplateAuthor = true on it manually after this deploy.)

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS "isTemplateAuthor" BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN users."isTemplateAuthor" IS
    'Whether this user may author Night Market templates (the template editor + its save endpoints). Distinct from isValidator (dictionary data approval). Default false.';
