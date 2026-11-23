import type { PoolClient } from 'pg';
import { vetSortedClause, VET_TRACKED_BUCKET } from './vetTable.js';

/**
 * The WRITING DECK — what the Deck Tower's writing world studies
 * (docs/WRITING_PRACTICE_REWORK.md § 3 "Writing flp", § 3d "The writing deck").
 *
 * Since 2026-11-22 the writing flp deals SINGLE CHARACTERS only: every distinct Han
 * character of the learner's SORTED words (a sorted 1-character card is its own word, so
 * it is included), keeping only characters that have a det row. Writing mastery already
 * lives on characters (migration 170), so the deck is the same unit the marks land on.
 *
 * A deck character is backed by the learner's single-character vet row for it — in any
 * bucket (sorted, tracked, or an old lent `provisional` row) — when one exists. When none exists yet it appears as a
 * VIRTUAL row: a full `vocabentries_zh`-shaped record with no history whose id is the
 * NEGATED code point of the character (`-ascii(ch)`), so it bands Unfamiliar, is off
 * cooldown, and has an id unique within the deck. Reads (the tower's counts) therefore
 * never write. A virtual card that is actually SELECTED — dealt into a working loop, or
 * picked into a focus snapshot — is turned into a real hidden row first
 * (`materializeWritingIds`) in the `tracked` bucket (migration 203): hidden like a lent
 * card, so marks land on a real vet row, but never re-lent. The client never sees a negative id.
 *
 * Chinese only (the writing flp refuses es), so the relation hard-codes `vocabentries_zh`.
 *
 * Layer: DAL shared SQL. Referenced by: OnDeckVocabDAL (`findFlpCandidates`,
 * `findReadinessRows`, `materializeWritingIds`), FocusModeDAL (`listWorldCards`,
 * `countWorldCards`, `listCardsByIds`, `materializeWritingIds`), WritingGridDAL
 * (`ensureCharacterRows`).
 * Docs: docs/WRITING_PRACTICE_REWORK.md § 3d, docs/DECK_TOWER.md (writing world counts),
 * docs/FOCUS_MODE.md.
 */

/** A single Han character, as a Postgres regex (same range as the writing surfaces). */
const HAN_CHAR_RE = `'^[㐀-鿿]$'`;

/**
 * FROM source (aliased `ve`) for a writing-deck read: the learner's real character rows
 * in the deck, UNION ALL a virtual row per deck character that has none. It has exactly
 * `vocabentries_zh`'s columns, so `ve.*`, DICT_JOIN, `WRITING_MASTERY_SELECT` and
 * `barCategoryExpr('writing')` all work on it unchanged. Do NOT add `vetSortedClause()`
 * to a query over it: hidden (tracked / provisional) character rows are deck members by design.
 *
 * `userParam` is the placeholder holding the user id (a fixed literal at every call site).
 */
export function writingDeckFrom(userParam = '$1'): string {
  return `(
    WITH split_chars AS MATERIALIZED (
      -- Every distinct Han character of the learner's sorted words. MATERIALIZED and
      -- de-duplicated BEFORE the det check below: unfolded, the planner guesses ~50
      -- characters per word, hashes all ~115k det rows for the semi-join, and the
      -- read costs ~50 ms instead of ~5 ms (dev, a 426-word deck, 2026-11-22).
      SELECT DISTINCT w."userId", ch
        FROM vocabentries_zh w
        CROSS JOIN LATERAL regexp_split_to_table(w."entryKey", '') AS ch
       WHERE w."userId" = ${userParam}
         AND w.language = 'zh'
         AND ${vetSortedClause('w')}
         AND ch ~ ${HAN_CHAR_RE}
    ),
    writing_deck_chars AS (
      -- Only characters with a det row (pinyin and dd to show).
      SELECT c."userId", c.ch
        FROM split_chars c
       WHERE EXISTS (SELECT 1 FROM dictionaryentries_zh d WHERE d.word1 = c.ch AND d.language = 'zh')
    )
    -- The character's own vet row, in any bucket.
    SELECT r.*
      FROM writing_deck_chars c
      JOIN vocabentries_zh r
        ON r."userId" = c."userId" AND r.language = 'zh' AND r."entryKey" = c.ch
    UNION ALL
    -- No row yet: a virtual one, id = -(code point). See the module docblock. LATERAL,
    -- not "(jsonb_populate_record(…)).*", which Postgres would evaluate once per column.
    SELECT v.*
      FROM writing_deck_chars c
      CROSS JOIN LATERAL jsonb_populate_record(NULL::vocabentries_zh, jsonb_build_object(
        'id', -ascii(c.ch),
        'userId', c."userId",
        'entryKey', c.ch,
        'language', 'zh',
        'starterPackBucket', '${VET_TRACKED_BUCKET}'
      )) AS v
     WHERE NOT EXISTS (
       SELECT 1 FROM vocabentries_zh r
        WHERE r."userId" = c."userId" AND r.language = 'zh' AND r."entryKey" = c.ch
     )
  ) ve`;
}

/** The character a virtual writing-deck id stands for (`-ascii(ch)` in `writingDeckFrom`). */
function charOfVirtualId(id: number): string {
  return String.fromCodePoint(-id);
}

/**
 * Give the learner a single-character vet row for each of `chars` — a hidden
 * `tracked` row when they have none, kept as-is when they do — and return
 * character → vet id. The one insert behind every "this character is about to be
 * studied" path: the Writing Grid / Superposition deals and the writing deck's
 * materialization. Same row shape as `VocabEntryDAL.ensureCharacterMarkStates`' insert.
 */
export async function ensureCharacterRows(
  client: PoolClient, userId: string, chars: string[]
): Promise<Map<string, number>> {
  const unique = [...new Set(chars)];
  if (unique.length === 0) return new Map();
  await client.query(
    `INSERT INTO vocabentries_zh ("userId", "entryKey", language, "starterPackBucket")
     SELECT $1, ch, 'zh', $3 FROM unnest($2::text[]) AS ch
     ON CONFLICT ("userId", "entryKey", language) DO NOTHING`,
    [userId, unique, VET_TRACKED_BUCKET]
  );
  const found = await client.query<{ id: number; entryKey: string }>(
    `SELECT id, "entryKey" FROM vocabentries_zh
      WHERE "userId" = $1 AND language = 'zh' AND "entryKey" = ANY($2::text[])`,
    [userId, unique]
  );
  return new Map(found.rows.map((row) => [row.entryKey, row.id]));
}

/**
 * Replace every VIRTUAL writing-deck id in `ids` (negative) with the id of a real hidden
 * character row, creating the rows (`ensureCharacterRows`). Real ids pass through, and the
 * order is kept. A call with no virtual id makes no query.
 */
export async function materializeWritingIds(
  client: PoolClient, userId: string, ids: number[]
): Promise<number[]> {
  const virtualChars = ids.filter((id) => id < 0).map(charOfVirtualId);
  if (virtualChars.length === 0) return ids;
  const byChar = await ensureCharacterRows(client, userId, virtualChars);
  return ids.map((id) => {
    if (id >= 0) return id;
    const real = byChar.get(charOfVirtualId(id));
    if (real === undefined) throw new Error(`Could not create a character row for virtual id ${id}`);
    return real;
  });
}
