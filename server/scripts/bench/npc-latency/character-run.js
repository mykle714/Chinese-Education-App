/**
 * Character-fidelity sweep — "does the NPC stay in character?" (IMMERSIVE_WORLD.md § 5.6)
 *
 *   npx tsx scripts/bench/npc-latency/character-run.js [--npc wang_shen]
 *                                                     [--model claude-haiku-4-5] [--reps 2]
 *   npx tsx scripts/bench/npc-latency/character-run.js --npc all
 *
 * ⚠️ RUN IT UNDER `tsx`, not bare `node`. This file is JS but imports the REGISTRY NPCs
 * (config/iwNpcs.ts) through the production renderer (services/iw/npcPrompt.ts), so
 * the loader has to understand TypeScript. That indirection is deliberate: a sweep that
 * graded its own private copy of an NPC would pass while the shipped prompt failed.
 *
 * `--npc bench` selects the pre-registry inline 王婶 from scenario.js, kept so the
 * historical 18/18 baseline stays reproducible.
 *
 * Runs every probe turn from character.js and prints what the NPC actually said, with
 * mechanical failure flags. Unlike run.js this is a QUALITY sweep, not a latency one —
 * read the replies, do not just read the flag column. The flags catch the four failures a
 * machine can judge; whether a line sounds like a 68-year-old retired mechanic is a
 * question only the reader can answer.
 */

import 'dotenv/config';
import { buildScenario, gradeReply, NPC as INLINE_NPC } from './scenario.js';
import { buildProbeTurns, gradeCharacter, glyphBudgetFor } from './character.js';
import { NPC_PROBES } from './npcProbes.js';
import { CANDIDATES, resolveKey } from './providers.js';
import { IW_NPCS, npcById } from '../../../config/iwNpcs.js';
import { renderNpcBlock, findMetaLanguage } from '../../../services/iw/npcPrompt.js';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const MODEL_ID = flag('model', 'claude-haiku-4-5');
const REPS = parseInt(flag('reps', '2'), 10);
const FORMAT = flag('format', 'lines');
const NPC_ARG = flag('npc', 'all');

const candidate = CANDIDATES.find(c => c.id === MODEL_ID);
if (!candidate) { console.error(`unknown candidate ${MODEL_ID}`); process.exit(1); }
const apiKey = resolveKey(candidate);
if (!apiKey) { console.error(`no key for ${MODEL_ID} (${candidate.keyEnv.join(' | ')})`); process.exit(1); }

async function ask(scenario) {
  if (candidate.adapter === 'anthropic') {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });
    const params = {
      model: candidate.model, max_tokens: scenario.maxTokens,
      system: [{ type: 'text', text: scenario.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: scenario.user }],
    };
    if (candidate.noThinking) { params.thinking = { type: 'disabled' }; params.output_config = { effort: 'low' }; }
    const r = await client.messages.create(params);
    return r.content.filter(b => b.type === 'text').map(b => b.text).join('');
  }
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey, baseURL: candidate.baseURL });
  const r = await client.chat.completions.create({
    model: candidate.model, max_completion_tokens: scenario.maxTokens,
    messages: [{ role: 'system', content: scenario.system }, { role: 'user', content: scenario.user }],
  });
  return r.choices[0].message.content ?? '';
}

const pad = (s, n) => { const w = [...String(s)].reduce((a, c) => a + (/[一-鿿，。！？]/.test(c) ? 2 : 1), 0); return String(s) + ' '.repeat(Math.max(0, n - w)); };

/**
 * Resolve `--NPC` to the things the sweep needs: the layer-2 prompt text, the probe
 * context, and the per-character length budget.
 *
 * `bench` is the odd one out — it has no registry entry, so its glyph budget is the old
 * flat 16 and its NPC text is scenario.js's string. Everything else goes through the
 * production renderer.
 */
function resolveSubjects(arg) {
  if (arg === 'bench') {
    return [{ id: 'bench', label: '王婶 (inline bench npc)', block: INLINE_NPC,
              ctx: NPC_PROBES.bench, maxGlyphs: 16 }];
  }
  const ids = arg === 'all' ? IW_NPCS.map(p => p.id) : arg.split(',');
  return ids.map(id => {
    const npc = npcById(id);
    if (!npc) throw new Error(`unknown npc "${id}" (have: ${IW_NPCS.map(p => p.id).join(', ')}, bench)`);
    const ctx = NPC_PROBES[id];
    if (!ctx) throw new Error(`npc "${id}" has no probe context in npcProbes.js — add one before sweeping it`);
    return {
      id,
      label: `${npc.name} (${npc.romanization})`,
      block: renderNpcBlock(npc),
      ctx,
      maxGlyphs: glyphBudgetFor(npc),
      npc,
    };
  });
}

async function sweepOne(subject) {
  const openingLine = subject.ctx.opening;
  const turns = buildProbeTurns(subject.ctx, openingLine);
  const scenarioCtx = { npc: subject.block, known: subject.ctx.known, nearby: subject.ctx.nearby, actions: subject.ctx.actions };

  console.log(`\n${'═'.repeat(96)}`);
  console.log(`${subject.label}  ·  id "${subject.id}"  ·  length budget ${subject.maxGlyphs} glyphs`);
  // The meta-language lint is cheap and catches the § 14 Q27 failure BEFORE it costs a call.
  if (subject.npc) {
    const meta = findMetaLanguage(subject.block);
    console.log(`npc block: ${subject.block.length} chars · meta-language: ${meta.length ? '⚠ ' + meta.join(', ') : 'clean'}`);
  }
  console.log('═'.repeat(96));
  console.log(pad('probe', 22) + pad('said', 30) + pad('action', 18) + 'flags');
  console.log('─'.repeat(96));

  // ⚠️ Count `cleanAction`, NOT `legalAction` (scenario.js § "legalAction vs cleanAction").
  // The parser DEGRADES an unrecognised action line to `idle`, so `legalAction` is
  // unconditionally true and a column built on it measures the parser's error handling
  // rather than the model. Fixed 2026-09-05, after a sweep reported "0 illegal actions"
  // while 老周 had invented `sit_to_actor` and been silently rescued.
  let fails = 0, total = 0, dirty = 0;
  for (const turn of turns) {
    for (let i = 0; i < REPS; i++) {
      const scenario = buildScenario(FORMAT, turn, scenarioCtx);
      const raw = await ask(scenario);
      // Grade against the SAME list that was offered — the vocabulary is per NPC now.
      const g = gradeReply(FORMAT, raw, scenario.actions);
      const c = gradeCharacter(g.say, { known: subject.ctx.known, maxGlyphs: subject.maxGlyphs });
      total++;
      // VOCAB is deliberately NOT a failure any more — the hard n+1 budget was withdrawn
      // (§ 9.4), so reaching past the learner is an observation, not a defect.
      const bad = c.flags.filter(f => f === 'ENGLISH' || f === 'BROKE-CHARACTER' || f.startsWith('LONG'));
      if (bad.length) fails++;
      if (!g.cleanAction) dirty++;
      const actionLine = raw.trim().split('\n')[1] ?? '?';
      console.log(pad(i === 0 ? turn.id : '', 22) + pad(g.say || '(silent)', 30)
        + pad((g.cleanAction ? '' : '⚠ ') + actionLine, 18) + (c.flags.join(' ') || 'ok'));
    }
  }
  console.log(`\n${total - fails}/${total} replies clean · ${dirty} rescued action/emote lines`);
  return { id: subject.id, total, fails, dirty };
}

async function main() {
  const subjects = resolveSubjects(NPC_ARG);
  console.log(`\ncharacter sweep — ${candidate.label}, format "${FORMAT}", ${REPS} reps/turn, ${subjects.length} npc(s)`);

  const results = [];
  for (const s of subjects) results.push(await sweepOne(s));

  console.log(`\n${'═'.repeat(96)}\nSUMMARY`);
  for (const r of results) console.log(`  ${pad(r.id, 16)} ${r.total - r.fails}/${r.total} clean · ${r.dirty} rescued`);
  console.log('\nFlags: ENGLISH = switched language · BROKE-CHARACTER = admitted to being a model');
  console.log('       LONG(n>m) = over this npc\'s energy-derived budget');
  console.log('       VOCAB(+n) = reached n content characters past KNOWN_WORDS — an observation, not a failure');
}

main().catch(e => { console.error(e); process.exit(1); });
