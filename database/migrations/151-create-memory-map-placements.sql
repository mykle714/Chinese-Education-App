-- Migration 151: Memory Map — the durable per-user word placements.
--
-- See docs/MEMORY_MAP_GAME.md (§ 8 is the signed-off data model, 2026-08-18).
--
-- NUMBERED 151: 150 (the study-challenge week-index rename) is applied on prod and
-- its runbook is retired, so this simply takes the next free number.
--
-- NO OWN TRANSACTION: migrate.sh already wraps each file in one. A file that opens
-- its own BEGIN/COMMIT closes the runner's transaction early, which puts the
-- schema_migrations tracking INSERT outside it and loses the all-or-nothing
-- guarantee (this happened for real on migration 150, 2026-08-17).
--
-- ── WHY TWO TABLES AND NOT ONE ───────────────────────────────────────────────
-- User vocab is split per language (`vocabentries_zh` / `vocabentries_es`) with one
-- SHARED id sequence and deliberately NO union view. A single placements table could
-- therefore hold a "vocabEntryId" that is globally unique but has no table to point
-- at -- i.e. no real foreign key, and a hand-rolled orphan sweep forever after.
--
-- Mirroring the split buys the FK, and the FK is the whole point: ON DELETE CASCADE
-- means deleting a card deletes its placement, so an ORPHANED PLACEMENT CANNOT EXIST.
-- There is no cron step, no nightly reconciliation and no orphan-tolerant read path
-- anywhere in the feature. Do not "simplify" this back into one table without
-- replacing that guarantee with something.
--
-- ── WHAT A ROW MEANS ─────────────────────────────────────────────────────────
-- "This user's map has this word at this spot, this big, forever." A placement is
-- created once (when the word first joins the map) and is NEVER moved or resized --
-- see § 2.3: a size that tracked mastery would reflow every neighbour on every
-- study session. It is deleted only when the word graduates (reading-mastered) or
-- the card itself is deleted.
--
-- Colours, the prompt queue and the camera are NOT here: those belong to a RUN,
-- which lives in localStorage (§ 4). This table is the map, not the game.
--
-- ── COLUMNS ──────────────────────────────────────────────────────────────────
-- x, y      world coordinates of the bounding box's CENTRE. Continuous, not a grid
--           (§ 2.3) -- an archipelago of tangent boxes has no cell size that isn't
--           either wasteful or a lie about the text widths it holds.
-- scale     the random 0.7x-1.6x multiplier drawn once at spawn and frozen (§ 2.3).
--           Carries no meaning; it exists so the map looks organic.
-- language  stored even though the table name implies it. It is immutable (a card
--           never changes language) and it keeps the per-user index and every read
--           IDENTICAL IN SHAPE across the two tables, which is what lets one DAL
--           method serve both by swapping a whitelisted table name.
--
-- TYPES MIRROR THE VET TABLES EXACTLY, and are not what they look like:
--   "userId"  is UUID    (users.id is a uuid, NOT a serial integer)
--   language  is VARCHAR (matching vocabentries_*.language, not TEXT)
-- Both were written as INTEGER/TEXT in the first draft and rejected outright by the
-- FK checker. Recorded here because a placements table is exactly the kind of small
-- satellite table where someone reasonably assumes an integer user id.
--
-- NO islandId (§ 2.4): an island is the connected component of the tangency graph,
-- computed from the boxes when anything needs it. A stored id would start lying the
-- first time a graduation split an island in two.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS memory_map_placements_zh (
  id             SERIAL PRIMARY KEY,
  "userId"       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "vocabEntryId" INTEGER     NOT NULL REFERENCES vocabentries_zh(id) ON DELETE CASCADE,
  language       VARCHAR(10) NOT NULL DEFAULT 'zh',
  x              REAL        NOT NULL,
  y              REAL        NOT NULL,
  scale          REAL        NOT NULL,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One spot per card per user. Also the ON CONFLICT target for the spawn upsert,
  -- which makes a double-tapped game load idempotent rather than a duplicate map.
  CONSTRAINT uq_memory_map_zh_user_entry UNIQUE ("userId", "vocabEntryId")
);

CREATE INDEX IF NOT EXISTS idx_memory_map_zh_user_language
  ON memory_map_placements_zh ("userId", language);

CREATE TABLE IF NOT EXISTS memory_map_placements_es (
  id             SERIAL PRIMARY KEY,
  "userId"       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "vocabEntryId" INTEGER     NOT NULL REFERENCES vocabentries_es(id) ON DELETE CASCADE,
  language       VARCHAR(10) NOT NULL DEFAULT 'es',
  x              REAL        NOT NULL,
  y              REAL        NOT NULL,
  scale          REAL        NOT NULL,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_memory_map_es_user_entry UNIQUE ("userId", "vocabEntryId")
);

CREATE INDEX IF NOT EXISTS idx_memory_map_es_user_language
  ON memory_map_placements_es ("userId", language);
