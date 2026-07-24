/**
 * Promote pre-passed zh entries to `sortable = TRUE`.
 *
 * LAYER: data-enrichment (backfill) orchestration — the pre-pass counterpart to
 * run-lazy-enrichment.js's `discoverable` promotion. See docs/DISCOVER_LAZY_ENRICHMENT.md §4b.
 *
 * WHY THIS EXISTS: `sortable` (migration 110) means "level-assigned + lead gloss
 * cleaned; safe to show as a discover sort card". Until now the ONLY writer was
 * run-lazy-enrichment.js, which sets it together with `discoverable` at FULL manifest
 * completion — so there was no way to ship the cheap two-step pre-pass without also
 * paying for the other eleven steps. The /oracle-backfill pre-pass round (§3b) needs
 * exactly that, and it must not be done with hand-written UPDATE SQL: the promotion
 * has to re-derive the bar from the manifest so a half-finished batch cannot be
 * flagged. This script is that re-derivation.
 *
 * THE BAR is `buildSortableReadyPredicate` (shared/lib/requiredScripts.js) — valid
 * `difficulty` 1..6 AND every applicable pre-pass step stamped at its current manifest
 * version (or validator-protected). Rows failing it are reported, never promoted.
 *
 * It NEVER touches `discoverable` — that flag keeps its meaning ("fully enriched +
 * data-deployed") and stays the exclusive property of the /mark-discoverable pipeline
 * (CLAUDE.md). Promoting to sortable is not a step toward shipping a word anywhere
 * except the discover sort/quick-mark grids.
 *
 * SAFETY: DRY-RUN by default — prints what it would promote and why each rejected row
 * failed, writes nothing. Pass --apply to write.
 *
 *   server/scripts/backfill/run-prod.sh scripts/backfill/promote-sortable.js --words=未来,摸脉
 *   server/scripts/backfill/run-prod.sh scripts/backfill/promote-sortable.js --words=未来,摸脉 --apply
 *   server/scripts/backfill/run-prod.sh scripts/backfill/promote-sortable.js --limit=50 --apply   # any ready row
 *
 * Referenced by: .claude/commands/oracle-backfill.md §3b, docs/DISCOVER_LAZY_ENRICHMENT.md §4b.
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env.docker') });

import db from '../../db.js';
import {
  PRE_PASS_SCRIPTS_ZH,
  VALIDATION_FIELDS,
  isSortableReady,
  pendingSteps,
  buildSortableReadyPredicate,
} from './shared/lib/requiredScripts.js';

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const valOf = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const WORDS = (valOf('words') || '').split(',').map((s) => s.trim()).filter(Boolean);
const LIMIT = Math.max(1, Number(valOf('limit') || 100));

/**
 * Candidate rows. With --words: exactly those words, whatever their state, so the
 * caller sees a per-word verdict (promoted / already sortable / not ready + why).
 * Without: any not-yet-sortable row that already CLEARS the bar — i.e. rows a pre-pass
 * enriched but nobody promoted (this is also the self-heal for an interrupted round).
 */
async function fetchCandidates(client) {
  if (WORDS.length) {
    const { rows } = await client.query(
      `SELECT id, word1, difficulty, definitions, sortable, discoverable, "enrichmentLog"
         FROM dictionaryentries_zh
        WHERE language = 'zh' AND word1 = ANY($1::text[])
        ORDER BY id ASC`,
      [WORDS]
    );
    return rows;
  }
  const { rows } = await client.query(
    `SELECT id, word1, difficulty, definitions, sortable, discoverable, "enrichmentLog"
       FROM dictionaryentries_zh de
      WHERE de.language = 'zh'
        AND de.sortable = FALSE
        AND ${buildSortableReadyPredicate('de')}
      ORDER BY de.id ASC
      LIMIT $1`,
    [LIMIT]
  );
  return rows;
}

/** Validator-approved/flagged fields for these rows → Map<id, Set<field>>. */
async function loadApprovedFields(client, ids) {
  const byId = new Map(ids.map((id) => [id, new Set()]));
  if (ids.length === 0 || VALIDATION_FIELDS.length === 0) return byId;
  const { rows } = await client.query(
    `SELECT "entryId", field FROM validations
      WHERE language = 'zh' AND action IN ('approve','flag')
        AND field = ANY($1::text[]) AND "entryId" = ANY($2::int[])`,
    [VALIDATION_FIELDS, ids]
  );
  for (const r of rows) byId.get(r.entryId)?.add(r.field);
  return byId;
}

async function main() {
  const mode = APPLY ? 'APPLY' : 'DRY-RUN';
  console.log(`\n🃏 promote-sortable [${mode}]${WORDS.length ? ` words=${WORDS.join(',')}` : ` limit=${LIMIT}`}\n`);

  const client = await db.getClient();
  try {
    const rows = await fetchCandidates(client);
    if (rows.length === 0) {
      console.log('No rows to consider. ✅');
      return;
    }
    const approvedByRow = await loadApprovedFields(client, rows.map((r) => r.id));

    let promoted = 0;
    let already = 0;
    let notReady = 0;

    for (const row of rows) {
      const approved = approvedByRow.get(row.id) || new Set();
      if (row.sortable) {
        already++;
        console.log(`  = ${row.word1} (id ${row.id}) — already sortable`);
        continue;
      }
      if (!isSortableReady(row, approved)) {
        notReady++;
        // Report the exact blocker so the caller can re-run the right pre-pass step
        // rather than guessing (or worse, hand-writing the UPDATE).
        const blockers = [];
        const level = Number(row.difficulty);
        if (!Number.isInteger(level) || level < 1 || level > 6) {
          blockers.push(`difficulty=${row.difficulty ?? 'NULL'}`);
        }
        for (const s of pendingSteps(row, approved, PRE_PASS_SCRIPTS_ZH)) {
          blockers.push(path.basename(s.id));
        }
        console.log(`  ✗ ${row.word1} (id ${row.id}) — not ready: ${blockers.join(', ')}`);
        continue;
      }
      if (!APPLY) {
        promoted++;
        console.log(`  → ${row.word1} (id ${row.id}) — would promote (difficulty ${row.difficulty})`);
        continue;
      }
      // Re-assert the bar in the UPDATE itself, so a row that changed underneath us
      // between SELECT and UPDATE cannot slip through (the predicate is the authority,
      // not the snapshot we read).
      const { rowCount } = await client.query(
        `UPDATE dictionaryentries_zh de
            SET sortable = TRUE
          WHERE de.id = $1 AND de.sortable = FALSE
            AND ${buildSortableReadyPredicate('de')}`,
        [row.id]
      );
      if (rowCount === 1) {
        promoted++;
        console.log(`  ✅ ${row.word1} (id ${row.id}) — sortable (difficulty ${row.difficulty})`);
      } else {
        notReady++;
        console.log(`  ✗ ${row.word1} (id ${row.id}) — UPDATE matched 0 rows (row changed under us); not promoted`);
      }
    }

    console.log(`\n${'='.repeat(56)}`);
    console.log(`Considered: ${rows.length}  |  ${APPLY ? 'Promoted' : 'Would promote'}: ${promoted}`
      + `  |  Already sortable: ${already}  |  Not ready: ${notReady}  |  Mode: ${mode}`);
    console.log('='.repeat(56) + '\n');
  } finally {
    client.release();
    await db.pool.end();
  }
}

main().catch((err) => {
  console.error('❌ promote-sortable failed:', err);
  process.exit(1);
});
