-- Migration 130: add "breakdownElaboration" to dictionaryentries_zh
--
-- WHY: the per-word `breakdown` jsonb glosses each component character of a
-- multi-character word (会议 → 会 "meeting", 议 "discuss"). For most words that is
-- self-explanatory: stack the glosses and the word's meaning falls out. For a
-- minority it does NOT — the word is opaque or idiomatic and the component glosses
-- actively mislead:
--     东西  east + west            → "thing"
--     马虎  horse + tiger          → "careless, sloppy"
--     矛盾  spear + shield         → "contradiction"
-- For exactly those words this column holds ONE short English sentence explaining
-- how the parts get to the whole.
--
-- ⚠️ NULL IS A REAL ANSWER, NOT "not yet computed". NULL means the AI judged the
-- breakdown straightforward and deliberately declined to write anything — the common
-- case, by design. "Has this row been evaluated?" is therefore NOT answerable from
-- this column; it is answered by the per-entry `enrichmentLog` stamp (migration 68)
-- under the key `chinese/backfill-breakdown-elaboration`, which the backfill writes
-- for every row it decides, including the ones it decides to leave NULL. Any future
-- consumer that wants "unevaluated" rows must read the stamp, not this column.
--
-- LENGTH BUDGET: the writer caps each elaboration at 50 characters per character of
-- word1 (2-char word → 100 chars, 4-char idiom → 200). That is a CEILING, not a
-- target; most elaborations should come in well under it. The cap is enforced in the
-- backfill (over-budget responses are retried once, then left unwritten and flagged)
-- rather than by a CHECK constraint, so that a future hand-edit or a policy change
-- does not require a migration. It is intentionally a per-word budget: a 4-character
-- chengyu genuinely needs more room than a 2-character compound.
--
-- Chinese-only: `breakdown` itself exists only on dictionaryentries_zh (Spanish words
-- decompose into affixes, a different model — see the `affixes` table), so there is no
-- es counterpart. Populated only on rows with char_length(word1) > 1 that already have
-- a `breakdown`; single-character rows have nothing to elaborate on.
--
-- Written by server/scripts/backfill/chinese/backfill-breakdown-elaboration.js.
-- Depends on backfill-dictionary-breakdown.js + backfill-breakdown-senses.js having
-- run first (the elaboration is judged against the sense-tagged glosses).
-- Documented in docs/BREAKDOWN_FEATURE_IMPLEMENTATION.md § 5c.
--
-- Idempotent: safe to re-run.

BEGIN;

ALTER TABLE dictionaryentries_zh
  ADD COLUMN IF NOT EXISTS "breakdownElaboration" text;

COMMENT ON COLUMN dictionaryentries_zh."breakdownElaboration" IS
  'One short English sentence explaining how a multi-character word''s meaning arises from its component characters, written ONLY when the breakdown is non-obvious (东西 east+west → "thing"; 马虎 horse+tiger → "careless"). NULL is a real answer meaning "breakdown is straightforward, nothing to add" — NOT "not yet computed"; evaluated-ness lives in enrichmentLog under chinese/backfill-breakdown-elaboration. Capped at 50 chars per character of word1 (a ceiling, not a target), enforced by the backfill. Populated only where char_length(word1) > 1 and breakdown IS NOT NULL. Written by server/scripts/backfill/chinese/backfill-breakdown-elaboration.js. See docs/BREAKDOWN_FEATURE_IMPLEMENTATION.md.';

COMMIT;
