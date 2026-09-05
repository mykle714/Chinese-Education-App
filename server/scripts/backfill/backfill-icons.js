/**
 * Backfill Script: representative icons8 icon (iconId) for det entries
 *
 * LAYER: data-enrichment (backfill) layer. Talks directly to the icons8 HTTP API,
 * the Anthropic API (via run-log's instrumented client), and to Postgres via the
 * shared `db` pool — no service/DAL layer involved.
 *
 * Pipeline, per det row:
 *   1. SEARCH   — GET icons8 v7 search with amount=1, trying a cascade of terms
 *                 (dd → word1 → remaining definitions[]; see TERM CASCADE below)
 *                 until one returns a match, taking that top icon's id.
 *   2. JUDGE    — ask an LLM whether that candidate icon is a good visual match for
 *                 the word, from TEXT METADATA ONLY (name/commonName/category/
 *                 subcategory + the word's definitions — never the image itself).
 *                 If rejected, the judge also proposes a new, more concrete search
 *                 term; SEARCH+JUDGE repeats with that term (falling back to the
 *                 next cascade term if the judge doesn't supply one, or repeats one
 *                 already tried) for up to MAX_JUDGE_ATTEMPTS candidates.
 *   3. CHOOSE   — the first ACCEPTED candidate wins. If none of the (up to
 *                 MAX_JUDGE_ATTEMPTS) judged candidates was accepted, the
 *                 highest-scored candidate seen is used anyway (a NULL iconId is
 *                 worse than an imperfect one) — this only happens when the loop
 *                 found at least one candidate to score in the first place.
 *   4. UPSERT?  — if the winning icons8Id is NOT already in the local `icons8`
 *                 table, call getIconById to fetch the icon's full metadata + raw
 *                 SVG bytes and INSERT it (assetBytes + downloadedFormat='svg'). If
 *                 the id already exists locally, skip the second call.
 *   5. LINK     — set det."iconId" = that id (FK to icons8."icons8Id", migration 72).
 *
 * Two icons8 endpoints are used because they return COMPLEMENTARY data:
 *   - search   https://search-app.icons8.com/api/iconsets/v7/search
 *       gives the metadata columns the `icons8` table mirrors, and the SAME
 *       name/commonName/category/subcategory fields the judge reads
 *       (isColor / isExplicit / authorId / authorApiCode / sourceFormat) but NOT
 *       the previewUrl or the SVG bytes.
 *   - getById  https://api-icons.icons8.com/publicApi/icons/icon?id=<id>
 *       gives previewUrl + the raw `svg` string (stored as assetBytes) but NOT the
 *       search-only metadata above.
 *   The icons8 row is populated by merging both responses.
 *
 * AUTH: the public API key (ICONS8_API_KEY) is passed as the `token` query param on
 * both icons8 endpoints, replacing the browser's Bearer-JWT auth.
 *
 * TERM CASCADE (search fallback, tried in order until a search HIT is found — this
 * is independent of the judge's own reformulation, which takes priority once a
 * candidate has actually been judged and rejected):
 *   1. dd        — `iconSearchTerm(definitions[0])` (stripParentheses + leading
 *                  "to (be) " strip; mirrors src/utils/definitionUtils.ts, same
 *                  term the flp icon picker pre-fills with).
 *   2. word1     — the raw headword, as a fallback for when dd is empty/unmatched.
 *   3. ddt(definitions[i]), i = 1..n-1 — the same stripParentheses transform
 *      applied to each remaining gloss in turn.
 * Rows where every candidate term (cascade + every judge reformulation) misses are
 * left with iconId = NULL and reported as "no icon".
 *
 * ORACLE BACKFILL: this script routes its LLM calls through an Anthropic client
 * wired into run-log's `initRunLog`, so `BACKFILL_ORACLE=export|apply` captures and
 * replays the judge calls exactly like any other AI backfill (see run-log.js —
 * multi-call chains per row are an established pattern here, matching
 * backfill-long-definitions.js's generator→validator→regenerator→chooser shape).
 * It is still NOT a fully "oracle-plannable" step end to end: SEARCH and the
 * icons8 UPSERT are real, live HTTP calls made outside the Anthropic client, so an
 * oracle round cannot answer this script locally without ICONS8_API_KEY and network
 * access — it stays opt-in (`optional: true`, `--with-icons`) in the manifest for
 * that reason. It is NO LONGER `deterministic: true`, though: the JUDGE step is an
 * LLM call, so a given word's outcome can (rarely) differ between runs at the same
 * SCRIPT_VERSION if the model's verdict changes.
 *
 * Idempotent: only processes discoverable rows where "iconId" IS NULL, and getById is
 * skipped when the icon is already cached locally, so re-running only fills gaps —
 * this script does not re-evaluate a word that already has an iconId (no --stale
 * support yet; re-checking an already-linked word's icon requires nulling its
 * iconId first).
 *
 * Usage (run from the server/ dir, or via docker):
 *   docker exec cow-backend-local npx tsx scripts/backfill/backfill-icons.js --lang=zh
 *   docker exec cow-backend-local npx tsx scripts/backfill/backfill-icons.js --lang=es --spot-check
 *   docker exec cow-backend-local npx tsx scripts/backfill/backfill-icons.js --lang=zh --words=猫,狗
 *   docker exec cow-backend-local npx tsx scripts/backfill/backfill-icons.js --lang=zh --metadata-only
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

import { stripParentheses } from './shared/lib/stripParentheses.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env.docker') });

import Anthropic from '@anthropic-ai/sdk';
import db from '../../db.js';
import { initRunLog, cachedSystem } from './run-log.js';
import { parseModelJson } from './shared/lib/json.js';
import { searchIcons, getIconById } from '../../services/Icons8FetchService.js';

const SCRIPT_VERSION = 2; // bump when this script's logic changes (v2: LLM acceptability judge + reformulation loop, replacing the pure deterministic cascade)

// ─────────────────────────────────────────────────────────────────────────────
//  Args & config
// ─────────────────────────────────────────────────────────────────────────────

const isSpotCheck = process.argv.includes('--spot-check');
// Metadata-only: populate the icons8 row but leave assetBytes NULL (skip storing
// the SVG). Useful to build the catalog first and download bytes in a later pass.
const metadataOnly = process.argv.includes('--metadata-only');

const langArg = process.argv.find((a) => a.startsWith('--lang='));
const lang = (langArg ? langArg.slice('--lang='.length) : 'zh').trim();

// Both per-language det tables share the same column shape for this backfill
// (word1, iconId — migration 72). Map the language code to its table.
const TABLE_BY_LANG = {
  zh: 'dictionaryentries_zh',
  es: 'dictionaryentries_es',
};
const table = TABLE_BY_LANG[lang];
if (!table) {
  console.error(`❌ Unknown --lang="${lang}". Expected one of: ${Object.keys(TABLE_BY_LANG).join(', ')}`);
  process.exit(1);
}

const wordsArg = process.argv.find((a) => a.startsWith('--words='));
const targetWords = wordsArg
  ? wordsArg.slice('--words='.length).split(',').map((s) => s.trim()).filter(Boolean)
  : null;
const wordsFilter = targetWords?.length
  ? `AND word1 = ANY(ARRAY[${targetWords.map((w) => `'${w.replace(/'/g, "''")}'`).join(', ')}])`
  : '';
// A --words run enriches exactly the named rows regardless of `discoverable`, matching
// every other manifest step. This matters for the on-first-sort worker, which enriches a
// row BEFORE promoting it: gating on discoverable=TRUE here would select nothing, never
// stamp, and leave isComplete() permanently false — the row could never be promoted.
const discoverableFilter = targetWords?.length ? '' : 'AND discoverable = TRUE';

const ICONS8_TOKEN = process.env.ICONS8_API_KEY;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// run-log: oracle-backfill capable (the judge calls route through this client), so
// BACKFILL_ORACLE=export|apply can capture/replay them like any other AI backfill.
const { stampEntries } = initRunLog({ script: 'backfill-icons', version: SCRIPT_VERSION, anthropic });

// Be polite to the icons8 API: small delay between rows.
const DELAY_MS = 300;

// Cap on how many candidates get judged per word before falling back to the
// least-bad one seen. Locked in with the user: 4 attempts, then take the best score
// so far rather than leave iconId NULL when at least one candidate was ever found.
const MAX_JUDGE_ATTEMPTS = 4;

const JUDGE_MODEL = 'claude-sonnet-4-6';

// ─────────────────────────────────────────────────────────────────────────────
//  icons8 API helpers
// ─────────────────────────────────────────────────────────────────────────────
//
// The actual icons8 HTTP calls (search filters, auth, response shapes) live in the
// shared service Icons8FetchService so the request path (Icons8Controller) and this
// backfill stay in lockstep. See server/services/Icons8FetchService.ts.

/**
 * SEARCH for the single best icon for `term`. amount=1 — we only need one.
 * Returns the raw icon object (search shape) or null if nothing matched.
 */
async function searchTopIcon(term) {
  if (!term) return null;
  const { icons } = await searchIcons(term, { amount: 1 });
  return icons[0] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Search-term cascade (dd → word1 → remaining definitions[] via ddt)
// ─────────────────────────────────────────────────────────────────────────────
//
// `stripParentheses` is imported from shared/lib rather than re-declared: this
// script's local copy was the old `\s*\([^)]*\)` regex and had silently drifted from
// the app's nesting-aware scanner. See shared/lib/stripParentheses.js.

const ICON_SEARCH_LEADING_STRIPS = [
  /^to\s+be\s+/i, // copular infinitive ("to be hungry")
  /^to\s+/i,      // plain infinitive ("to understand")
];

/** dd/ddt → icons8 search term: stripParentheses + leading-infinitive strip. */
function iconSearchTerm(definition) {
  let term = stripParentheses(definition ?? '');
  for (const re of ICON_SEARCH_LEADING_STRIPS) term = term.replace(re, '');
  return term.trim();
}

/**
 * Ordered list of candidate search terms for a det row:
 *   1. dd = iconSearchTerm(definitions[0])
 *   2. word1 (fallback headword)
 *   3. ddt(definitions[i]) for the remaining glosses, in array order
 * Empty/duplicate candidates are dropped so we never re-search the same term twice.
 * This is the FALLBACK cascade used to find an initial (or next) candidate to judge;
 * the judge's own `nextSearchTerm` reformulation takes priority when present.
 */
function buildSearchTerms(row) {
  const definitions = Array.isArray(row.definitions) ? row.definitions : [];
  const candidates = [
    iconSearchTerm(definitions[0]),
    (row.word1 ?? '').trim(),
    ...definitions.slice(1).map(iconSearchTerm),
  ];

  const seen = new Set();
  const terms = [];
  for (const term of candidates) {
    if (term && !seen.has(term)) {
      seen.add(term);
      terms.push(term);
    }
  }
  return terms;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Acceptability judge (text-metadata-only LLM call)
// ─────────────────────────────────────────────────────────────────────────────
//
// Deliberately metadata-only (name/commonName/category/subcategory), not
// vision/image-based — locked in with the user. The judge doubles as the
// reformulator: a rejection always comes with a proposed next search term, so one
// call both scores the candidate and, when needed, advances the loop.

const JUDGE_SYSTEM_TEXT = `You are curating icons for a language-learning flashcard app. For each word you are shown ONE CANDIDATE icon — its catalog metadata only (name, common name, category, subcategory), never the actual image — found by a keyword search against the icons8 catalog. Judge whether that icon would help a learner instantly recognize the word's meaning.

ACCEPT when the icon's subject matter clearly and concretely depicts the word's core meaning: a literal object/action/scene for concrete words, or a widely-recognized symbol for abstract ones (e.g. a clock for "time", a calendar page for "month", a sun for "morning").
REJECT when the icon is generic, unrelated, misleading, keyed off an unrelated homograph of the search term, or only an interface/UI glyph standing in for a grammatical or highly abstract word with no natural pictogram (e.g. "have", "there is", pronouns, particles) — for those, prefer the closest reasonable visual metaphor over an empty result, but still reject a bad one and propose a better search angle.

Respond with ONLY valid JSON, no markdown:
{"acceptable": true|false, "score": 1-5, "reason": "1 short sentence", "nextSearchTerm": "..." or null}
- score: 5 = perfect match, 1 = unrelated/misleading. Always include it, even when acceptable is true.
- nextSearchTerm: REQUIRED (a different, more concrete or differently-angled English search phrase) when acceptable is false. Must not repeat any already-tried term. null when acceptable is true.`;

function buildJudgeRequest(wordContext, searchIcon, currentTerm, triedTerms) {
  const defsText = wordContext.definitions.slice(0, 4).join('; ') || '(none)';
  const prompt = `Word: ${wordContext.word1}
Definitions: ${defsText}

Candidate icon (found via search term "${currentTerm}"):
  name: ${searchIcon.name ?? '(none)'}
  commonName: ${searchIcon.commonName ?? '(none)'}
  category: ${searchIcon.category ?? '(none)'}
  subcategory: ${searchIcon.subcategory ?? '(none)'}

Already-tried search terms (do not repeat these in nextSearchTerm): ${triedTerms.join(', ')}`;

  return {
    model: JUDGE_MODEL,
    max_tokens: 300,
    temperature: 0.2,
    system: cachedSystem(JUDGE_SYSTEM_TEXT),
    messages: [{ role: 'user', content: prompt }],
  };
}

/**
 * Judge one candidate icon. Fails closed (reject, no reformulation) on unparseable
 * output. Token usage is accrued automatically — initRunLog wraps
 * anthropic.messages.create itself, so this must NOT also call accrueUsage.
 */
async function judgeIcon(wordContext, searchIcon, currentTerm, triedTerms) {
  const response = await anthropic.messages.create(buildJudgeRequest(wordContext, searchIcon, currentTerm, triedTerms));
  const parsed = parseModelJson(response.content[0]?.text ?? '');
  if (!parsed || typeof parsed.acceptable !== 'boolean') {
    return { acceptable: false, score: 1, reason: 'unparseable judge response', nextSearchTerm: null };
  }
  const nextSearchTerm = typeof parsed.nextSearchTerm === 'string' && parsed.nextSearchTerm.trim()
    ? parsed.nextSearchTerm.trim()
    : null;
  return {
    acceptable: parsed.acceptable === true,
    score: typeof parsed.score === 'number' ? parsed.score : (parsed.acceptable ? 5 : 1),
    reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    nextSearchTerm,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  DB helpers
// ─────────────────────────────────────────────────────────────────────────────

/** True if the icon id already exists in the local icons8 table. */
async function icons8RowExists(client, iconId) {
  const { rows } = await client.query(
    `SELECT 1 FROM icons8 WHERE "icons8Id" = $1`,
    [iconId]
  );
  return rows.length > 0;
}

/**
 * INSERT a new icons8 row by merging the search-shape icon (search-only metadata)
 * with the getById-shape icon (previewUrl + svg bytes). ON CONFLICT DO NOTHING so a
 * concurrent/duplicate insert is harmless.
 *
 * Column source mapping (see migration 71 for the column meanings):
 *   icons8Id        ← search.id (=== getById.id)
 *   name            ← getById.name (NOT NULL) — search.name as fallback
 *   commonName      ← getById.commonName / search.commonName
 *   category        ← getById.categoryName (human label, matches v5 search shape)
 *   subcategory     ← getById.subcategoryName
 *   platform        ← getById.platform / search.platform
 *   isColor         ← search.isColor (getById omits it; platform 'color' as fallback)
 *   isAnimated      ← getById.isAnimated (absent ⇒ false)
 *   isExplicit      ← search.isExplicit (getById omits it)
 *   authorId        ← search.authorId
 *   authorApiCode   ← search.authorApiCode
 *   sourceFormat    ← search.sourceFormat (we store the SVG, so effectively 'svg')
 *   previewUrl      ← getById.previewUrl
 *   assetBytes      ← getById.svg (UTF-8 bytes)  [NULL when --metadata-only]
 *   downloadedFormat← 'svg'                       [NULL when --metadata-only]
 *   downloadedAt    ← now()                       [NULL when --metadata-only]
 */
async function insertIcons8Row(client, searchIcon, fullIcon) {
  const svg = typeof fullIcon.svg === 'string' ? fullIcon.svg : null;
  const storeBytes = !metadataOnly && svg;
  const assetBytes = storeBytes ? Buffer.from(svg, 'utf8') : null;

  await client.query(
    `INSERT INTO icons8 (
        "icons8Id", name, "commonName", category, subcategory, platform,
        "isColor", "isAnimated", "isExplicit", "authorId", "authorApiCode",
        "sourceFormat", "previewUrl",
        "assetBytes", "downloadedFormat", "downloadedAt"
     ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11,
        $12, $13,
        $14, $15, ${storeBytes ? 'now()' : 'NULL'}
     )
     ON CONFLICT ("icons8Id") DO NOTHING`,
    [
      fullIcon.id,
      fullIcon.name || searchIcon.name || '(unnamed)',
      fullIcon.commonName ?? searchIcon.commonName ?? null,
      fullIcon.categoryName ?? searchIcon.category ?? null,
      fullIcon.subcategoryName ?? searchIcon.subcategory ?? null,
      fullIcon.platform ?? searchIcon.platform ?? null,
      // getById has no isColor; trust search, fall back to the platform name.
      searchIcon.isColor ?? (String(fullIcon.platform).toLowerCase() === 'color'),
      fullIcon.isAnimated ?? false,
      searchIcon.isExplicit ?? false,
      searchIcon.authorId ?? null,
      searchIcon.authorApiCode ?? null,
      searchIcon.sourceFormat ?? 'svg',
      fullIcon.previewUrl ?? null,
      assetBytes,
      storeBytes ? 'svg' : null,
    ]
  );
  return { storedBytes: !!storeBytes };
}

/** Link a det row to its chosen icon. */
async function setEntryIconId(client, id, iconId) {
  await client.query(`UPDATE ${table} SET "iconId" = $1 WHERE id = $2`, [iconId, id]);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Per-entry pipeline: SEARCH → JUDGE → (reformulate → SEARCH → JUDGE)* → CHOOSE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Process one det row. Returns a small result describing what happened so the
 * caller can tally + log: { status, iconId?, name?, term?, fetched?, storedBytes?,
 * accepted?, score?, judgeAttempts?, reason? }.
 *   status: 'linked' | 'no-icon'
 *   fetched: true when getById was called (icon was new locally)
 *   accepted: true if the WINNING candidate was judge-accepted; false if it's the
 *             least-bad fallback after MAX_JUDGE_ATTEMPTS rejections.
 */
async function processEntry(client, row) {
  const cascadeTerms = buildSearchTerms(row);
  if (cascadeTerms.length === 0) return { status: 'no-icon', reason: 'no usable search term' };

  const wordContext = {
    word1: row.word1,
    definitions: Array.isArray(row.definitions) ? row.definitions : [],
  };

  const triedTerms = [];
  const attempts = []; // { term, icon, judgement }
  let cascadeIdx = 0;
  let queuedTerm = cascadeTerms[cascadeIdx++] ?? null;

  // Each iteration either (a) finds nothing for `queuedTerm` and advances the
  // cascade without spending a judge attempt, or (b) finds a candidate, judges it,
  // and queues either the judge's reformulation or the next cascade term.
  while (attempts.length < MAX_JUDGE_ATTEMPTS && queuedTerm) {
    const term = queuedTerm;
    queuedTerm = null;

    if (triedTerms.includes(term)) {
      queuedTerm = cascadeTerms[cascadeIdx++] ?? null;
      continue;
    }
    triedTerms.push(term);

    const searchIcon = await searchTopIcon(term);
    if (!searchIcon?.id) {
      queuedTerm = cascadeTerms[cascadeIdx++] ?? null;
      continue;
    }

    const judgement = await judgeIcon(wordContext, searchIcon, term, triedTerms);
    attempts.push({ term, icon: searchIcon, judgement });

    if (judgement.acceptable) break;

    queuedTerm = judgement.nextSearchTerm && !triedTerms.includes(judgement.nextSearchTerm)
      ? judgement.nextSearchTerm
      : (cascadeTerms[cascadeIdx++] ?? null);
  }

  if (attempts.length === 0) {
    return { status: 'no-icon', reason: `no search match (tried: ${triedTerms.join(', ')})` };
  }

  // Winner: the last attempt if it was accepted, otherwise the highest-scored
  // candidate across every attempt — least-bad fallback per the capped loop, so a
  // word never ends up with iconId NULL just because nothing hit the bar.
  const last = attempts[attempts.length - 1];
  let chosen = last;
  if (!last.judgement.acceptable) {
    chosen = attempts.reduce((best, a) =>
      (a.judgement.score ?? 0) > (best.judgement.score ?? 0) ? a : best, attempts[0]);
  }

  const { icon: searchIcon, term, judgement } = chosen;
  const iconId = searchIcon.id;

  // If we don't already have this icon locally, fetch full record + svg and insert.
  let fetched = false;
  let storedBytes = false;
  if (!(await icons8RowExists(client, iconId))) {
    const fullIcon = await getIconById(iconId);
    if (!fullIcon) return { status: 'no-icon', reason: `getIconById empty for ${iconId}` };
    const ins = await insertIcons8Row(client, searchIcon, fullIcon);
    fetched = true;
    storedBytes = ins.storedBytes;
  }

  // LINK det → icon.
  await setEntryIconId(client, row.id, iconId);

  return {
    status: 'linked',
    iconId,
    name: searchIcon.name,
    term,
    fetched,
    storedBytes,
    accepted: judgement.acceptable,
    score: judgement.score,
    judgeAttempts: attempts.length,
    reason: judgement.reason,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Main
// ─────────────────────────────────────────────────────────────────────────────

async function run() {
  if (!ICONS8_TOKEN) {
    console.error('❌ ICONS8_API_KEY not set (add it to server/.env.docker)');
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY not set');
    process.exit(1);
  }

  if (isSpotCheck) console.log('🔍 SPOT CHECK MODE — processing 5 entries only\n');
  if (metadataOnly) console.log('📝 METADATA-ONLY MODE — icons8 rows will be inserted without SVG bytes\n');
  if (targetWords?.length) console.log(`🎯 Scoped to: ${targetWords.join(', ')}\n`);
  console.log(`🚀 Starting icons8 iconId backfill for ${table} (lang=${lang})...\n`);

  const client = await db.getClient();

  try {
    // Only rows still missing an icon. definitions[]/word1 drive the search-term
    // cascade (see buildSearchTerms).
    const { rows: entries } = await client.query(`
      SELECT id, word1, definitions
      FROM ${table}
      WHERE "iconId" IS NULL
        ${discoverableFilter}
        ${wordsFilter}
      ORDER BY id ASC
      ${isSpotCheck ? 'LIMIT 5' : ''}
    `);

    console.log(`📊 Found ${entries.length} entries needing an iconId\n`);
    if (entries.length === 0) {
      console.log('Nothing to process.');
      return;
    }

    let linked = 0;
    let acceptedCount = 0;
    let fallbackCount = 0;
    let noIcon = 0;
    let fetchedNew = 0;
    let reusedCached = 0;
    let failed = 0;
    let exported = 0;

    for (const row of entries) {
      process.stdout.write(`  ${row.word1} ... `);
      let wasExport = false;
      try {
        const result = await processEntry(client, row);

        if (result.status === 'linked') {
          await stampEntries(client, table, row.id);
          linked++;
          if (result.accepted) acceptedCount++;
          else fallbackCount++;
          if (result.fetched) fetchedNew++;
          else reusedCached++;
          const tag = result.fetched
            ? `(fetched${result.storedBytes ? ' +svg' : ' meta-only'})`
            : '(cached)';
          const verdict = result.accepted
            ? `accepted, score ${result.score}/5`
            : `FALLBACK (least-bad after ${result.judgeAttempts} judged), score ${result.score}/5`;
          console.log(`→ ${result.iconId} "${result.name}" via "${result.term}" ${tag} — ${verdict}: ${result.reason}`);
        } else {
          // Stamp even though iconId stays NULL: this version of the term cascade really
          // ran and its verdict was "icons8 has no match". Without the stamp the row is
          // re-searched on every run and — now that this step is in the manifest — would
          // block promotion forever on a word icons8 simply does not carry.
          await stampEntries(client, table, row.id);
          noIcon++;
          console.log(`no icon (${result.reason})`);
        }
      } catch (err) {
        // Oracle export phase: the judge prompt was captured and the row deliberately
        // unwound before it could be judged/linked. Not a failure. (See the ORACLE
        // MODE block in run-log.js.)
        if (err?.oracleExport) { console.log('captured'); exported++; wasExport = true; }
        else { failed++; console.log(`FAILED: ${err.message}`); }
      }

      // No point throttling a row that never left the machine.
      if (!wasExport) await new Promise((r) => setTimeout(r, DELAY_MS));
    }

    console.log('\n' + '='.repeat(60));
    console.log(exported ? '📤 Oracle Export Complete!' : '📊 Icons8 Backfill Complete!');
    console.log('='.repeat(60));
    console.log(`Table                   : ${table}`);
    console.log(`Total processed         : ${entries.length}`);
    console.log(`Linked (iconId set)     : ${linked}`);
    console.log(`  Judge-accepted        : ${acceptedCount}`);
    console.log(`  Least-bad fallback    : ${fallbackCount}`);
    console.log(`  New icon fetched      : ${fetchedNew}`);
    console.log(`  Reused cached icon    : ${reusedCached}`);
    console.log(`No icon found           : ${noIcon}`);
    if (exported) console.log(`Prompts captured        : ${exported}  (no DB writes)`);
    console.log(`Errors                  : ${failed}`);
    console.log('='.repeat(60) + '\n');
  } finally {
    client.release();
    await db.end?.();
  }
}

run().catch((err) => {
  console.error('❌ Script failed:', err);
  process.exit(1);
});
