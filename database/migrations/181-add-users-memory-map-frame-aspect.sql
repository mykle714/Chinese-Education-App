-- Migration 181: users."memoryMapFrameAspect" — the screen a learner's Memory Map was packed for.
--
-- See docs/MEMORY_MAP_GAME.md § 2.4b (the frame) and § 6a (the mismatch dialog).
--
-- The Memory Map camera became FIXED (2026-11-04): no pan, no zoom — the client fits the
-- whole map to its game viewport. So a spawn now packs the map toward the shape of that
-- viewport, width ÷ height, and the shape is stored here the first time a load reports
-- one. Every later spawn and refill packs toward the stored frame; a client on a screen
-- whose aspect differs by more than MEMORY_MAP_FRAME_MISMATCH_RATIO (1.4) offers to
-- regenerate the map, which overwrites it.
--
-- ONE VALUE PER USER, shared by both language maps (owner, 2026-11-04 — Memory Map is
-- zh-only in practice), hence a users column rather than one on the per-language slot
-- tables.
--
-- NULL = never framed. That is also how the code recognises a PRE-FRAME map (packed
-- for the old pannable world, larger than one screen): the first framed load wipes and
-- regenerates it (MemoryMapService.loadMap → MemoryMapDAL.resetMap). The wipe is
-- deliberately CODE-driven rather than a TRUNCATE here, so this migration is
-- expand-only and safe to auto-run before the rebuild — a TRUNCATE would let the old
-- code respawn pannable maps in the gap before the new containers came up.
--
-- NO OWN TRANSACTION: migrate.sh wraps each file in one.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS "memoryMapFrameAspect" REAL NULL;

COMMENT ON COLUMN users."memoryMapFrameAspect" IS
    'Memory Map frame: width / height of the game viewport the learner''s map was generated for. NULL = never framed (a pre-frame map is wiped and regenerated on the next framed load). Shared by both language maps. Migration 181. See docs/MEMORY_MAP_GAME.md § 2.4b.';
