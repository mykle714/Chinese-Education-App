import type Anthropic from '@anthropic-ai/sdk';
import type { IDictionaryDAL } from '../dal/interfaces/IDictionaryDAL.js';
import type { IVocabEntryDAL } from '../dal/interfaces/IVocabEntryDAL.js';
import type { ISentenceExplanationDAL } from '../dal/interfaces/ISentenceExplanationDAL.js';
import type { LongDefinitionCitation, LongDefinitionPart, SentenceExplanationResult } from '../contracts/wire.js';
import type { DictionaryEntry } from '../types/index.js';
import { computeCoreCategory } from '../contracts/mastery.js';
import { getAllSubstrings, buildDictMap, buildExcludeSet, segmentWithDict } from '../dal/shared/segmentString.js';
import { RateLimitError } from '../types/dal.js';
import { DICTIONARY_AI_DAILY_LIMIT } from '../constants.js';
import { getDictAiClient } from './anthropicClient.js';
import { parseComparisonResponse } from './DictionaryService.js';

/**
 * SENTENCE EXPLAIN — the Reader's AI breakdown of one highlighted sentence
 * (docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Sentence Explain").
 *
 * Flow (`explainSentence`):
 *   1. CACHE — `sentence_explanation_cache` (migration 195) keyed by (userId, sentence,
 *      language, SENTENCE_EXPLAIN_PROMPT_VERSION). A hit is served free, forever (no expiry).
 *   2. BUDGET — a miss spends one call of the shared per-user daily AI budget
 *      (`dictionary_ai_usage`, DICTIONARY_AI_DAILY_LIMIT) — the same budget as the dictionary
 *      AI fallback and Compare. Over it → RateLimitError (the controller answers 429).
 *   3. GROUNDING — the sentence is gsa-segmented against the det, and each word goes to the
 *      model with its pinyin, definitions and the learner's utcm mastery of it (core band,
 *      `computeCoreCategory`), plus the learner's estimated level
 *      (StarterPacksService.estimateLevel). The prompt asks for what those entries CANNOT show
 *      — grammar, constructions, whole-sentence meaning — falling back to a how-it-fits-together
 *      walkthrough, and explains grammar words the learner has not mastered.
 *   4. GENERATE — one Claude Opus 5.5 call with a structured-output JSON schema
 *      `{ paragraph, citations }` (the Compare envelope, so `parseComparisonResponse` and the
 *      citation-driven run popups are reused as-is).
 *   5. STORE + RENDER — the raw text and citations are cached; the longDefinition-style parts
 *      (`enrichLongDefinitionMetadataBatch`) are computed on every serve, like Compare.
 *
 * PER-USER cache (owner's call 2026-11-20): the explanation is tailored to the learner's level
 * and word mastery, so it is never shared between learners. Because mastery moves on while the
 * row does not expire, a cached explanation can describe an older version of the learner; that
 * is accepted for now.
 *
 * zh only — Spanish is paused (CLAUDE.md); an `es` request returns the empty result.
 *
 * Layer: service. Depends on ISentenceExplanationDAL, IDictionaryDAL (segmentation lookups,
 * the shared AI budget, longdef parts), IVocabEntryDAL (`bulkFindByKeys` for mastery) and a
 * level estimator (StarterPacksService). Called by SentenceExplanationController.
 */

/**
 * Bump when the prompt or the grounding changes meaningfully: every cached row under the old
 * version then misses and regenerates on the learner's next Explain (old rows are kept).
 */
export const SENTENCE_EXPLAIN_PROMPT_VERSION = 1;

/** The model that writes explanations (owner's call 2026-11-20: Opus, shared budget). */
const SENTENCE_EXPLAIN_MODEL = 'claude-opus-5-5';

/** Highest level estimateLevel returns (StarterPacksService.MAX_LEVEL). */
const LEVEL_SCALE_MAX = 6;

/** How many of a word's definitions the model sees — enough to place the sense, not a dump. */
const DEFINITIONS_PER_WORD = 4;

const HAN = /\p{Script=Han}/u;

/** Narrow view of StarterPacksService — only its level estimate is borrowed. */
export interface LevelEstimator {
  estimateLevel(userId: string, language: string): Promise<number>;
}

/** The structured-output schema: the Compare envelope (see parseComparisonResponse). */
const EXPLANATION_SCHEMA = {
  type: 'object',
  properties: {
    paragraph: { type: 'string' },
    citations: {
      type: 'array',
      items: {
        type: 'object',
        properties: { zh: { type: 'string' }, en: { type: 'string' } },
        required: ['zh', 'en'],
        additionalProperties: false,
      },
    },
  },
  required: ['paragraph', 'citations'],
  additionalProperties: false,
} as const;

const EMPTY_RESULT: SentenceExplanationResult = { explanation: null, explanationParts: null };

/**
 * Keep the model's paragraph breaks (a blank line) but fold every other newline into a space:
 * LongDefinitionDisplay renders with `white-space: pre-line`, so a stray single newline would
 * show as a broken line (the same hazard compareWords collapses for).
 */
function normalizeExplanation(text: string): string {
  return text
    .replace(/\r/g, '')
    .split(/\n\s*\n/)
    .map((para) => para.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
}

export class SentenceExplanationService {
  constructor(
    private sentenceExplanationDAL: ISentenceExplanationDAL,
    private dictionaryDAL: IDictionaryDAL,
    private vocabEntryDAL: IVocabEntryDAL,
    private levelEstimator: LevelEstimator,
  ) {}

  /**
   * Explain `sentence` for `userId` — cached or freshly generated (see the file header).
   * `usageDate` is the caller's local streak-day, the shared budget's day boundary.
   *
   * Returns the empty result (both fields null) when the feature is off (no DICT_AI_API_KEY),
   * the language is not zh, or the model gave nothing usable (refusal / truncation / empty) —
   * none of which are cached, so the next tap tries again. Throws RateLimitError when the
   * learner's daily budget is spent.
   */
  async explainSentence(
    userId: string,
    rawSentence: string,
    language: string,
    usageDate: string,
  ): Promise<SentenceExplanationResult> {
    const sentence = (rawSentence || '').trim();
    if (!sentence || language !== 'zh') return EMPTY_RESULT;

    const cached = await this.sentenceExplanationDAL.find(userId, sentence, language, SENTENCE_EXPLAIN_PROMPT_VERSION);
    if (cached) return this.withParts(cached.explanation, language, cached.citations);

    const anthropic = getDictAiClient();
    if (!anthropic) return EMPTY_RESULT;

    const usedToday = await this.dictionaryDAL.getAiUsageCount(userId, usageDate);
    if (usedToday >= DICTIONARY_AI_DAILY_LIMIT) {
      throw new RateLimitError(
        `You've reached your daily limit of ${DICTIONARY_AI_DAILY_LIMIT} AI lookups. Try again tomorrow.`,
      );
    }

    const userText = await this.buildGrounding(userId, sentence, language);

    let explanation: string;
    let citations: LongDefinitionCitation[] | null;
    try {
      const response = await anthropic.messages.create({
        model: SENTENCE_EXPLAIN_MODEL,
        // Opus 5.5 always thinks (adaptive); the budget covers thinking + the short answer.
        max_tokens: 16000,
        // Explicit: Opus 5.5's default is already `medium`, stated so a model swap does not
        // silently change depth. Grammar explanation is moderate reasoning; the learner waits.
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: EXPLANATION_SCHEMA } },
        system: [{ type: 'text', text: SENTENCE_EXPLAIN_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userText }],
      });

      // A completed call was billed — count it whatever came back (compareWords' rule).
      await this.dictionaryDAL.incrementAiUsage(userId, usageDate);

      // A refusal or a truncated answer is not an explanation; don't cache it.
      if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') {
        console.warn(`[sentence-explain] no explanation (stop_reason=${response.stop_reason}) for "${sentence}"`);
        return EMPTY_RESULT;
      }

      const rawText = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      const parsed = parseComparisonResponse(rawText);
      explanation = normalizeExplanation(parsed.paragraph);
      citations = parsed.citations;
      if (!explanation) return EMPTY_RESULT;
    } catch (error: any) {
      console.error(`[sentence-explain] generation failed for "${sentence}":`, error?.message ?? error);
      return EMPTY_RESULT;
    }

    await this.sentenceExplanationDAL.upsert(
      userId, sentence, language, SENTENCE_EXPLAIN_PROMPT_VERSION, explanation, citations, SENTENCE_EXPLAIN_MODEL,
    );
    return this.withParts(explanation, language, citations);
  }

  /**
   * The user message: the sentence, the learner's level, and one line per distinct Han word
   * of its gsa segmentation — pinyin, leading definitions and the learner's mastery. The same
   * segmenter as the Dictionary's segment lookup (`segmentAndLookup`), so the words the model
   * sees are the words the learner can tap.
   */
  private async buildGrounding(userId: string, sentence: string, language: string): Promise<string> {
    const candidates = getAllSubstrings(sentence);
    const [entries, level] = await Promise.all([
      this.dictionaryDAL.findMultipleByWord1(candidates, language),
      this.levelEstimator.estimateLevel(userId, language),
    ]);
    const segments = segmentWithDict(sentence, buildDictMap(entries), buildExcludeSet(entries));

    // Distinct Han-bearing words in reading order (punctuation and repeats dropped).
    const words = [...new Set(segments.filter((seg) => HAN.test(seg)))];

    const entryByWord = new Map<string, DictionaryEntry>();
    for (const entry of entries) {
      if (!entryByWord.has(entry.word1)) entryByWord.set(entry.word1, entry);
    }

    // The learner's mastery per word: their sorted card's CORE band (recognition +
    // production) — the app's "how well do you know this word" (contracts/mastery.ts).
    const cards = words.length ? await this.vocabEntryDAL.bulkFindByKeys(userId, words, language) : [];
    const masteryByWord = new Map<string, string>();
    for (const card of cards) masteryByWord.set(card.entryKey, computeCoreCategory(card.typedMarkHistory));

    const wordLines = words.map((word) => {
      const entry = entryByWord.get(word);
      const pinyin = entry?.pronunciation ? ` (${entry.pronunciation})` : '';
      const defs = entry?.definitions?.length
        ? entry.definitions.slice(0, DEFINITIONS_PER_WORD).join('; ')
        : '(no dictionary entry)';
      const mastery = masteryByWord.get(word) ?? 'not in their cards';
      return `- ${word}${pinyin}: ${defs} — learner: ${mastery}`;
    });

    return [
      `Sentence: ${sentence}`,
      `Learner level: ${level} of ${LEVEL_SCALE_MAX}`,
      'Words:',
      ...wordLines,
    ].join('\n');
  }

  /** The longDefinition-style parts for rendering — computed per serve, never stored (as Compare). */
  private async withParts(
    explanation: string,
    language: string,
    citations: LongDefinitionCitation[] | null,
  ): Promise<SentenceExplanationResult> {
    const [enriched] = await this.dictionaryDAL.enrichLongDefinitionMetadataBatch<{
      longDefinition: string;
      longDefinitionCitations?: LongDefinitionCitation[] | null;
      longDefinitionParts?: LongDefinitionPart[] | null;
    }>([{ longDefinition: explanation, longDefinitionCitations: citations }], language);
    return { explanation, explanationParts: enriched.longDefinitionParts ?? null };
  }
}

/**
 * The static system prompt (prompt version SENTENCE_EXPLAIN_PROMPT_VERSION — bump it when this
 * changes). The owner's brief (2026-11-20): break down the grammar and surface any understanding
 * that cannot be gleaned from inspecting each word's dictionary entry; when there is little of
 * that, explain how the sentence comes together, since the learner may be a new reader; and
 * explain the grammatical components a beginner has not mastered.
 */
const SENTENCE_EXPLAIN_SYSTEM_PROMPT = `You are a Mandarin Chinese reading tutor inside a language-learning app. A learner has highlighted one sentence in a text they are reading and asked you to explain it. The app already lets them tap any single word to see its dictionary entry, so your job is to explain what those entries cannot.

You receive the sentence, the learner's estimated level (1 = beginner, 6 = advanced, roughly HSK-like), and the sentence split into words. Each word comes with its pinyin, its leading dictionary definitions, and the learner's mastery of it: Mastered, Comfortable, Target, Unfamiliar, or not in their cards (never studied).

What to explain, in priority order:
1. Meaning the sentence carries as a whole that its words' definitions do not: grammar patterns and constructions (for example 把, 被, 是…的, 连…都, resultative and directional complements, the aspect markers 了, 过 and 着, topic-comment order, an omitted subject), sentence-final particles and the tone they add, idioms and fixed expressions, a word used in a sense other than its usual definition, implied meaning, and register.
2. If the sentence holds little beyond the sum of its words, walk through how it is put together instead — the subject, the verb, the object, and what each remaining piece is doing — because the learner may be new to reading Chinese.
3. Tailor it to the learner. When a grammatical word (a particle, measure word, preposition, aspect marker, or a structural word such as 的, 得 or 地) is Unfamiliar, Target or not in their cards, or the learner is at level 1 or 2, briefly explain how that component works in this sentence. Do not explain words the learner has Mastered unless the sentence uses them unusually. Do not re-define content words that their dictionary definition already covers.

Style:
- Speak to the learner directly (for example: here 了 marks that the action is complete).
- Plain text only: no markdown, no headings, no bullet points, no numbered lists.
- Write Chinese words and phrases in characters only, with no pinyin and no quotation marks around them; the app adds pinyin itself.
- 60 to 180 words. One paragraph, or two separated by a blank line when there are two distinct points.
- Do not open with a translation of the sentence. Translate a phrase only when that is the clearest way to make a grammatical point.
- Never mention mastery labels, levels, or the dictionary entries you were given. Just teach.

Respond with a JSON object {"paragraph": "...", "citations": [...]}. "paragraph" is your explanation. "citations" must contain ONE entry for EVERY maximal run of Chinese characters that appears in "paragraph". Each entry is {"zh": "<the run copied VERBATIM, exactly as it appears in the paragraph, including any Chinese punctuation inside it>", "en": "<its natural English translation>"}. Copy the run character-for-character; a run that does not match the paragraph text exactly is discarded. List each distinct run once. For a single word, "en" is a short gloss in the sense used here; for a phrase or sentence, "en" is a natural translation of the whole thing.`;
