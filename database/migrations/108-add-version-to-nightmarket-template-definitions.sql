-- Migration 108: Night Market template VERSIONS
--
-- Adds multi-version support to the validator-authored template catalog
-- (docs/NIGHT_MARKET_TEMPLATE_EDITOR.md). A single template NAME now owns several
-- numbered VERSIONS (variants sharing one board size + one placeholder layout but
-- differing in terrain / streets / decor / the new CONDITION mask). Placement will
-- pick a version per the conditional cell-class rules — see
-- docs/NIGHT_MARKET_TEMPLATES.md.
--
-- Model: one row per (name, version). `version` is a 0-based integer; version 0 is
-- the base/default and the SINGLE SOURCE OF TRUTH for the shared `placeholder` mask
-- (the editor only lets you paint placeholder on version 0; other versions inherit
-- it read-only). Row uniqueness moves from (name) to (name, version).
--
-- The shared placeholder is NOT duplicated per row — it lives only in version 0's
-- `definition` JSONB; the service merges it into other versions on read. This keeps
-- the invariant "all versions share one placeholder" impossible to violate.

ALTER TABLE nightmarkettemplatedefinitions
    ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;

-- Uniqueness is now per (name, version): a name may repeat across versions, but a
-- given version of a given name is unique. Replaces the old name-only unique index.
DROP INDEX IF EXISTS idx_nightmarkettemplatedefinitions_name;
CREATE UNIQUE INDEX IF NOT EXISTS idx_nightmarkettemplatedefinitions_name_version
    ON nightmarkettemplatedefinitions (name, version);

COMMENT ON COLUMN nightmarkettemplatedefinitions.version IS
    '0-based template version. Version 0 is the base/default and the single source of truth for the shared placeholder mask; other versions inherit placeholder on read. See docs/NIGHT_MARKET_TEMPLATE_EDITOR.md.';
