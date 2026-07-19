-- Migration 112: Night Market template PLACEMENTS (per-user layout)
--
-- Records WHERE each user has dropped a copy of a catalog template — the per-account
-- layout the runtime renders (docs/NIGHT_MARKET_TEMPLATES.md § Storage,
-- docs/NIGHT_MARKET_TEMPLATE_RUNTIME_PLAN.md slice 3). Distinct from
-- `nightmarkettemplatedefinitions` (the account-independent CATALOG of authored
-- template definitions): this table is one row per placed template INSTANCE.
--
-- A placement references a template BY NAME (`templateName`) — a name, not a specific
-- version; `activeVersion` records which snapshot is currently shown, chosen by the
-- runtime version selector and PERSISTED so it is stable across renders. `templateName`
-- is intentionally NOT a foreign key: definitions are unique on (name, version), so the
-- name alone is not a referenceable key.
--
-- Coordinates: `offsetCol`/`offsetRow` locate the template's SW (min-iso / near/front)
-- corner in template-cell units — the same min-iso anchor the cell model uses everywhere
-- (isometric.ts: +isoX = east, +isoY = NORTH, so the min cell (0,0) is the SW corner).
-- The runtime maps a local cell to global via isoX = offsetCol + col, isoY = offsetRow + row.
--
-- There is deliberately NO `placeOrder` column: the starter hub is identified by its name
-- constant + origin offset, and chronological order is `createdAt` — nothing consumes a
-- gap-free ordinal (spawn ranks anchors by distance from origin).
--
-- NOTE (post-migration behavior change): rows in this table are NO LONGER append-only. On any
-- decay, empty + weakly-attached placements are pruned (NightMarketPlacementService.
-- pruneDanglingTemplates); see docs/NIGHT_MARKET_TEMPLATES.md § "Losing minutes removes templates".

CREATE TABLE IF NOT EXISTS nightmarkettemplatelocations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "userId"        UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Catalog key: nightmarkettemplatedefinitions.name (a NAME, not a specific version).
    "templateName"  VARCHAR(120) NOT NULL,
    -- The version currently rendered (chosen by selectVersion), persisted for render stability.
    "activeVersion" INTEGER NOT NULL,
    -- SW (min-iso / near) corner offset of this placement, in template-cell units.
    "offsetCol"     INTEGER NOT NULL,
    "offsetRow"     INTEGER NOT NULL,
    "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-user layout read, in chronological placement order.
CREATE INDEX IF NOT EXISTS idx_nightmarkettemplatelocations_user_created
    ON nightmarkettemplatelocations ("userId", "createdAt");

-- Integrity guard: two placements for one user can never legitimately share a SW corner
-- (placement legality forbids overlap), so a duplicate corner marks a placement bug.
CREATE UNIQUE INDEX IF NOT EXISTS idx_nightmarkettemplatelocations_user_corner
    ON nightmarkettemplatelocations ("userId", "offsetCol", "offsetRow");

COMMENT ON TABLE nightmarkettemplatelocations IS
    'Per-user Night Market template PLACEMENTS: which catalog template (by name) sits where (SW-corner offset) and in which persisted activeVersion. The account-specific layout the runtime renders. See docs/NIGHT_MARKET_TEMPLATES.md.';
