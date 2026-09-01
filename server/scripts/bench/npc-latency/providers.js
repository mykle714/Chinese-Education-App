/**
 * Candidate model registry for the iw NPC latency bench (docs/IMMERSIVE_WORLD.md § 6a).
 *
 * TWO ADAPTERS COVER EVERYTHING:
 *   - 'anthropic'  → @anthropic-ai/sdk (already a server dependency)
 *   - 'openai'     → the `openai` SDK pointed at a base URL. Groq, Cerebras, Together,
 *                    Fireworks, DeepSeek, xAI, Mistral and Google all expose an
 *                    OpenAI-compatible /chat/completions, so one adapter benches them all.
 *
 * A candidate is SKIPPED (not failed) when its key env var is unset, so the bench runs with
 * whatever credentials the machine happens to have. Only DICT_AI_API_KEY exists today.
 *
 * RULE: no reasoning/thinking models. An NPC that thinks before saying "要几碗？" has already
 * lost — thinking tokens land in front of the first glyph, which is the one number we care
 * about. This is also why public leaderboards report absurd TTFT for reasoning models.
 */

export const CANDIDATES = [
  // ── Anthropic ──────────────────────────────────────────────────────────────
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', adapter: 'anthropic', model: 'claude-haiku-4-5',
    keyEnv: ['DICT_AI_API_KEY', 'ANTHROPIC_API_KEY'], price: [1.0, 5.0] },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', adapter: 'anthropic', model: 'claude-sonnet-5',
    keyEnv: ['DICT_AI_API_KEY', 'ANTHROPIC_API_KEY'], price: [2.0, 10.0], noThinking: true },

  // ── Groq (LPU — custom silicon, the usual TTFT leader) ─────────────────────
  { id: 'groq-llama-8b', label: 'Llama 3.1 8B (Groq)', adapter: 'openai', model: 'llama-3.1-8b-instant',
    baseURL: 'https://api.groq.com/openai/v1', keyEnv: ['GROQ_API_KEY'], price: [0.05, 0.08] },
  { id: 'groq-gpt-oss-20b', label: 'GPT-OSS 20B (Groq)', adapter: 'openai', model: 'openai/gpt-oss-20b',
    baseURL: 'https://api.groq.com/openai/v1', keyEnv: ['GROQ_API_KEY'], price: [0.1, 0.5] },
  { id: 'groq-llama-70b', label: 'Llama 3.3 70B (Groq)', adapter: 'openai', model: 'llama-3.3-70b-versatile',
    baseURL: 'https://api.groq.com/openai/v1', keyEnv: ['GROQ_API_KEY'], price: [0.59, 0.79] },

  // ── Cerebras (WSE — the other custom-silicon option) ───────────────────────
  { id: 'cerebras-llama-8b', label: 'Llama 3.1 8B (Cerebras)', adapter: 'openai', model: 'llama3.1-8b',
    baseURL: 'https://api.cerebras.ai/v1', keyEnv: ['CEREBRAS_API_KEY'], price: [0.1, 0.1] },
  { id: 'cerebras-llama-70b', label: 'Llama 3.3 70B (Cerebras)', adapter: 'openai', model: 'llama-3.3-70b',
    baseURL: 'https://api.cerebras.ai/v1', keyEnv: ['CEREBRAS_API_KEY'], price: [0.85, 1.2] },

  // ── Google (OpenAI-compatible endpoint; strong Chinese, very cheap) ────────
  { id: 'gemini-flash-lite', label: 'Gemini Flash Lite', adapter: 'openai', model: 'gemini-flash-lite-latest',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/', keyEnv: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'], price: [0.1, 0.4] },
  { id: 'gemini-flash', label: 'Gemini Flash', adapter: 'openai', model: 'gemini-flash-latest',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/', keyEnv: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'], price: [0.3, 2.5] },

  // ── OpenAI ────────────────────────────────────────────────────────────────
  { id: 'gpt-mini', label: 'GPT mini', adapter: 'openai', model: 'gpt-5-mini',
    baseURL: 'https://api.openai.com/v1', keyEnv: ['OPENAI_API_KEY'], price: [0.25, 2.0] },
  { id: 'gpt-nano', label: 'GPT nano', adapter: 'openai', model: 'gpt-5-nano',
    baseURL: 'https://api.openai.com/v1', keyEnv: ['OPENAI_API_KEY'], price: [0.05, 0.4] },

  // ── DeepSeek / Moonshot — notable because they are natively strong in Chinese ──
  { id: 'deepseek-chat', label: 'DeepSeek Chat', adapter: 'openai', model: 'deepseek-chat',
    baseURL: 'https://api.deepseek.com/v1', keyEnv: ['DEEPSEEK_API_KEY'], price: [0.27, 1.1] },
];

export function resolveKey(candidate) {
  for (const name of candidate.keyEnv) {
    const v = process.env[name];
    if (v && v.trim()) return v.trim();
  }
  return null;
}
