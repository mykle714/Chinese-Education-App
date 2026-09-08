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
 *                 term PLUS a `termRationale` saying what metaphor that term is
 *                 betting on; SEARCH+JUDGE repeats with that term (falling back to
 *                 the next cascade term if the judge doesn't supply one, or repeats
 *                 one already tried) for up to MAX_JUDGE_ATTEMPTS candidates.
 *                 INTENT-AWARE (v3): the rationale is carried into the NEXT judge
 *                 call as "Search intent". Without it every attempt re-asked the flat
 *                 "does this icon depict the word?" question, which structurally
 *                 penalised the very cases the loop exists for — a reformulated term
 *                 is deliberately ADJACENT for a word with no literal icon, so
 *                 grading its result against the word alone rejects metaphors that
 *                 actually succeeded (一场空 → "futile effort" → "Effort", rejected
 *                 2/5 for "not conveying futility", i.e. graded against the word
 *                 instead of against the metaphor it had just committed to). With the
 *                 intent present the judge scores two things together: does the icon
 *                 depict the INTENDED concept, and does that concept serve the WORD.
 *                 Both must hold, so a drifted chain of loose hops still fails.
 *   3. CHOOSE   — the first ACCEPTED candidate wins. If none of the (up to
 *                 MAX_JUDGE_ATTEMPTS) judged candidates was accepted, the
 *                 highest-scored one is used only when it still reaches
 *                 MIN_STORED_SCORE; below that the word keeps iconId = NULL.
 *                 SCORE FLOOR (v4): the fallback used to be stored unconditionally
 *                 ("a NULL iconId is worse than an imperfect one"). That holds for a
 *                 3/5 near-miss but not at the bottom — sub-floor picks are
 *                 misleading rather than weak (年中 "mid-year" → a NEW YEAR calendar;
 *                 锦囊 "brocade pouch" → a money bag; 长平之战, a 260 BC battle → the
 *                 Fortnite logo) and a missing icon degrades gracefully everywhere it
 *                 is read. The threshold is not tuned: across a 50-word sample every
 *                 ACCEPTED candidate scored >= 3 and every REJECTED one <= 2, so the
 *                 floor sits on the judge's own boundary and only discards what the
 *                 judge already rejected. A discarded candidate also skips the
 *                 getIconById fetch and icons8 INSERT, so it leaves no junk row.
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

const SCRIPT_VERSION = 5; // bump when this script's logic changes (v5: comma-split search terms — a gloss packing several synonyms is split so each searches on its own (fixes icons8 HTTP 400 on long seed terms, and stops the search matching the LAST synonym), plus a 400 now advances the cascade instead of failing the row; v4: score floor — a judged candidate below MIN_STORED_SCORE is discarded rather than stored as a least-bad fallback; v3: intent-aware judging — a reformulated term's rationale is carried into the next judge call, so a deliberate metaphor is scored on whether it serves the word rather than on literal depiction; v2: LLM acceptability judge + reformulation loop, replacing the pure deterministic cascade)

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

// Cap on how many candidates get judged per word. After this many rejections the
// loop stops reformulating and settles on the best-scoring candidate it saw. That
// candidate is only STORED if it clears MIN_STORED_SCORE below — as of v4 exhausting
// the attempts no longer guarantees an icon, so a word with no decent match keeps
// iconId = NULL instead of taking a least-bad one.
const MAX_JUDGE_ATTEMPTS = 4;

// Minimum judge score (1-5) that may be WRITTEN to a row. A candidate scoring below
// this is discarded and the word keeps iconId = NULL rather than shipping a
// misleading picture. 3 is the judge's own accept/reject boundary — see the SCORE
// FLOOR note in the CHOOSE step.
const MIN_STORED_SCORE = 3;

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
  try {
    const { icons } = await searchIcons(term, { amount: 1 });
    return icons[0] ?? null;
  } catch (err) {
    // A 400 is icons8 rejecting THIS TERM, not an outage — treat it as "no results"
    // so the cascade advances to the next term instead of failing the whole word.
    // Before this, one unsearchable seed gloss errored the row out of every run and
    // it could never receive an icon (see MAX_SEARCH_TERM_LENGTH).
    // Auth (401), rate limit (429) and 5xx still throw: those are real faults, and
    // swallowing them would silently turn an outage into a corpus of empty icons.
    if (/HTTP 400\b/.test(err?.message ?? '')) {
      console.log(`      ↳ icons8 rejected term "${term}" (400) — trying the next term`);
      return null;
    }
    throw err;
  }
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

// Longest term we will send to icons8. The API rejects long multi-clause terms
// outright with HTTP 400 — `agradecido`'s seed gloss
// "grateful, thankful, appreciative, obliged, indebted" (50 chars) did exactly that,
// which errored the word out of the batch on every run rather than degrading to a
// worse icon. Splitting on commas (below) keeps terms well under this in practice;
// the cap is the backstop for a long comma-free gloss.
const MAX_SEARCH_TERM_LENGTH = 40;

/**
 * One gloss → the search terms it yields, in preference order.
 *
 * A single gloss routinely packs several synonyms behind commas — this is the norm
 * in the Wiktionary-derived es data ("lawyer, solicitor, counsel") and rare but
 * possible in zh. Searching the JOINED string is wrong twice over: icons8 400s on the
 * long ones, and on the rest it tends to match the LAST synonym, which is the least
 * representative one ("weapon, arm" → Robotic Arm; "elevator, lift" → Not Working
 * Elevator; "motorway, freeway" → Traffic Jam). So split and let each synonym search
 * on its own, best-first — the leading synonym is the primary sense.
 *
 * Parentheses are stripped BEFORE splitting, so a comma inside a parenthetical
 * ("acute (terminating in a point or edge, especially ...)") never produces a fragment.
 */
function iconSearchFragments(definition) {
  const term = iconSearchTerm(definition);
  if (!term) return [];
  return term
    .split(',')
    .map((fragment) => fragment.trim())
    .filter((fragment) => fragment && fragment.length <= MAX_SEARCH_TERM_LENGTH);
}

/**
 * Ordered list of candidate search terms for a det row:
 *   1. each comma-separated fragment of dd = definitions[0], leading synonym first
 *   2. word1 (fallback headword)
 *   3. the fragments of definitions[i] for the remaining glosses, in array order
 * Empty/duplicate candidates are dropped so we never re-search the same term twice.
 * This is the FALLBACK cascade used to find an initial (or next) candidate to judge;
 * the judge's own `nextSearchTerm` reformulation takes priority when present.
 */
function buildSearchTerms(row) {
  const definitions = Array.isArray(row.definitions) ? row.definitions : [];
  const candidates = [
    ...iconSearchFragments(definitions[0]),
    (row.word1 ?? '').trim(),
    ...definitions.slice(1).flatMap(iconSearchFragments),
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
- nextSearchTerm: REQUIRED (a different, more concrete or differently-angled English search phrase) when acceptable is false. Must not repeat any already-tried term. null when acceptable is true.
- termRationale: REQUIRED alongside nextSearchTerm — one short sentence saying WHY that term should stand in for this word (the metaphor or angle you are betting on). null when acceptable is true.

INTENT-AWARE JUDGING. When the candidate was found via a term that a previous pass
proposed as a deliberate stand-in (you will be shown that term and its rationale under
"Search intent"), do NOT re-ask whether the icon literally depicts the word. That term was
chosen precisely because the word has no literal icon. Instead score TWO things together:
  (a) does the icon faithfully depict the INTENDED concept the term was reaching for, and
  (b) does that concept genuinely help a learner recall the WORD?
Both must hold. A faithful icon for a well-chosen metaphor is ACCEPTABLE and should score
3-5 even though it does not picture the word itself — that is a success, not a miss. But an
icon for a concept that has drifted away from the word (a chain of loosely-related hops that
no longer points back at the meaning) fails (b) and must still be REJECTED, however well it
matches the search term.`;

function buildJudgeRequest(wordContext, searchIcon, currentTerm, triedTerms, searchIntent) {
  const defsText = wordContext.definitions.slice(0, 4).join('; ') || '(none)';
  // Carry the PRIOR pass's reformulation intent forward. Without it every attempt
  // re-asks the flat "does this depict the word?" question, which structurally
  // penalises the deliberate metaphors the loop exists to find: the reformulated
  // term is adjacent ON PURPOSE for a word with no literal icon, so judging its
  // result against the word alone rejects a metaphor that actually succeeded.
  const intentText = searchIntent
    ? `\n\nSearch intent — "${currentTerm}" was NOT a literal description of the word. A previous pass proposed it as a deliberate stand-in because: ${searchIntent}\nJudge this candidate against that intent (see INTENT-AWARE JUDGING), not against a literal depiction of the word.`
    : '';
  const prompt = `Word: ${wordContext.word1}
Definitions: ${defsText}${intentText}

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
async function judgeIcon(wordContext, searchIcon, currentTerm, triedTerms, searchIntent) {
  const response = await anthropic.messages.create(buildJudgeRequest(wordContext, searchIcon, currentTerm, triedTerms, searchIntent));
  const parsed = parseModelJson(response.content[0]?.text ?? '');
  if (!parsed || typeof parsed.acceptable !== 'boolean') {
    return { acceptable: false, score: 1, reason: 'unparseable judge response', nextSearchTerm: null, termRationale: null };
  }
  const nextSearchTerm = typeof parsed.nextSearchTerm === 'string' && parsed.nextSearchTerm.trim()
    ? parsed.nextSearchTerm.trim()
    : null;
  return {
    acceptable: parsed.acceptable === true,
    score: typeof parsed.score === 'number' ? parsed.score : (parsed.acceptable ? 5 : 1),
    reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    nextSearchTerm,
    // Why the judge believes nextSearchTerm stands in for the word. Fed to the NEXT
    // attempt as its "Search intent" so the metaphor is judged on its own terms.
    termRationale: typeof parsed.termRationale === 'string' && parsed.termRationale.trim()
      ? parsed.termRationale.trim()
      : null,
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
  // Rationale for `queuedTerm`, when it came from a judge reformulation rather than
  // the cascade. Cascade terms are literal (dd / word1 / other glosses) and carry no
  // intent, so they stay null and the judge falls back to the plain literal test.
  let queuedIntent = null;

  // Each iteration either (a) finds nothing for `queuedTerm` and advances the
  // cascade without spending a judge attempt, or (b) finds a candidate, judges it,
  // and queues either the judge's reformulation or the next cascade term.
  while (attempts.length < MAX_JUDGE_ATTEMPTS && queuedTerm) {
    const term = queuedTerm;
    const intent = queuedIntent;
    queuedTerm = null;
    queuedIntent = null;

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

    const judgement = await judgeIcon(wordContext, searchIcon, term, triedTerms, intent);
    attempts.push({ term, icon: searchIcon, judgement, intent });

    if (judgement.acceptable) break;

    // A judge reformulation carries its rationale forward; falling back to the next
    // cascade term drops it, since that term is literal and needs no intent framing.
    if (judgement.nextSearchTerm && !triedTerms.includes(judgement.nextSearchTerm)) {
      queuedTerm = judgement.nextSearchTerm;
      queuedIntent = judgement.termRationale;
    } else {
      queuedTerm = cascadeTerms[cascadeIdx++] ?? null;
    }
  }

  if (attempts.length === 0) {
    return { status: 'no-icon', reason: `no search match (tried: ${triedTerms.join(', ')})` };
  }

  // Winner: the last attempt if it was accepted, otherwise the highest-scored
  // candidate across every attempt.
  const last = attempts[attempts.length - 1];
  let chosen = last;
  if (!last.judgement.acceptable) {
    chosen = attempts.reduce((best, a) =>
      (a.judgement.score ?? 0) > (best.judgement.score ?? 0) ? a : best, attempts[0]);
  }

  // SCORE FLOOR (v4). The least-bad fallback used to be stored unconditionally, on
  // the theory that a NULL iconId is worse than an imperfect one. Measured over a
  // 50-word random sample that theory does not hold at the bottom of the range: the
  // sub-floor picks are not merely weak but actively misleading — 年中 ("mid-year")
  // drew a NEW YEAR calendar, 锦囊 ("brocade pouch") a money bag, 长平之战 (a 260 BC
  // battle) the Fortnite logo — and a missing icon degrades gracefully everywhere it
  // is read, which is why this whole step is `optional` in the manifest.
  //
  // The threshold needs no tuning: the judge's own accept/reject boundary already
  // falls exactly here. Across 100 judged candidates every ACCEPTED one scored >= 3
  // and every REJECTED one <= 2, with nothing straddling. So this only discards
  // candidates the judge itself had already rejected.
  //
  // Returning early also skips the getIconById fetch and the icons8 INSERT, so a
  // rejected candidate no longer pays an HTTP call or leaves a junk row behind
  // (tonight's runs put "Samsung Flow" and "Fortnite Battle Royale" in the catalog
  // that way). The row is still stamped by the caller's no-icon branch, so it is not
  // re-searched on every subsequent run.
  if (!chosen.judgement.acceptable && (chosen.judgement.score ?? 0) < MIN_STORED_SCORE) {
    return {
      status: 'no-icon',
      reason: `below score floor (best ${chosen.judgement.score}/5 < ${MIN_STORED_SCORE} after ${attempts.length} judged): ${chosen.judgement.reason}`,
    };
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
    // Index (1-based) of the attempt that won, and whether that attempt carried a
    // reformulation intent. Distinguishes "accepted on the literal first try" from
    // "accepted under the intent-aware rubric", which are different rubrics.
    winningAttempt: attempts.indexOf(chosen) + 1,
    winningHadIntent: Boolean(chosen.intent),
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
          const attemptTag = `[att ${result.winningAttempt}/${result.judgeAttempts}${result.winningHadIntent ? ' intent' : ' literal'}]`;
          const verdict = result.accepted
            ? `accepted ${attemptTag}, score ${result.score}/5`
            : `FALLBACK ${attemptTag} (least-bad after ${result.judgeAttempts} judged), score ${result.score}/5`;
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
