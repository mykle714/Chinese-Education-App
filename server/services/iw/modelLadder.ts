import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { describeLadder, type IWModelRequest, type IWModelRung } from './npcTurn.js';

/**
 * iw model ladder — the concrete rungs behind {@link IWModelRung} (§ 14 Q7, § 14 Q12).
 *
 * LAYER: service. This is the ONLY file in iw that constructs a model client; everything else
 * takes an `IWModelRung` and never learns which vendor answered. A provider swap is an edit
 * here and nowhere else (§ 5.2).
 *
 * ⚠️ **THE LADDER MUST SPAN TWO VENDORS** (§ 14 Q12). Rung 3 exists to survive rungs 1 and 2's
 * provider going down, which it cannot do on the same provider. {@link buildIwLadder} logs a
 * warning when the environment yields a single-vendor ladder rather than silently building one
 * that will fail exactly when it is needed.
 *
 * ⚠️ **PROMPT CACHING IS ASSERTED, NOT ASSUMED** (§ 5.5, in as many words). The minimum
 * cacheable prefix is model-dependent and NOT monotonic across generations — Opus 5 = 512,
 * Sonnet 5 = 1024, Opus 4.7 = 2048, **Haiku 4.5 = 4096, the highest of any current model** —
 * and under the floor the failure is SILENT: no error, just `cache_read_input_tokens: 0`. iw's
 * prefix is ~1200–1750 tokens depending on the NPC, so it caches on Sonnet 5 and never on
 * Haiku 4.5 without padding layer 1 by ~2700 tokens.
 *
 * ⚠️ **RUNG 1 IS HAIKU 4.5, AND THAT WAS DECIDED BY MEASUREMENT, NOT BY THE CACHE ARGUMENT.**
 * It is worth writing down because the cache argument points the other way and is seductive.
 * Measured 2026-09-06 on the first real authored scene (`scripts/iw-turn-probe.ts`, 3 runs
 * each, prefix 2175 tokens):
 *
 * | model | first glyph | line 1 closed | cache | billed input |
 * |---|---|---|---|---|
 * | Haiku 4.5 | 792–970 ms | 792–970 ms | ❌ never (2175 < 4096 floor) | 1817 |
 * | Sonnet 5 | 715–1254 ms | 1326–1869 ms | ✅ 2175 read | 320 |
 *
 * So caching DOES work on Sonnet 5 and never on Haiku 4.5, exactly as § 5.5 predicted, and a
 * cached Sonnet turn is genuinely CHEAPER than an uncached Haiku one. But § 5.5 also claimed
 * the two were "indistinguishable" at 548 vs 551 ms to first glyph, and on this workload they
 * are not: **Sonnet closes line 1 roughly 600–900 ms later**, which is the number § 6.4's
 * audio budget spends. iw is a latency feature before it is a cost feature, so Haiku leads and
 * Sonnet sits at rung 2 — where it is both a real failover (a different model) and the cheap
 * one, which is a good place for it.
 *
 * Flip them with `IW_MODEL_PRIMARY=claude-sonnet-5` if the cost side ever dominates; the
 * numbers above are what that trade costs.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 5.2, § 5.5, § 6, § 14 Q7, § 14 Q12.
 */

/** Read the first env var that has a value. */
const firstEnv = (...names: string[]): string | undefined => {
  for (const n of names) {
    const v = process.env[n];
    if (v) return v;
  }
  return undefined;
};

/**
 * Whether the last call read a cached prefix.
 *
 * Exposed as a module-level counter rather than a return value because caching is a property
 * of the DEPLOYMENT, not of one turn: the number a reader wants is "is caching working at
 * all", and a per-call boolean threaded through the ladder would be noise on every path.
 * § 5.5's standing instruction is to assert this in the turn path rather than assume it.
 */
export const cacheStats = { reads: 0, writes: 0, misses: 0 };

function recordCache(read: number | undefined | null, write: number | undefined | null): void {
  if (read && read > 0) cacheStats.reads++;
  else cacheStats.misses++;
  if (write && write > 0) cacheStats.writes++;
}

/**
 * An Anthropic rung.
 *
 * The system block is sent as TWO segments with `cache_control` on the first: the caller is
 * expected to pass the frozen layers 1 + 2 in `system`, and everything volatile in `user`
 * (§ 5.5, § 11). Marking the whole system block ephemeral is what puts the breakpoint after
 * the NPC sheet and before the turn.
 */
export function anthropicRung(id: string, model: string, apiKey: string): IWModelRung {
  const client = new Anthropic({ apiKey });
  return {
    id,
    vendor: 'anthropic',
    async *stream(req: IWModelRequest, signal: AbortSignal) {
      const stream = client.messages.stream(
        {
          model,
          max_tokens: req.maxTokens,
          system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: req.user }],
        },
        { signal },
      );
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield event.delta.text;
        }
      }
      // Usage is only available once the stream finishes; a rung killed by a deadline never
      // reaches here, which is correct — a dead rung has no cache story to tell.
      const final = await stream.finalMessage();
      recordCache(final.usage.cache_read_input_tokens, final.usage.cache_creation_input_tokens);
    },
  };
}

/**
 * An OpenAI-compatible rung — Groq, Cerebras, Gemini, DeepSeek (§ 5.2, § 6a).
 *
 * ⚠️ NO EXPLICIT CACHE CONTROL. These providers cache prefixes automatically or not at all;
 * none of them takes Anthropic's `cache_control` block, so passing one is an error rather than
 * a no-op. `stream_options.include_usage` is set so a final chunk carries usage where the
 * provider supports it, and `recordCache` simply sees a miss where it does not — which is
 * honest: an unmeasurable cache is not a cache you can rely on.
 */
export function openAiRung(
  id: string,
  vendor: string,
  model: string,
  baseURL: string,
  apiKey: string,
): IWModelRung {
  const client = new OpenAI({ apiKey, baseURL });
  return {
    id,
    vendor,
    async *stream(req: IWModelRequest, signal: AbortSignal) {
      const stream = await client.chat.completions.create(
        {
          model,
          max_tokens: req.maxTokens,
          stream: true,
          stream_options: { include_usage: true },
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user },
          ],
        },
        { signal },
      );
      for await (const chunk of stream) {
        const text = chunk.choices?.[0]?.delta?.content;
        if (text) yield text;
        const cached = chunk.usage?.prompt_tokens_details?.cached_tokens;
        if (chunk.usage) recordCache(cached, 0);
      }
    },
  };
}

/** The env var naming each rung's model, so a deploy can move a rung without a code change. */
const PRIMARY_MODEL = () => process.env.IW_MODEL_PRIMARY || 'claude-haiku-4-5';
const BACKUP_MODEL = () => process.env.IW_MODEL_BACKUP || 'claude-sonnet-5';
const CROSS_VENDOR_MODEL = () => process.env.IW_MODEL_CROSS_VENDOR || 'deepseek-chat';
const CROSS_VENDOR_BASE_URL = () => process.env.IW_CROSS_VENDOR_BASE_URL || 'https://api.deepseek.com';

/**
 * Assemble the ladder from the environment: primary → same-vendor backup → different vendor.
 *
 * ⚠️ A MISSING KEY DROPS A RUNG RATHER THAN THROWING. A box with no DeepSeek key should run
 * iw on a two-rung ladder and say so, not refuse to boot — but it should never do so silently,
 * hence the log. An environment with NO keys at all yields an empty ladder, and every turn
 * then freezes with the § 14 Q7 banner, which is the correct behaviour for "no model
 * configured" and much easier to diagnose than a crash at import time.
 *
 * `log` is injectable so a test can assert what an operator would be told.
 */
export function buildIwLadder(log: (msg: string) => void = console.log): IWModelRung[] {
  const rungs: IWModelRung[] = [];

  const anthropicKey = firstEnv('IW_ANTHROPIC_API_KEY', 'DICT_AI_API_KEY', 'ANTHROPIC_API_KEY');
  if (anthropicKey) {
    rungs.push(anthropicRung('iw-primary', PRIMARY_MODEL(), anthropicKey));
    // Rung 2 is the same vendor on purpose (§ 14 Q7): most failures are a model hiccup or a
    // capacity blip, not an outage, and staying put is faster than switching.
    if (BACKUP_MODEL() !== PRIMARY_MODEL()) {
      rungs.push(anthropicRung('iw-backup', BACKUP_MODEL(), anthropicKey));
    }
  } else {
    log('iw: no Anthropic key (IW_ANTHROPIC_API_KEY / DICT_AI_API_KEY / ANTHROPIC_API_KEY) — rungs 1 and 2 unavailable');
  }

  const crossKey = firstEnv('IW_CROSS_VENDOR_API_KEY', 'DEEPSEEK_API_KEY');
  if (crossKey) {
    rungs.push(openAiRung('iw-cross-vendor', 'deepseek', CROSS_VENDOR_MODEL(), CROSS_VENDOR_BASE_URL(), crossKey));
  } else {
    log('iw: no cross-vendor key (IW_CROSS_VENDOR_API_KEY / DEEPSEEK_API_KEY) — rung 3 unavailable, ladder cannot survive a vendor outage (§ 14 Q12)');
  }

  log(describeLadder(rungs));
  return rungs;
}

/**
 * The process-wide ladder, built once.
 *
 * Lazily, because the env is not necessarily read at import time and because a ladder built at
 * import would log before the app's own startup banner.
 */
let ladder: IWModelRung[] | null = null;
export function getIwLadder(): IWModelRung[] {
  if (!ladder) ladder = buildIwLadder();
  return ladder;
}

/** Test seam — drop the memoized ladder so the next call re-reads the environment. */
export function resetIwLadder(): void {
  ladder = null;
}
