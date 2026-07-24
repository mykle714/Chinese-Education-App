/**
 * Chinese lazy-enrichment runner (per-word step runner + manual bulk drain).
 *
 * LAYER: data-enrichment (backfill) orchestration. See docs/DISCOVER_LAZY_ENRICHMENT.md §5.
 *
 * TWO CALLERS:
 *   1. RUNTIME (the standing mechanism) — `LazyEnrichmentService.triggerForWord`
 *      spawns this with `--words=<word> --apply --stale` when a VALIDATOR opens or
 *      sorts a word. That service owns the validator gate + candidacy pre-check; this
 *      script just runs the word's pending steps and promotes.
 *   2. MANUAL / BULK — run without `--words` to drain the derived candidate set (e.g. a
 *      one-off re-heal after a big SCRIPT_VERSION bump). There is NO standing cron; the
 *      old cron-style drain loop was retired in favour of the request-time triggers.
 *
 * WHY NO JOBS TABLE: the "needs enrichment" set is DERIVED from existing state
 * (no enrichment_jobs table). In the bulk drain a word is a candidate when:
 *     de.language = 'zh'
 *     AND de.sortable = TRUE            -- shown as a sort card
 *     AND EXISTS (a vocabentries_zh row for word1)   -- someone actually sorted it
 *     AND <incomplete per the required-scripts manifest>   -- VERSION-aware
 * (No `discoverable = FALSE` filter — candidacy is version-aware, so a stale shipped row
 * heals in place.) The vet-row check bounds a bulk drain to words users engaged with.
 * The set cannot be double-enqueued (one det row per word) and self-heals (a word drops
 * out the moment it is fully stamped + promoted).
 *
 * WHAT IT RUNS: for each candidate, the ordered required-scripts manifest
 * (requiredScripts.js) — steps that APPLY to the word and are not yet stamped —
 * each as a child `npx tsx <script> --words=<word>` (SERIAL; the Batches-API port
 * is explicitly out of scope here). Manifest order encodes the mark-discoverable
 * §A3 ordering constraints. Backfill scripts self-skip already-populated columns
 * (their own `col IS NULL` doneGate) and honor validator-approved fields via
 * validatedClause, so human-reviewed content survives and the pre-pass's work is
 * not redone. On completion the worker flips discoverable=TRUE.
 *
 * SAFETY: DRY-RUN by default (prints the candidate set + planned command sequence,
 * writes nothing, spends nothing). Pass --apply to actually spawn the steps and
 * promote. Run inside the backend container (siblings resolve via `npx tsx`):
 *   docker exec cow-backend-local npx tsx scripts/backfill/run-lazy-enrichment.js            # dry run
 *   docker exec cow-backend-local npx tsx scripts/backfill/run-lazy-enrichment.js --apply --limit=10
 *   docker exec cow-backend-local npx tsx scripts/backfill/run-lazy-enrichment.js --words=未来  # target words (skips the candidate query)
 *
 * Referenced by: docs/DISCOVER_LAZY_ENRICHMENT.md §5.
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env.docker') });

import db from '../../db.js';
import {
  pendingSteps, isComplete, buildIncompletePredicate, VALIDATION_FIELDS,
} from './shared/lib/requiredScripts.js';

// Per-step child command. Override for non-container hosts (e.g. ENRICH_STEP_CMD="node").
const STEP_CMD = (process.env.ENRICH_STEP_CMD || 'npx tsx').split(' ');

function parseArgs(argv = process.argv.slice(2)) {
  const apply = argv.includes('--apply');
  const limArg = argv.find(a => a.startsWith('--limit='));
  const limit = limArg ? Math.max(1, parseInt(limArg.slice('--limit='.length), 10) || 0) : 25;
  const wordsArg = argv.find(a => a.startsWith('--words='));
  const words = wordsArg ? wordsArg.slice('--words='.length).split(',').map(s => s.trim()).filter(Boolean) : null;
  return { apply, limit, words };
}

/**
 * Rows that need enrichment. When `words` is given, target exactly those (skips
 * the sortable/discoverable/vet gating — a manual override). Otherwise apply the
 * full derived candidate predicate, most-recently-sorted first.
 */
async function fetchCandidates(client, { limit, words }) {
  if (words && words.length) {
    const { rows } = await client.query(
      `SELECT id, word1, definitions, "partsOfSpeech", "enrichmentLog"
         FROM dictionaryentries_zh
        WHERE language = 'zh' AND word1 = ANY($1)`,
      [words]
    );
    return rows;
  }
  const incomplete = buildIncompletePredicate('de');
  // NOTE: no `discoverable = FALSE` filter — candidacy is version-aware, so an
  // already-discoverable but version-stale row is a candidate too and heals in place
  // (its stale script re-runs, re-stamps, and it stays discoverable). See requiredScripts.js.
  const { rows } = await client.query(
    `SELECT de.id, de.word1, de.definitions, de."partsOfSpeech", de."enrichmentLog"
       FROM dictionaryentries_zh de
      WHERE de.language = 'zh'
        AND de.sortable = TRUE
        AND ${incomplete}
        AND EXISTS (
          SELECT 1 FROM vocabentries_zh ve
           WHERE ve."entryKey" = de.word1 AND ve.language = 'zh'
        )
      ORDER BY (
        SELECT max(ve."createdAt") FROM vocabentries_zh ve
         WHERE ve."entryKey" = de.word1 AND ve.language = 'zh'
      ) DESC NULLS LAST, de.id ASC
      LIMIT $1`,
    [limit]
  );
  return rows;
}

/**
 * Load validator-approved/flagged fields for the given det ids → Map<id, Set<field>>.
 * A step whose validation field is here must NOT be run (the human review is
 * authoritative) and must NOT block promotion — matches each script's validatedClause.
 */
async function loadApprovedFields(client, ids) {
  const byId = new Map(ids.map((id) => [id, new Set()]));
  if (ids.length === 0 || VALIDATION_FIELDS.length === 0) return byId;
  const { rows } = await client.query(
    `SELECT "entryId", field FROM validations
      WHERE language = 'zh' AND action IN ('approve','flag')
        AND field = ANY($1) AND "entryId" = ANY($2)`,
    [VALIDATION_FIELDS, ids]
  );
  for (const r of rows) byId.get(r.entryId)?.add(r.field);
  return byId;
}

/**
 * Absolute path to a step's script file from its manifest scriptId. Manifest ids are
 * paths relative to this directory — usually `chinese/<name>`, but language-shared steps
 * (e.g. `backfill-icons`) sit at the backfill root, so resolve the id as given rather
 * than forcing every step into chinese/ via basename().
 */
function scriptPathFor(stepId) {
  return path.join(__dirname, `${stepId}.js`);
}

async function main() {
  const { apply, limit, words } = parseArgs();
  const mode = apply ? 'APPLY' : 'DRY-RUN';
  console.log(`\n🌙 run-lazy-enrichment [${mode}] limit=${limit}${words ? ` words=${words.join(',')}` : ''}\n`);

  const client = await db.getClient();
  let candidates;
  let approvedByRow; // Map<det id, Set<approved field>>
  try {
    candidates = await fetchCandidates(client, { limit, words });
    approvedByRow = await loadApprovedFields(client, candidates.map((r) => r.id));
  } finally {
    client.release();
  }

  if (candidates.length === 0) {
    console.log('No candidate words need enrichment. ✅');
    return;
  }
  console.log(`Found ${candidates.length} candidate word(s):\n`);

  let promoted = 0;
  for (const row of candidates) {
    const approved = approvedByRow.get(row.id) || new Set();
    const steps = pendingSteps(row, approved);
    const approvedNote = approved.size ? ` [approved: ${[...approved].join(',')}]` : '';
    console.log(`• ${row.word1} (id ${row.id}) — ${steps.length} pending step(s): ${steps.map(s => path.basename(s.id)).join(', ') || '(none)'}${approvedNote}`);

    if (!apply) {
      for (const step of steps) {
        // --stale so a below-version stamp actually re-processes (for scripts that honor it).
        console.log(`    would run: ${STEP_CMD.join(' ')} ${path.relative(process.cwd(), scriptPathFor(step.id))} --words=${row.word1} --stale`);
      }
      continue;
    }

    // APPLY: run each pending step serially; abort this word on the first failure
    // so we never promote a partially-enriched word.
    let ok = true;
    for (const step of steps) {
      const scriptPath = scriptPathFor(step.id);
      console.log(`    ▶ ${path.basename(step.id)} --words=${row.word1} --stale`);
      const res = spawnSync(STEP_CMD[0], [...STEP_CMD.slice(1), scriptPath, `--words=${row.word1}`, '--stale'], {
        cwd: path.join(__dirname, '..', '..'), // server/ — matches the scripts' relative .env/db paths
        stdio: 'inherit',
        env: process.env,
      });
      if (res.status !== 0) {
        console.log(`    ✗ ${path.basename(step.id)} exited ${res.status} — skipping promotion for ${row.word1}`);
        ok = false;
        break;
      }
    }
    if (!ok) continue;

    // Re-read the row's stamps and promote iff the manifest is now satisfied.
    const c2 = await db.getClient();
    try {
      const { rows } = await c2.query(
        `SELECT id, word1, definitions, "partsOfSpeech", "enrichmentLog"
           FROM dictionaryentries_zh WHERE id = $1`,
        [row.id]
      );
      const fresh = rows[0];
      if (fresh && isComplete(fresh, approved)) {
        await c2.query(
          `UPDATE dictionaryentries_zh SET discoverable = TRUE, sortable = TRUE WHERE id = $1`,
          [row.id]
        );
        promoted++;
        console.log(`    ✅ promoted ${row.word1} → discoverable`);
      } else {
        const remaining = fresh ? pendingSteps(fresh).map(s => path.basename(s.id)) : ['(row vanished)'];
        console.log(`    … ${row.word1} still incomplete after run (${remaining.join(', ')}); not promoted`);
      }
    } finally {
      c2.release();
    }
  }

  console.log(`\n${'='.repeat(48)}`);
  console.log(`Candidates: ${candidates.length}  |  Promoted: ${promoted}  |  Mode: ${mode}`);
  console.log('='.repeat(48) + '\n');
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('run-lazy-enrichment failed:', err); process.exit(1); });
