/**
 * Cleanup Script: review all existing expansion values and null out bad ones.
 *
 * Two passes:
 *  1. Technical validator — catches structural violations (same logic as DictionaryService.validateExpansion)
 *  2. Semantic denylist  — nulls out known incorrect expansions identified during spot-checks
 *
 * Usage:
 *   docker exec cow-backend-local npx tsx scripts/cleanup-expansion.js
 *   docker exec cow-backend-local npx tsx scripts/cleanup-expansion.js --dry-run
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env.docker') });

import db from '../db.js';

const DRY_RUN = process.argv.includes('--dry-run');

/** Mirrors DictionaryService.validateExpansion — returns null if invalid */
function validateExpansion(original, expansion) {
  if (!expansion || typeof expansion !== 'string') return null;
  if (expansion.length <= original.length) return null;
  if (expansion === original) return null;
  if (expansion.includes(original)) return null;

  // No consecutive duplicate of any original character (AABB/reduplication)
  for (const char of original) {
    if (expansion.includes(char + char)) return null;
  }

  // No original character may appear MORE times in expansion than in original
  for (const char of new Set(original)) {
    const origCount = [...original].filter(c => c === char).length;
    const expCount  = [...expansion].filter(c => c === char).length;
    if (expCount > origCount) return null;
  }

  // All original characters must appear in order
  let pos = 0;
  for (const char of original) {
    const idx = expansion.indexOf(char, pos);
    if (idx === -1) return null;
    pos = idx + 1;
  }

  return expansion;
}

/**
 * Known semantic failures identified during spot-checks.
 * Format: [word, bad_expansion, reason]
 */
const SEMANTIC_DENYLIST = [
  // Wrong morpheme sense
  ['足球',    '足够球类',         '足 in 足球 means "foot", not 足够 "sufficient"'],
  ['警察',    '警惕察觉',         '警惕=vigilance, 察觉=to notice — neither matches "police"'],
  ['解释',    '解答释放',         '释放=to release — wrong sense of 释 here'],
  ['解释',    '解开释放',         '释放=to release — wrong sense of 释 here'],
  ['银行',    '银子行业',         '银子=silver ingot, 行业=industry — both wrong senses here'],
  ['颜色',    '颜面色彩',         '颜面=face/dignity — wrong sense of 颜 in color context'],
  ['偶尔',    '偶然尔后',         '尔后=henceforth — wrong sense of 尔'],
  ['元旦',    '元月旦日',         '旦日 is not a common everyday word'],
  ['昨天',    '昨日天',           '昨日 is more literary than 昨天, not more vernacular'],
  ['卧室',    '卧铺房室',         '卧铺=train sleeping berth — changes meaning'],

  // Structurally weak / circular / tautological
  ['分手',    '分开手',           'Just appends 开 to 分; 分开手 = "let go of the hand", not illuminating'],
  ['梳子',    '梳头子',           '梳头子 is not a real word'],
  ['旁边',    '旁侧边上',         '旁侧 is not a natural everyday phrase'],
  ['有时候',  '有的时候',         'Just inserts 的, no morpheme illumination'],
  ['没关系',  '没有关系',         'Just inserts 有; 没有关系 is essentially the same phrase'],
  ['难看',    '难以看得好看',     'Adds 好看 which contradicts/changes the meaning'],
  ['爱好',    '爱上的好兴趣',     '兴趣 appended is redundant; 爱上的好 does not illuminate the morphemes'],
  ['收据',    '收到的据凭',       '据凭 is not a standard everyday word'],
  ['现在',    '现如今在这里',     'Forces 如今 and 这里 in awkwardly; not natural'],
  ['差不多',  '差一点不多不少',   '不少 is appended without being an expansion of any original morpheme'],
];

async function run() {
  console.log(`Expansion cleanup... ${DRY_RUN ? '(DRY RUN)' : ''}\n`);

  const client = await db.getClient();

  try {
    const { rows } = await client.query(`
      SELECT id, word1, expansion
      FROM dictionaryentries
      WHERE language = 'zh'
        AND expansion IS NOT NULL
      ORDER BY word1
    `);

    console.log(`Reviewing ${rows.length} entries with existing expansions...\n`);

    const techFailures = [];
    const semanticFailures = [];

    for (const row of rows) {
      // Pass 1: technical validation
      const validated = validateExpansion(row.word1, row.expansion);
      if (!validated) {
        techFailures.push(row);
        continue;
      }

      // Pass 2: semantic denylist
      const denied = SEMANTIC_DENYLIST.find(
        ([word, exp]) => word === row.word1 && exp === row.expansion
      );
      if (denied) {
        semanticFailures.push({ ...row, reason: denied[2] });
      }
    }

    // Report
    if (techFailures.length) {
      console.log('── Technical failures (structural violations) ──');
      for (const r of techFailures) {
        console.log(`  ${r.word1} → "${r.expansion}"`);
      }
      console.log();
    }

    if (semanticFailures.length) {
      console.log('── Semantic failures (wrong meaning / weak) ──');
      for (const r of semanticFailures) {
        console.log(`  ${r.word1} → "${r.expansion}"`);
        console.log(`    Reason: ${r.reason}`);
      }
      console.log();
    }

    const allFailures = [
      ...techFailures.map(r => r.id),
      ...semanticFailures.map(r => r.id),
    ];

    if (allFailures.length === 0) {
      console.log('No failures found — all expansions look good.');
    } else {
      console.log(`Nulling out ${allFailures.length} bad expansion(s)...`);
      if (!DRY_RUN) {
        await client.query(
          `UPDATE dictionaryentries SET expansion = NULL WHERE id = ANY($1)`,
          [allFailures]
        );
        console.log('Done.');
      } else {
        console.log('(DRY RUN — no changes written)');
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('CLEANUP SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total reviewed       : ${rows.length}`);
    console.log(`Technical failures   : ${techFailures.length}`);
    console.log(`Semantic failures    : ${semanticFailures.length}`);
    console.log(`Total nulled         : ${allFailures.length}`);
    console.log(`Remaining expansions : ${rows.length - allFailures.length}`);
    console.log('='.repeat(60));

  } finally {
    client.release();
    await db.pool.end();
  }
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
