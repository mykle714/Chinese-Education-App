/**
 * Shared everyday-conversation FREQUENCY scoring core (Chinese).
 *
 * Owns the 1–5 rubric behind `frequencyScore` (det column + the same-named key on
 * each definitionClusters element) so the word-level backfill and the definition-
 * clustering backfill score on one identical scale — one source of truth
 * (decision 5 of the definition-clusters design; see docs/DEFINITION_CLUSTERS.md).
 *
 * HISTORY (migration 122): this was originally a REGISTER scorer — how
 * spoken/colloquial a word feels vs. how written/literary. It was renamed and
 * re-pointed at frequency because every consumer already treated it as "how
 * common is this word": the gsa tie-break (segmentString.ts), dictionary search
 * relevance (DictionaryDAL.ts), starter-pack ordering (StarterPacksService.ts),
 * the quick-mark 3–5 gate (VocabEntryDAL.ts), and dd's top-cluster pick
 * (definitions.ts). Under register semantics a colloquial-but-rare word beat a
 * very common register-neutral one (自由 "freedom" scored 3 as register-neutral).
 * Register is NOT scored anywhere anymore — do not re-introduce register
 * language into this prompt.
 *
 * Why per-cluster matters: a polysemous word's senses differ wildly in how often
 * they come up (会 "can/will" is constant; the kuai4 "to reckon accounts" sense is
 * near-never). One word-level number forces a compromise; clustering removes it by
 * scoring each cluster's glosses independently with this identical rubric.
 *
 * This module owns the rubric + a factory that binds the scorer to an Anthropic
 * client. It does NOT own orchestration (the run loop, DB writes, stats).
 *
 * Referenced by:
 *   - scripts/backfill/chinese/backfill-frequency-score.js (word level)
 *   - scripts/backfill/chinese/backfill-cluster-definitions.js (per cluster)
 * Documented in: docs/DEFINITION_CLUSTERS.md, docs/DEFINITION_MAPPING.md,
 *   docs/VOCAB_ENRICHMENT_IMPLEMENTATION.md
 */

const DEFAULT_MODEL = 'claude-sonnet-4-6';

// Shared scale and guidelines used in every prompt mode.
export const SCALE_AND_GUIDELINES = `Scale — how often would a learner living in a Mandarin-speaking environment actually HEAR or SAY this word in everyday conversation?
  5 = Constant — comes up daily; unavoidable in ordinary talk about food, family, time, feelings, getting around (e.g. 吃饭, 时间, 朋友, 好吃, 明天)
  4 = Common — comes up most weeks in ordinary conversation; a learner meets it early and often (e.g. 工作, 手机, 学习, 随便, 差不多)
  3 = Moderately common — comes up in conversation now and then, when the topic calls for it; not part of daily small talk (e.g. 自由, 环境, 手术, 政府)
  2 = Uncommon in speech — a speaker might go months without saying it; mostly encountered while reading, in news, or in specialist talk (e.g. 目前, 阐述, 就业率)
  1 = Almost never spoken — literary, classical, archaic, or narrowly technical; essentially absent from ordinary conversation (e.g. 余 meaning "I/me", 翌日, 兮, 乃)

Guidelines:
  - Score FREQUENCY OF OCCURRENCE in everyday spoken Mandarin, NOT register. Do not lower a score because a word sounds formal, clinical, or bookish — only because it comes up rarely in conversation.
  - Do not raise a score because a word is vivid slang. Slang that only one subculture uses is INFREQUENT (2) even though it is maximally casual.
  - A word that is widely known but rarely uttered scores low (2): recognition is not frequency.
  - A neutral, unremarkable, high-traffic word scores high (4–5) even though it is not colloquial in flavour — 时间 and 工作 are register-neutral AND extremely frequent.
  - Judge the word as a spoken-conversation item; ignore how often it appears in written corpora, textbooks, or news.
  - If a word has multiple meanings that differ in frequency, score its most frequently-heard everyday meaning.`;

// Band names are the same scale in every language, so they live in the shared lib
// and are re-exported here under the name this module's callers already import.
export { FREQUENCY_SCORE_LABELS as SCORE_LABELS } from '../../shared/lib/frequencyLabels.js';

/**
 * Bind the frequency scorer to an Anthropic client.
 *
 * scoreFrequency(word, pronunciation, definitions, { withReasoning }):
 *   - withReasoning=false → { score }
 *   - withReasoning=true  → { score, reasoning }
 * `definitions` may be an array (first 4 joined) or a pre-joined string — when a
 * caller scores a single cluster it passes that cluster's glosses.
 */
export function createFrequencyScorer({ anthropic, model = DEFAULT_MODEL }) {
  async function scoreFrequency(word, pronunciation, definitions, { withReasoning = false } = {}) {
    const definitionText = Array.isArray(definitions)
      ? definitions.slice(0, 4).join('; ')
      : definitions;

    const header = `You are a Chinese linguistics expert with deep knowledge of spoken-Mandarin usage frequency.

Word: ${word} (${pronunciation})
Definitions: ${definitionText}

Task: Score how FREQUENTLY the word "${word}" comes up in everyday conversation, on a scale of 1 to 5.

This is a frequency score, not a register score. The question is how often a person would actually hear or say this word in ordinary daily conversation — NOT how casual, formal, colloquial, or literary it sounds. A perfectly neutral, unglamorous word that everyone says constantly scores 5; a vividly colloquial word that rarely comes up scores low.

${SCALE_AND_GUIDELINES}`;

    let prompt;
    let maxTokens;

    if (withReasoning) {
      prompt = `${header}

Respond with ONLY a JSON object with two fields:
  "score": integer 1–5
  "reasoning": one sentence explaining your score

Example: {"score": 2, "reasoning": "Widely recognized, but a speaker would rarely have occasion to say it in ordinary conversation."}
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

  return { scoreFrequency };
}
