/**
 * Backfill Script: representative icons8 icon (iconId) for det entries
 *
 * LAYER: data-enrichment (backfill) layer. Talks directly to the icons8 HTTP API
 * and to Postgres via the shared `db` pool — no service/DAL layer involved.
 *
 * Pipeline, per det row (deterministic — no LLM):
 *   1. SEARCH  — GET icons8 v7 search with amount=1, trying a cascade of terms
 *                (dd → word1 → remaining definitions[]; see TERM CASCADE below)
 *                until one returns a match, taking that top icon's id.
 *   2. UPSERT? — if that icons8Id is NOT already in the local `icons8` table, call
 *                getIconById to fetch the icon's full metadata + raw SVG bytes and
 *                INSERT it (assetBytes + downloadedFormat='svg'). If the id already
 *                exists locally, skip the second call — we already have the asset.
 *   3. LINK    — set det."iconId" = that id (FK to icons8."icons8Id", migration 72).
 *
 * Two endpoints are used because they return COMPLEMENTARY data:
 *   - search   https://search-app.icons8.com/api/iconsets/v7/search
 *       gives the metadata columns the `icons8` table mirrors
 *       (isColor / isExplicit / authorId / authorApiCode / sourceFormat) but NOT
 *       the previewUrl or the SVG bytes.
 *   - getById  https://api-icons.icons8.com/publicApi/icons/icon?id=<id>
 *       gives previewUrl + the raw `svg` string (stored as assetBytes) but NOT the
 *       search-only metadata above.
 *   The icons8 row is populated by merging both responses.
 *
 * AUTH: the public API key (ICONS8_API_KEY) is passed as the `token` query param on
 * both endpoints, replacing the browser's Bearer-JWT auth.
 *
 * TERM CASCADE: icons8's catalog is English-indexed, so a single term often misses.
 * We try, in order, until one search returns a hit:
 *   1. dd        — `iconSearchTerm(definitions[0])` (stripParentheses + leading
 *                  "to (be) " strip; mirrors src/utils/definitionUtils.ts, same
 *                  term the flp icon picker pre-fills with).
 *   2. word1     — the raw headword, as a fallback for when dd is empty/unmatched.
 *   3. ddt(definitions[i]), i = 1..n-1 — the same stripParentheses transform
 *      applied to each remaining gloss in turn, stopping at the first hit.
 * Rows where every candidate term misses are left with iconId = NULL and reported
 * as "no icon".
 *
 * Idempotent: only processes discoverable rows where "iconId" IS NULL, and getById is skipped when
 * the icon is already cached locally, so re-running only fills gaps.
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env.docker') });

import db from '../../db.js';
import { initRunLog } from './run-log.js';
import { searchIcons, getIconById } from '../../services/Icons8FetchService.js';

const SCRIPT_VERSION = 1; // bump when this script's logic changes

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

const ICONS8_TOKEN = process.env.ICONS8_API_KEY;

// run-log: deterministic script (no Anthropic client to instrument).
const { stampEntries } = initRunLog({ script: 'backfill-icons', version: SCRIPT_VERSION });

// Be polite to the icons8 API: small delay between rows.
const DELAY_MS = 300;

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
// Mirror of src/utils/definitionUtils.ts (stripParentheses / iconSearchTerm / ddt).
// Kept as a plain JS copy rather than imported since this script runs outside the
// frontend build (same pattern as backfill-long-definitions.js's stripParentheses
// mirror). Keep in sync if the frontend versions change.

function stripParentheses(text) {
  return (text ?? '').replace(/\s*\([^)]*\)/g, '').trim();
}

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
//  Per-entry pipeline
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Process one det row. Returns a small result describing what happened so the
 * caller can tally + log: { status, iconId?, name?, term?, fetched?, storedBytes? }.
 *   status: 'linked' | 'no-icon'
 *   fetched: true when getById was called (icon was new locally)
 */
async function processEntry(client, row) {
  const terms = buildSearchTerms(row);
  if (terms.length === 0) return { status: 'no-icon', reason: 'no usable search term' };

  // 1. SEARCH (amount=1) → try each candidate term in order until one hits.
  let term = null;
  let searchIcon = null;
  for (const candidate of terms) {
    searchIcon = await searchTopIcon(candidate);
    if (searchIcon?.id) {
      term = candidate;
      break;
    }
  }
  if (!searchIcon?.id) {
    return { status: 'no-icon', reason: `no search match (tried: ${terms.join(', ')})` };
  }

  const iconId = searchIcon.id;

  // 2. If we don't already have this icon locally, fetch full record + svg and insert.
  let fetched = false;
  let storedBytes = false;
  if (!(await icons8RowExists(client, iconId))) {
    const fullIcon = await getIconById(iconId);
    if (!fullIcon) return { status: 'no-icon', reason: `getIconById empty for ${iconId}` };
    const ins = await insertIcons8Row(client, searchIcon, fullIcon);
    fetched = true;
    storedBytes = ins.storedBytes;
  }

  // 3. LINK det → icon.
  await setEntryIconId(client, row.id, iconId);

  return { status: 'linked', iconId, name: searchIcon.name, term, fetched, storedBytes };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Main
// ─────────────────────────────────────────────────────────────────────────────

async function run() {
  if (!ICONS8_TOKEN) {
    console.error('❌ ICONS8_API_KEY not set (add it to server/.env.docker)');
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
        AND discoverable = TRUE
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
    let noIcon = 0;
    let fetchedNew = 0;
    let reusedCached = 0;
    let failed = 0;

    for (const row of entries) {
      process.stdout.write(`  ${row.word1} ... `);
      try {
        const result = await processEntry(client, row);

        if (result.status === 'linked') {
          await stampEntries(client, table, row.id);
          linked++;
          if (result.fetched) fetchedNew++;
          else reusedCached++;
          const tag = result.fetched
            ? `(fetched${result.storedBytes ? ' +svg' : ' meta-only'})`
            : '(cached)';
          console.log(`→ ${result.iconId} "${result.name}" via "${result.term}" ${tag}`);
        } else {
          noIcon++;
          console.log(`no icon (${result.reason})`);
        }
      } catch (err) {
        failed++;
        console.log(`FAILED: ${err.message}`);
      }

      await new Promise((r) => setTimeout(r, DELAY_MS));
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 Icons8 Backfill Complete!');
    console.log('='.repeat(60));
    console.log(`Table                   : ${table}`);
    console.log(`Total processed         : ${entries.length}`);
    console.log(`Linked (iconId set)     : ${linked}`);
    console.log(`  New icon fetched      : ${fetchedNew}`);
    console.log(`  Reused cached icon    : ${reusedCached}`);
    console.log(`No icon found           : ${noIcon}`);
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
