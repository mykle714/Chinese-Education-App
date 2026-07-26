-- Migration 125: add "components" to dictionaryentries_zh — sub-character visual parts
--
-- WHY: the word search game's **No Pinyin** mode (docs/WORD_SEARCH_GAME.md § "Two hub
-- entries (pinyin mode)") had no hint currency of its own. The hint meter's reveal
-- mechanic is a hangman-style pinyin spell-out, which is exactly the thing that mode
-- deliberately hides — so hints there either leaked pinyin or did nothing useful.
-- This column supplies the replacement: reveal a character's VISUAL PARTS one at a
-- time, so a player scans the grid for a shape rather than for a sound.
--
-- ⚠️ NOT the same thing as "breakdown", despite the similar name:
--
--   breakdown  (jsonb, MULTI-char rows) : {char: {definition, sense}} — the per-CHARACTER
--                                         glosses of a word.        会议 → 会, 议
--   components (jsonb, SINGLE-char rows): ["相","心"]               — the SUB-character
--                                         parts of one character.   想 → 相 + 心
--
-- breakdown decomposes a WORD into characters; components decomposes a CHARACTER into
-- the strokes-groups it is written from. They are one level apart and never overlap:
-- breakdown is only ever populated on rows with char_length(word1) > 1, components only
-- on rows with char_length(word1) = 1.
--
-- SHAPE: a JSONB ARRAY of single-character strings, e.g.
--   想 → ["相", "心"]        腐 → ["广", "付", "肉"]
--   从 → ["人", "人"]        江 → ["氵", "工"]
--
--   * LEVEL 1 ONLY. Recursive decomposition degrades into meaningless strokes
--     (交 → 亠 丶 一 父 八 乂 丿 乀), which are not hints. One level is the hint.
--   * MULTIPLICITY IS KEPT — 从 is ["人","人"], not ["人"]. "two 人" is a strictly
--     better hint than "one 人".
--   * ORDERED MOST-COMMON-FIRST, by how many single-char det rows use each component
--     across the whole table. Hints therefore ESCALATE: the first (cheapest) hint is a
--     common part that barely narrows the search, the last is a rare part that nearly
--     identifies the character.
--   * The BOUND FORM is stored, not the standalone relative: 氵 (not 水), 亻 (not 人),
--     ⺮ (not 竹), ⺼ (not 月). The player is matching a SHAPE, so the shape as it
--     actually appears in the character is what gets stored. This is why the client
--     needs the component subset webfont (see below).
--   * NULL = not yet computed. An EMPTY ARRAY [] is meaningful and distinct: the
--     character is atomic (人, 口, 大, 一 …) and has no parts to reveal — the hint
--     ladder skips straight to revealing the character itself.
--
-- ⚠️ CLIENT FONT DEPENDENCY: ~4% of components (⺀ ⺮ ⺼ 㐬 耂 ⺌ 龹 殸 ⺈ …) are NOT
-- served by the Google-hosted Noto Sans SC webfont loaded in index.html — Google
-- subsets CJK by frequency, not by Unicode block, so this is not limited to the
-- radical-supplement blocks. Rendering them needs the generated subset webfont:
--   server/scripts/backfill/chinese/generate-component-font.js
-- Run that generator whenever this column changes, or those hints render as tofu.
--
-- SOURCE: decomposition is derived from makemeahanzi's dictionary.txt (LGPLv3, itself
-- derived from Unihan + CJKlib). That file is a BUILD-TIME INPUT ONLY — fetched into a
-- gitignored cache by the backfill, never vendored and never shipped to the client.
-- Only the derived per-character facts land here.
--
-- Deterministic and free: no AI, no API spend, safe to re-run.

BEGIN;

ALTER TABLE dictionaryentries_zh
  ADD COLUMN IF NOT EXISTS components jsonb;

COMMENT ON COLUMN dictionaryentries_zh.components IS
  'Sub-character visual parts of a SINGLE character, as a JSONB array of single-char strings: 想 → ["相","心"], 从 → ["人","人"] (multiplicity kept), 江 → ["氵","工"] (bound form stored, not 水). Level-1 decomposition only; ordered most-common-first by component frequency across all single-char rows so word-search hints escalate from weak to decisive. Populated only where char_length(word1) = 1 — NOT to be confused with "breakdown", which holds per-CHARACTER glosses of a MULTI-character word. NULL = not computed; [] = atomic character with no parts. Generated deterministically by server/scripts/backfill/chinese/backfill-character-components.js from makemeahanzi (LGPLv3, build-time input only). Consumed by the word search No Pinyin hint ladder — see docs/WORD_SEARCH_GAME.md.';

-- Partial index: every consumer reads this column for single-character rows only.
-- Keeps the index to the ~9.8k single-char rows rather than the whole table.
CREATE INDEX IF NOT EXISTS idx_dictionaryentries_zh_components
  ON dictionaryentries_zh (word1)
  WHERE char_length(word1) = 1 AND components IS NOT NULL;

COMMIT;
