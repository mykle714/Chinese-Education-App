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
 *   - CROSS-ROW drift (`driftProbe`): a step whose stored output was invalidated by a
 *     change to ANOTHER row. Neither the stamp nor the script's own doneGate can see
 *     this, so each probe runs as its own set query and its ids are OR-ed into the
 *     candidate scope — see runDriftProbes() and DRIFT_PROBES in the manifest.
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
 *   --shard=k/N     PARALLEL RUNS: plan only the rows where `id % N = k` (0 <= k < N).
 *                   Two concurrent oracle workers would otherwise get byte-identical
 *                   batches — every scope here is a deterministic `ORDER BY … LIMIT N`
 *                   with no claim or lease, so worker A and worker B both take the
 *                   same top-25 words and race the same rows. Sharding on the
 *                   surrogate id partitions the candidate set into N disjoint slices
 *                   with no schema change and no lock lifetime to manage (a round
 *                   spans many separate `npx tsx` processes over ~20 min, so Postgres
 *                   advisory locks would release between scripts and protect nothing).
 *                   Each shard still applies the full commonness ORDER BY within its
 *                   own slice, so every worker stays at the frequency frontier rather
 *                   than one worker getting all the common words.
 *                   Ignored by --words= (an explicit list is an instruction).
 *                   The worker must ALSO get its own oracle scratch files, or the two
 *                   will interleave prompts: set BACKFILL_ORACLE_PROMPTS and
 *                   BACKFILL_ORACLE_ANSWERS per worker (run-log.js honors both).
 *   --with-icons    also plan the OPT-IN `backfill-icons` step. It is excluded by
 *                   default because it is the one manifest step that must reach an
 *                   external paid API (icons8) — an oracle round cannot answer it
 *                   locally, and a NULL `iconId` degrades gracefully. Pass this only
 *                   when ICONS8_API_KEY is set and you intend to run it (and then pass
 *                   --with-icons to promote-discoverable.js too, or the rows it
 *                   enriched will still promote without it).
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
  driftProbesFor,
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
// Print untruncated --words= lists (the default preview caps at 8 words).
const FULL_LISTS = has('--full');
// Opt-in for the manifest's `optional` steps (today: backfill-icons). Off by default.
const WITH_ICONS = has('--with-icons');
const LIMIT = Number(val('limit') || 50);
const WORDS = (val('words') || '').split(',').map((s) => s.trim()).filter(Boolean);

// --shard=k/N — disjoint candidate slices for parallel oracle workers. Parsed and
// validated here so a malformed value fails before any DB work rather than silently
// planning the whole table (which would hand two workers the same batch — the exact
// collision this flag exists to prevent).
const SHARD_RAW = val('shard');
let SHARD_K = null;
let SHARD_N = null;
if (SHARD_RAW !== null) {
  const m = /^(\d+)\/(\d+)$/.exec(SHARD_RAW.trim());
  if (!m) {
    console.error(`❌ --shard must look like k/N (e.g. --shard=0/3), got "${SHARD_RAW}".`);
    process.exit(1);
  }
  SHARD_K = Number(m[1]);
  SHARD_N = Number(m[2]);
  if (SHARD_N < 1 || SHARD_K >= SHARD_N) {
    console.error(`❌ --shard=k/N needs N >= 1 and 0 <= k < N, got k=${SHARD_K} N=${SHARD_N}.`);
    process.exit(1);
  }
}

// Fail fast on an unknown language rather than planning zh under an es-shaped intent.
// Caught so a typo'd --lang prints one usable line instead of a module-load stack trace.
let MANIFEST, DET_TABLE;
try {
  MANIFEST = scriptsForLanguage(LANG, { includeOptional: WITH_ICONS });
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

/**
 * Run every drift probe the manifest declares for this language, ONCE.
 *
 * Returns `{ idsByStep, wordsById }`: which step ids each det row has drifted on, and
 * the word for each drifted id (so the plan can name them without a second lookup).
 * Probes are set-based and cheap (~30ms for the whole zh corpus); they are run BEFORE
 * the candidate query so their ids can widen its scope — a drifted row is otherwise
 * invisible to buildIncompletePredicate, which only ever looks at the row itself.
 */
async function runDriftProbes(client, steps, detTable) {
  const idsByStep = new Map();   // step id → Set<det id>
  const wordsById = new Map();   // det id → word1
  for (const [name, probe] of driftProbesFor(steps)) {
    let rows;
    try {
      ({ rows } = await client.query(probe.sql(detTable)));
    } catch (err) {
      // A probe is a diagnostic, not the plan itself: a broken one must not take the
      // whole round down, but it must be LOUD — silently planning without it looks
      // exactly like "no drift", which is the failure this feature exists to end.
      console.error(`⚠️  drift probe "${name}" failed, continuing without it: ${err.message}`);
      continue;
    }
    if (!idsByStep.has(probe.step)) idsByStep.set(probe.step, new Set());
    for (const r of rows) {
      idsByStep.get(probe.step).add(r.id);
      wordsById.set(r.id, r.word1);
    }
    if (rows.length) {
      console.log(`  ⚠ drift [${name}] — ${rows.length} row(s): ${probe.describe}`);
    }
  }
  return { idsByStep, wordsById };
}

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

    // Apply the shard AFTER the scope branches so it composes with all of them
    // (--discoverable, --new, and the default "both"). It is deliberately NOT applied
    // to --words=: an explicit word list is a direct instruction, and silently
    // dropping half of it because those ids fall in another shard would look like the
    // planner losing words.
    if (SHARD_N !== null && !WORDS.length) {
      scope += `
               AND (d.id % ${SHARD_N}) = ${SHARD_K}`;
    }

    // Every scope plans the FULL manifest: a row is either fully enriched and shipped
    // (`discoverable`) or it is not — there is no intermediate bar any more, so there
    // is no longer a subset of steps worth planning on its own.
    const steps = MANIFEST;

    // Cross-row drift, resolved BEFORE the candidate query so its ids can widen the
    // scope. `driftedIds` is the union across probes — the per-step split stays in
    // idsByStep so pendingSteps can attribute the drift to the right script.
    const { idsByStep, wordsById } = await runDriftProbes(client, steps, DET_TABLE);
    const driftedIds = [...new Set([...idsByStep.values()].flatMap((set) => [...set]))];

    // buildIncompletePredicate encodes applicability + version-staleness + approval
    // protection. A --words run skips it: an explicit word list is an instruction to
    // look at those rows, and the per-row pendingSteps below still reports honestly.
    // A drifted row is fully stamped and would fail that predicate, so it is OR-ed in
    // explicitly — this is the whole point of the third axis.
    let incomplete = WORDS.length ? 'TRUE' : buildIncompletePredicate('d', steps);
    if (!WORDS.length && driftedIds.length) {
      params.push(driftedIds);
      incomplete = `(${incomplete} OR d.id = ANY($${params.length}::int[]))`;
    }

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
    // Which steps THIS row has drifted on — the 4th argument to pendingSteps.
    const driftedStepsFor = (id) =>
      new Set([...idsByStep].filter(([, ids]) => ids.has(id)).map(([stepId]) => stepId));

    let driftPlanned = 0;
    for (const row of rows) {
      const approved = approvedByRow.get(row.id) || new Set();
      for (const f of approved) protectedCount.set(f, (protectedCount.get(f) || 0) + 1);
      const drifted = driftedStepsFor(row.id);
      if (drifted.size) driftPlanned++;
      for (const step of pendingSteps(row, approved, steps, drifted)) byScript.get(step.id).push(row.word1);
    }

    if (AS_JSON) {
      console.log(JSON.stringify({
        language: LANG,
        withOptional: WITH_ICONS,
        scope: ONLY_DISCOVERABLE ? 'discoverable' : ONLY_NEW ? 'new' : WORDS.length ? 'words' : 'all',
        candidates: rows.map((r) => ({ id: r.id, word1: r.word1, discoverable: r.discoverable })),
        plan: [...byScript].filter(([, w]) => w.length).map(([id, words]) => ({ id, words })),
        drift: [...idsByStep].map(([stepId, ids]) => ({
          step: stepId,
          total: ids.size,                                  // corpus-wide, not just this batch
          inBatch: [...ids].filter((id) => rows.some((r) => r.id === id)).length,
          words: [...ids].map((id) => wordsById.get(id)).filter(Boolean).slice(0, 50),
        })),
      }, null, 2));
      return;
    }

    const shipped = rows.filter((r) => r.discoverable).length;
    console.log(`\n📋 Oracle plan [${LANG}] — ${rows.length} candidate rows `
      + `(${shipped} already discoverable, ${rows.length - shipped} new)\n`);
    // Print the shard prominently: a worker silently planning the wrong slice is the
    // failure mode that produces two workers racing the same rows, and the batch
    // itself looks perfectly normal when it happens.
    if (SHARD_N !== null) {
      console.log(`  🔀 shard ${SHARD_K}/${SHARD_N} — only rows where id % ${SHARD_N} = ${SHARD_K}. `
        + 'Give each parallel worker its own BACKFILL_ORACLE_PROMPTS/_ANSWERS too.\n');
    }
    // Say so out loud: a silently-omitted step would read as "nothing to do" rather
    // than "deliberately skipped", which is exactly the confusion `optional` invites.
    console.log(WITH_ICONS
      ? '  (--with-icons: the opt-in icons8 step IS planned — needs ICONS8_API_KEY)\n'
      : '  (opt-in step backfill-icons skipped; pass --with-icons to include it)\n');
    console.log('  Run these in this order (manifest order encodes the dependencies):\n');
    let total = 0;
    for (const step of steps) {
      const words = byScript.get(step.id);
      if (!words.length) continue;
      total += words.length;
      // `--full` prints untruncated --words= lists so they can be copy-pasted
      // straight into each script; the default 8-word preview stays readable.
      const preview = FULL_LISTS
        ? words.join(',')
        : words.slice(0, 8).join(',') + (words.length > 8 ? ` …+${words.length - 8}` : '');
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
    if (driftPlanned) {
      // Say the corpus-wide total too: the batch is LIMIT-ed, so "12 in this batch"
      // with 994 outstanding is a very different situation from 12 out of 12, and the
      // difference decides whether the round should keep pulling drift batches.
      console.log('\n  ⚠ cross-row drift (re-planned despite a current stamp — see DRIFT_PROBES):');
      for (const [stepId, ids] of idsByStep) {
        if (!ids.size) continue;
        console.log(`      ${stepId.replace(/^(chinese|spanish)\//, '')}: `
          + `${driftPlanned} in this batch, ${ids.size} corpus-wide`);
      }
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
