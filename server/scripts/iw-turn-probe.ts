/**
 * iw-turn-probe — run ONE real NPC turn against a real stored scene, end to end.
 *
 * ```
 * cd server && npx tsx scripts/iw-turn-probe.ts --scene "Get Dinner" --npc wang_shen --say "我要一碗面"
 * cd server && npx tsx scripts/iw-turn-probe.ts --file /tmp/scene.json --npc wang_shen --say "你好"
 * ```
 *
 * `--file` reads a scene as JSON instead of from the database. It exists because the scene
 * worth probing lives on PPE and a dev box's `iw_scenes` is usually empty — dumping the row
 * and probing it locally is much cheaper than authoring a stand-in that would then be the
 * thing under test.
 *
 * WHY THIS EXISTS. Phase 2's server half is a pipeline of pure modules, each unit-tested
 * against fakes — which proves every piece and nothing about the seam. This is the smallest
 * thing that exercises the real assembly: a real scene out of Postgres, the real NPC sheet,
 * the real prompt layers, the real ladder, the real stream. It prints what an operator would
 * need to debug a bad turn: the offers, the suppressed items and why, the prompt sizes, the
 * ladder attempts, and whether the prompt cache actually engaged.
 *
 * ⚠️ IT SPENDS MONEY (one turn, ~1500 prefix tokens + ~40 out). Pass `--dry` to render the
 * prompt and stop before the call.
 *
 * ⚠️ ASSERT THE CACHE, DO NOT ASSUME IT (§ 5.5). Under a model's minimum cacheable prefix the
 * failure is SILENT — no error, just `cache_read_input_tokens: 0`. The summary prints the
 * counters for exactly that reason. Note a cold first call always MISSES; run it twice.
 *
 * LAYER: script. Reads the DAL directly, which a service may not do — scripts are outside the
 * layering rules by design, and this one is a debugging tool rather than a code path.
 */

import 'dotenv/config';
import * as fs from 'fs';
import { ImmersiveWorldDAL } from '../dal/implementations/ImmersiveWorldDAL.js';
import type { IWScene } from '../contracts/iw.js';
import { buildSystemBlock, takeNpcTurn } from '../services/ImmersiveWorldService.js';
import { buildIwLadder, cacheStats } from '../services/iw/modelLadder.js';
import { buildTurnOffers } from '../services/iw/turnOffers.js';
import { renderTurnState } from '../services/iw/turnState.js';
import type { TurnStateInput } from '../services/iw/turnState.js';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

/** A plausible beginner vocabulary, so the probe does not depend on a learner account. */
const KNOWN_WORDS = ['面', '碗', '要', '热', '凉', '好', '谢谢', '多少', '钱', '一', '二', '三', '我', '你', '吃', '来', '这个', '那个', '大', '小'];

async function main(): Promise<void> {
  const sceneName = arg('scene');
  const sceneFile = arg('file');
  const npcId = arg('npc');
  const say = arg('say', '你好')!;
  if ((!sceneName && !sceneFile) || !npcId) {
    console.error('usage: iw-turn-probe.ts (--scene "<name>" | --file <path.json>) --npc <npcId> [--say "<utterance>"] [--cues a,b] [--dry] [--verbose]');
    process.exit(1);
  }

  let scene: IWScene | null;
  if (sceneFile) {
    scene = JSON.parse(fs.readFileSync(sceneFile, 'utf8')) as IWScene;
  } else {
    const dal = new ImmersiveWorldDAL();
    const summaries = await dal.listScenes();
    const summary = summaries.find(s => s.name === sceneName);
    if (!summary) {
      console.error(`No scene named "${sceneName}". Have: ${summaries.map(s => s.name).join(', ') || '(none)'}`);
      process.exit(1);
    }
    scene = await dal.findSceneById(summary.id);
  }
  if (!scene) { console.error('scene vanished between list and read'); process.exit(1); }

  const member = (scene.npcCast ?? []).find(m => m.npcId === npcId);
  if (!member) {
    console.error(`"${npcId}" is not cast in this scene. Cast: ${(scene.npcCast ?? []).map(m => m.npcId).join(', ')}`);
    process.exit(1);
  }

  // ── What this NPC is offered ────────────────────────────────────────────────
  const firedCues = (arg('cues') ?? '').split(',').filter(Boolean);
  const { offers, names, suppressed } = buildTurnOffers(scene, member, new Set(firedCues));
  console.log(`\nSCENE  ${scene.name} (${scene.language}, ${scene.width}x${scene.height})`);
  console.log(`NPC    ${npcId} at ${member.col},${member.row} facing ${member.facing}`);
  console.log(`CUES   ${firedCues.length ? firedCues.join(', ') : '(none fired)'}`);
  console.log(`\nOFFERED (${offers.length}):`);
  for (const o of offers) {
    console.log(`  - ${o.name} [${o.kind}]${o.urgent ? ' URGENT' : ''}${o.when ? ` — ${o.when}` : ''}`);
  }
  if (suppressed.length) {
    console.log(`SUPPRESSED (${suppressed.length}):`);
    for (const s of suppressed) console.log(`  - ${s.name}: ${s.reason}`);
  }

  // ── The prompt ──────────────────────────────────────────────────────────────
  const perception: Omit<TurnStateInput, 'offers'> = {
    knownWords: KNOWN_WORDS,
    nearby: [{ label: 'the customer', distance: 2, facingYou: true }],
    heard: [],
    // `--overheard` is the § 4.1 over-eagerness probe: the same utterance, not aimed at this
    // NPC. The measured risk is a chorus of helpful bystanders, so the interesting answer here
    // is NOTHING.
    event: { kind: 'utterance', speaker: 'the customer', text: say, addressed: !flag('overheard') },
  };
  const system = buildSystemBlock(npcId, names)!;
  const user = renderTurnState({ ...perception, offers });
  console.log(`\nPROMPT system ${system.length} chars · user ${user.length} chars`);
  if (flag('verbose') || flag('dry')) {
    console.log('\n───── SYSTEM ─────\n' + system);
    console.log('\n───── USER ─────\n' + user);
  }
  if (flag('dry')) { console.log('\n--dry: stopping before the model call.'); process.exit(0); }

  // ── The turn ────────────────────────────────────────────────────────────────
  const rungs = buildIwLadder();
  const started = Date.now();
  let firstGlyphAt: number | null = null;
  const result = await takeNpcTurn({
    scene,
    npcId,
    firedCues,
    perception,
    rungs,
    onDelta: (partial) => {
      if (firstGlyphAt === null && partial.length > 0) firstGlyphAt = Date.now() - started;
    },
  });
  const totalMs = Date.now() - started;

  console.log(`\n───── RESULT (${result.kind}) ─────`);
  if (result.kind === 'reply') {
    console.log(`SAY    ${result.reply.say || '(silence)'}`);
    console.log(`ACTION ${result.reply.action}${result.chosen ? ` → ${result.chosen.kind} "${result.chosen.id}"` : ''}`);
    console.log(`EMOTE  ${result.reply.emote}`);
    if (result.reply.rescued.length) console.log(`RESCUED ${result.reply.rescued.join(' · ')}`);
    else console.log('RESCUED (none — the model produced a clean three-line reply)');
  } else if (result.kind === 'frozen') {
    console.log('The ladder was exhausted. In the game this freezes the scene and shows a banner (§ 14 Q7).');
  } else {
    console.log(`Unknown NPC: ${result.npcId}`);
  }

  if (result.kind !== 'unknown-npc') {
    console.log('\nATTEMPTS:');
    for (const a of result.attempts) console.log(`  ${a.id} (${a.vendor}) ${a.ms}ms → ${a.outcome}${a.error ? ` — ${a.error}` : ''}`);
  }
  console.log(`\nTIMING first glyph ${firstGlyphAt ?? '—'}ms · total ${totalMs}ms`);
  console.log(`CACHE  reads ${cacheStats.reads} · writes ${cacheStats.writes} · misses ${cacheStats.misses}`);
  if (cacheStats.reads === 0) {
    console.log('       ⚠️ no cache read. A COLD first call always misses — run this twice. If the');
    console.log('       second run also reads 0, the prefix is under this model\'s floor (§ 5.5).');
  }
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
