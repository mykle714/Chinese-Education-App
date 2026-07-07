/**
 * backfill-breakdown-senses.js — tag each component character of a multi-char zh
 * word with the CORRECT sense it carries in that word.
 *
 * WHY
 *   The per-word `breakdown` jsonb (dictionaryentries_zh.breakdown, keyed by
 *   component character) is generated deterministically by
 *   backfill-dictionary-breakdown.js using the character's GLOBAL lead gloss
 *   (definitions[0]). That is the character's most-common sense in isolation,
 *   which is frequently the WRONG sense inside a specific compound:
 *     会议  → 会 breakdown reads "can" (global lead) but here it is the "meeting" sense
 *     银行  → 行 breakdown reads "to walk" but here it is the "row/business" (háng) sense
 *   Now that every character carries orthogonal `definitionClusters` (migration 90,
 *   see docs/DEFINITION_CLUSTERS.md), we can pick the RIGHT cluster per component
 *   character in the context of word1.
 *
 * WHAT IT WRITES  (extends the existing breakdown shape — no new column)
 *   breakdown[char] = {
 *     definition: <the tagged cluster's lead gloss, ddt-style>,   // correct-sense gloss
 *     sense:      <the tagged cluster's `sense` LABEL>,           // stable pointer
 *     pronunciation?: <preserved from the prior breakdown value>
 *   }
 *   `sense` is the source of truth and is the cluster's LABEL (not an index) so it
 *   survives re-clustering/re-scoring — the same stability contract as
 *   vet.selectedSense (migration 99). `definition` is refreshed to the tagged
 *   cluster's lead gloss so the on-card breakdown display shows the correct sense
 *   without any read-path change.
 *
 * HOW  (mirrors the example-sentence per-segment sense tagger)
 *   Per word, gather each unique component character's clusters:
 *     • 0 clusters (char not in dict / not yet clustered) → left untouched (no sense).
 *     • 1 cluster                                         → auto-assigned, NO API call.
 *     • ≥2 clusters                                       → offered to the model.
 *   If any character needs disambiguation, ONE Sonnet call per word returns
 *   {char: senseLabel}; each label is validated against that character's own cluster
 *   labels (invalid/absent → fall back to the most-vernacular cluster + a ⚠ review line).
 *
 * Depends on: backfill-dictionary-breakdown.js (breakdown must exist) and
 * backfill-cluster-definitions.js (component chars must be clustered) having run first.
 * Referenced by docs/BREAKDOWN_FEATURE_IMPLEMENTATION.md and docs/DEFINITION_MAPPING.md.
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import Anthropic from '@anthropic-ai/sdk';
import db from '../../../db.js';
import { initRunLog, cachedSystem } from '../run-log.js';

const SCRIPT_VERSION = 1; // bump when this script's logic/prompt changes
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const { stampEntries, staleClause } = initRunLog({ script: 'chinese/backfill-breakdown-senses', version: SCRIPT_VERSION, anthropic });

const TAGGER_MODEL = 'claude-sonnet-4-6';

// Stable marker so the mark-discoverable skill agent can grep review flags off stdout
// (same convention as the clusterer). See docs/DEFINITION_CLUSTERS.md § human review.
const REVIEW_MARKER = '⚠ BREAKDOWN SENSE REVIEW';

// ── args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const hasFlag = (f) => args.includes(f);
const getArg = (name) => {
  const a = args.find((x) => x.startsWith(`${name}=`));
  return a ? a.slice(name.length + 1) : null;
};
const ALL = hasFlag('--all');           // include non-discoverable zh entries
const FORCE = hasFlag('--force');        // re-tag even rows that already carry a sense
const STALE = hasFlag('--stale');        // also re-tag rows stamped below SCRIPT_VERSION
const SPOT_CHECK = hasFlag('--spot-check'); // 5 entries, NO writes, verbose
const LIMIT = getArg('--limit') ? parseInt(getArg('--limit'), 10) : null;
const wordsArg = getArg('--words');
const targetWords = wordsArg ? wordsArg.split(',').map((s) => s.trim()).filter(Boolean) : null;

// ── helpers ───────────────────────────────────────────────────────────────
// Lead gloss of a cluster, parentheticals stripped — the server analog of the
// frontend ddt() (src/utils/definitionUtils.ts). Falls back to the sense label.
function clusterLeadGloss(cluster) {
  const g = Array.isArray(cluster?.glosses) ? cluster.glosses.find((x) => typeof x === 'string' && x.trim()) : null;
  const stripped = (g ?? '').replace(/\s*\([^)]*\)/g, '').trim();
  return stripped || (typeof cluster?.sense === 'string' ? cluster.sense : '');
}

// The default cluster for a character (used when the model can't disambiguate):
// the most-vernacular sense, matching the frontend's sortedSenseClusters index-0
// default. Ties keep source order.
function defaultCluster(clusters) {
  return [...clusters].sort((a, b) => (b?.vernacularScore ?? 0) - (a?.vernacularScore ?? 0))[0];
}

// Only keep well-formed clusters that actually carry a usable label.
function usableClusters(definitionClusters) {
  return Array.isArray(definitionClusters)
    ? definitionClusters.filter((c) => c && typeof c.sense === 'string' && c.sense.trim().length > 0)
    : [];
}

function parseJsonObject(text) {
  const stripped = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// ── model call ──────────────────────────────────────────────────────────────
const TAGGER_SYSTEM = `You disambiguate the component characters of a Chinese WORD. For each listed character you are given the word it appears in and that character's candidate SENSES (each a short English label). Choose the ONE candidate sense that matches how the character is actually used IN THIS WORD.

Rules:
- Copy the chosen label VERBATIM, character-for-character. Never invent, translate, paraphrase, shorten, or combine labels.
- Judge the character's role inside the whole word's meaning, not its most common standalone meaning (e.g. in 会议 "meeting", 会 is the "meeting/gathering" sense, not "can").
- If you are even slightly unsure which candidate applies, still pick your best guess but add a short note to "reviewNotes" naming the character and why.

Respond with ONLY a JSON object:
{"assignments": {"<char>": "<exact candidate label>"}, "reviewNotes": ["<char>: <reason>"]}`;

// Returns Map<char, senseLabel> for the chars that were offered candidates. Fails
// OPEN (empty map) so a flaky/unparseable response falls back to per-char defaults.
async function callTagger(word, ambiguous) {
  const result = new Map();
  if (ambiguous.length === 0) return result;

  const lines = ambiguous
    .map(({ char, clusters }) => {
      const cands = clusters.map((c) => `"${c.sense}"`).join('; ');
      return `- ${char}: ${cands}`;
    })
    .join('\n');

  const userText = `Word: ${word}\n\nDisambiguate each character (pick one of its candidate senses):\n${lines}`;

  try {
    const response = await anthropic.messages.create({
      model: TAGGER_MODEL,
      max_tokens: Math.max(400, 150 * ambiguous.length),
      temperature: 0.1,
      system: cachedSystem(TAGGER_SYSTEM),
      messages: [{ role: 'user', content: userText }],
    });
    const parsed = parseJsonObject(response.content[0].text);
    const assignments = parsed?.assignments;
    if (assignments && typeof assignments === 'object') {
      for (const [char, label] of Object.entries(assignments)) {
        if (typeof label === 'string') result.set(char, label);
      }
    }
    if (Array.isArray(parsed?.reviewNotes)) {
      for (const note of parsed.reviewNotes) {
        if (typeof note === 'string' && note.trim()) console.log(`${REVIEW_MARKER} ${word}: ${note.trim()}`);
      }
    }
  } catch (e) {
    console.log(`${REVIEW_MARKER} ${word}: tagger call failed (${e.message}) — using per-char defaults`);
  }
  return result;
}

// ── per-entry work ────────────────────────────────────────────────────────
/**
 * Build the sense-tagged breakdown for one entry. Returns the new breakdown object,
 * or null when nothing changed (no clustered component chars). Chars with no usable
 * clusters are carried through UNCHANGED (keep their prior definition, no `sense`).
 */
async function tagEntryBreakdown(word, breakdown, clustersByChar) {
  // Preserve insertion order + repeats collapse exactly like generateBreakdown (keyed by char).
  const chars = Object.keys(breakdown);

  // Split chars into auto-assignable (0/1 cluster) vs. needs-model (≥2 clusters).
  const ambiguous = [];
  const decided = new Map(); // char -> chosen cluster
  for (const char of chars) {
    const clusters = clustersByChar.get(char) ?? [];
    if (clusters.length === 0) continue;           // untouched
    if (clusters.length === 1) { decided.set(char, clusters[0]); continue; }
    ambiguous.push({ char, clusters });
  }

  // Call the tagger even in spot-check mode (shows the decision); writes are gated later.
  const modelPicks = ambiguous.length ? await callTagger(word, ambiguous) : new Map();

  for (const { char, clusters } of ambiguous) {
    const label = modelPicks.get(char);
    const matched = label ? clusters.find((c) => c.sense === label) : null;
    if (matched) {
      decided.set(char, matched);
    } else {
      const fallback = defaultCluster(clusters);
      decided.set(char, fallback);
      console.log(`${REVIEW_MARKER} ${word}: '${char}' — model label ${label ? `"${label}" not among candidates` : 'missing'}; fell back to "${fallback.sense}"`);
    }
  }

  if (decided.size === 0) return null;

  // Merge: rewrite decided chars' definition+sense, keep pronunciation and any untouched chars.
  const next = {};
  for (const char of chars) {
    const prior = breakdown[char] && typeof breakdown[char] === 'object' ? breakdown[char] : {};
    const cluster = decided.get(char);
    if (cluster) {
      next[char] = {
        ...prior,
        definition: clusterLeadGloss(cluster),
        sense: cluster.sense,
      };
    } else {
      next[char] = prior; // no usable clusters → leave as generated
    }
  }
  return next;
}

// ── main ────────────────────────────────────────────────────────────────
async function run() {
  console.log('Starting breakdown sense-tagging backfill...\n');
  if (targetWords?.length) console.log(`🎯 Scoped to: ${targetWords.join(', ')}`);
  if (SPOT_CHECK) console.log('🔎 SPOT-CHECK mode — NO writes\n');

  const client = await db.getClient();
  try {
    // Target: multi-char zh entries that already have a breakdown. Default gate
    // skips rows already sense-tagged (breakdown text contains "sense"); --force re-tags.
    const conds = [
      `language = 'zh'`,
      `char_length(word1) > 1`,
      `breakdown IS NOT NULL`,
      `breakdown <> 'null'::jsonb`,
    ];
    const params = [];
    if (!ALL) conds.push('discoverable = TRUE');
    // Default: skip rows already sense-tagged. --stale ALSO re-tags rows stamped below
    // the current SCRIPT_VERSION; --force re-tags everything.
    if (!FORCE) {
      const notTagged = `breakdown::text NOT LIKE '%"sense"%'`;
      conds.push(STALE ? `(${notTagged} OR ${staleClause()})` : notTagged);
    }
    if (targetWords?.length) { params.push(targetWords); conds.push(`word1 = ANY($${params.length})`); }

    // Spot-check samples RANDOMLY (verify quality across the corpus, not just the
    // lowest ids); the real run keeps deterministic id order for resumability.
    let sql = `SELECT id, word1, breakdown FROM dictionaryentries_zh WHERE ${conds.join(' AND ')} ORDER BY ${SPOT_CHECK ? 'RANDOM()' : 'id'}`;
    if (SPOT_CHECK) sql += ` LIMIT ${LIMIT ?? 5}`;
    else if (LIMIT) sql += ` LIMIT ${LIMIT}`;

    const { rows: entries } = await client.query(sql, params);
    console.log(`Found ${entries.length} entries to sense-tag\n`);
    if (entries.length === 0) { console.log('No entries to process.'); return; }

    let processed = 0, updated = 0, skipped = 0, failed = 0;
    for (const entry of entries) {
      processed++;
      try {
        const breakdown = entry.breakdown && typeof entry.breakdown === 'object' ? entry.breakdown : null;
        if (!breakdown) { skipped++; continue; }

        // Load clusters for this word's unique component characters.
        const chars = [...new Set(Object.keys(breakdown))];
        const { rows: charRows } = await client.query(
          `SELECT word1, "definitionClusters" FROM dictionaryentries_zh
           WHERE language = 'zh' AND word1 = ANY($1::text[])`,
          [chars]
        );
        const clustersByChar = new Map();
        for (const r of charRows) clustersByChar.set(r.word1, usableClusters(r.definitionClusters));

        const next = await tagEntryBreakdown(entry.word1, breakdown, clustersByChar);
        if (!next) { skipped++; if (SPOT_CHECK) console.log(`— ${entry.word1}: no clustered component chars, skipped`); continue; }

        if (SPOT_CHECK) {
          console.log(`✓ ${entry.word1}:`);
          for (const [c, v] of Object.entries(next)) console.log(`    ${c} → ${v.sense ? `[${v.sense}] ` : ''}${v.definition}`);
        } else {
          await client.query(`UPDATE dictionaryentries_zh SET breakdown = $1 WHERE id = $2`, [JSON.stringify(next), entry.id]);
          await stampEntries(client, 'dictionaryentries_zh', entry.id);
        }
        updated++;
        if (!SPOT_CHECK && processed % 50 === 0) {
          console.log(`Progress: ${processed}/${entries.length} (${Math.round((processed / entries.length) * 100)}%)`);
        }
      } catch (e) {
        failed++;
        console.error(`Failed ID ${entry.id} "${entry.word1}": ${e.message}`);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('BREAKDOWN SENSE-TAG SUMMARY');
    console.log('='.repeat(60));
    console.log(`Processed:        ${processed}`);
    console.log(`Updated:          ${updated}${SPOT_CHECK ? ' (not written — spot-check)' : ''}`);
    console.log(`Skipped:          ${skipped}`);
    console.log(`Failed:           ${failed}`);
    console.log('='.repeat(60));
  } catch (e) {
    console.error('Fatal error during backfill:', e);
    throw e;
  } finally {
    client.release();
    await db.pool.end();
  }
}

run().catch((e) => { console.error('Fatal error:', e); process.exit(1); });
