/**
 * Shared vernacular-register scoring core (Chinese).
 *
 * Extracted verbatim from backfill-vernacular-score.js so the definition-
 * clustering backfill can score each sense CLUSTER on the same 1–5 register
 * scale — one source of truth (decision 5 of the definition-clusters design;
 * see docs/DEFINITION_CLUSTERS.md).
 *
 * Why per-cluster matters: the word-level scorer's own guideline says "If a
 * word has multiple meanings with different registers, score the most common
 * everyday usage" — a forced compromise for polysemous words (会 "can" = 5 vs
 * 会计 "to reckon accounts" = 1). Clustering removes the compromise by scoring
 * each cluster's glosses independently with this identical rubric.
 *
 * This module owns the rubric + a factory that binds the scorer to an Anthropic
 * client. It does NOT own orchestration (the run loop, DB writes, stats).
 *
 * Referenced by:
 *   - scripts/backfill/chinese/backfill-vernacular-score.js (word level)
 *   - scripts/backfill/chinese/backfill-cluster-definitions.js (per cluster)
 */

const DEFAULT_MODEL = 'claude-sonnet-4-6';

// Shared scale and guidelines used in every prompt mode.
export const SCALE_AND_GUIDELINES = `Scale:
  5 = Natural vernacular — the word sounds completely natural and at home in everyday casual spoken Mandarin; native speakers use it without thinking in conversation (e.g. 吃饭, 好吃, 老爸, 搞定, 没事)
  4 = Informal-leaning — more common in spoken language than in writing; has a slightly casual or conversational feel, though not slang (e.g. 好久不见, 随便, 差不多, 讲)
  3 = Neutral register — equally appropriate in spoken and written contexts; neither marked as casual nor as formal (e.g. 工作, 学习, 手机, 问题, 明天)
  2 = Formal/written-leaning — more natural in written, academic, news, or formal speech contexts than in casual conversation; would sound slightly stiff in everyday chat (e.g. 目前, 然而, 因此, 手术, 阐述)
  1 = Literary/classical/formal only — archaic, classical Chinese, or elevated literary register; sounds unnatural or pretentious in everyday spoken Mandarin (e.g. 余 meaning "I/me", 翌日 for "the next day", 兮, 乃)

Guidelines:
  - Score based on how natural this word sounds in everyday casual spoken Mandarin — not whether it is formally correct or widely known.
  - A word that is universally known but primarily lives in formal/written contexts scores 2 (e.g. 手术 — everyone knows it, but it has a clinical, written feel; it does not belong in casual small talk).
  - A word used freely and naturally in casual conversation scores 4–5, regardless of whether it also appears in formal writing.
  - Classical or archaic words that survive only in set phrases or literary texts score 1.
  - If a word has multiple meanings with different registers, score the most common everyday usage.`;

export const SCORE_LABELS = {
  1: 'Literary/classical/formal only',
  2: 'Formal/written-leaning',
  3: 'Neutral register',
  4: 'Informal-leaning',
  5: 'Natural vernacular',
};

/**
 * Bind the vernacular scorer to an Anthropic client.
 *
 * scoreVernacular(word, pronunciation, definitions, { withReasoning }):
 *   - withReasoning=false → { score }
 *   - withReasoning=true  → { score, reasoning }
 * `definitions` may be an array (first 4 joined) or a pre-joined string — when a
 * caller scores a single cluster it passes that cluster's glosses.
 */
export function createVernacularScorer({ anthropic, model = DEFAULT_MODEL }) {
  async function scoreVernacular(word, pronunciation, definitions, { withReasoning = false } = {}) {
    const definitionText = Array.isArray(definitions)
      ? definitions.slice(0, 4).join('; ')
      : definitions;

    const header = `You are a Chinese linguistics expert specializing in sociolinguistics and register.

Word: ${word} (${pronunciation})
Definitions: ${definitionText}

Task: Score how vernacular (everyday spoken) the word "${word}" is on a scale of 1 to 5.

This is a register score — does this word live primarily in casual everyday speech (score high), or in written, formal, or literary contexts (score low)? The question is not whether the word is common or well-known, but whether it sounds natural and at home in everyday spoken Mandarin.

${SCALE_AND_GUIDELINES}`;

    let prompt;
    let maxTokens;

    if (withReasoning) {
      prompt = `${header}

Respond with ONLY a JSON object with two fields:
  "score": integer 1–5
  "reasoning": one sentence explaining your score

Example: {"score": 2, "reasoning": "Primarily used in formal/written contexts; would sound clinical in casual speech."}
No markdown, no extra text.`;
      maxTokens = 200;
    } else {
      prompt = `${header}

Respond with ONLY a single integer: 1, 2, 3, 4, or 5.
No explanation, no punctuation, no markdown.`;
      maxTokens = 16;
    }

    const response = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      temperature: 0.1,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].text.trim();

    if (withReasoning) {
      // Strip markdown code fences if present
      let cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
      const parsed = JSON.parse(cleaned);
      const score = parseInt(parsed.score, 10);
      if (score < 1 || score > 5 || isNaN(score)) {
        throw new Error(`Invalid score from Claude: ${parsed.score}`);
      }
      return { score, reasoning: parsed.reasoning ?? '' };
    } else {
      // Expect a bare digit 1–5; extract it defensively
      const match = text.match(/^[1-5]$/);
      if (!match) {
        throw new Error(`Invalid score from Claude: "${text}"`);
      }
      return { score: parseInt(text, 10) };
    }
  }

  return { scoreVernacular };
}
