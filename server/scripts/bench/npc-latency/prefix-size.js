/**
 * Prompt-prefix token census (docs/IMMERSIVE_WORLD.md § 5.5, § 6a).
 *
 *   npx tsx scripts/bench/npc-latency/prefix-size.js
 *
 * Prints the measured token size of layer 1 (world rules + reply contract) and of each
 * registry NPC's layer 2, plus their sum — the cacheable prefix.
 *
 * WHY THIS IS A SCRIPT AND NOT A COMMENT. The § 6a cache trap is a THRESHOLD problem: a
 * prefix under the model's minimum cacheable size fails silently, reporting
 * `cache_read_input_tokens: 0` with no error. The number therefore has to be checked
 * whenever the rules or an NPC change, and an estimate in a comment goes stale the first
 * time somebody adds a sentence. Uses Anthropic's count_tokens endpoint — the real
 * tokenizer, not a chars/4 guess, which is off by ~25% on mixed English/Chinese text.
 *
 * Minimum cacheable prefix, for reference (NOT monotonic across generations):
 *   Opus 5 = 512 · Sonnet 5 = 1024 · Opus 4.7 = 2048 · Haiku 4.5 = 4096
 */
import 'dotenv/config';
import { IW_NPCS } from '../../../config/iwNpcs.js';
import { renderNpcBlock } from '../../../services/iw/npcPrompt.js';
import { buildScenario } from './scenario.js';

const MINIMUMS = { 'claude-opus-5': 512, 'claude-sonnet-5': 1024, 'claude-haiku-4-5': 4096 };
const MODEL = process.argv.includes('--model') ? process.argv[process.argv.indexOf('--model') + 1] : 'claude-haiku-4-5';

async function main() {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.DICT_AI_API_KEY ?? process.env.ANTHROPIC_API_KEY });
  const count = async (text) =>
    (await client.messages.countTokens({ model: MODEL, messages: [{ role: 'user', content: text }] })).input_tokens;

  // Layer 1 is everything in the system prompt before the NPC block begins.
  const layer1 = await count(buildScenario('lines').system.split('\nYOU ARE:')[0]);
  const floor = MINIMUMS[MODEL];
  console.log(`\nmodel ${MODEL} · minimum cacheable prefix ${floor ?? 'unknown'}\n`);
  console.log(`layer 1 (world rules + contract): ${layer1}`);
  for (const p of IW_NPCS) {
    const l2 = await count(renderNpcBlock(p));
    const total = layer1 + l2;
    const verdict = floor ? (total >= floor ? '✅ caches' : `❌ ${floor - total} short — SILENTLY does not cache`) : '';
    console.log(`layer 2 ${p.id.padEnd(11)} ${String(l2).padStart(5)}  → prefix ${String(total).padStart(5)}  ${verdict}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
