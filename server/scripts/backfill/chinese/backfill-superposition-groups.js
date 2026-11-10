/**
 * backfill-superposition-groups.js — AI-authored Superposition tile groups for every
 * character of the given zh words (docs/SUPERPOSITION_GAME.md § Stored groups).
 *
 * WHAT IT WRITES  (migration 180)
 *   dictionaryentries_zh."superpositionGroups" — `[[stroke indices], …]`, an exact partition
 *   of the character's hanzi-writer-data strokes. Written on SINGLE-CHARACTER rows only;
 *   multi-character rows keep NULL (a word deals as its characters).
 *
 *   The deal reads it (SuperpositionService.deal → strokeGroups). A character with no stored
 *   groups yet is grouped at deal time by the shared algorithm instead
 *   (server/contracts/superpositionGroups.ts → groupStrokes, run by
 *   src/games/superposition/board.ts → characterGroups), so a row this script has not reached
 *   still plays.
 *
 * HOW A WORD IS HANDLED
 *   The planner (oracle-plan.js) and /mark-discoverable hand this script WORDS. A word's
 *   groups live on its characters' own rows, so the script works per CHARACTER:
 *     1. collect the distinct characters of every selected word;
 *     2. skip a character whose det rows are all stamped at the current SCRIPT_VERSION
 *        (a character shared by many words is authored once);
 *     3. author the rest:
 *          - no hanzi-writer-data file  → NULL (nothing to draw), stamped as decided;
 *          - ≤ SINGLE_STROKE_MAX strokes → every stroke alone, written with NO model call;
 *          - otherwise                  → one model call per character (PROMPT below);
 *        a character's answer is written to EVERY zh row with that word1 (the glyph is the
 *        same for each reading of 行), and each of those rows is stamped;
 *     4. stamp each selected WORD row once all of its characters are stamped (a single-
 *        character word is its own character row, so step 3 already stamped it). A character
 *        with no det row of its own has nowhere to store groups and does not hold the word up.
 *
 *   ⚠️ DONE-NESS IS THE STAMP, never the column: multi-character rows stay NULL forever, and
 *   a glyph-less character is a decided NULL. The gate is `staleClause()` (no stamp, or one
 *   below SCRIPT_VERSION), so a prompt revision re-authors every character exactly once.
 *
 * QUALITY GATE (handleResponse)
 *   The answer must be JSON `{ "groups": [[…], …] }` that partitions the strokes exactly
 *   (`isStrokePartition`) into at least two tiles. Anything else is FAILED, left unwritten
 *   and unstamped, and printed as `⚠ SUPERPOSITION GROUPS REVIEW <char>` so a later round
 *   retries it.
 *
 * INPUTS (all committed or installed; nothing is fetched at run time except the Make Me a
 * Hanzi decomposition on its first use, which lib/decompose.js caches)
 *   - REPO-ROOT node_modules/hanzi-writer-data (a client dependency): stroke outlines + medians;
 *   - src/games/superposition/strokeParts.json (generate-superposition-parts.js): the
 *     natural parts handed to the model as hints;
 *   - lib/decompose.js → loadDecompositionEntries: the IDS tree + stroke `matches`, walked
 *     recursively so each stroke reads as a full component path (道's stroke 3 = 首>自).
 *
 * FLAGS
 *   --words=照,国   scope to these words (any length; their characters are authored)
 *   --stale         accepted for pipeline uniformity; the gate is always version-aware
 *   --force         re-author characters even when stamped at the current version
 *   --spot-check    first 5 selected words only
 *   --dry-run       print each character's prompt data, no model calls, no writes
 *   --batch         Message Batches API (50% price); not with BACKFILL_ORACLE
 *   Unscoped (no --words) runs select every discoverable zh word.
 *
 * Usage (from server/):
 *   scripts/backfill/run-ppe.sh scripts/backfill/chinese/backfill-superposition-groups.js --words=道,喜欢
 *   BACKFILL_ORACLE=export scripts/backfill/run-ppe.sh scripts/backfill/chinese/backfill-superposition-groups.js --words=道
 *
 * Referenced by: docs/SUPERPOSITION_GAME.md § Stored groups,
 * scripts/backfill/shared/lib/requiredScripts.js (REQUIRED_SCRIPTS_ZH),
 * .claude/commands/mark-discoverable.md § A3, server/contracts/featureFlags.ts → superpositionStoredGroups.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { REPO_ROOT } from '../shared/lib/repoRoot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../.env.docker') });

import Anthropic from '@anthropic-ai/sdk';
import db from '../../../db.js';
import { initRunLog, cachedSystem, assertOracleCompatible, ORACLE_MODE } from '../run-log.js';
import { parseBackfillArgs } from '../shared/lib/cli.js';
import { runBackfill } from '../shared/lib/runner.js';
import { loadDecompositionEntries } from './lib/decompose.js';
import {
  SINGLE_STROKE_MAX,
  isStrokePartition,
  strokeInk,
  strokeOutline,
} from '../../../contracts/superpositionGroups.js';

const SCRIPT_VERSION = 1; // bump when this script's logic/prompt changes — and REQUIRED_SCRIPTS_ZH with it
const SCRIPT_ID = 'chinese/backfill-superposition-groups';
const MODEL = 'claude-opus-5-5';
const TABLE = 'dictionaryentries_zh';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const { stampEntries, accrueUsage, staleClause } = initRunLog({ script: SCRIPT_ID, version: SCRIPT_VERSION, anthropic });
const { isSpotCheck, isBatch, targetWords, flags } = parseBackfillArgs();
const FORCE = flags.includes('--force');
const DRY_RUN = flags.includes('--dry-run');
// Oracle export must write NOTHING (run-log.js "ORACLE MODE"): the no-model-call decisions and
// the word stamps wait for the apply pass, which re-runs this same command.
const NO_WRITES = DRY_RUN || ORACLE_MODE === 'export';

// Host vs container layout: see shared/lib/repoRoot.js.
const HANZI_DATA_DIR = path.join(REPO_ROOT, 'node_modules', 'hanzi-writer-data');
const PARTS_FILE = path.join(REPO_ROOT, 'src', 'games', 'superposition', 'strokeParts.json');

// Stable marker so the oracle / mark-discoverable agent can grep review flags off stdout.
const REVIEW_MARKER = '⚠ SUPERPOSITION GROUPS REVIEW';

// ── The prompt ──────────────────────────────────────────────────────────────────────
// Authored with the user on 2026-11-03 and tried by hand on 球 我 黑 象 / 想 道 跳 慢 /
// 重 鬼 黄 赛 before it became this script. Static → one cached system block.
const SYSTEM_TEXT = `You are authoring tile groupings for a Chinese-character puzzle game called Superposition.

## The game
Each character's strokes are cut into TILES. The tiles of several characters are scattered on a
board, and the player stacks a character's tiles on top of each other, at the same position, to
rebuild it. A tile is one piece the player drags: all of its strokes move together. A good
grouping makes every tile feel like a meaningful, solid PIECE of the character, and gives the
player a satisfying handful of pieces to assemble.

## What makes a good grouping (in priority order)
1. **Natural parts stay whole and closed.** A recognisable component (a radical or common block:
   口, 王, 扌, 灬, 氵, 木, 日, ⺈, …) is ONE tile: exactly its strokes, never split, never padded
   with an extra stroke. The "natural parts already detected" list is a strong hint; trust it
   unless it is plainly wrong. Also recognise shapes the source data fails to name (an IDS '？'),
   e.g. an enclosed box or frame whose strokes close a 口-like shape belongs together.
   Exception: 豕 is NOT treated as a unit (it is too big and too loose); break it up.
   **Never mix strokes across a component boundary.** The component path column shows each
   stroke's components from outer to inner (首>自>目). A tile takes strokes from ONE component
   only: never pull a stroke out of one component to fill out a neighbour (自's 丿 does not join
   首's 丷一 hat, even though it touches the bar). A part that is too big (rule 4) may be split
   only along its own named sub-components (足 → its 口 + its bottom), and only if no piece is
   left as a lone stroke; otherwise it stays whole, even at half the character. Strokes the
   source leaves "(unmatched)" belong to whichever component they sit inside (首's long bar,
   under its 丷, is the hat's).
2. **Tiles are dense.** A tile's strokes should touch, cross or nestle tightly, so its ink fills
   most of its own bounding box. Never join strokes that sit far apart with empty space between
   them. Small strokes (dots, short ticks) belong with the stroke they sit against or inside.
3. **No lone strokes.** Every tile has at least 2 strokes. A dot or tick on its own is "too
   small". A lone stroke is acceptable only if it is forced (every neighbour is already inside a
   closed natural part).
4. **No oversized tiles.** A tile that is half the character is "too big". For 9–13 strokes aim
   for roughly 3–5 tiles of about 2–4 strokes each; a natural part may be bigger (a 4-dot 灬, a
   4-stroke 王 is fine). The number of tiles scales with stroke count: simpler characters get
   fewer, smaller tiles.
5. **Writing order does not matter.** A tile may take strokes 1, 4 and 9. Group by where strokes
   sit and how they connect, not by index.
6. **Never one tile.** A character must have at least 2 tiles.
7. **Spatially coherent leftovers.** After natural parts, split the remaining strokes into
   compact clusters that each read as a sub-shape (a hook with its dot, a pair of crossing
   strokes, a left-falling sweep with its parallel partner). Prefer clean region splits (top /
   bottom, left / right) over interleaved ones.

## The data you get
- The IDS decomposition, and each stroke's component path from outer to inner ('？' =
  unidentified component, '(unmatched)' = the source names no component for it).
- Natural parts already detected (closed tiles).
- Per stroke: its median path (start → middle → end, in writing direction), its bounding box,
  and its ink (outline area). Coordinates are a 1024-unit square, x left→right, y top→bottom.
  Use the coordinates to judge what touches what; picture the character as you know it.

## Output
Respond with ONLY one JSON object, no markdown fences, no text outside it:
{"reasoning": "<two or three sentences on the character's anatomy and your cuts>", "groups": [[0, 1], [2, 3, 4], [5, 6]]}
Every stroke index appears in exactly one group. Each group sorted ascending, groups ordered by
their first stroke.`;

// ── Stroke facts for the prompt ─────────────────────────────────────────────────────

const IDS_OPERATOR = /[⿰-⿻]/;
const TERNARY_OPERATORS = new Set(['⿲', '⿳']);

/** An IDS string as a tree; each node keeps its path, the prefix `matches` entries use. */
function parseIds(ids) {
  const symbols = [...ids];
  let position = 0;
  const read = (treePath) => {
    const symbol = symbols[position++];
    if (symbol === undefined) throw new Error('truncated IDS');
    if (!IDS_OPERATOR.test(symbol)) return { part: symbol, treePath, children: [] };
    const arity = TERNARY_OPERATORS.has(symbol) ? 3 : 2;
    const children = [];
    for (let k = 0; k < arity; k++) children.push(read([...treePath, k]));
    return { part: null, treePath, children };
  };
  return read([]);
}

/** Positions in `matches` whose path runs through `treePath`. */
const strokesUnder = (matches, treePath) =>
  matches.flatMap((match, position) =>
    match && treePath.every((step, depth) => match[depth] === step) ? [position] : []
  );

/**
 * One stroke's component path, outer to inner. Walks the IDS tree to the stroke's leaf
 * component, then recurses into that component's own entry (whose `matches` are positions
 * local to it), so 道's stroke 3 reads 首>自 rather than just 首. Mirrors the walk in
 * generate-superposition-parts.js → collectParts.
 */
function componentPath(entries, char, local, depth = 0) {
  const entry = entries.get(char);
  if (!entry?.matches || depth > 6) return [];
  const match = entry.matches[local];
  if (!match) return ['(unmatched)'];
  let node;
  try {
    node = parseIds(entry.ids);
  } catch {
    return [];
  }
  for (const step of match) {
    const next = node.children?.[step];
    if (!next) break;
    node = next;
    if (node.part) break;
  }
  if (!node.part) return [];
  if (node.part === '？') return ['？'];
  const under = strokesUnder(entry.matches, node.treePath);
  const inner = under.indexOf(local);
  const sub = entries.get(node.part);
  const rest = under.length > 1 && sub?.matches?.length === under.length && inner >= 0
    ? componentPath(entries, node.part, inner, depth + 1)
    : [];
  return [node.part, ...rest];
}

/** The character's glyph (strokes + medians), or null when hanzi-writer-data has none. */
function loadGlyph(char) {
  const file = path.join(HANZI_DATA_DIR, `${char}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    const glyph = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(glyph.strokes) && glyph.strokes.length > 0 ? glyph : null;
  } catch (error) {
    console.warn(`  ⚠️  ${char}: unreadable glyph file (${error.message}); treated as no glyph`);
    return null;
  }
}

/** The per-character prompt data: IDS, detected parts, and one line of facts per stroke. */
function strokeFacts(char, glyph, entries, parts) {
  const entry = entries.get(char);
  // hanzi-writer y runs bottom→top (≈ −124…900); flip it so the model reads y top→bottom.
  const y = (value) => Math.round(900 - value);
  const lines = glyph.strokes.map((stroke, index) => {
    const median = glyph.medians?.[index] ?? [];
    const picks = median.length ? [median[0], median[Math.floor(median.length / 2)], median[median.length - 1]] : [];
    const outline = strokeOutline(stroke);
    const xs = outline.map((point) => point[0]);
    const ys = outline.map((point) => y(point[1]));
    return [
      index,
      componentPath(entries, char, index).join('>') || '?',
      picks.map(([px, py]) => `(${Math.round(px)},${y(py)})`).join('→'),
      `${Math.round(Math.min(...xs))}-${Math.round(Math.max(...xs))},${Math.min(...ys)}-${Math.max(...ys)}`,
      Math.round(strokeInk(stroke)),
    ].join(' | ');
  });
  return [
    `CHARACTER ${char}  (${glyph.strokes.length} strokes)`,
    `IDS decomposition: ${entry?.ids ?? 'none'}`,
    `Natural parts already detected (closed tiles, stroke indices): ${JSON.stringify(parts[char] ?? [])}`,
    'Coordinates: 1024-unit square, x left→right, y top→bottom.',
    'idx | component path (outer>inner) | median path (writing direction) | bbox x0-x1,y0-y1 | ink',
    ...lines,
  ].join('\n');
}

// ── Answer parsing ──────────────────────────────────────────────────────────────────

/** The `groups` of the model's JSON answer, or null when there is no parseable object. */
function parseGroups(text) {
  const stripped = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed?.groups) ? parsed.groups : null;
  } catch {
    return null;
  }
}

/** Groups in the stored shape: each sorted ascending, ordered by first stroke. */
const normalizeGroups = (groups) =>
  groups.map((group) => [...group].sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]);

// ── Writes ──────────────────────────────────────────────────────────────────────────

/** Store one character's groups (or a decided NULL) on all its zh rows, and stamp them. */
async function writeCharacter(client, char, groups) {
  const { rows } = await client.query(
    `UPDATE ${TABLE} SET "superpositionGroups" = $1::jsonb
      WHERE language = 'zh' AND word1 = $2
      RETURNING id`,
    [groups === null ? null : JSON.stringify(groups), char]
  );
  await stampEntries(client, TABLE, rows.map((row) => row.id));
}

// ── Main ────────────────────────────────────────────────────────────────────────────

async function run() {
  if (isSpotCheck) console.log('🔍 SPOT CHECK MODE — first 5 words only\n');
  if (DRY_RUN) console.log('🧪 DRY RUN — prompt data only, no model calls, no writes\n');
  if (targetWords?.length) console.log(`🎯 Scoped to: ${targetWords.join(', ')}\n`);
  console.log(`🧩 Superposition groups backfill (${MODEL})${isBatch ? ' (batch mode)' : ''}...\n`);

  assertOracleCompatible(isBatch);
  if (!DRY_RUN && !process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY not set');
    process.exit(1);
  }
  if (!fs.existsSync(HANZI_DATA_DIR)) {
    throw new Error(`${HANZI_DATA_DIR} not found: run \`npm install\` at the repo root first.`);
  }
  const parts = JSON.parse(fs.readFileSync(PARTS_FILE, 'utf8'));
  const entries = await loadDecompositionEntries();

  const client = await db.getClient();
  try {
    // 1. The words. --words drops the discoverable gate (the pipeline enriches a word BEFORE
    //    it ships); an unscoped run sweeps the shipped corpus. --force ignores the stamp.
    const params = [];
    const scope = targetWords?.length
      ? (params.push(targetWords), `AND word1 = ANY($${params.length}::text[])`)
      : 'AND discoverable = TRUE';
    const gate = FORCE ? '' : `AND ${staleClause()}`;
    const { rows: words } = await client.query(
      `SELECT id, word1 FROM ${TABLE}
        WHERE language = 'zh' ${scope} ${gate}
        ORDER BY id ASC ${isSpotCheck ? 'LIMIT 5' : ''}`,
      params
    );
    console.log(`📊 ${words.length} word rows to cover`);
    if (words.length === 0) return;

    // 2. Their distinct characters, and which of those still need authoring: a character is
    //    pending when any of its own rows is unstamped/stale (or always, under --force).
    const chars = [...new Set(words.flatMap((row) => Array.from(row.word1)))];
    const { rows: charRows } = await client.query(
      `SELECT word1, bool_or(${staleClause()}) AS pending
         FROM ${TABLE}
        WHERE language = 'zh' AND word1 = ANY($1::text[])
        GROUP BY word1`,
      [chars]
    );
    const pendingChars = charRows.filter((row) => FORCE || row.pending).map((row) => row.word1);
    const rowless = chars.filter((char) => !charRows.some((row) => row.word1 === char));
    console.log(`🔤 ${chars.length} distinct characters: ${pendingChars.length} to author, ${chars.length - pendingChars.length - rowless.length} already current, ${rowless.length} with no det row of their own`);
    if (rowless.length) console.log(`   no det row (nowhere to store, skipped): ${rowless.join(' ')}`);

    // 3. Author. Glyph-less and simple characters are decided here without a model call.
    const toAsk = [];
    let decided = 0;
    for (const char of pendingChars) {
      const glyph = loadGlyph(char);
      if (glyph && glyph.strokes.length > SINGLE_STROKE_MAX) {
        toAsk.push({ id: char, word1: char, glyph, facts: strokeFacts(char, glyph, entries, parts) });
        continue;
      }
      const groups = glyph ? glyph.strokes.map((_, stroke) => [stroke]) : null;
      if (!NO_WRITES) await writeCharacter(client, char, groups);
      decided++;
    }
    console.log(`✍️  ${decided} decided without a model call (≤ ${SINGLE_STROKE_MAX} strokes or no glyph); ${toAsk.length} to ask\n`);

    if (DRY_RUN) {
      toAsk.forEach((row) => console.log(`${row.facts}\n`));
    } else if (toAsk.length > 0) {
      await runBackfill({
        anthropic,
        entries: toAsk,
        batch: isBatch,
        accrueUsage,
        buildRequest: (row) => ({
          model: MODEL,
          max_tokens: 2000,
          system: cachedSystem(SYSTEM_TEXT),
          messages: [{ role: 'user', content: row.facts }],
        }),
        handleResponse: async (row, message) => {
          const text = message.content?.find((block) => block.type === 'text')?.text ?? '';
          const groups = parseGroups(text);
          const strokeCount = row.glyph.strokes.length;
          if (!groups || groups.length < 2 || !isStrokePartition(groups, strokeCount)) {
            console.log(`\n${REVIEW_MARKER} ${row.word1}: not an exact partition of ${strokeCount} strokes into ≥ 2 tiles — ${text.slice(0, 200)}`);
            return false;
          }
          const normalized = normalizeGroups(groups);
          await writeCharacter(client, row.word1, normalized);
          console.log(normalized.map((group) => group.join(' ')).join(' | '));
          return true;
        },
      });
    }

    // 4. Stamp each word whose characters are now all stamped. Read back from the DB rather
    //    than trusting step 3, so an oracle export (which writes nothing) stamps nothing.
    if (!NO_WRITES) {
      const { rows: stillPending } = await client.query(
        `SELECT DISTINCT word1 FROM ${TABLE}
          WHERE language = 'zh' AND word1 = ANY($1::text[]) AND ${staleClause()}`,
        [chars]
      );
      const blocked = new Set(stillPending.map((row) => row.word1));
      const done = words.filter((row) => !Array.from(row.word1).some((char) => blocked.has(char)));
      if (done.length) await stampEntries(client, TABLE, done.map((row) => row.id));
      console.log(`🏁 ${done.length} of ${words.length} word rows complete${blocked.size ? `; waiting on ${[...blocked].join(' ')}` : ''}`);
    }
  } finally {
    client.release();
    await db.pool.end();
  }
}

run().catch((error) => {
  console.error('❌ Superposition groups backfill failed:', error);
  process.exit(1);
});
