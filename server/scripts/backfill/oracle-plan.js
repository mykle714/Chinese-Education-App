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
 *
 * FLAGS
 *   --discoverable  only already-shipped rows (refresh/heal work)   [default: both]
 *   --new           only undiscoverable rows (candidates to ship)
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
  REQUIRED_SCRIPTS_ZH,
  VALIDATION_FIELDS,
  pendingSteps,
  buildIncompletePredicate,
} from './shared/lib/requiredScripts.js';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const ONLY_DISCOVERABLE = has('--discoverable');
const ONLY_NEW = has('--new');
const AS_JSON = has('--json');
const LIMIT = Number(val('limit') || 50);
const WORDS = (val('words') || '').split(',').map((s) => s.trim()).filter(Boolean);

async function main() {
  const client = await db.getClient();
  try {
    const params = [];
    let scope = '';
    if (WORDS.length) {
      params.push(WORDS);
      scope = `AND d.word1 = ANY($${params.length}::text[])`;
    } else if (ONLY_DISCOVERABLE) {
      scope = 'AND d.discoverable = TRUE';
    } else if (ONLY_NEW) {
      // Candidates worth shipping: real definitions to work from.
      scope = `AND d.discoverable = FALSE
               AND d.definitions IS NOT NULL AND jsonb_array_length(d.definitions) > 0`;
    }

    // buildIncompletePredicate encodes applicability + version-staleness + approval
    // protection. A --words run skips it: an explicit word list is an instruction to
    // look at those rows, and the per-row pendingSteps below still reports honestly.
    const incomplete = WORDS.length ? 'TRUE' : buildIncompletePredicate('d');

    const { rows } = await client.query(`
      SELECT d.id, d.word1, d.pronunciation, d.definitions, d."partsOfSpeech",
             d."enrichmentLog", d.discoverable
      FROM dictionaryentries_zh d
      WHERE d.language = 'zh'
        AND ${incomplete}
        ${scope}
      ORDER BY d.discoverable DESC, d.id
      LIMIT ${Number.isFinite(LIMIT) && LIMIT > 0 ? LIMIT : 50}
    `, params);

    if (rows.length === 0) {
      console.log('✅ Nothing pending for the requested scope.');
      return;
    }

    // Validator approvals/flags for exactly these rows, so pendingSteps can honor them.
    const { rows: vRows } = await client.query(
      `SELECT "entryId", field FROM validations
        WHERE language = 'zh' AND action IN ('approve','flag')
          AND field = ANY($1::text[]) AND "entryId" = ANY($2::int[])`,
      [VALIDATION_FIELDS, rows.map((r) => r.id)]
    );
    const approvedByRow = new Map();
    for (const v of vRows) {
      if (!approvedByRow.has(v.entryId)) approvedByRow.set(v.entryId, new Set());
      approvedByRow.get(v.entryId).add(v.field);
    }

    // Aggregate: script id → the words needing it.
    const byScript = new Map(REQUIRED_SCRIPTS_ZH.map((s) => [s.id, []]));
    const protectedCount = new Map();
    for (const row of rows) {
      const approved = approvedByRow.get(row.id) || new Set();
      for (const f of approved) protectedCount.set(f, (protectedCount.get(f) || 0) + 1);
      for (const step of pendingSteps(row, approved)) byScript.get(step.id).push(row.word1);
    }

    if (AS_JSON) {
      console.log(JSON.stringify({
        candidates: rows.map((r) => ({ id: r.id, word1: r.word1, discoverable: r.discoverable })),
        plan: [...byScript].filter(([, w]) => w.length).map(([id, words]) => ({ id, words })),
      }, null, 2));
      return;
    }

    const shipped = rows.filter((r) => r.discoverable).length;
    console.log(`\n📋 Oracle plan — ${rows.length} candidate rows `
      + `(${shipped} already discoverable, ${rows.length - shipped} new)\n`);
    console.log('  Run these in this order (manifest order encodes the dependencies):\n');
    let total = 0;
    for (const step of REQUIRED_SCRIPTS_ZH) {
      const words = byScript.get(step.id);
      if (!words.length) continue;
      total += words.length;
      const preview = words.slice(0, 8).join(',') + (words.length > 8 ? ` …+${words.length - 8}` : '');
      console.log(`  ${String(words.length).padStart(4)}  ${step.id.replace('chinese/', '')}  (v${step.version}, ${step.when})`);
      console.log(`        --words=${preview}`);
    }
    console.log(`\n  ${total} prompt(s) total across ${[...byScript].filter(([, w]) => w.length).length} script(s).`);
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
