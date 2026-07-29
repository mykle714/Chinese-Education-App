/**
 * Flag Spanish headwords `discoverable = TRUE` so the es enrichment pipeline picks
 * them up (/mark-discoverable §B2).
 *
 * LAYER: data-enrichment (backfill) orchestration — the Spanish counterpart of
 * promote-discoverable.js, but deliberately NOT its twin. See "WHY THE BAR DIFFERS".
 *
 * WHY THIS EXISTS: per CLAUDE.md the `discoverable` flag may only be set by pipeline
 * code, never by a hand-written `UPDATE ... SET discoverable = TRUE`. Chinese has had
 * such code since promote-discoverable.js; Spanish had none, so §B2 of
 * /mark-discoverable still instructed a bare UPDATE — the exact statement the rule
 * forbids. This script closes that hole: same effect, but the row selection, the
 * eligibility bar, and the dry-run review all live in reviewable code.
 *
 * WHY THE BAR DIFFERS FROM ZH: promote-discoverable.js flags a row only AFTER the
 * whole manifest has enriched it (`buildCompletePredicate`). The es pipeline runs the
 * other way around — §B3's AI steps auto-scope to `discoverable = TRUE`, so the flag
 * is what SELECTS a word for enrichment rather than what certifies it finished. There
 * is also no es manifest to check against (shared/lib/requiredScripts.js is zh-only).
 * So the bar here is "is this a real headword worth enriching", not "is it complete":
 *
 *   1. the word exists in dictionaryentries_es, and
 *   2. its representative row has a non-empty `definitions` array, and
 *   3. that row is not a pointer stub ("alternative form of ...", "abbreviation of ...").
 *
 * Completeness is asserted afterwards by §B4 verification, not here.
 *
 * REPRESENTATIVE ROW: es rows are split by (pos, gender) until §B3's parts-of-speech
 * step collapses them, and that step rebuilds EVERY row sharing the word1. So flagging
 * one row per word is enough — we pick the row with the most definitions (the primary
 * sense), tie-broken by lowest id, skipping pointer stubs. The other senses that will
 * be pulled in are printed so the caller can spot a junk/vulgar one before --apply.
 *
 * SAFETY: DRY-RUN by default; --apply writes. The eligibility predicate is re-asserted
 * inside the UPDATE so a row that changed between SELECT and UPDATE cannot slip through.
 *
 *   server/scripts/backfill/run-prod.sh scripts/backfill/spanish/mark-discoverable.js --words=cura,perro
 *   server/scripts/backfill/run-prod.sh scripts/backfill/spanish/mark-discoverable.js --words=cura,perro --apply
 *
 * Referenced by: .claude/commands/mark-discoverable.md §B2, .claude/commands/oracle-backfill.md §3.
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../.env.docker') });

import db from '../../../db.js';

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
// --undo reverses this script: clears `discoverable` on every row of the given words.
// Needed when a batch turns out to carry content that should not ship (e.g. a slur
// gloss surfaced only once the pipeline printed the word's full sense list), so the
// withdrawal goes through the same reviewable code path as the flagging did.
const UNDO = argv.includes('--undo');
const valOf = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const WORDS = (valOf('words') || '').split(',').map((s) => s.trim()).filter(Boolean);

/**
 * Glosses that only redirect to another entry carry no meaning of their own, so a row
 * headed by one must never be the representative (e.g. `mar` n/mfequiv = 'alternative
 * form of "mar.": abbreviation of "marzo"').
 */
const STUB_GLOSS = /^\s*(alternative|obsolete|archaic|dated|eye dialect|superseded)\s+(form|spelling)\s+of\b|^\s*(abbreviation|initialism|acronym|misspelling|inflection|synonym)\s+of\b/i;

/** SQL twin of the JS eligibility check, re-asserted inside the UPDATE. */
const ELIGIBLE_SQL = `de.discoverable = FALSE AND jsonb_array_length(de.definitions) > 0`;

function isStub(row) {
  const first = Array.isArray(row.definitions) ? row.definitions[0] : null;
  return typeof first === 'string' && STUB_GLOSS.test(first);
}

/**
 * POS preference for choosing a headword's canonical row. Content parts of speech
 * outrank function//exclamation ones: `fuego` and `nombre` each have a one-gloss
 * interjection row that would otherwise tie with — and by lower id beat — the noun
 * row carrying the word's actual meaning.
 */
const POS_RANK = { v: 0, n: 0, adj: 1, adv: 2, prop: 3 };
const posRank = (r) => (r.pos in POS_RANK ? POS_RANK[r.pos] : 9);

/** Rows are grouped by word1; the primary sense wins (content POS, most definitions, lowest id). */
function pickRepresentative(rows) {
  const usable = rows.filter((r) => Array.isArray(r.definitions) && r.definitions.length > 0 && !isStub(r));
  if (usable.length === 0) return null;
  return usable.sort(
    (a, b) => posRank(a) - posRank(b) || b.definitions.length - a.definitions.length || a.id - b.id
  )[0];
}

const label = (r) => `${r.pos || '?'}/${r.gender || '-'}`;

async function main() {
  const mode = APPLY ? 'APPLY' : 'DRY-RUN';
  if (WORDS.length === 0) {
    console.error('❌ --words=a,b,c is required (this script never picks words on its own).');
    process.exit(1);
  }
  console.log(`\n🇪🇸 spanish/mark-discoverable [${mode}]${UNDO ? ' [UNDO]' : ''} words=${WORDS.join(',')}\n`);

  const client = await db.getClient();
  try {
    if (UNDO) {
      const q = `UPDATE dictionaryentries_es SET discoverable = FALSE
                  WHERE language = 'es' AND word1 = ANY($1::text[]) AND discoverable = TRUE`;
      if (!APPLY) {
        const { rows: preview } = await client.query(
          `SELECT id, word1, pos, gender FROM dictionaryentries_es
            WHERE language = 'es' AND word1 = ANY($1::text[]) AND discoverable = TRUE
            ORDER BY word1, id`, [WORDS]);
        for (const r of preview) console.log(`  ← ${r.word1} (id ${r.id}, ${label(r)}) — would un-flag`);
        console.log(`\nWould un-flag ${preview.length} row(s). Re-run with --apply to write.\n`);
      } else {
        const { rowCount } = await client.query(q, [WORDS]);
        console.log(`\nUn-flagged ${rowCount} row(s).\n`);
      }
      return;
    }
    const { rows } = await client.query(
      `SELECT id, word1, pos, gender, definitions, discoverable
         FROM dictionaryentries_es
        WHERE language = 'es' AND word1 = ANY($1::text[])
        ORDER BY word1, id ASC`,
      [WORDS]
    );

    // Group by headword so each word gets exactly one verdict line.
    const byWord = new Map();
    for (const r of rows) {
      if (!byWord.has(r.word1)) byWord.set(r.word1, []);
      byWord.get(r.word1).push(r);
    }

    let flagged = 0;
    let already = 0;
    let skipped = 0;

    for (const word of WORDS) {
      const group = byWord.get(word);
      if (!group || group.length === 0) {
        skipped++;
        console.log(`  ✗ ${word} — not in dictionaryentries_es`);
        continue;
      }
      if (group.some((r) => r.discoverable)) {
        already++;
        const hit = group.find((r) => r.discoverable);
        console.log(`  = ${word} (id ${hit.id}, ${label(hit)}) — already discoverable`);
        continue;
      }
      const rep = pickRepresentative(group);
      if (!rep) {
        skipped++;
        console.log(`  ✗ ${word} — no usable sense (all rows empty or pointer stubs)`);
        continue;
      }
      // §B3's parts-of-speech step rebuilds every row of the word1, so list the senses
      // that ride along — this is the caller's chance to catch a junk/vulgar one.
      const others = group.filter((r) => r.id !== rep.id).map((r) => `${label(r)} "${String(r.definitions?.[0] ?? '').slice(0, 32)}"`);

      if (!APPLY) {
        flagged++;
        console.log(`  → ${word} (id ${rep.id}, ${label(rep)}, ${rep.definitions.length} defs) — would flag`);
        if (others.length) console.log(`      pulls in: ${others.join(' | ')}`);
        continue;
      }
      const { rowCount } = await client.query(
        `UPDATE dictionaryentries_es de
            SET discoverable = TRUE
          WHERE de.id = $1 AND ${ELIGIBLE_SQL}`,
        [rep.id]
      );
      if (rowCount === 1) {
        flagged++;
        console.log(`  ✅ ${word} (id ${rep.id}, ${label(rep)}) — discoverable`);
        if (others.length) console.log(`      pulls in: ${others.join(' | ')}`);
      } else {
        skipped++;
        console.log(`  ✗ ${word} (id ${rep.id}) — UPDATE matched 0 rows (row changed under us); not flagged`);
      }
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(
      `Words: ${WORDS.length}  |  ${APPLY ? 'Flagged' : 'Would flag'}: ${flagged}` +
        `  |  Already discoverable: ${already}  |  Skipped: ${skipped}  |  Mode: ${mode}`
    );
    console.log('='.repeat(60));
    console.log(APPLY ? '\nNext: run the §B3 pipeline scoped to these words.\n' : '\nRe-run with --apply to write.\n');
  } finally {
    client.release();
    await db.pool.end();
  }
}

main().catch((err) => {
  console.error('❌ spanish/mark-discoverable failed:', err);
  process.exit(1);
});
