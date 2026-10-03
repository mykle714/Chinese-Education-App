-- Migration 169: create daily_words — the global Word of the Day
--
-- WHY: the Reading and Writing Centers open with a "Word of the day" card
-- (docs/READING_WRITING_CENTERS.md § Phase 3): one Chinese CHARACTER, shown big on a
-- card face, with the visual parts it is written from (the radical tagged), each part
-- glossed, and one sentence on why the character is written that way.
--
-- GLOBAL, NOT PER USER: every learner sees the same word on the same calendar date.
-- `day` is the learner's LOCAL calendar date (sent by the client), so two learners in
-- different timezones who are both on 2026-10-02 see the same word, and each sees it
-- change at their own midnight.
--
-- PINNED, NOT DERIVED: the first request for a day picks a random discoverable
-- single-character det row and writes it here; every later request reads this row.
-- Deriving the pick from a hash of the date was rejected because the discoverable set
-- changes during the day (/mark-discoverable runs), which would swap the word under a
-- learner who already saw it.
--
-- content (jsonb) — the AI-written card body, written once per day by
-- WordOfTheDayService (one model call per day, app-wide):
--   { "parts": [ { "char": "亻", "gloss": "person", "pinyin": "rén", "isRadical": true },
--                { "char": "木", "gloss": "tree",   "pinyin": "mù",  "isRadical": false } ],
--     "explanation": "A person leaning against a tree — …" }
-- `parts` is validated against the det row's `components` before it is stored. NULL
-- means the model call has not succeeded yet: the word is still pinned (the card
-- renders the bare components), and the next request retries the fill.
--
-- "detId" references dictionaryentries_zh(id). ON DELETE CASCADE: a det row deleted by
-- a data deploy takes its day with it, and that day simply re-picks on next request.
-- ⚠️ det ids are PPE-assigned and a dev box refreshed with /data-ppe-to-dev keeps PPE's
-- ids, so a dev copy of this table stays valid across a refresh.
--
-- Not synced by /data-ppe-to-dev: this is runtime state, not reference data; each box
-- picks its own days.
--
-- Expand-only: no shipped code reads this table before the code that ships with it.

CREATE TABLE IF NOT EXISTS daily_words (
  day         DATE        PRIMARY KEY,
  "detId"     INTEGER     NOT NULL REFERENCES dictionaryentries_zh(id) ON DELETE CASCADE,
  content     JSONB       NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "Not recently used" check when picking a new day's word.
CREATE INDEX IF NOT EXISTS idx_daily_words_det_id ON daily_words ("detId");

COMMENT ON TABLE daily_words IS
  'Global Word of the Day (one zh character per local calendar date), pinned on first request. See docs/READING_WRITING_CENTERS.md.';
COMMENT ON COLUMN daily_words.content IS
  'AI-written card body {parts:[{char,gloss,pinyin,isRadical}], explanation}; NULL until the once-per-day model call succeeds.';
