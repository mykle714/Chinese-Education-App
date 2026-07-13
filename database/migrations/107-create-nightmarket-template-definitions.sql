-- Migration 107: Night Market Template Definitions
--
-- Adds the store for validator-authored Night Market **templates** (see
-- docs/NIGHT_MARKET_TEMPLATE_EDITOR.md and docs/NIGHT_MARKET_TEMPLATES.md). A
-- validator uses the desktop template editor to paint a rectangular W×H board —
-- light/dark grass masks + a street mask now, growing later to the full template
-- (walkability classes, asset map, placeholder areas, conditional cell-class
-- rules, edge signatures) — and Submits it under a unique name.
--
-- The template CONTENT lives in a single `definition` JSONB column so the schema
-- does not churn as the authored shape grows; the scalar `name`/`width`/`height`
-- columns are lifted out because they are queried directly (name uniqueness for
-- the editor's name-availability check; width/height for listing/placement).
--
-- Distinct from `nightmarkettemplates` (the PROPOSED per-user PLACEMENT table in
-- NIGHT_MARKET_TEMPLATES.md) — that records WHERE a placed template instance sits
-- for a given account. This table is the static, account-independent CATALOG of
-- template DEFINITIONS the placement system draws from.

CREATE TABLE IF NOT EXISTS nightmarkettemplatedefinitions (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- Unique authored name — the editor's name-availability check targets this,
    -- and Submit is create-only (a duplicate name is rejected, not overwritten).
    name         VARCHAR(120) NOT NULL,
    -- Board dimensions in template cells (col = width/east, row = height/south).
    width        INTEGER      NOT NULL,
    height       INTEGER      NOT NULL,
    -- Full authored content. Currently { lightGrass, darkGrass, street } cell
    -- lists (each "col,row"); grows to hold walkability/assetMap/placeholders/etc.
    definition   JSONB        NOT NULL,
    -- Authoring validator (users.isValidator). Kept for provenance; templates are
    -- account-independent catalog content, not per-user state.
    "createdBy"  UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    "createdAt"  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    "updatedAt"  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Case-sensitive unique name (drives the create-only Submit + name-availability
-- check). A partial/functional index could add case-insensitivity later.
CREATE UNIQUE INDEX IF NOT EXISTS idx_nightmarkettemplatedefinitions_name
    ON nightmarkettemplatedefinitions (name);

COMMENT ON TABLE nightmarkettemplatedefinitions IS
    'Validator-authored Night Market template CATALOG (definitions), keyed by unique name. Distinct from the per-user placement table. See docs/NIGHT_MARKET_TEMPLATE_EDITOR.md.';
