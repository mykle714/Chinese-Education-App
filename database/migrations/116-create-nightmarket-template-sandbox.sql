-- Migration 116: Night Market template SANDBOX (template-author free-tiling scratch layout)
--
-- Per-author scratch layout for the desktop-only "Template Sandbox" tool: a template author
-- tiles catalog templates together however they please to preview how they compose
-- (docs/NIGHT_MARKET_TEMPLATE_SANDBOX.md). This is a CLONE of `nightmarkettemplatelocations`
-- (migration 112, the per-user RUNTIME layout) with two deliberate differences:
--   (1) it is a FREEFORM scratch surface — there is NO unique-corner index, so tiles may be
--       dropped/dragged anywhere and may overlap (the runtime table forbids overlap; the
--       sandbox intentionally allows it for experimentation), and
--   (2) it is authoring scratch state, unrelated to a user's minute-point unlock economy —
--       nothing grants/decays these rows; the author adds/moves/deletes them by hand.
--
-- Like the runtime table, a row references a template BY NAME (`templateName`, NOT a foreign
-- key — definitions are unique on (name, version), so the name alone is not referenceable);
-- `activeVersion` is the version currently rendered for THIS instance, switchable per-instance
-- from the sandbox header (each placed tile carries its own version).
--
-- Coordinates mirror the runtime table exactly: `offsetCol`/`offsetRow` locate the template's
-- SW (min-iso / near) corner in template-cell units (isometric.ts: +isoX = east, +isoY = north,
-- so the min cell (0,0) is the SW corner). A local cell maps to global via
-- isoX = offsetCol + col, isoY = offsetRow + row.
--
-- Cleanup: when a template author DELETES a whole template in the editor, every sandbox row
-- referencing that `templateName` (across ALL authors) is also removed — the catalog row is
-- gone, so a placement of it can no longer render (NightMarketTemplateService.deleteTemplate →
-- NightMarketSandboxDAL.deleteByTemplateName). This is a manual cascade in the service layer
-- (templateName is not an FK, so the DB cannot cascade it).

CREATE TABLE IF NOT EXISTS nightmarkettemplatesandbox (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "userId"        UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Catalog key: nightmarkettemplatedefinitions.name (a NAME, not a specific version).
    "templateName"  VARCHAR(120) NOT NULL,
    -- The version currently rendered for THIS instance (switchable per-tile in the sandbox).
    "activeVersion" INTEGER NOT NULL,
    -- SW (min-iso / near) corner offset of this placement, in template-cell units.
    "offsetCol"     INTEGER NOT NULL,
    "offsetRow"     INTEGER NOT NULL,
    "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-author layout read, in chronological placement order.
CREATE INDEX IF NOT EXISTS idx_nightmarkettemplatesandbox_user_created
    ON nightmarkettemplatesandbox ("userId", "createdAt");

-- Fast cleanup of every author's placements of a template when it is deleted from the catalog.
CREATE INDEX IF NOT EXISTS idx_nightmarkettemplatesandbox_template_name
    ON nightmarkettemplatesandbox ("templateName");

-- NOTE: unlike nightmarkettemplatelocations, there is deliberately NO
-- UNIQUE(userId, offsetCol, offsetRow) index — the sandbox is a freeform scratch surface where
-- overlapping / co-located tiles are allowed.

COMMENT ON TABLE nightmarkettemplatesandbox IS
    'Per-author Night Market template SANDBOX: freeform scratch layout where a template author tiles catalog templates (by name) at SW-corner offsets, each in its own switchable activeVersion. Overlaps allowed (no unique-corner index). Scratch state only — no unlock economy. See docs/NIGHT_MARKET_TEMPLATE_SANDBOX.md.';
