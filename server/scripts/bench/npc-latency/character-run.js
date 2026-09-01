/**
 * Character-fidelity sweep — "does the NPC stay 王婶?" (docs/IMMERSIVE_WORLD.md § 5.4)
 *
 *   node scripts/bench/npc-latency/character-run.js [--model claude-haiku-4-5] [--reps 2]
 *
 * Runs every probe turn in character.js and prints what the NPC actually said, with
 * mechanical failure flags. Unlike run.js this is a QUALITY sweep, not a latency one —
 * read the replies, do not just read the flag column.
 */

import 'dotenv/config';
import { buildScenario, gradeReply } from './scenario.js';
import { PROBE_TURNS, gradeCharacter } from './character.js';
import { CANDIDATES, resolveKey } from './providers.js';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const MODEL_ID = flag('model', 'claude-haiku-4-5');
const REPS = parseInt(flag('reps', '2'), 10);
const FORMAT = flag('format', 'lines');

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

async function main() {
  console.log(`\ncharacter sweep — ${candidate.label}, format "${FORMAT}", ${REPS} reps/turn\n`);
  console.log(pad('probe', 22) + pad('said', 24) + pad('action', 18) + 'flags');
  console.log('─'.repeat(96));
  let fails = 0, total = 0;
  const rows = [];
  for (const turn of PROBE_TURNS) {
    for (let i = 0; i < REPS; i++) {
      const raw = await ask(buildScenario(FORMAT, turn));
      const g = gradeReply(FORMAT, raw);
      const c = gradeCharacter(g.say);
      total++;
      const bad = c.flags.filter(f => f === 'ENGLISH' || f === 'BROKE-CHARACTER' || f.startsWith('VOCAB') || f.startsWith('LONG'));
      if (bad.length) fails++;
      const actionCell = g.legalAction ? '' : '⚠ ';
      rows.push({ turn: turn.id, say: g.say, action: raw.trim().split('\n')[1] ?? '?', flags: c.flags, bad: bad.length > 0, legal: g.legalAction });
      console.log(pad(i === 0 ? turn.id : '', 22) + pad(g.say || '(silent)', 24) + pad(actionCell + (raw.trim().split('\n')[1] ?? '?'), 18) + (c.flags.join(' ') || 'ok'));
    }
  }
  console.log('\n' + `${total - fails}/${total} replies clean · ${rows.filter(r => !r.legal).length} illegal actions`);
  console.log('Flags: ENGLISH = switched language · BROKE-CHARACTER = admitted to being a model');
  console.log('       LONG(n) = over 16 glyphs · VOCAB(+n) = more than one new word');
}

main().catch(e => { console.error(e); process.exit(1); });
