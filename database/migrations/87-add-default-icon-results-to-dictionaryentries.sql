-- Migration 87: Cache the default icon-search response on the det tables
--
-- Backs the icon-picker prefetch for the "Custom Card Icon Layout" feature
-- (docs/CARD_ICON_LAYOUT.md). When a learner enters the flp edit mode, the picker
-- pre-fills its search box with the card's English meaning (the "default query",
-- computed client-side via iconSearchTerm() in src/utils/definitionUtils.ts). To
-- avoid a network round-trip every time the box opens, we cache the FIRST PAGE of
-- that default query's icons8 search *response* on the shared det row, so the very
-- first learner to open the picker for a word warms the cache for everyone.
--
-- We intentionally store the RESPONSE, not the query: the query is cheap to recompute
-- from the definition; the icons8 round-trip is the slow part we want to skip.
--
-- Shape (jsonb array; NULL = never warmed -> do one live search on first open and
-- write the results back here; [] = warmed but the term matched nothing):
--   [{ "id": "16017", "name": "Cat" }, ...]   -- icons8 ids + names (no image URL;
--                                                tiles preview from the icons8 CDN by id)
--
-- Lives on det (shared across users), keyed by the word, because the default query is
-- a pure function of the entry's English definition and is therefore word-global, not
-- per-user. NOT selected into the normal vocab read (DICT_COLS) — it would bloat every
-- flashcard payload with up to ~48 rows; instead it's fetched on demand by the
-- POST /api/icons8/default-results endpoint when the learner enters edit mode.

ALTER TABLE dictionaryentries_zh ADD COLUMN IF NOT EXISTS "defaultIconResults" jsonb;
ALTER TABLE dictionaryentries_es ADD COLUMN IF NOT EXISTS "defaultIconResults" jsonb;
