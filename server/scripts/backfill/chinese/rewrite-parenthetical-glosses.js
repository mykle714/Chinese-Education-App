/**
 * Repair Script: replace sense clusters whose glosses are ENTIRELY parenthetical.
 *
 * THE PROBLEM. CC-CEDICT writes grammatical senses as one parenthesised note —
 * 了 "(completed action marker)", 在 "(used before a verb to indicate an action in
 * progress)". The client's display transformation (`ddt` → `stripParentheses`,
 * src/utils/definitionUtils.ts) strips every parenthetical, so such a cluster has an
 * EMPTY display gloss, and `sortedSenseClusters` drops it from the sense picker. For a
 * function word that hides its most common meaning: 了's two `le` senses vanished and
 * its card defaulted to "to understand" (liǎo). A single-cluster entry (分之) rendered
 * NO English at all, because the legacy-dd fallback strips `definitions[0]` too.
 *
 * THE FIX. Hand-authored, parenthesis-free glosses (agreed with the project owner
 * 2026-10-03), one REWRITES entry per affected cluster, addressed by (word1, sense
 * label). Two clusters were judged not to be senses at all and are REMOVED:
 *   - 零 "linking 'and' between numbers": in 一百零五 the 零 is the digit zero holding
 *     an empty place; the English "and" is an artefact of translation. Its example
 *     sentence + longDefinition part are folded into the "zero" sense.
 *   - 比 "Taiwan reading note": a pronunciation note, not a meaning.
 *
 * INVARIANT KEPT. `definitionClusters` must stay an EXACT PARTITION of `definitions`
 * (validatePartition / checkShape, docs/DEFINITION_CLUSTERS.md), so each rewrite
 * replaces the old glosses in BOTH columns in one UPDATE: the new glosses take the
 * flat-array slot of the first old gloss, and the remaining old glosses are removed.
 * Sense LABELS are never changed (they are addresses: vet.selectedSense, est sentence
 * tags, per-sense longDefinition keys), except for the two removed clusters.
 *
 * LAYER: data-enrichment (backfill), zh only. Deterministic — no API calls.
 *
 * SAFETY
 *   - Idempotent: a cluster already carrying its new glosses is skipped; a cluster
 *     whose glosses match NEITHER the expected old nor new value is skipped with a
 *     warning (the data moved under us — re-check by hand rather than overwrite).
 *   - Skips entries a validator has reviewed on `definitions`
 *     (docs/DATA_VALIDATION_SYSTEM.md).
 *   - Reports, but does not rewrite, vet rows whose `selectedSense` points at a removed
 *     cluster — an unmatched label already falls back to the default sense.
 *
 * Usage (from the backend container, so it sees .env.docker):
 *   docker exec cow-backend npx tsx scripts/backfill/chinese/rewrite-parenthetical-glosses.js --dry-run
 *   docker exec cow-backend npx tsx scripts/backfill/chinese/rewrite-parenthetical-glosses.js
 *   ... --words=了,的        # scope to specific headwords
 *
 * Referenced by: docs/DEFINITION_CLUSTERS.md ("Displayable clusters").
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../.env.docker') });

import db from '../../../db.js';
import { initRunLog } from '../run-log.js';
import { parseBackfillArgs } from '../shared/lib/cli.js';

const SCRIPT_VERSION = 1; // bump when the REWRITES table changes

const { validatedClause, stampEntries } = initRunLog({ script: 'chinese/rewrite-parenthetical-glosses', version: SCRIPT_VERSION });
const { targetWords } = parseBackfillArgs();
const DRY_RUN = process.argv.includes('--dry-run');
const TABLE = 'dictionaryentries_zh';

// (word1, sense label) → the cluster's new glosses, lead gloss first (the lead is what
// `ddt` shows on the card face and in the picker). `old` is the exact current gloss
// list, used both to locate the strings in `definitions` and as an optimistic check.
const REWRITES = [
  { word: '了', sense: 'completed-action particle', old: ['(completed action marker)'],
    new: ['marks a completed action'] },
  { word: '了', sense: 'change-of-state particle',
    old: ['(modal particle indicating change of state, situation now)', '(modal particle intensifying preceding clause)'],
    new: ['signals a new situation', 'now, already', 'adds emphasis'] },
  { word: '过', sense: 'experienced action marker', old: ['(experienced action marker)'],
    new: ['has done before', 'marks past experience'] },
  { word: '在', sense: 'progressive aspect marker', old: ['(used before a verb to indicate an action in progress)'],
    new: ['in the middle of doing', 'be doing right now'] },
  { word: '的', sense: 'nominalizing particle',
    old: ['(used after a noun, verb or adjective to form a nominal expression, as in 皮革的[pi2 ge2 de5] "one made of leather" or 跑堂兒的|跑堂儿的[pao3 tang2 r5 de5] "a waiter (literally, one who runs back and forth in a restaurant)" or 新的[xin1 de5] "new one")'],
    new: ['the one that is…', 'one, the one'] },
  { word: '的', sense: 'sentence-final emphatic particle', old: ['(used at the end of a declarative sentence for emphasis)'],
    new: ['emphasizes the statement'] },
  { word: '之', sense: 'possessive particle (literary)', old: ['(possessive particle, literary equivalent of 的[de5])'],
    new: ["'s, of"] },
  { word: '者', sense: 'the former / the latter',
    old: ['(used after a number or 後|后[hou4] or 前[qian2] to refer to something mentioned previously)'],
    new: ['the former, the latter', 'the ones mentioned'] },
  { word: '者', sense: 'topic pause marker', old: ['(used after a term, to mark a pause before defining the term)'],
    new: ['as for, topic marker'] },
  { word: '者', sense: 'imperative ending (archaic)', old: ['(old) (used at the end of a command)'],
    new: ['archaic command ending'] },
  { word: '分之', sense: '(indicating a fraction)', old: ['(indicating a fraction)'],
    new: ['out of, for fractions'] },
  { word: '直', sense: 'continuously / straight (adverbial)', old: ['(indicates continuing motion or action)'],
    new: ['continuously', 'keep on doing'] },
  { word: '之间', sense: 'in an instant (after time words)',
    old: ['(used after certain bisyllabic words to form expressions indicating a short period of time, e.g. 彈指之間|弹指之间[tan2 zhi3 zhi1 jian1])'],
    new: ['in the span of'] },
  { word: '过去', sense: 'directional verb suffix', old: ['(verb suffix)'],
    new: ['over, past, across'] },
  { word: '来', sense: '(after 得/不) can / cannot manage',
    old: ['(used after 得[de2] to indicate possibility, as in 談得來|谈得来[tan2 de5 lai2], or after 不[bu4] to indicate impossibility, as in 吃不來|吃不来[chi1 bu5 lai2])'],
    new: ['can or cannot manage'] },
  // 来 keeps its "come" direction here: the action is brought TOWARD the speaker and is
  // wanted — ordering (来一杯), requesting (来一首), volunteering (我来), and the
  // challenge reading of 再来一次 ("bring it on").
  { word: '来', sense: '(stand-in for a more specific verb)', old: ['(used as a substitute for a more specific verb)'],
    new: ["bring it on, let's have", 'let me do it'] },
  { word: '去', sense: 'directional complement: away from speaker', old: ['(after a verb of motion indicates movement away from the speaker)'],
    new: ['away from the speaker'] },
  { word: '去', sense: 'complement of detachment', old: ['(used after certain verbs to indicate detachment or separation)'],
    new: ['off, away, removing'] },
  { word: '上来', sense: '(verb complement) successfully', old: ['(verb complement indicating success)'],
    new: ['succeed in doing'] },
  { word: '下来', sense: 'continuation/completion (grammatical aspect marker)',
    old: ['(indicates continuation from the past towards us)', '(completed action marker)'],
    new: ['keep on, carry through', 'continuing up to now', 'marks a completed action'] },
  { word: '出', sense: 'verb complement: outward or successful result', old: ['(used after a verb to indicate an outward direction or a positive result)'],
    new: ['out, to a result'] },
  { word: '好', sense: '(complement) done, finished', old: ['(verb complement indicating completion)'],
    new: ['done, finished'] },
  { word: '是', sense: 'emphatic assertion marker', old: ['(adverb for emphatic assertion)'],
    new: ['really, indeed'] },
  { word: '加', sense: '(before a disyllabic verb) apply the action',
    old: ['(used before a disyllabic verb, often after an adverb like 不[bu4], 大[da4], 稍[shao1] etc, to indicate that the action applies to something previously mentioned, as in 稍加改良[shao1 jia1 gai3 liang2] "make some minor improvements to (it)")'],
    new: ['apply, give'] },
  { word: '给', sense: 'grammatical marker (把 / 被)',
    old: ['(grammatical equivalent of 被)', '(grammatical equivalent of 把)', '(sentence intensifier)'],
    new: ['by, or marks the object', 'by, passive marker', 'marks the object', 'adds emphasis'] },
  { word: '而', sense: 'marks change of state', old: ['(indicates change of state)'],
    new: ['and so, and then'] },
  { word: '哪', sense: 'sentence-final particle', old: ['(emphatic sentence-final particle, used instead of 啊[a5] after a word ending in "n")'],
    new: ['ah, emphatic ending'] },
  { word: '夫', sense: 'classical particle', old: ['(initial particle, introduces an opinion)', '(exclamatory final particle)'],
    new: ['classical opener or exclamation', 'introduces an opinion', 'alas, how'] },
  { word: '斯', sense: '(phonetic) transliteration syllable', old: ['(phonetic)'],
    new: ['sound used in foreign names'] },
  { word: '尼', sense: 'phonetic transliteration character', old: ['(often used in phonetic spellings)'],
    new: ['sound used in foreign names'] },
  { word: '老头乐', sense: 'products for the elderly',
    old: ['(may also refer to other products that are of benefit to old people, such as padded cloth shoes, mobility tricycle etc)'],
    new: ['products for the elderly'] },
  { word: '海东', sense: 'lands east of the sea (historical)',
    old: ['(also can refer to Liaodong, the Korean Peninsula, Bohai or Japan, depending on the historical context)'],
    new: ['lands east of the sea', 'Liaodong, Korea or Japan, historically'] },
];

// Clusters that are not senses. `retagTo` is the surviving sense label that takes over
// any example sentence / longDefinition part tagged with the removed sense.
const REMOVALS = [
  { word: '零', sense: "linking 'and' between numbers",
    old: ['(placed between two numbers to indicate a smaller quantity followed by a larger one)'],
    retagTo: 'zero', retagSenseDict: 'zero',
    // the longDefinition part is keyed by its own (older) label, not the cluster's
    dropLongDefSenses: ['(between two numbers) and'] },
  { word: '比', sense: 'Taiwan reading note',
    old: ['(Taiwan pr. [bi4] in some compounds derived from Classical Chinese)'],
    retagTo: null, dropLongDefSenses: [] },
];

const sameList = (a, b) => Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);

/** Replace `oldGlosses` in the flat definitions array with `newGlosses` at the slot of
 *  the first old gloss. Returns null if any old gloss is missing (partition broken). */
function spliceDefinitions(definitions, oldGlosses, newGlosses) {
  const at = definitions.indexOf(oldGlosses[0]);
  if (at < 0 || oldGlosses.some((g) => !definitions.includes(g))) return null;
  const out = definitions.filter((d, i) => i < at && !oldGlosses.includes(d));
  out.push(...newGlosses);
  out.push(...definitions.filter((d, i) => i > at && !oldGlosses.includes(d)));
  return out;
}

/** Apply every REWRITE/REMOVAL for one det row. Returns { changed, log[], row' }. */
function planRow(row) {
  let definitions = [...row.definitions];
  let clusters = row.definitionClusters.map((c) => ({ ...c }));
  let longDefinition = row.longDefinition;
  let exampleSentences = row.exampleSentences;
  const log = [];
  let changed = false;

  for (const rw of REWRITES.filter((r) => r.word === row.word1)) {
    const c = clusters.find((x) => x.sense === rw.sense);
    if (!c) { log.push(`  ⚠ ${row.word1}: no cluster labelled "${rw.sense}" — skipped`); continue; }
    if (sameList(c.glosses, rw.new)) continue; // already applied
    if (!sameList(c.glosses, rw.old)) { log.push(`  ⚠ ${row.word1} "${rw.sense}": glosses changed since authoring — skipped: ${JSON.stringify(c.glosses)}`); continue; }
    const next = spliceDefinitions(definitions, rw.old, rw.new);
    if (!next) { log.push(`  ⚠ ${row.word1} "${rw.sense}": old glosses not found in definitions — skipped`); continue; }
    definitions = next;
    c.glosses = [...rw.new];
    changed = true;
    log.push(`  ✎ ${row.word1} [${c.reading}] ${rw.sense}: → ${rw.new.join(' ¦ ')}`);
  }

  for (const rm of REMOVALS.filter((r) => r.word === row.word1)) {
    const c = clusters.find((x) => x.sense === rm.sense);
    if (!c) continue; // already removed
    if (!sameList(c.glosses, rm.old)) { log.push(`  ⚠ ${row.word1} "${rm.sense}": glosses changed since authoring — not removed`); continue; }
    clusters = clusters.filter((x) => x !== c);
    definitions = definitions.filter((d) => !rm.old.includes(d));
    if (Array.isArray(longDefinition) && rm.dropLongDefSenses.length) {
      longDefinition = longDefinition.filter((p) => !rm.dropLongDefSenses.includes(p?.sense));
    }
    if (Array.isArray(exampleSentences) && rm.retagTo) {
      exampleSentences = exampleSentences.map((s) => {
        if (s?.sense !== rm.sense) return s;
        const senseDict = s.senseDict ? { ...s.senseDict, [row.word1]: rm.retagSenseDict } : s.senseDict;
        return { ...s, sense: rm.retagTo, senseDict };
      });
    }
    changed = true;
    log.push(`  ✖ ${row.word1}: removed cluster "${rm.sense}"${rm.retagTo ? ` (sentences retagged → "${rm.retagTo}")` : ''}`);
  }

  return { changed, log, definitions, clusters, longDefinition, exampleSentences };
}

async function run() {
  console.log(`Parenthetical-gloss rewrite${DRY_RUN ? ' — DRY RUN, no writes' : ''}`);
  let words = [...new Set([...REWRITES, ...REMOVALS].map((r) => r.word))];
  if (targetWords?.length) words = words.filter((w) => targetWords.includes(w));

  const client = await db.getClient();
  const stats = { rows: 0, changed: 0, unchanged: 0, failed: 0 };
  try {
    const { rows } = await client.query(
      `SELECT id, word1, definitions, "definitionClusters", "longDefinition", "exampleSentences"
         FROM ${TABLE}
        WHERE language = 'zh' AND discoverable = TRUE
          AND word1 = ANY($1::text[])
          AND "definitionClusters" IS NOT NULL
          AND ${validatedClause(['definitions'], TABLE)}
        ORDER BY id`,
      [words]
    );
    stats.rows = rows.length;
    const seen = new Set(rows.map((r) => r.word1));
    for (const w of words) if (!seen.has(w)) console.log(`  ⚠ ${w}: no discoverable, unvalidated row`);

    for (const row of rows) {
      const plan = planRow(row);
      plan.log.forEach((l) => console.log(l));
      if (!plan.changed) { stats.unchanged++; continue; }
      stats.changed++;
      if (DRY_RUN) continue;
      try {
        // One statement per entry: the partition (definitions ↔ clusters) must never be
        // observable half-applied by a concurrent read.
        await client.query(
          `UPDATE ${TABLE}
              SET definitions = $1::jsonb,
                  "definitionClusters" = $2::jsonb,
                  "longDefinition" = $3::jsonb,
                  "exampleSentences" = $4::jsonb
            WHERE id = $5`,
          [JSON.stringify(plan.definitions), JSON.stringify(plan.clusters),
           plan.longDefinition == null ? null : JSON.stringify(plan.longDefinition),
           plan.exampleSentences == null ? null : JSON.stringify(plan.exampleSentences), row.id]
        );
        await stampEntries(client, TABLE, row.id);
      } catch (err) {
        stats.failed++;
        console.error(`  ✖ ${row.word1} (id ${row.id}): ${err.message}`);
      }
    }

    // Learners pinned to a removed sense silently fall back to the default; report them.
    const { rows: orphans } = await client.query(
      `SELECT "entryKey", "selectedSense", count(*)::int AS n FROM vocabentries_zh
        WHERE "selectedSense" = ANY($1::text[]) GROUP BY 1, 2`,
      [REMOVALS.map((r) => r.sense)]
    );
    if (orphans.length) console.log('  ℹ vet rows pinned to a removed sense (will show the default):', orphans);
  } finally {
    client.release();
  }
  console.log(`rows: ${stats.rows}, changed: ${stats.changed}, unchanged: ${stats.unchanged}, failed: ${stats.failed}`);
  await db.pool.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
