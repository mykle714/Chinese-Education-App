/**
 * Oracle Backfill planner — decide WHICH backfill scripts have real work pending.
 *
 * LAYER: data-enrichment (backfill) planning utility. Read-only; never writes.
 *
 * WHY: /oracle-backfill used to run a hardcoded 12-script list every round and let
 * each script's own doneGate no-op. That works but is blind — it cannot say what is
 * pending before running, cannot prioritize, and leaves "is this row stale?" as a
 * human judgment call. The zh pipeline already has an authoritative manifest
 * (shared/lib/requiredScripts.js) powering the on-first-sort lazy-enrichment worker;
 * this reuses it so the skill plans from the same source of truth.
 *
 * Semantics come straight from the manifest and therefore match the worker exactly:
 *   - applicability (`when`): breakdown only on multi-char, classifier only on nouns, …
 *   - version-aware staleness: a step is pending when MISSING a stamp or stamped
 *     BELOW its manifest version — so a version bump re-triggers only that script.
 *   - approval protection: a step whose validation field a validator approved/flagged
 *     is never pending (mirrors validatedClause in the scripts themselves).
 *
 * USAGE (via the prod shim so it reaches cow-postgres-prod):
 *   scripts/backfill/run-prod.sh scripts/backfill/oracle-plan.js --limit=25
 *   scripts/backfill/run-prod.sh scripts/backfill/oracle-plan.js --new --limit=25
 *   scripts/backfill/run-prod.sh scripts/backfill/oracle-plan.js --words=未来,摸脉
 *   scripts/backfill/run-prod.sh scripts/backfill/oracle-plan.js --lang=es --discoverable
 *
 * FLAGS
 *   --lang=zh|es    which pipeline to plan (default zh). Selects the manifest AND the
 *                   det table — the two are intentionally not unified (see CLAUDE.md).
 *   --discoverable  only already-shipped rows (refresh/heal work)   [default: both]
 *   --new           only undiscoverable rows (candidates to ship). For zh this scope
 *                   is CURATED and RANKED — see the --new branch in main().
 *   --words=a,b     restrict to these word1 values (ignores the above)
 *   --limit=N       cap the candidate rows examined (default 50)
 *   --json          emit machine-readable JSON instead of the table
 *
 * Referenced by: .claude/commands/oracle-backfill.md §3-§4.
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env.docker') });

import db from '../../db.js';
import {
  VALIDATION_FIELDS,
  pendingSteps,
  buildIncompletePredicate,
  scriptsForLanguage,
  detTableForLanguage,
} from './shared/lib/requiredScripts.js';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const LANG = val('lang') || 'zh';
const ONLY_DISCOVERABLE = has('--discoverable');
const ONLY_NEW = has('--new');
const AS_JSON = has('--json');
const LIMIT = Number(val('limit') || 50);
const WORDS = (val('words') || '').split(',').map((s) => s.trim()).filter(Boolean);

// Fail fast on an unknown language rather than planning zh under an es-shaped intent.
// Caught so a typo'd --lang prints one usable line instead of a module-load stack trace.
let MANIFEST, DET_TABLE;
try {
  MANIFEST = scriptsForLanguage(LANG);
  DET_TABLE = detTableForLanguage(LANG);
} catch {
  console.error(`❌ unknown --lang="${LANG}". Supported: zh, es.`);
  process.exit(1);
}

/**
 * Corpus-derived character-commonness table, used to order the zh `--new` batches. There is NO frequency column or word list anywhere in this project, so the
 * dictionary itself is the corpus: a character's score is the number of headwords it
 * appears in (的/人/大 are in thousands, 鳚/鹮/丂 in a handful). A word scores as the
 * MIN over its characters — a word is only as common as its rarest character.
 *
 * Cheap enough to compute per plan (one grouped pass over ~114k headwords, ~250k
 * characters; hash-joined, sub-second) so it never goes stale and needs no new column.
 *
 * CAVEAT: this ranks characters, not words, so a rare word built from common
 * characters (人子 "son of man", 国学) can outrank a commoner word. It is a proxy —
 * it is there to keep obscure fish and archaic radicals out of the batches, which it
 * does decisively; it is not a true frequency list.
 */
const CHAR_FREQ_CTE = `
  WITH charfreq AS (
    SELECT c.ch, count(*) AS n
      FROM dictionaryentries_zh d, regexp_split_to_table(d.word1, '') AS c(ch)
     WHERE d.language = 'zh'
     GROUP BY c.ch
  )`;

async function main() {
  const client = await db.getClient();
  try {
    const params = [];
    let scope = '';
    let order = 'd.discoverable DESC, d.id';
    if (WORDS.length) {
      params.push(WORDS);
      scope = `AND d.word1 = ANY($${params.length}::text[])`;
    } else if (ONLY_DISCOVERABLE) {
      scope = 'AND d.discoverable = TRUE';
    } else if (ONLY_NEW) {
      // Candidates worth shipping. For zh this branch does two jobs beyond
      // "discoverable = FALSE" (it inherited them from the retired --unsortable
      // pre-pass scope, which after migration 144 selected exactly these same rows):
      //
      // (a) CANDIDATE QUALITY. Plain id order walks the head of the cedict import,
      //     which is punctuation, numerals and latin-initialism entries (`%`, `110`,
      //     `11区`, `3C`, `A片`). Those are not words a learner should be handed as a
      //     sort card, and every one wastes a hand-authored prompt. So require a
      //     Han-only headword of 1-4 characters with real definitions, and drop the
      //     cedict surname/place stubs whose lead gloss is literally "surname X".
      // (b) USEFUL ORDER — see CHAR_FREQ_CTE. The corpus will realistically never be
      //     enriched in full, so the ORDER BY decides which slice learners actually
      //     get. Commonest-first, not id-first.
      // es gets neither: `--new` does not filter junk headwords there (the Wiktionary
      // import's head is punctuation and abbreviations), which is why the skill makes
      // the user confirm the es word list by hand.
      scope = `AND d.discoverable = FALSE
               AND d.definitions IS NOT NULL AND jsonb_array_length(d.definitions) > 0`;
      if (LANG === 'zh') {
        scope += `
               AND d.word1 ~ '^[一-龥]{1,4}$'
               AND COALESCE(d.definitions->>0, '') NOT ILIKE 'surname %'`;
        order = 'score DESC, d.id';
      }
    }

    // Every scope plans the FULL manifest: a row is either fully enriched and shipped
    // (`discoverable`) or it is not — there is no intermediate bar any more, so there
    // is no longer a subset of steps worth planning on its own.
    const steps = MANIFEST;

    // buildIncompletePredicate encodes applicability + version-staleness + approval
    // protection. A --words run skips it: an explicit word list is an instruction to
    // look at those rows, and the per-row pendingSteps below still reports honestly.
    const incomplete = WORDS.length ? 'TRUE' : buildIncompletePredicate('d', steps);

    const lim = Number.isFinite(LIMIT) && LIMIT > 0 ? LIMIT : 50;
    const cols = `d.id, d.word1, d.pronunciation, d.definitions, d."partsOfSpeech",
                  d."enrichmentLog", d.discoverable, d.difficulty`;

    // The commonness ranking needs the per-character join + GROUP BY, so it gets its
    // own query shape; every other scope uses the plain one.
    const ranked = ONLY_NEW && LANG === 'zh';
    const { rows } = await client.query(
      ranked
        ? `${CHAR_FREQ_CTE}
           SELECT ${cols}, min(cf.n) AS score
             FROM ${DET_TABLE} d
             CROSS JOIN LATERAL regexp_split_to_table(d.word1, '') AS c(ch)
             JOIN charfreq cf ON cf.ch = c.ch
            WHERE d.language = '${LANG}'
              AND ${incomplete}
              ${scope}
            GROUP BY d.id
            ORDER BY ${order}
            LIMIT ${lim}`
        : `SELECT ${cols}
             FROM ${DET_TABLE} d
            WHERE d.language = '${LANG}'
              AND ${incomplete}
              ${scope}
            ORDER BY ${order}
            LIMIT ${lim}`,
      params);

    if (rows.length === 0) {
      console.log('✅ Nothing pending for the requested scope.');
      return;
    }

    // Validator approvals/flags for exactly these rows, so pendingSteps can honor them.
    const { rows: vRows } = await client.query(
      `SELECT "entryId", field FROM validations
        WHERE language = '${LANG}' AND action IN ('approve','flag')
          AND field = ANY($1::text[]) AND "entryId" = ANY($2::int[])`,
      [VALIDATION_FIELDS, rows.map((r) => r.id)]
    );
    const approvedByRow = new Map();
    for (const v of vRows) {
      if (!approvedByRow.has(v.entryId)) approvedByRow.set(v.entryId, new Set());
      approvedByRow.get(v.entryId).add(v.field);
    }

    // Aggregate: script id → the words needing it.
    const byScript = new Map(steps.map((s) => [s.id, []]));
    const protectedCount = new Map();
    for (const row of rows) {
      const approved = approvedByRow.get(row.id) || new Set();
      for (const f of approved) protectedCount.set(f, (protectedCount.get(f) || 0) + 1);
      for (const step of pendingSteps(row, approved, steps)) byScript.get(step.id).push(row.word1);
    }

    if (AS_JSON) {
      console.log(JSON.stringify({
        language: LANG,
        scope: ONLY_DISCOVERABLE ? 'discoverable' : ONLY_NEW ? 'new' : WORDS.length ? 'words' : 'all',
        candidates: rows.map((r) => ({ id: r.id, word1: r.word1, discoverable: r.discoverable })),
        plan: [...byScript].filter(([, w]) => w.length).map(([id, words]) => ({ id, words })),
      }, null, 2));
      return;
    }

    const shipped = rows.filter((r) => r.discoverable).length;
    console.log(`\n📋 Oracle plan [${LANG}] — ${rows.length} candidate rows `
      + `(${shipped} already discoverable, ${rows.length - shipped} new)\n`);
    console.log('  Run these in this order (manifest order encodes the dependencies):\n');
    let total = 0;
    for (const step of steps) {
      const words = byScript.get(step.id);
      if (!words.length) continue;
      total += words.length;
      const preview = words.slice(0, 8).join(',') + (words.length > 8 ? ` …+${words.length - 8}` : '');
      console.log(`  ${String(words.length).padStart(4)}  ${step.id.replace(/^(chinese|spanish)\//, '')}  (v${step.version}, ${step.when})`);
      console.log(`        --words=${preview}`);
    }
    console.log(`\n  ${total} prompt(s) total across ${[...byScript].filter(([, w]) => w.length).length} script(s).`);
    if (ONLY_NEW) {
      // Answering the prompts does not ship the rows — only the promoter, which
      // re-derives completeness, may flip `discoverable`. Name it explicitly so the
      // round can't end one step short.
      console.log('\n  Then promote the batch (re-derives completeness; never promotes a half-done row):');
      console.log(`      scripts/backfill/promote-discoverable.js --words=${rows.slice(0, 8).map((r) => r.word1).join(',')}`
        + `${rows.length > 8 ? ' …' : ''} --apply`);
    }
    if (protectedCount.size) {
      console.log('\n  🛡 validator-protected (these steps are skipped, content is authoritative):');
      for (const [field, n] of protectedCount) console.log(`      ${field}: ${n} row(s)`);
    }
    console.log('');
  } finally {
    client.release();
    await db.pool.end();
  }
}

main().catch((err) => {
  console.error('❌ oracle-plan failed:', err);
  process.exit(1);
});
