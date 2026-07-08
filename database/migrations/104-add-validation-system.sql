-- Migration 104: Data Validation System
--
-- Adds the schema for the human-in-the-loop data-validation feature (see
-- docs/DATA_VALIDATION_SYSTEM.md). A "validator" user downloads an auto-composed
-- Reader document for ONE field of ONE discoverable dictionary entry, then either
-- Approves it (unchanged) or Flags it with a suggestion (edited body). The outcome
-- is appended to the entry's `validationLog`, and future backfills skip fields that
-- have been human-approved/flagged.
--
-- Three independent changes, all additive and idempotent (IF [NOT] EXISTS):
--   1. users."isValidator"  — gates the validator UI + endpoints.
--   2. validations          — a DEDICATED table of review records. It is NOT a column
--                             on the det tables on purpose: `dictionaryentries_{zh,es}`
--                             are TRUNCATE+restored wholesale on every prod data deploy
--                             (see docs/DATA_DEPLOYMENT_GUIDE.md), which would wipe any
--                             review column. `validations` lives outside that set and is
--                             keyed by the det row's surrogate `id` (stable across data
--                             deploys — the binary dump preserves id values) + language.
--   3. texts."validation*"  — links a downloaded doc back to its (entry, field) + the
--                             server's original body (for revert + change-detection).

-- ── 1. users.isValidator ─────────────────────────────────────────────────────
-- Mirrors migration 07 (isPublic): NOT NULL DEFAULT false so existing rows are
-- non-validators. No backfill UPDATE needed — the default already applies.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS "isValidator" BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN users."isValidator" IS
    'Whether this user may download entries to validate and submit approvals/flags. Default false.';

-- ── 2. validations (dedicated table, survives det data deploys) ──────────────
-- One row per (entry, field) reviewed by a validator. `entryId` is the surrogate
-- id of dictionaryentries_<language> (stable across data deploys). `content` holds
-- the reviewed body for BOTH actions: for 'approve' it is the exact data version
-- being approved; for 'flag' it is the validator's suggested edit. `field` ∈
-- {'definitions','exampleSentence0','exampleSentence1','exampleSentence2'}.
CREATE TABLE IF NOT EXISTS validations (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "entryId"         INTEGER      NOT NULL,   -- dictionaryentries_<language>.id
    language          VARCHAR(10)  NOT NULL,   -- 'zh' | 'es' → which det table
    field             VARCHAR(50)  NOT NULL,
    "validatorUserId" UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    "validatorName"   TEXT         NOT NULL,
    action            VARCHAR(20)  NOT NULL CHECK (action IN ('approve','flag')),
    content           TEXT         NOT NULL,   -- approved data version, or suggested edit
    "createdAt"       TIMESTAMP    DEFAULT NOW(),
    -- One record per (entry, field, validator) — enforces "can never re-validate".
    CONSTRAINT validations_unique_per_user UNIQUE ("entryId", language, field, "validatorUserId")
);

-- Backfill guard + compose "already-validated?" checks both filter by (entryId, language).
CREATE INDEX IF NOT EXISTS idx_validations_entry ON validations ("entryId", language);
CREATE INDEX IF NOT EXISTS idx_validations_user  ON validations ("validatorUserId");

COMMENT ON TABLE validations IS
    'Human validation records (approve/flag + reviewed content) per (entry, field). Kept off the det tables so prod data deploys (TRUNCATE+restore of dictionaryentries_*) never wipe them; backfills skip fields recorded here. See docs/DATA_VALIDATION_SYSTEM.md.';

-- ── 3. texts.validation* linkage columns ─────────────────────────────────────
-- All nullable; NULL ⇒ an ordinary user document. When set, the text is a
-- validation doc: it points at the det row being reviewed, records which field,
-- and stores the server's originally-composed body so the client can detect edits
-- (Approve vs Flag) and Revert to the original.
-- validationEntryId is INTEGER because dictionaryentries_{zh,es}.id is a surrogate
-- SERIAL integer (NOT a uuid). It is intentionally an unconstrained integer rather
-- than a FK: it can point at either det table depending on validationLanguage.
ALTER TABLE texts
    ADD COLUMN IF NOT EXISTS "validationEntryId"       INTEGER,
    ADD COLUMN IF NOT EXISTS "validationLanguage"      VARCHAR(10),
    ADD COLUMN IF NOT EXISTS "validationField"         VARCHAR(50),
    ADD COLUMN IF NOT EXISTS "validationOriginalContent" TEXT;

COMMENT ON COLUMN texts."validationEntryId" IS
    'When set, this text is a validation doc reviewing dictionaryentries_<validationLanguage>.id = this value (det id is a SERIAL integer).';
COMMENT ON COLUMN texts."validationField" IS
    'Which field of the entry this doc validates: definitions | exampleSentence0..2.';
COMMENT ON COLUMN texts."validationOriginalContent" IS
    'Server-composed original body; used for client-side change detection (Approve vs Flag) and Revert.';
