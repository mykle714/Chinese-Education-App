-- Migration 173: Memory Map — placements become a TREE OF SLOTS.
--
-- See docs/MEMORY_MAP_GAME.md § 2.3–§ 2.4 (the slot tree) and § 8 (data model).
-- Deploy: docs/MEMORY_MAP_SLOTS_DEPLOY_RUNBOOK.md — this is a CONTRACT migration (it
-- renames both tables and drops x/y, which the old code reads by name).
--
-- NO OWN TRANSACTION: migrate.sh already wraps each file in one (the migration-150
-- lesson — a file's own COMMIT closes the runner's transaction early).
--
-- ── WHAT CHANGED, AND WHY ────────────────────────────────────────────────────
-- A row used to be "this word sits at absolute (x, y)". It is now "a SLOT hangs off
-- its parent slot at this bearing, tilted and bowed this much" — and the word is merely the
-- slot's current OCCUPANT:
--
--   • Positions are no longer stored. They are DERIVED, deterministically, by
--     `layoutMap` in server/services/memoryMapLayout.ts, which both the server and the
--     client run. Slide each slot out from its parent along `angle` until its tilted
--     tile clears every tile laid before it (§ 2.4).
--   • When a word graduates, its SLOT stays and a new word moves in (§ 3.6). The slot
--     owns `angle`, `tilt`, `bow` and `scale`; only "vocabEntryId" changes. That is why the
--     table is renamed placements → slots: a row outlives any one word.
--   • Islands are the tree's own structure: a slot whose `link` is 'island' starts a
--     new island, launched across water from a coast slot. No islandId column — an
--     island is "every slot whose nearest 'island'-linked ancestor (or the root) is X".
--
-- ── COLUMNS ──────────────────────────────────────────────────────────────────
-- "parentId"     the slot this one hangs off. NULL for exactly one slot per map: the
--                first root, laid at the world origin. Self-FK with NO ACTION (the
--                default) — deleting a parent alone would strand its subtree with no
--                position to derive, so the database refuses. Deliberately NOT
--                `RESTRICT`: RESTRICT is checked row by row, so deleting a USER (which
--                cascades to every slot at once) could fail on whichever parent row
--                happened to go first; NO ACTION is checked at the end of the statement,
--                when the whole tree is gone.
-- link           'grow'   = touches its parent (slides out until it just clears);
--                'island' = a new island's root, slid out from a COAST slot until it
--                           clears every tile by the island water gap.
-- angle          bearing from the parent's centre, in DEGREES [0, 360). 0 = east (+x),
--                increasing CLOCKWISE on screen (world y grows downward). NULL only for
--                the first root.
-- tilt           the tile's render rotation in DEGREES, drawn once (normal around 0°, σ 6°, truncated to [-30, +30]) and
--                frozen (MEMORY_MAP_TILT_RANGE). Part of the geometry, not just paint:
--                the layout collides the ROTATED tile.
-- bow            the word's arc, drawn once and frozen like tilt (MEMORY_MAP_BOW_RANGE /
--                MEMORY_MAP_BOW_SIGMA: normal around 0°, σ 5°, truncated to [-15, +15]).
--                Stored as the LEAN OF THE OUTER CHARACTERS in degrees; + = smile (ends
--                raised), − = frown. Also geometry: each character's box is bent onto
--                the arc before collision (memoryMapLayout.ts → `bowShape`). Ignored by a
--                single-character occupant, but kept for whatever refills the slot.
-- scale          unchanged meaning (frozen random size multiplier), now owned by the
--                slot — a refilled word inherits it.
-- "vocabEntryId" the current occupant, NULL-able now: ON DELETE SET NULL, so deleting a
--                card EMPTIES its slot instead of cascading the row away (which would
--                orphan its children). The next map load refills an empty slot.
--
-- ── EXISTING MAPS ARE WIPED ──────────────────────────────────────────────────
-- An absolute (x, y) cannot be converted into a (parent, bearing) without inventing a
-- tree that was never there, and the map's arrangement is cosmetic — membership comes
-- from the reading track and marks live on the vet (§ 8.1 precedent). Every learner's
-- map re-spawns on their next GET /api/memoryMap. The TRUNCATE must precede the NOT
-- NULL column adds, which have no meaningful default for existing rows.
--
-- Idempotent where Postgres allows: the renames are guarded, every ADD is IF NOT EXISTS
-- and every DROP is IF EXISTS.

DO $$
BEGIN
  IF to_regclass('public.memory_map_placements_zh') IS NOT NULL
     AND to_regclass('public.memory_map_slots_zh') IS NULL THEN
    ALTER TABLE memory_map_placements_zh RENAME TO memory_map_slots_zh;
    ALTER TABLE memory_map_slots_zh RENAME CONSTRAINT uq_memory_map_zh_user_entry TO uq_memory_map_slots_zh_user_entry;
    ALTER INDEX idx_memory_map_zh_user_language RENAME TO idx_memory_map_slots_zh_user_language;
    -- Cosmetic, but a table named slots with a placements_* pkey/sequence/FK reads as
    -- a half-finished rename in every \d and every error message.
    ALTER TABLE memory_map_slots_zh RENAME CONSTRAINT memory_map_placements_zh_pkey TO memory_map_slots_zh_pkey;
    ALTER TABLE memory_map_slots_zh RENAME CONSTRAINT "memory_map_placements_zh_userId_fkey" TO "memory_map_slots_zh_userId_fkey";
    ALTER SEQUENCE memory_map_placements_zh_id_seq RENAME TO memory_map_slots_zh_id_seq;
  END IF;
  IF to_regclass('public.memory_map_placements_es') IS NOT NULL
     AND to_regclass('public.memory_map_slots_es') IS NULL THEN
    ALTER TABLE memory_map_placements_es RENAME TO memory_map_slots_es;
    ALTER TABLE memory_map_slots_es RENAME CONSTRAINT uq_memory_map_es_user_entry TO uq_memory_map_slots_es_user_entry;
    ALTER INDEX idx_memory_map_es_user_language RENAME TO idx_memory_map_slots_es_user_language;
    -- Cosmetic, but a table named slots with a placements_* pkey/sequence/FK reads as
    -- a half-finished rename in every \d and every error message.
    ALTER TABLE memory_map_slots_es RENAME CONSTRAINT memory_map_placements_es_pkey TO memory_map_slots_es_pkey;
    ALTER TABLE memory_map_slots_es RENAME CONSTRAINT "memory_map_placements_es_userId_fkey" TO "memory_map_slots_es_userId_fkey";
    ALTER SEQUENCE memory_map_placements_es_id_seq RENAME TO memory_map_slots_es_id_seq;
  END IF;
END $$;

-- The wipe (see header). Children must go with parents, so the whole table at once.
TRUNCATE memory_map_slots_zh, memory_map_slots_es;

-- ── zh ───────────────────────────────────────────────────────────────────────
ALTER TABLE memory_map_slots_zh DROP COLUMN IF EXISTS x;
ALTER TABLE memory_map_slots_zh DROP COLUMN IF EXISTS y;
ALTER TABLE memory_map_slots_zh ADD COLUMN IF NOT EXISTS "parentId" INTEGER NULL
  REFERENCES memory_map_slots_zh(id);
ALTER TABLE memory_map_slots_zh ADD COLUMN IF NOT EXISTS link VARCHAR(10) NOT NULL
  CHECK (link IN ('grow', 'island'));
ALTER TABLE memory_map_slots_zh ADD COLUMN IF NOT EXISTS angle REAL NULL;
ALTER TABLE memory_map_slots_zh ADD COLUMN IF NOT EXISTS tilt REAL NOT NULL;
ALTER TABLE memory_map_slots_zh ADD COLUMN IF NOT EXISTS bow REAL NOT NULL;

-- Occupant: CASCADE → SET NULL, and nullable. The UNIQUE ("userId", "vocabEntryId")
-- constraint is kept as is — Postgres treats NULLs as distinct, so any number of empty
-- slots coexist while one card still cannot sit in two slots.
ALTER TABLE memory_map_slots_zh ALTER COLUMN "vocabEntryId" DROP NOT NULL;
ALTER TABLE memory_map_slots_zh DROP CONSTRAINT IF EXISTS "memory_map_placements_zh_vocabEntryId_fkey";
ALTER TABLE memory_map_slots_zh DROP CONSTRAINT IF EXISTS "memory_map_slots_zh_vocabEntryId_fkey";
ALTER TABLE memory_map_slots_zh ADD CONSTRAINT "memory_map_slots_zh_vocabEntryId_fkey"
  FOREIGN KEY ("vocabEntryId") REFERENCES vocabentries_zh(id) ON DELETE SET NULL;

-- ── es (identical shape — one DAL method serves both by table-name whitelist) ─
ALTER TABLE memory_map_slots_es DROP COLUMN IF EXISTS x;
ALTER TABLE memory_map_slots_es DROP COLUMN IF EXISTS y;
ALTER TABLE memory_map_slots_es ADD COLUMN IF NOT EXISTS "parentId" INTEGER NULL
  REFERENCES memory_map_slots_es(id);
ALTER TABLE memory_map_slots_es ADD COLUMN IF NOT EXISTS link VARCHAR(10) NOT NULL
  CHECK (link IN ('grow', 'island'));
ALTER TABLE memory_map_slots_es ADD COLUMN IF NOT EXISTS angle REAL NULL;
ALTER TABLE memory_map_slots_es ADD COLUMN IF NOT EXISTS tilt REAL NOT NULL;
ALTER TABLE memory_map_slots_es ADD COLUMN IF NOT EXISTS bow REAL NOT NULL;

ALTER TABLE memory_map_slots_es ALTER COLUMN "vocabEntryId" DROP NOT NULL;
ALTER TABLE memory_map_slots_es DROP CONSTRAINT IF EXISTS "memory_map_placements_es_vocabEntryId_fkey";
ALTER TABLE memory_map_slots_es DROP CONSTRAINT IF EXISTS "memory_map_slots_es_vocabEntryId_fkey";
ALTER TABLE memory_map_slots_es ADD CONSTRAINT "memory_map_slots_es_vocabEntryId_fkey"
  FOREIGN KEY ("vocabEntryId") REFERENCES vocabentries_es(id) ON DELETE SET NULL;
