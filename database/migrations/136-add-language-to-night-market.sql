-- Migration 136: per-language Night Market (Phase 2 of the per-language minute-points work)
--
-- Migration 134 made every minute-points balance per (user, language). This migration gives
-- the thing that CONSUMES those balances — the Night Market — the same dimension, so each
-- language earns and grows its own market.
--
-- BEFORE: one market per user. `nightmarkettemplatelocations` and `nightmarketunlocks` were
-- keyed on `userId` alone, and the unlock entitlement read the user's single global balance.
-- Phase 1 deliberately kept that behaviour by feeding the entitlement Σ net across languages.
--
-- AFTER: one market per (user, language). Studying Spanish grows the Spanish market; the
-- Chinese market is untouched. Each language's market has its OWN starter hub at the origin
-- and its own coordinate space — placements never collide across languages because every
-- read is language-filtered.
--
-- BACKFILL: every existing placement and occupant becomes 'zh'. The market predates
-- multi-language support, so 'zh' is the language it was actually built in for essentially
-- every account. A user who studied Spanish gets an empty Spanish market that starts
-- growing from their next Spanish minute — nothing is lost, because their existing market
-- (and every occupant in it) stays intact under 'zh'.
--
-- NO NEW UNIQUENESS ON OCCUPANTS. Occupant identity is already correct and needs no language
-- dimension: `idx_nightmarketunlocks_placement_slot` UNIQUE (placedTemplateId, placeholderAreaId)
-- (migration 113) — one occupant per slot — and every placement belongs to exactly one market,
-- so slot uniqueness is transitively per-market already. Do NOT reintroduce a (userId, assetId)
-- unique index in any form: migration 114 dropped it precisely because occupants share a
-- generic assetId under the placement model, and re-adding it 23505-conflicts the grant flow
-- on the second occupant.
--
-- Idempotent: safe to re-run.

-- ── Placements ────────────────────────────────────────────────────────────────
ALTER TABLE nightmarkettemplatelocations
  ADD COLUMN IF NOT EXISTS language VARCHAR(10) NOT NULL DEFAULT 'zh';

COMMENT ON COLUMN nightmarkettemplatelocations.language IS
  'Which language market this placement belongs to. Each (userId, language) is an independent market with its own origin/starter hub. Backfilled to zh by migration 136.';

-- Every market read is "this user, this language", so the index must lead with both.
CREATE INDEX IF NOT EXISTS idx_nmtl_user_language
  ON nightmarkettemplatelocations ("userId", language);

-- ⚠️ The SW-corner integrity guard MUST become per-market.
-- Migration 112 created UNIQUE (userId, offsetCol, offsetRow) on the premise that "two
-- placements for one user can never legitimately share a SW corner (placement legality
-- forbids overlap)". That premise held only while a user had ONE market. Each language's
-- market now has its OWN coordinate space anchored at the origin, so a user studying zh and
-- es legitimately has TWO hubs at (0,0) — and every other coordinate can collide too. Left
-- as-is, seeding the second language's hub fails with a 23505 and that market can never
-- start. Widening to (userId, language, …) keeps the real guard (no overlap WITHIN a market)
-- while letting markets coexist.
DROP INDEX IF EXISTS idx_nightmarkettemplatelocations_user_corner;
CREATE UNIQUE INDEX IF NOT EXISTS idx_nmtl_user_language_corner
  ON nightmarkettemplatelocations ("userId", language, "offsetCol", "offsetRow");

-- Same reasoning for the (userId, createdAt) ordering index: reads are per market.
DROP INDEX IF EXISTS idx_nightmarkettemplatelocations_user_created;
CREATE INDEX IF NOT EXISTS idx_nmtl_user_language_created
  ON nightmarkettemplatelocations ("userId", language, "createdAt");

-- ── Occupants ─────────────────────────────────────────────────────────────────
-- `language` is denormalized onto the occupant row (it is derivable via placedTemplateId →
-- location.language) for the same reason `userId` already is: the unique index below and the
-- count/delete queries need it without a join.
ALTER TABLE nightmarketunlocks
  ADD COLUMN IF NOT EXISTS language VARCHAR(10) NOT NULL DEFAULT 'zh';

COMMENT ON COLUMN nightmarketunlocks.language IS
  'Which language market this occupant belongs to. Denormalized from its placement (like userId) so the per-market unique index and count/delete queries need no join. Backfilled to zh by migration 136.';

-- Repair any occupant whose denormalized language disagrees with its placement. A no-op on a
-- clean backfill (both default to 'zh'); it exists so a re-run after partial manual edits
-- converges rather than leaving the two out of step.
UPDATE nightmarketunlocks u
SET language = l.language
FROM nightmarkettemplatelocations l
WHERE l.id = u."placedTemplateId"
  AND u.language IS DISTINCT FROM l.language;

-- Occupant counting and surplus-deletion filter on (userId, language), and the table had no
-- index on userId at all after migration 114 removed the last one. Add the one index the
-- occupant model actually queries by.
CREATE INDEX IF NOT EXISTS idx_nightmarketunlocks_user_language
  ON nightmarketunlocks ("userId", language);
