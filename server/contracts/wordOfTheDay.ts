/**
 * wordOfTheDay.ts — wire contract for the global Word of the Day
 * (`GET /api/dictionary/word-of-the-day?day=YYYY-MM-DD`, docs/READING_WRITING_CENTERS.md
 * § Phase 3). Shared by the server (WordOfTheDayService) and the client
 * (`src/api/wordOfTheDay.ts` → `WordOfTheDayCard`).
 *
 * Pure types + one pure validator, so both builds can load it.
 */

/** One visual part of the character, as the card lists it ("亻 person · rén  RADICAL"). */
export interface WordOfTheDayPart {
  /** The part exactly as it appears in the character — the BOUND form (亻, not 人). */
  char: string;
  /** A one-or-two-word English gloss of the part ("person"). */
  gloss: string;
  /** The pinyin of the part's standalone character, tone-marked ("rén"). */
  pinyin: string;
  /** True for the character's Kangxi radical — exactly one part carries it. */
  isRadical: boolean;
}

/** The AI-written card body stored in `daily_words.content`. */
export interface WordOfTheDayContent {
  parts: WordOfTheDayPart[];
  /** One or two sentences on why the character is written with these parts. */
  explanation: string;
}

/** The endpoint's response. */
export interface WordOfTheDay {
  /** The local calendar date this word belongs to (echo of the request). */
  day: string;
  detId: number;
  word: string;
  /** Tone-marked pinyin of the default reading. */
  pronunciation: string | null;
  /** The display definition. */
  dd: string;
  /**
   * The written card body, or null while the day's one model call has not succeeded
   * yet — the card then shows the character, pinyin and dd only.
   */
  content: WordOfTheDayContent | null;
}

/** `YYYY-MM-DD`, the only `day` shape the endpoint accepts. */
export const WORD_OF_THE_DAY_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate a model's (or a stored row's) content object. Returns the clean value, or
 * null if anything is off. Shape rules: 1–5 parts, each part ONE character with a
 * non-empty gloss and pinyin, at most one radical, a non-empty explanation.
 */
export function parseWordOfTheDayContent(raw: unknown): WordOfTheDayContent | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as { parts?: unknown; explanation?: unknown };
  if (!Array.isArray(obj.parts) || obj.parts.length < 1 || obj.parts.length > 5) return null;
  if (typeof obj.explanation !== 'string' || !obj.explanation.trim()) return null;
  const parts: WordOfTheDayPart[] = [];
  for (const p of obj.parts) {
    if (!p || typeof p !== 'object') return null;
    const { char, gloss, pinyin, isRadical } = p as Record<string, unknown>;
    if (typeof char !== 'string' || [...char].length !== 1) return null;
    if (typeof gloss !== 'string' || !gloss.trim()) return null;
    if (typeof pinyin !== 'string' || !pinyin.trim()) return null;
    parts.push({ char, gloss: gloss.trim(), pinyin: pinyin.trim(), isRadical: isRadical === true });
  }
  if (parts.filter((p) => p.isRadical).length > 1) return null;
  return { parts, explanation: obj.explanation.trim() };
}
