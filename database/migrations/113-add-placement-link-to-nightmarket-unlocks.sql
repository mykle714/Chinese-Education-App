-- Migration 113: link Night Market unlocks (occupants) to their placement + slot
--
-- Ties each unlock to the placed template it occupies and the placeholder area (slot)
-- within it (docs/NIGHT_MARKET_TEMPLATES.md § Storage). This makes an unlock and its
-- occupant one concept: a placeholder area PLACEHOLDS for an unlock, and the unlock row
-- records which slot it landed in.
--
-- Both columns are NOT NULL: every unlock is placed into a slot at the moment it is
-- unlocked, so there is no "unplaced unlock" state.
--
-- ⚠️ DESTRUCTIVE: because the new columns are NOT NULL with no default, existing rows
-- must be cleared first. The pre-placement unlock rows have no placement/slot linkage and
-- cannot be backfilled, so this migration WIPES all current nightmarketunlocks rows. This
-- is a deliberate clean cutover to the template-placement occupant model (confirmed
-- 2026-07-17). On prod this loses every user's current unlocks — the /deploy migration
-- step runs this the same as any other; ensure that is intended before deploying.

DELETE FROM nightmarketunlocks;

ALTER TABLE nightmarketunlocks
    -- The placed template this occupant sits in (cascade-delete with its placement).
    ADD COLUMN IF NOT EXISTS "placedTemplateId" UUID NOT NULL
        REFERENCES nightmarkettemplatelocations(id) ON DELETE CASCADE,
    -- The placeholder area (slot) within that placement — the area's SW-corner anchor id
    -- ("col_row"), matching the runtime's placeholderAreaId (conditionAnalysis.ts).
    ADD COLUMN IF NOT EXISTS "placeholderAreaId" VARCHAR(40) NOT NULL;

-- Fast lookup of a placement's occupants (which slots are filled) — drives version
-- selection's filled-placeholder set and decay's free-slot pool.
CREATE INDEX IF NOT EXISTS idx_nightmarketunlocks_placed_template
    ON nightmarketunlocks ("placedTemplateId");

-- One occupant per (placement, slot): a placeholder area holds at most one unlock.
CREATE UNIQUE INDEX IF NOT EXISTS idx_nightmarketunlocks_placement_slot
    ON nightmarketunlocks ("placedTemplateId", "placeholderAreaId");

COMMENT ON COLUMN nightmarketunlocks."placedTemplateId" IS
    'The nightmarkettemplatelocations placement this unlock occupies (NOT NULL — no unplaced unlocks). See docs/NIGHT_MARKET_TEMPLATES.md.';
COMMENT ON COLUMN nightmarketunlocks."placeholderAreaId" IS
    'The placeholder area (slot) within the placement, as its SW-corner anchor id "col_row".';
