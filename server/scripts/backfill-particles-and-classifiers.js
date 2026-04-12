/**
 * Backfill Script: AI-powered particle and classifier seeding for particlesandclassifiers table.
 *
 * Queries dictionaryentries for single-character zh words where partsOfSpeech or definitions
 * indicate a particle or classifier role, then asks Claude Sonnet to confirm and provide a
 * concise contextual definition for each role.
 *
 * The table uses (character, language, type) as a unique key, so a character can have
 * separate rows for both 'particle' and 'classifier' roles.
 *
 * NULL means "not yet processed"; rows in the table mean "confirmed and defined".
 * Characters Claude confirms as neither are simply not inserted.
 *
 * Usage:
 *   docker exec cow-backend-local npx tsx scripts/backfill-particles-and-classifiers.js             # full backfill
 *   docker exec cow-backend-local npx tsx scripts/backfill-particles-and-classifiers.js --spot-check # test 5 entries
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env.docker') });

import Anthropic from '@anthropic-ai/sdk';
import db from '../db.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const isSpotCheck = process.argv.includes('--spot-check');

/**
 * Ask Claude Sonnet whether a Chinese character is a grammatical particle, a classifier
 * (measure word), both, or neither. Returns an array of { type, definition } objects.
 *
 * Returns [] if the character does not qualify as either role.
 * Each returned item has:
 *   - type: 'particle' | 'classifier'
 *   - definition: concise contextual phrase (max ~8 words), e.g. "possessive/attributive particle"
 */
async function askClaudeForParticleClassifier(word, pronunciation, definitions, partsOfSpeech) {
  const definitionText = Array.isArray(definitions)
    ? definitions.slice(0, 4).join('; ')
    : definitions;
  const posText = Array.isArray(partsOfSpeech) ? partsOfSpeech.join(', ') : (partsOfSpeech || '');

  const prompt = `You are a Chinese linguistics expert.

Character: ${word} (${pronunciation})
Parts of speech: ${posText}
Definitions: ${definitionText}

Task: Determine whether "${word}" functions as a grammatical particle, a classifier (measure word), both, or neither.

Definitions:
- "particle": a grammatical function word with no independent lexical meaning used to mark grammatical relationships (e.g. 的 as possessive marker, 了 as aspect particle, 吗 as question particle, 把 as disposal particle)
- "classifier": a measure word used alongside numerals or demonstratives to count or quantify nouns (e.g. 辆 for wheeled vehicles, 条 for long flexible things, 只 for small animals)
- A character may qualify as BOTH (return two entries)
- If it is neither, return []

Respond with ONLY a JSON array. Each element must have:
  "type": "particle" or "classifier"
  "definition": a concise, learner-friendly English phrase (max 8 words) using EXACTLY these formats:
    - classifiers: "classifier for [what it counts]"  e.g. "classifier for wheeled vehicles"
    - particles:   "particle for [grammatical function]"  e.g. "particle for yes-no questions"

Examples:
  [{"type":"particle","definition":"particle for possession and describing things"}]
  [{"type":"classifier","definition":"classifier for wheeled vehicles"}]
  [{"type":"particle","definition":"particle for placing the object before the verb"},{"type":"classifier","definition":"classifier for handfuls or bunches"}]
  []

No markdown, no explanation. Only the JSON array.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 256,
    temperature: 0.1,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text.trim();
  // Strip markdown code fences if present
  let cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  // Extract outermost JSON array
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrMatch) cleaned = arrMatch[0];

  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) return [];

  return parsed.filter(item =>
    item &&
    typeof item.type === 'string' &&
    (item.type === 'particle' || item.type === 'classifier') &&
    typeof item.definition === 'string' &&
    item.definition.length > 0
  );
}

async function run() {
  if (isSpotCheck) {
    console.log('🔍 SPOT CHECK MODE — processing 5 entries only\n');
  }
  console.log('🚀 Starting particle and classifier backfill...\n');

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY not set');
    process.exit(1);
  }

  // Comprehensive seed list of Chinese classifiers and particles.
  // Classifiers cover common → literary usage across all semantic domains.
  // Claude confirms the exact role(s) and writes the contextual definition for each —
  // characters it deems neither particle nor classifier in practice are skipped.
  const SEED_CHARACTERS = [

    // ══ CLASSIFIERS ══════════════════════════════════════════════════

    // ── General / individual objects ─────────────────────────────────
    '个', '件', '只', '条', '根', '支', '枝', '粒', '颗', '块',
    '片', '张', '枚', '把', '本', '册',

    // ── Paired / matched sets ─────────────────────────────────────────
    '幅', '副', '双', '对', '套', '组',

    // ── Machines / devices / appliances ──────────────────────────────
    '台', '部', '架',

    // ── Containers / liquid / dry measures ───────────────────────────
    '杯', '碗', '盘', '盒', '袋', '罐', '桶', '瓶', '包', '箱',
    '篮', '壶', '缸', '盏', '碟', '勺', '盆', '筐', '篓', '坛',
    '瓮', '甑',

    // ── Animals ───────────────────────────────────────────────────────
    '匹', '头', '峰', '尾', '羽', '窝',

    // ── Plants / natural objects ──────────────────────────────────────
    '棵', '株', '丛', '茎', '瓣', '朵',

    // ── People ────────────────────────────────────────────────────────
    '位', '名', '口', '员',

    // ── Vehicles / transport ──────────────────────────────────────────
    '辆', '艘', '列', '节',

    // ── Buildings / rooms / land ──────────────────────────────────────
    '栋', '间', '座', '层', '幢', '所', '处', '户', '亩',

    // ── Hats / tent / peaked objects ─────────────────────────────────
    '顶',

    // ── Flat / surface objects ────────────────────────────────────────
    '面', '版', '页', '幕',

    // ── Doors / windows / fans (hinged/flat openings) ─────────────────
    '扇',

    // ── Long / thin / flexible ────────────────────────────────────────
    '缕', '股', '道', '绺', '线', '丝', '茬', '蓬', '挂',

    // ── Tiny / small round / drops ────────────────────────────────────
    '滴', '点', '泡', '丸',

    // ── Abstract / events / occurrences ──────────────────────────────
    '次', '回', '遍', '番', '场', '顿', '阵', '度', '趟', '通',
    '轮', '局', '步', '圈', '阶', '级', '遭',

    // ── Collective / grouped ──────────────────────────────────────────
    '群', '堆', '批', '串', '排', '队', '班', '伙', '帮', '拨',
    '摊', '叠', '捆', '扎', '束', '摞', '撮',

    // ── Text / written / published works ─────────────────────────────
    '首', '篇', '卷', '段', '句', '字', '行', '章', '期', '封',
    '帖', '则', '款', '栏', '格',

    // ── Legal / formal matters ────────────────────────────────────────
    '宗', '起', '案', '桩',

    // ── Sums / portions / quantities ─────────────────────────────────
    '笔', '项', '份', '样',

    // ── Medicine / TCM ingredients ────────────────────────────────────
    '剂', '服', '贴', '味',

    // ── Structural / spatial shapes ───────────────────────────────────
    '方', '截', '弯', '尊',

    // ── Body-related (used as measure) ───────────────────────────────
    '身', '手', '肚', '眼', '嘴', '脸',

    // ── Standard measurement units (used as classifiers) ─────────────
    '克', '升', '斤', '两', '里', '尺', '丈', '寸', '分', '亩',
    '吨', '磅', '升',

    // ── Time units (used as classifiers) ─────────────────────────────
    '年', '月', '日', '时', '秒',

    // ── Sessions / terms / generations ───────────────────────────────
    '届', '代', '辈', '号',

    // ── Tools / implements / corpses (literary) ───────────────────────
    '具',

    // ── Military / organizational units ──────────────────────────────
    '连', '营', '团', '师',

    // ── Performances / arts ───────────────────────────────────────────
    '曲', '出',

    // ── Miscellaneous (from DB / common use) ─────────────────────────
    '家', '部', '颗', '台', '样',

    // ── Sections / cuts ───────────────────────────────────────────────
    '截',

    // ── Academic sessions ─────────────────────────────────────────────
    '课', '堂', '门', '科',

    // ── Sounds / utterances ───────────────────────────────────────────
    '声',

    // ── Body-action / load measures ───────────────────────────────────
    '捧', '抱', '担', '握',

    // ── Pot / pan loads ───────────────────────────────────────────────
    '锅',

    // ── Cases / small boxes (literary) ────────────────────────────────
    '匣', '函',

    // ── Cloth / fabric (classical) ────────────────────────────────────
    '帛', '疋',

    // ── Vehicle loads ─────────────────────────────────────────────────
    '车', '船',

    // ── Cutting implements used as classifiers ────────────────────────
    '刀', '针',

    // ── Old volume / dry measures ─────────────────────────────────────
    '斗', '石', '斛', '釜',

    // ── Old weight / coin units ───────────────────────────────────────
    '铢', '文', '钱',

    // ── Military units (larger scale) ────────────────────────────────
    '军', '旅',

    // ── Land / agricultural ──────────────────────────────────────────
    '垄',

    // ── Full sets / suits ────────────────────────────────────────────
    '袭',

    // ── Train / transport compartments ───────────────────────────────
    '厢',

    // ── Incense / ritual ─────────────────────────────────────────────
    '炷', '柱',

    // ── Small cups / vessels (literary / classical) ───────────────────
    '盅', '钵', '鼎', '觥', '爵', '樽', '觚',

    // ── Pillars / columns (text layout) ──────────────────────────────
    '行',

    // ── Types / kinds / categories ───────────────────────────────────
    '种', '类', '型',

    // ── Seasons ───────────────────────────────────────────────────────
    '季',

    // ── Tiny measurement units ────────────────────────────────────────
    '毫', '厘',

    // ── Openings / holes / dens / nests ─────────────────────────────
    '孔', '窟', '巢', '穴',

    // ── Seats / banquets ─────────────────────────────────────────────
    '席',

    // ── Ancient ritual / food vessels ────────────────────────────────
    '豆', '卮', '觯', '斝', '彝',

    // ── Classical tile / brick units ─────────────────────────────────
    '瓴', '甃',

    // ── Spoons / ladles ───────────────────────────────────────────────
    '匙',

    // ── Earthen / archaic vessels ─────────────────────────────────────
    '缶', '罍', '盎',

    // ── Historical military groups ────────────────────────────────────
    '伍',

    // ── Digital / film frames ─────────────────────────────────────────
    '帧',

    // ── Files / dossiers ─────────────────────────────────────────────
    '档',

    // ── Architectural spaces (literary / formal) ──────────────────────
    '亭', '轩', '院', '殿', '庄', '苑',

    // ── Rarely-used / literary / classical classifiers ────────────────
    '爿', '锭', '罅', '垡', '泓', '湾', '帆', '沓', '甓',

    // ══ PARTICLES ════════════════════════════════════════════════════

    // ── Structural (的地得) ───────────────────────────────────────────
    '的', '地', '得',

    // ── Aspect ────────────────────────────────────────────────────────
    '了', '着', '过',

    // ── Sentence-final / modal ────────────────────────────────────────
    '吗', '呢', '吧', '啊', '哦', '哈', '嘛', '呗', '嗯', '噢', '哟', '咧',

    // ── Colloquial ────────────────────────────────────────────────────
    '啦', '咯',

    // ── Classical ─────────────────────────────────────────────────────
    '之', '乎', '者', '也', '矣', '焉', '哉',
  ];

  // Deduplicate in case of any overlap
  const uniqueCharacters = [...new Set(SEED_CHARACTERS)];
  const spotCheckList = isSpotCheck ? uniqueCharacters.slice(0, 5) : uniqueCharacters;

  const client = await db.getClient();

  try {
    // Look up pronunciation and definitions from dictionaryentries for Claude context.
    // Characters not in the dictionary will still be processed — just without context.
    const { rows: dictRows } = await client.query(
      `SELECT word1, pronunciation, definitions
       FROM dictionaryentries
       WHERE word1 = ANY($1) AND language = 'zh'
       ORDER BY word1 ASC`,
      [spotCheckList]
    );
    const dictMap = new Map(dictRows.map(r => [r.word1, r]));

    const candidates = spotCheckList.map(char => ({
      word1: char,
      pronunciation: dictMap.get(char)?.pronunciation ?? null,
      definitions: dictMap.get(char)?.definitions ?? [],
      partsOfSpeech: null,
    }));

    console.log(`📊 Processing ${candidates.length} characters (${dictRows.length} found in dictionary)\n`);

    if (candidates.length === 0) {
      console.log('Nothing to process.');
      return;
    }

    // Pre-load existing (character, type) pairs to skip re-processing
    const { rows: existing } = await client.query(
      `SELECT character, type FROM particlesandclassifiers WHERE language = 'zh'`
    );
    const doneSet = new Set(existing.map(r => `${r.character}::${r.type}`));

    let inserted = 0;
    let skipped = 0;
    let neitherCount = 0;
    let failed = 0;

    for (const row of candidates) {
      try {
        process.stdout.write(`  ${row.word1} (${row.pronunciation}) ... `);

        const results = await askClaudeForParticleClassifier(
          row.word1,
          row.pronunciation,
          row.definitions,
          row.partsOfSpeech
        );

        if (results.length === 0) {
          console.log('neither');
          neitherCount++;
        } else {
          const labels = results.map(r => `[${r.type}: ${r.definition}]`).join(', ');
          console.log(labels);

          for (const item of results) {
            const doneKey = `${row.word1}::${item.type}`;
            if (doneSet.has(doneKey)) {
              skipped++;
              continue;
            }

            await client.query(
              `INSERT INTO particlesandclassifiers (character, language, type, definition)
               VALUES ($1, 'zh', $2, $3)
               ON CONFLICT (character, language, type) DO NOTHING`,
              [row.word1, item.type, item.definition]
            );
            doneSet.add(doneKey);
            inserted++;
          }
        }
      } catch (err) {
        console.log(`FAILED: ${err.message}`);
        failed++;
      }

      // Small delay to avoid rate-limiting
      await new Promise(r => setTimeout(r, 200));
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 Backfill Complete!');
    console.log('='.repeat(60));
    console.log(`Total candidates : ${candidates.length}`);
    console.log(`Rows inserted    : ${inserted}`);
    console.log(`Already present  : ${skipped}`);
    console.log(`Neither role     : ${neitherCount}`);
    console.log(`Errors           : ${failed}`);
    console.log('='.repeat(60) + '\n');
  } finally {
    client.release();
    await db.end?.();
  }
}

run().catch(err => {
  console.error('❌ Script failed:', err);
  process.exit(1);
});
