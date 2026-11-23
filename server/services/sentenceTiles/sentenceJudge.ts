import Anthropic from '@anthropic-ai/sdk';
import { getSentenceTilesAiClient } from '../anthropicClient.js';

/**
 * Sentence Tiles — the AI judge (docs/SENTENCE_TILES_GAME.md § "The judge").
 *
 * One Messages call per NEW line: is this sequence of word tiles a natural, complete Chinese
 * sentence? The rules text mirrors the pilot's judge-rules.md
 * (server/scripts/analysis/wordScrabblePilot/), which produced the viability numbers.
 *
 * Cost shape:
 *   - Claude Sonnet 5.5 at `low` effort. The owner approved the spend limits on a Sonnet cost
 *     estimate (2026-11-22). Classification of a ≤13-word line needs little reasoning.
 *   - The system prompt is frozen (no per-request text) and marked cacheable; the user message
 *     is the line only.
 *   - Structured output (json_schema) so the answer always parses.
 *
 * Safety: the line is built by the SERVER from tiles in the player's rack and on the board —
 * all det headwords from a fixed 1,129-word set — so no free text from a client ever reaches
 * the model.
 *
 * Server-side refusal fallbacks are NOT enabled: the installed @anthropic-ai/sdk (0.77) predates
 * the `fallbacks` parameter. A refusal returns `unavailable`, so the player simply retries; it
 * is never recorded as an illegal line.
 *
 * LAYER: service helper (external I/O, no DB). Caller: SentenceTilesService.playTiles.
 */

export const SENTENCE_JUDGE_MODEL = 'claude-sonnet-5-5';

const SYSTEM_PROMPT = `You referee a casual word-tile game for learners of Mandarin Chinese (HSK 1–3).

Each tile is one whole Chinese word, used as an indivisible unit. A player lays tiles in a line, read in order. The line is LEGAL if it forms a natural, complete Chinese sentence or utterance that a native speaker would actually say. A short reply counts (对。/ 我知道。/ 谢谢你。). Punctuation is implied and free: a comma or question mark may be imagined wherever it is needed.

Judge generously on style and strictly on meaning:
- Grammatical but bizarre or meaningless lines are NOT legal ("鞋子喝河").
- Fragments that are not a complete utterance are NOT legal ("我的", "很高").
- Word order must be the order given; do not rearrange tiles.
- Colloquial, everyday speech is fine. Mild oddness that a native speaker would still accept is fine.

Answer with JSON: "legal" (true/false) and "reason": ONE short English sentence for the learner. On a rejection, say what is wrong; on an acceptance, give a natural English translation.`;

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    legal: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['legal', 'reason'],
  additionalProperties: false,
} as const;

export type JudgeResult =
  | { kind: 'verdict'; legal: boolean; reason: string; model: string }
  /** No key, a refusal, a truncation or an API error — nothing was decided. */
  | { kind: 'unavailable'; billed: boolean };

/** Ask the model whether `lineWords` (tiles in reading order) is a legal sentence. Never throws. */
export async function judgeLine(lineWords: readonly string[]): Promise<JudgeResult> {
  const client = getSentenceTilesAiClient();
  if (!client) return { kind: 'unavailable', billed: false };

  // Tiles are shown both separated (so the model sees the units) and joined (so it reads naturally).
  const userText = `Tiles: ${lineWords.join(' | ')}\nRead together: ${lineWords.join('')}`;

  try {
    const response = await client.messages.create({
      model: SENTENCE_JUDGE_MODEL,
      // Thinking is adaptive on Sonnet 5.5; at low effort a verdict uses a small fraction of this.
      max_tokens: 4000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: VERDICT_SCHEMA } },
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userText }],
    });

    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') {
      console.warn(`[sentence-judge] no verdict (stop_reason=${response.stop_reason}) for "${lineWords.join('|')}"`);
      return { kind: 'unavailable', billed: true };
    }
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    const parsed = JSON.parse(text) as { legal?: unknown; reason?: unknown };
    if (typeof parsed.legal !== 'boolean') return { kind: 'unavailable', billed: true };
    const reason = typeof parsed.reason === 'string' ? parsed.reason.trim().slice(0, 300) : '';
    return { kind: 'verdict', legal: parsed.legal, reason, model: SENTENCE_JUDGE_MODEL };
  } catch (error: any) {
    // An APIError means the request reached Anthropic and may have been billed; a connection
    // error means it did not. Either way nothing was decided.
    console.error(`[sentence-judge] call failed for "${lineWords.join('|')}":`, error?.message ?? error);
    return { kind: 'unavailable', billed: error instanceof Anthropic.APIError };
  }
}
