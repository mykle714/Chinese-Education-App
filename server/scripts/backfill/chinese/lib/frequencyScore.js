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
  - Judge the word as a spoken-conversation item; ignore how often it appears in written corpora, textbooks, or news.`;

/**
 * The final guideline, which is the ONE line that must differ between the two callers.
 *
 * ⚠️ THIS SPLIT IS THE WHOLE POINT — see the bug it fixes, below.
 *
 * WORD mode asks about the headword and must resolve polysemy by taking the word's best
 * sense. SENSE mode asks about ONE cluster and must do the exact opposite: a common
 * word's rare sense has to be allowed to score low, or clustering buys nothing.
 *
 * ── THE BUG (fixed 2026-08-18, SCRIPT_VERSION 6) ──────────────────────────────
 * Both callers previously shared a single guideline block ending in "if a word has
 * multiple meanings that differ in frequency, score its most frequently-heard everyday
 * meaning." Correct for the word-level backfill; for the per-cluster call it instructed
 * the model to DISREGARD the cluster it had just been handed and score the headword
 * instead — the direct negation of that call's purpose. The task line reinforced it by
 * asking "how frequently does the word X come up", never naming the sense.
 *
 * The result was not merely wrong scores but INCOHERENT ones, because the model resolved
 * the contradiction differently per call. 老: "of long standing" 5, "familiar prefix" 5,
 * "always; very" 5 (all scored as the WORD, which is constant), but "tough (of food)" 3
 * and "old; aged" 2 (scored as the SENSE). Nothing about 老 makes its core meaning rarer
 * than "of long standing" — the difference is only which instruction won that sample.
 * Since `sortedSenseClusters` orders by this score, the learner's DEFAULT sense for 老
 * became "experienced", and for 和 became "to mix / blend" over "and".
 *
 * It also explains the tie rate: when the model scores the word, every cluster of that
 * word gets the SAME number, so ties are the expected outcome rather than an accident —
 * 431 of 1094 clustered discoverable entries (39.4%) had their default sense decided by
 * a tie, i.e. by JSON array order.
 */
const POLYSEMY_GUIDELINE = {
  word: `  - If a word has multiple meanings that differ in frequency, score its most frequently-heard everyday meaning.`,
  sense: `  - Score ONLY the sense stated above. IGNORE how common the word is in its other meanings — a very common word's rare sense must score LOW. 会 is constant as "can/will" (5) but near-never as "to reckon accounts" (1); score the sense in front of you, not the headword.
  - Do not let the word's overall familiarity raise the score. The question is how often speakers use it WITH THIS MEANING.`,
};

// Band names are the same scale in every language, so they live in the shared lib
// and are re-exported here under the name this module's callers already import.
export { FREQUENCY_SCORE_LABELS as SCORE_LABELS } from '../../shared/lib/frequencyLabels.js';

/**
 * Bind the frequency scorer to an Anthropic client.
 *
 * scoreFrequency(word, pronunciation, definitions, { withReasoning, sense }):
 *   - withReasoning=false → { score }
 *   - withReasoning=true  → { score, reasoning }
 * `definitions` may be an array (first 4 joined) or a pre-joined string — when a
 * caller scores a single cluster it passes that cluster's glosses.
 *
 * `sense` switches the prompt into SENSE MODE and is REQUIRED for a per-cluster call:
 * it names the sense in the task line and swaps in the sense-mode polysemy guideline
 * (see POLYSEMY_GUIDELINE). Omit it for the word-level backfill. Passing the cluster's
 * glosses WITHOUT `sense` is the bug this parameter exists to make impossible — the
 * model then answers about the headword and every cluster of a word scores alike.
 */
export function createFrequencyScorer({ anthropic, model = DEFAULT_MODEL }) {
  async function scoreFrequency(word, pronunciation, definitions, { withReasoning = false, sense = null } = {}) {
    const definitionText = Array.isArray(definitions)
      ? definitions.slice(0, 4).join('; ')
      : definitions;

    // SENSE MODE names the sense in the subject line and in the task, so the model is
    // never asked about the bare headword while being shown one cluster's glosses.
    const senseMode = typeof sense === 'string' && sense.trim() !== '';
    const subject = senseMode
      ? `Word: ${word} (${pronunciation})
Sense being scored: ${sense}
Glosses for THIS SENSE ONLY: ${definitionText}`
      : `Word: ${word} (${pronunciation})
Definitions: ${definitionText}`;

    const task = senseMode
      ? `Task: Score how FREQUENTLY "${word}" is used to mean "${sense}" in everyday conversation, on a scale of 1 to 5. You are scoring THIS SENSE, not the word overall.`
      : `Task: Score how FREQUENTLY the word "${word}" comes up in everyday conversation, on a scale of 1 to 5.`;

    const header = `You are a Chinese linguistics expert with deep knowledge of spoken-Mandarin usage frequency.

${subject}

${task}

This is a frequency score, not a register score. The question is how often a person would actually hear or say this word in ordinary daily conversation — NOT how casual, formal, colloquial, or literary it sounds. A perfectly neutral, unglamorous word that everyone says constantly scores 5; a vividly colloquial word that rarely comes up scores low.

${SCALE_AND_GUIDELINES}
${senseMode ? POLYSEMY_GUIDELINE.sense : POLYSEMY_GUIDELINE.word}`;

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
      // 0, not 0.1: this is a bounded 1–5 judgement and the clusterer's other stages
      // already run deterministic (see tempParams in backfill-cluster-definitions.js).
      // Sampling noise here made a mis-scored sense non-reproducible, which is what
      // made the 老/和 defect hard to see — re-running gave different numbers.
      temperature: 0,
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
