-- Migration 114: drop the two legacy asset-unlock indexes on nightmarketunlocks
--
-- Migrations 112/113 repurposed `nightmarketunlocks` from the retired asset-unlock
-- economy (one row = an unlocked ASSET) to the template-placement OCCUPANT model
-- (one row = a placeholder slot filled by a placed template). Two indexes from the
-- OLD model survived that cutover and are now wrong / dead:
--
--   • idx_nightmarketunlocks_user_asset — UNIQUE (userId, assetId). Under the old
--     model a user could unlock each asset at most once. Under the occupant model a
--     user holds MANY occupants, and until the real stand-asset catalog exists they
--     all share one generic assetId — so this unique constraint BREAKS the grant
--     flow (the 2nd occupant insert 23505-conflicts). Occupant uniqueness is now
--     correctly enforced by idx_nightmarketunlocks_placement_slot
--     (UNIQUE (placedTemplateId, placeholderAreaId), migration 113) — one occupant
--     per (placement, slot).
--
--   • idx_nightmarketunlocks_user_order — (userId, unlockOrder). `unlockOrder` is a
--     defaulted-0 legacy column with no reader in the occupant model; the index has
--     no query behind it.
--
-- Dropping both completes the 113 cutover. Non-destructive to row data.

DROP INDEX IF EXISTS idx_nightmarketunlocks_user_asset;
DROP INDEX IF EXISTS idx_nightmarketunlocks_user_order;
