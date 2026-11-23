/**
 * Builds the voice tutor's system prompt, learner profile and per-turn annotations
 * (docs/VOICE_ASSISTANT.md § 6.2–6.3).
 *
 * PREFIX-CACHE DISCIPLINE (§ 6.4): the system prompt is a constant string and the profile
 * is built from sorted, deterministic inputs — no timestamps, no ids, no unsorted maps — so
 * every turn of a session reuses the cached prefix. Anything volatile goes in the per-turn
 * annotation appended to the learner's line, after the last cache breakpoint.
 *
 * The CONTENT here is an initial draft. How the tutor teaches is tuned after free talk works
 * (§ 5.4, § 6.2–6.3); expect this file to change most.
 *
 * Layer: service (pure). Referenced by server/services/voice/LiveVoiceSession.ts.
 */
import type { VoiceWordMatch } from '../../contracts/voice.js';

export const VOICE_SYSTEM_PROMPT = `You are a patient, warm Mandarin Chinese conversation partner for a language learner, speaking with them out loud through a voice interface. Everything you write is converted to speech.

Scope: language practice through conversation only. If the learner asks for something unrelated to practicing Chinese (coding, news, homework in other subjects), politely steer back to chatting in Chinese.

Voice rules:
- Write plain spoken sentences. No markdown, no lists, no headings, no emoji, no parentheses.
- Keep replies to one to three short sentences unless the learner asks for more.
- Do not read out pinyin or romanization unless you are teaching how to say a specific word.
- Ask one simple follow-up question most turns so the conversation keeps going.

How to respond to mixed Chinese and English ("Chinglish"):
- The learner often mixes English words into Chinese. Understand the meaning first and answer its content.
- Then, at most once per reply, model the natural all-Chinese version of what they said, for example: 对，超市的菜很新鲜。你也可以说：我昨天去了超市，买了很多蔬菜。
- Introduce at most two new words per reply. Do not lecture or explain grammar unless asked.
- If the learner seems lost for two turns in a row, or asks "what?" in English, switch your next reply to simple Chinese with a short English gloss of the key words.
- Never talk about flashcards, decks or saving words. The learner adds words from the transcript on their own.

Tool use: whenever your reply models a better version of something the learner said, call note_recast silently with what they said, the better version, and the new words. Call it once, after you have finished speaking your reply, and do not say anything after it. Never mention the tool.

Honesty: you only receive a text transcript of the learner's speech, so you cannot hear their tones or pronunciation. Never praise or criticize their tones or pronunciation. If the transcript marks a word as uncertain with [?], ask what they meant instead of correcting them confidently.

Speak at the learner's level, which is described in the learner profile that follows.`;

/** The level scale estimateLevel returns (StarterPacksService.MAX_LEVEL): roughly HSK 1–6. */
export const VOICE_LEVEL_MAX = 6;

export interface VoiceLearnerProfile {
  /** StarterPacksService.estimateLevel, 1…6. */
  level: number;
  /** Card counts per utcm band on the core bar. */
  bandCounts: { unfamiliar: number; target: number; comfortable: number; mastered: number };
  /** Mastered + Comfortable words, most frequent first, capped (§ 6.3). */
  knownWords: string[];
}

/** The session-start profile block (cached after the system prompt, § 6.3). */
export function buildProfileBlock(profile: VoiceLearnerProfile): string {
  const { level, bandCounts, knownWords } = profile;
  const scaffold =
    level <= 2
      ? 'Beginner: use very short sentences with the most common words. A brief English gloss after a new word is fine.'
      : level <= 4
        ? 'Intermediate: speak natural, simple Chinese. Use English only if the learner is clearly lost.'
        : 'Advanced: speak natural Chinese at a normal conversational level. Avoid English.';
  const known = knownWords.length
    ? `Words the learner already knows (build sentences mostly from these; introduce at most one word outside them per reply):\n${knownWords.join('、')}`
    : 'The learner has no known-word list yet; assume a beginner vocabulary.';
  return [
    'Learner profile',
    `Estimated level: ${level} of ${VOICE_LEVEL_MAX} (roughly HSK ${level}). ${scaffold}`,
    `Flashcards by mastery: ${bandCounts.mastered} mastered, ${bandCounts.comfortable} comfortable, ${bandCounts.target} target, ${bandCounts.unfamiliar} unfamiliar.`,
    known,
  ].join('\n');
}

/**
 * The bracketed annotation appended to a learner turn (§ 6.3), e.g.
 * `[cards: 超市=learning, 菜=known; lowConfidence: 蔬菜]`. Empty string when there is nothing
 * to say. Keys are sorted so the same turn always renders the same bytes.
 */
export function buildTurnAnnotation(matches: Record<string, VoiceWordMatch>, lowConfidence: string[]): string {
  const cardBits = Object.keys(matches).sort().map((w) => `${w}=${matches[w]}`);
  const parts: string[] = [];
  if (cardBits.length) parts.push(`cards: ${cardBits.join(', ')}`);
  if (lowConfidence.length) parts.push(`lowConfidence: ${[...lowConfidence].sort().join(', ')}`);
  return parts.length ? `[${parts.join('; ')}]` : '';
}

/** The learner's line as Claude sees it: text with uncertain words marked `[?]`, plus annotation. */
export function buildUserTurnContent(
  text: string,
  matches: Record<string, VoiceWordMatch>,
  lowConfidence: string[],
): string {
  let marked = text;
  for (const word of lowConfidence) marked = marked.split(word).join(`${word}[?]`);
  const annotation = buildTurnAnnotation(matches, lowConfidence);
  return annotation ? `${marked}\n${annotation}` : marked;
}

/** Speaking rate by level (§ 5.3): ~0.8× at levels 1–2, rising to 1.0× at 5+. */
export function speakingRateForLevel(level: number): number {
  if (level <= 2) return 0.8;
  if (level === 3) return 0.88;
  if (level === 4) return 0.94;
  return 1.0;
}
