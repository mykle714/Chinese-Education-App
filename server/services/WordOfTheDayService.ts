import type Anthropic from '@anthropic-ai/sdk';
import { IDailyWordDAL, DailyWordRow } from '../dal/interfaces/IDailyWordDAL.js';
import { getAnthropicClient } from './anthropicClient.js';
import { resolveDisplayDefinition, resolveDefaultPronunciation } from '../utils/definitions.js';
import { ValidationError, NotFoundError } from '../types/dal.js';
import {
  WORD_OF_THE_DAY_DAY_RE,
  parseWordOfTheDayContent,
  type WordOfTheDay,
  type WordOfTheDayContent,
} from '../contracts/wordOfTheDay.js';

/**
 * The global Word of the Day (docs/READING_WRITING_CENTERS.md § Phase 3).
 *
 * ── One word per local calendar date, for everyone ─────────────────────────────
 * The client sends ITS local date; the first request for a date pins a random
 * discoverable single character (`daily_words`, migration 169) and every later request
 * reads it back. Pinning first and writing the card body second means a failed model
 * call never moves the word — the next request just retries the body.
 *
 * ── The card body is AI-written, once per day ────────────────────────────────
 * The det has nothing that explains a single character's construction: `components` is
 * level-1 parts in bound form with no glosses and no radical flag (and is not yet
 * populated), and `breakdownElaboration` exists only for multi-character words. So one
 * model call per day writes {parts, explanation}; it is validated
 * (`parseWordOfTheDayContent`, and against `components` when present) before storing.
 *
 * ── Abuse bound ───────────────────────────────────────────────────────────────
 * `day` must be within one day of the server's UTC date (every real timezone is), so a
 * client cannot make the server pin — and pay a model call for — arbitrary dates.
 *
 * Layer: service. SQL lives in DailyWordDAL; HTTP in DictionaryController.
 */

/** Don't repeat a word that was the word of the day within this many days. */
const REPEAT_WINDOW_DAYS = 365;

const MODEL = 'claude-opus-5-5';

/** The response schema the model is constrained to (structured outputs). */
const CONTENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['parts', 'explanation'],
  properties: {
    parts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['char', 'gloss', 'pinyin', 'isRadical'],
        properties: {
          char: { type: 'string' },
          gloss: { type: 'string' },
          pinyin: { type: 'string' },
          isRadical: { type: 'boolean' },
        },
      },
    },
    explanation: { type: 'string' },
  },
} as const;

// Static, so it caches across days (prompt caching is a prefix match).
const SYSTEM_PROMPT = `You write the "Word of the day" card for a Chinese learning app. The learner sees one Simplified Chinese character, its pinyin and its English meaning. You supply:

1. "parts" — the character's FIRST-LEVEL visual components, left-to-right / top-to-bottom, exactly as they are written inside the character. Use the bound form where the character uses it (亻 not 人, 氵 not 水, 扌 not 手, 艹 not 草). For each part: "char" (that one component), "gloss" (one or two plain English words for what it depicts or means, e.g. "person", "water", "hand"), "pinyin" (tone-marked pinyin of the component's standalone character, e.g. 亻 → "rén"), and "isRadical" (true for exactly one part: the character's Kangxi radical as used in standard dictionaries). If the character is a single indivisible pictograph, return one part: the character itself, with isRadical true.

2. "explanation" — one or two short sentences (under 40 words) telling a beginner why the character is written with these parts: the picture or story the parts form, or which part gives the meaning and which gives the sound. Concrete and memorable, never speculative folk etymology presented as fact; if the origin is a sound loan or obscure, say which part carries the sound and which the meaning. Mention each part's character inline, e.g. "亻 (person) leans against 木 (tree)".

Write in plain English with no markdown.`;

export class WordOfTheDayService {
  constructor(private readonly dailyWordDAL: IDailyWordDAL) {}

  /**
   * The word for `day` (YYYY-MM-DD, the caller's local date), pinning one if this is
   * the day's first request and writing its card body if that has not happened yet.
   */
  async getForDay(day: string, now: Date = new Date()): Promise<WordOfTheDay> {
    if (!WORD_OF_THE_DAY_DAY_RE.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) {
      throw new ValidationError('day must be a YYYY-MM-DD date');
    }
    const offsetDays = Math.abs(Date.parse(`${day}T00:00:00Z`) - Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`)) / 86_400_000;
    if (offsetDays > 1) throw new ValidationError('day must be within one day of today');

    let row = await this.dailyWordDAL.findByDay(day);
    if (!row) {
      const detId = await this.dailyWordDAL.pickCandidateDetId(REPEAT_WINDOW_DAYS)
        // Every candidate used within the window (a tiny corpus): allow repeats.
        ?? await this.dailyWordDAL.pickCandidateDetId(0);
      if (detId == null) throw new NotFoundError('No discoverable character is available for a word of the day');
      await this.dailyWordDAL.pinDay(day, detId);
      // Read back rather than trusting our pick: a concurrent first request may have won.
      row = await this.dailyWordDAL.findByDay(day);
      if (!row) throw new NotFoundError('Word of the day could not be pinned');
    }

    let content = parseWordOfTheDayContent(row.content);
    if (!content) {
      content = await this.writeContent(row);
      if (content) await this.dailyWordDAL.fillContent(day, content);
    }
    return this.toWire(row, content);
  }

  /** One model call → validated card body, or null (no key, refusal, invalid output). */
  private async writeContent(row: DailyWordRow): Promise<WordOfTheDayContent | null> {
    const anthropic = getAnthropicClient();
    if (!anthropic) return null; // AI disabled on this box — the card renders without a body

    const dd = resolveDisplayDefinition(row as Parameters<typeof resolveDisplayDefinition>[0]);
    const pinyin = resolveDefaultPronunciation(row as Parameters<typeof resolveDefaultPronunciation>[0]);
    const known = row.components?.length ? `\nKnown first-level components (use exactly these, in this order): ${row.components.join(' ')}` : '';
    const userText = `Character: ${row.word1}\nPinyin: ${pinyin ?? 'unknown'}\nMeaning: ${dd}${known}`;

    // `fallbacks` (server-side refusal fallback, beta) is newer than this SDK's types,
    // so it rides an intersection type; the header goes on the request options.
    const params: Anthropic.MessageCreateParamsNonStreaming & { fallbacks: 'default' } = {
      model: MODEL,
      max_tokens: 16000,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userText }],
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: CONTENT_SCHEMA as unknown as Record<string, unknown> } },
      fallbacks: 'default',
    };

    try {
      const response = await anthropic.messages.create(params, {
        headers: { 'anthropic-beta': 'server-side-fallback-2026-07-01' },
      });
      if (response.stop_reason === 'refusal') {
        console.warn(`[WordOfTheDay] model refused for "${row.word1}" — card renders without a body`);
        return null;
      }
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();
      let parsed: WordOfTheDayContent | null = null;
      try {
        parsed = parseWordOfTheDayContent(JSON.parse(text));
      } catch {
        parsed = null;
      }
      if (!parsed) {
        console.warn(`[WordOfTheDay] invalid card body for "${row.word1}": ${text.slice(0, 200)}`);
        return null;
      }
      // When the det knows the parts, the model must agree with it (same multiset).
      if (row.components?.length) {
        const want = [...row.components].sort().join('');
        const got = parsed.parts.map((p) => p.char).sort().join('');
        if (want !== got) {
          console.warn(`[WordOfTheDay] parts ${got} disagree with det components ${want} for "${row.word1}"`);
          return null;
        }
      }
      return parsed;
    } catch (error) {
      console.error(`[WordOfTheDay] model call failed for "${row.word1}":`, (error as Error).message);
      return null;
    }
  }

  private toWire(row: DailyWordRow, content: WordOfTheDayContent | null): WordOfTheDay {
    const entry = row as Parameters<typeof resolveDisplayDefinition>[0] & Parameters<typeof resolveDefaultPronunciation>[0];
    return {
      day: row.day,
      detId: row.detId,
      word: row.word1,
      pronunciation: resolveDefaultPronunciation(entry),
      dd: resolveDisplayDefinition(entry),
      content,
    };
  }
}
