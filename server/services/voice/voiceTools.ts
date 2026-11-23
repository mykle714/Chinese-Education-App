/**
 * The voice tutor's one tool: `note_recast` (docs/VOICE_ASSISTANT.md § 7).
 *
 * Silent: the tutor calls it whenever it recasts a learner's line, never mentions it aloud,
 * and the call never touches the learner's cards. Its input is stored on the assistant turn
 * (`voice_turns.recast`) and feeds the transcript highlights and the end-of-session card
 * without a second Claude call.
 *
 * The tool is declared `strict: true` with `eager_input_streaming: true` (the claude-api
 * guidance for streamed client tools). Eager streaming means the API no longer validates the
 * input, so `parseRecastInput` re-validates it before it is stored — a malformed input is
 * dropped (and answered with an error tool_result) rather than persisted.
 *
 * Layer: service. Referenced by server/services/voice/LiveVoiceSession.ts.
 * Tested by server/__tests__/voiceTools.test.ts.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { VoiceRecast } from '../../contracts/voice.js';

export const NOTE_RECAST_TOOL_NAME = 'note_recast';

/** At most two new words per recast (§ 5.4). */
const MAX_NEW_WORDS = 2;
const MAX_FIELD_CHARS = 300;

export const NOTE_RECAST_TOOL = {
  name: NOTE_RECAST_TOOL_NAME,
  description:
    'Silently record a recast. Call this every time your reply models a better, all-Chinese ' +
    'version of something the learner said. Never mention this tool or say that you are ' +
    'recording anything. It does not change the learner\'s flashcards.',
  input_schema: {
    type: 'object' as const,
    properties: {
      learnerSaid: { type: 'string', description: 'What the learner said, as they said it (may mix English).' },
      better: { type: 'string', description: 'The natural all-Chinese version you modelled.' },
      newWords: {
        type: 'array',
        items: { type: 'string' },
        description: 'The Chinese words in `better` the learner did not use (at most two).',
      },
    },
    required: ['learnerSaid', 'better', 'newWords'],
    additionalProperties: false,
  },
  strict: true,
  eager_input_streaming: true,
} as unknown as Anthropic.Tool;

/** Validate a (possibly truncated / malformed) note_recast input. Null when invalid. */
export function parseRecastInput(input: unknown): VoiceRecast | null {
  if (!input || typeof input !== 'object') return null;
  const { learnerSaid, better, newWords } = input as Record<string, unknown>;
  if (typeof learnerSaid !== 'string' || typeof better !== 'string') return null;
  if (!Array.isArray(newWords) || !newWords.every((w) => typeof w === 'string')) return null;
  const said = learnerSaid.trim().slice(0, MAX_FIELD_CHARS);
  const fixed = better.trim().slice(0, MAX_FIELD_CHARS);
  if (!said || !fixed) return null;
  const words = [...new Set((newWords as string[]).map((w) => w.trim()).filter(Boolean))]
    // A "new word" must appear in the better line, or the transcript highlight has nothing to mark.
    .filter((w) => fixed.includes(w))
    .slice(0, MAX_NEW_WORDS);
  return { learnerSaid: said, better: fixed, newWords: words };
}
