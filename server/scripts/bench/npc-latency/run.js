/**
 * iw NPC latency bench — "can a model answer fast enough to be an NPC?"
 *
 *   node scripts/bench/npc-latency/run.js [--trials 5] [--only id,id] [--list] [--json out.json]
 *
 * Run from `server/`. Reads keys from server/.env. Candidates whose key is missing are
 * skipped, so this works with whatever credentials the box has.
 *
 * WHAT IT MEASURES, and why these three numbers and not tok/s:
 *   ttft      — ms to the first streamed content token. The floor on any visible feedback.
 *   ttfSay    — ms to the first character INSIDE the "say" string. THIS IS THE HEADLINE
 *               NUMBER: it is the moment a speech bubble can start painting Chinese. A model
 *               that emits {"emote":...,"action":...} before "say" pays its whole decode time
 *               before the player sees anything, however good its ttft looks.
 *   total     — ms to the last token. When the NPC's BODY can start moving (the action is
 *               only known at the end), which § 6 spends deliberately.
 *
 * Every trial is also graded for usability (scenario.js → grade). A fast model that emits
 * an illegal action enum is not a candidate.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 6a.
 */

import 'dotenv/config';
import { buildScenario, gradeReply } from './scenario.js';
import { CANDIDATES, resolveKey } from './providers.js';

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const TRIALS = parseInt(flag('trials', '5'), 10);
const ONLY = flag('only', null)?.split(',').map(s => s.trim());
const JSON_OUT = flag('json', null);
// Which reply format to ask for: 'lines' | 'json' | 'schema'. This is the single biggest
// measured latency variable (§ 6a) — pass --format all to sweep every one of them.
const FORMAT = flag('format', 'lines');
const SCENARIO = FORMAT === 'all' ? null : buildScenario(FORMAT);

const pct = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : NaN;

// Where the first spoken glyph sits in a partial stream is FORMAT-SPECIFIC — in `lines`
// it is index 0, in `json` it is after the opening `{"say": "`. Each format owns its own
// detector (scenario.js) and it runs on every chunk, so it must stay cheap.

async function runAnthropic(candidate, apiKey, scenario) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });
  const t0 = performance.now();
  let ttft = NaN, ttfSay = NaN, text = '';
  const params = {
    model: candidate.model,
    max_tokens: scenario.maxTokens,
    // The stable half rides a cache_control block exactly as the shipped dictionary path
    // does, so the bench measures the prefill cost we would ACTUALLY pay in production.
    system: [{ type: 'text', text: scenario.system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: scenario.user }],
  };
  // Newer Anthropic models think by default; an NPC must not. Effort floor + thinking off.
  if (candidate.noThinking) { params.thinking = { type: 'disabled' }; params.output_config = { effort: 'low' }; }
  // API-enforced JSON, for the 'schema' format only. Guarantees validity, costs latency.
  if (scenario.format.jsonSchema) {
    params.output_config = { ...(params.output_config ?? {}), format: { type: 'json_schema', schema: scenario.format.jsonSchema } };
  }
  const stream = client.messages.stream(params);
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      if (Number.isNaN(ttft)) ttft = performance.now() - t0;
      text += event.delta.text;
      if (Number.isNaN(ttfSay) && scenario.format.sayIndex(text) >= 0) ttfSay = performance.now() - t0;
    }
  }
  const final = await stream.finalMessage();
  return {
    ttft, ttfSay, total: performance.now() - t0, text,
    inTokens: final.usage.input_tokens + (final.usage.cache_read_input_tokens ?? 0),
    outTokens: final.usage.output_tokens,
    cacheRead: final.usage.cache_read_input_tokens ?? 0,
  };
}

async function runOpenAICompatible(candidate, apiKey, scenario) {
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey, baseURL: candidate.baseURL });
  const t0 = performance.now();
  let ttft = NaN, ttfSay = NaN, text = '', usage = null;
  const stream = await client.chat.completions.create({
    model: candidate.model,
    max_completion_tokens: scenario.maxTokens,
    // Ask for JSON at the API level ONLY for the JSON-shaped formats. Forcing json_object
    // on the `lines` format would contradict the prompt and is the kind of mismatch that
    // makes a benchmark quietly meaningless.
    ...(scenario.format.jsonSchema
      ? { response_format: { type: 'json_schema', json_schema: { name: 'npc_turn', strict: true, schema: scenario.format.jsonSchema } } }
      : FORMAT === 'json' ? { response_format: { type: 'json_object' } } : {}),
    messages: [
      { role: 'system', content: scenario.system },
      { role: 'user', content: scenario.user },
    ],
    stream: true,
    stream_options: { include_usage: true },
  });
  for await (const chunk of stream) {
    if (chunk.usage) usage = chunk.usage;
    const delta = chunk.choices?.[0]?.delta?.content;
    if (!delta) continue;
    if (Number.isNaN(ttft)) ttft = performance.now() - t0;
    text += delta;
    if (Number.isNaN(ttfSay) && scenario.format.sayIndex(text) >= 0) ttfSay = performance.now() - t0;
  }
  return {
    ttft, ttfSay, total: performance.now() - t0, text,
    inTokens: usage?.prompt_tokens ?? NaN, outTokens: usage?.completion_tokens ?? NaN, cacheRead: 0,
  };
}

async function benchOne(candidate, apiKey, formatKey, scenario) {
  const runner = candidate.adapter === 'anthropic' ? runAnthropic : runOpenAICompatible;
  const trials = [];
  let firstError = null;
  for (let i = 0; i < TRIALS; i++) {
    try {
      const r = await runner(candidate, apiKey, scenario);
      trials.push({ ...r, grade: gradeReply(formatKey, r.text) });
    } catch (err) {
      // Record and keep going — one provider being down must not abort the whole sweep.
      if (!firstError) firstError = err?.message ?? String(err);
    }
  }
  return { candidate, formatKey, trials, firstError };
}

function summarize(result) {
  const { candidate, formatKey, trials, firstError } = result;
  const label = `${candidate.label}${formatKey ? ` [${formatKey}]` : ''}`;
  if (!trials.length) return { id: candidate.id, label, error: firstError ?? 'no trials' };
  const by = (k) => trials.map(t => t[k]).filter(v => !Number.isNaN(v)).sort((a, b) => a - b);
  const ttft = by('ttft'), ttfSay = by('ttfSay'), total = by('total');
  // "usable" means the MODEL got it right, not that the parser rescued it (see gradeReply).
  const ok = trials.filter(t => t.grade.parsed && t.grade.cleanAction).length;
  const rescued = trials.filter(t => t.grade.rescued).length;
  const sayFirst = trials.filter(t => t.grade.sayFirst).length;
  const chinese = trials.filter(t => t.grade.chinese && t.grade.say).length;
  const avgIn = trials.reduce((s, t) => s + (t.inTokens || 0), 0) / trials.length;
  const avgOut = trials.reduce((s, t) => s + (t.outTokens || 0), 0) / trials.length;
  const [pin, pout] = candidate.price ?? [0, 0];
  return {
    id: candidate.id, label, format: formatKey, n: trials.length,
    ttftP50: Math.round(pct(ttft, 0.5)), ttftP95: Math.round(pct(ttft, 0.95)),
    saySayP50: Math.round(pct(ttfSay, 0.5)), sayP95: Math.round(pct(ttfSay, 0.95)),
    totalP50: Math.round(pct(total, 0.5)),
    usable: `${ok}/${trials.length}`, rescued, sayFirst: `${sayFirst}/${trials.length}`, chinese: `${chinese}/${trials.length}`,
    // Cost of one NPC turn, in millionths of a dollar — the readable unit at this scale.
    microUsd: Math.round((avgIn * pin + avgOut * pout)),
    sample: trials[trials.length - 1].grade.say || trials[trials.length - 1].text.slice(0, 60),
    cacheRead: Math.round(trials.reduce((s, t) => s + t.cacheRead, 0) / trials.length),
  };
}

const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

async function main() {
  const pool = ONLY ? CANDIDATES.filter(c => ONLY.includes(c.id)) : CANDIDATES;
  if (args.includes('--list')) {
    for (const c of CANDIDATES) console.log(`${pad(c.id, 22)} ${pad(c.label, 26)} key: ${c.keyEnv.join(' | ')} ${resolveKey(c) ? '✓' : '✗ (skipped)'}`);
    return;
  }
  const runnable = pool.filter(c => resolveKey(c));
  const skipped = pool.filter(c => !resolveKey(c));
  console.log(`\niw NPC latency bench — ${TRIALS} trials × ${runnable.length} models × format "${FORMAT}"`);
  if (skipped.length) console.log(`skipped (no key): ${skipped.map(c => c.id).join(', ')}\n`);

  const formats = FORMAT === 'all' ? ['lines', 'json', 'schema'] : [FORMAT];
  const summaries = [];
  for (const candidate of runnable) {
    for (const formatKey of formats) {
      const scenario = buildScenario(formatKey);
      process.stdout.write(`  ${pad(`${candidate.label} [${formatKey}]`, 34)}`);
      const summary = summarize(await benchOne(candidate, resolveKey(candidate), formatKey, scenario));
      summaries.push(summary);
      console.log(summary.error ? `ERROR: ${summary.error}` : `say@p50 ${summary.saySayP50}ms`);
    }
  }

  console.log('\n' + pad('model', 34) + lpad('ttft p50', 10) + lpad('SAY p50', 10) + lpad('SAY p95', 10) + lpad('done p50', 10) + lpad('usable', 8) + lpad('say1st', 8) + lpad('µ$/turn', 9) + '  sample');
  console.log('─'.repeat(120));
  for (const s of summaries.sort((a, b) => (a.saySayP50 ?? 1e9) - (b.saySayP50 ?? 1e9))) {
    if (s.error) { console.log(pad(s.label, 34) + '  ERROR: ' + s.error.slice(0, 80)); continue; }
    console.log(pad(s.label, 34) + lpad(s.ttftP50, 10) + lpad(s.saySayP50, 10) + lpad(s.sayP95, 10) + lpad(s.totalP50, 10) + lpad(s.usable, 8) + lpad(s.sayFirst, 8) + lpad(s.microUsd, 9) + '  ' + s.sample);
  }
  console.log('\nSAY p50 = ms until the first Chinese glyph can be painted in the bubble. Target: < 700ms.');
  if (JSON_OUT) {
    const { writeFileSync } = await import('fs');
    writeFileSync(JSON_OUT, JSON.stringify({ at: new Date().toISOString(), trials: TRIALS, summaries }, null, 2));
    console.log(`wrote ${JSON_OUT}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
