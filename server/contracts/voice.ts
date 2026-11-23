/**
 * Voice Assistant — the contract both halves of the app agree on (docs/VOICE_ASSISTANT.md).
 *
 * Covers the WebSocket wire protocol (§ 3) on `/api/voice/session` and the REST shapes for
 * the saved-session list, the transcript review page and the end-of-session card (§ 9).
 * Lives in server/contracts/ for the same reason as wire.ts: the client imports it
 * (`src/** → server/contracts/**`), the server cannot import from src/.
 *
 * Event names are camelCase. Binary frames carry audio:
 *   - C→S: 16 kHz mono PCM16 little-endian, 20 ms frames (640 bytes), no header.
 *   - S→C: one MP3 per tutor sentence, prefixed by VOICE_AUDIO_HEADER_BYTES bytes:
 *          uint32 turnId (BE) + uint32 sentenceIndex (BE), so audio from a turn the learner
 *          barged into can be dropped on arrival (§ 4.1).
 *
 * Referenced by: server/controllers/VoiceSessionController.ts, server/services/voice/*,
 * src/api/voiceSocket.ts, src/api/voice.ts, src/features/voice/*.
 */
import type { LongDefinitionPart } from './wire.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constants shared by both halves
// ─────────────────────────────────────────────────────────────────────────────

/** Mic capture sample rate the server's STT expects. */
export const VOICE_INPUT_SAMPLE_RATE = 16000;
/** One mic frame: 20 ms of 16 kHz PCM16 = 320 samples = 640 bytes. */
export const VOICE_INPUT_FRAME_BYTES = 640;
/** Bytes before the MP3 payload in an S→C audio frame (turnId + sentenceIndex). */
export const VOICE_AUDIO_HEADER_BYTES = 8;
/** WebSocket path (under the /api proxy prefix so nginx + Vite forward it unchanged). */
export const VOICE_SOCKET_PATH = '/api/voice/session';
/** Close code the server uses when the learner's daily voice minutes are spent. */
export const VOICE_CLOSE_CAP_REACHED = 4001;
/** Close code for an auth failure during the `start` handshake. */
export const VOICE_CLOSE_UNAUTHORIZED = 4401;

/**
 * The tutor's voice as an ABSTRACT ROLE (Q14, Q21). The client never sends a provider voice
 * name; server/services/voice/VoiceTTS.ts maps the role to a Chirp3-HD voice — the same
 * rule as TTSService's TTSVoiceKey.
 */
export type TutorVoiceRole = 'male' | 'female';
export const TUTOR_VOICE_ROLES: readonly TutorVoiceRole[] = ['male', 'female'];

/** Narrow an untrusted field to a tutor voice role; anything else reads as 'female'. */
export function toTutorVoiceRole(value: unknown): TutorVoiceRole {
  return value === 'male' ? 'male' : 'female';
}

/** The orb's three states (§ 8). */
export type VoiceOrbState = 'listening' | 'thinking' | 'speaking';

/** How a transcript word relates to the learner's cards (§ 4.3). */
export type VoiceWordMatch = 'known' | 'learning';

// ─────────────────────────────────────────────────────────────────────────────
// Client → server (text frames)
// ─────────────────────────────────────────────────────────────────────────────

export interface VoiceStartMessage {
  type: 'start';
  /**
   * The live access token. A browser WebSocket cannot set an Authorization header, so the
   * token rides in the first frame rather than the URL (a query string ends up in proxy
   * logs). The httpOnly cookie, when the browser sends it on the upgrade, is accepted too.
   */
  token?: string | null;
  language: 'zh';
  voice: TutorVoiceRole;
  /** IANA timezone, for the 04:00-local day the daily cap is counted in. */
  tz: string;
}

export interface VoiceInterruptMessage {
  /** Local VAD heard the learner talk over the tutor: stop speaking now (§ 4.4). */
  type: 'interrupt';
}

export interface VoiceSetVoiceMessage {
  /** The tutor-voice toggle in the sheet (Q21); applies from the next sentence. */
  type: 'setVoice';
  voice: TutorVoiceRole;
}

export interface VoicePlaybackEndedMessage {
  /**
   * The client finished playing every sentence of `turnId`. The server stops treating the mic
   * as possible echo and starts listening again (§ 4.1). A server-side timer covers a client
   * that never reports.
   */
  type: 'playbackEnded';
  turnId: number;
}

export interface VoiceCardAddedMessage {
  /**
   * The learner added `word` to their cards from the transcript (deip). The server tells the
   * tutor through a mid-conversation system message (§ 6.3) so it can reuse the word.
   */
  type: 'cardAdded';
  word: string;
}

export interface VoiceEndMessage {
  /** The learner tapped End. The server finalizes and replies with `ended`. */
  type: 'end';
}

export type VoiceClientMessage =
  | VoiceStartMessage
  | VoiceInterruptMessage
  | VoiceSetVoiceMessage
  | VoicePlaybackEndedMessage
  | VoiceCardAddedMessage
  | VoiceEndMessage;

// ─────────────────────────────────────────────────────────────────────────────
// Server → client (text frames)
// ─────────────────────────────────────────────────────────────────────────────

export interface VoiceReadyEvent {
  type: 'ready';
  sessionId: string;
  /** Voice seconds left today when the session opened (the cap minus today's use). */
  secondsRemaining: number;
}

export interface VoiceStateEvent {
  type: 'state';
  state: VoiceOrbState;
}

export interface VoiceUserPartialEvent {
  /** Live caption of the learner while they speak (plain text, not yet segmented). */
  type: 'userPartial';
  text: string;
}

export interface VoiceUserFinalEvent {
  /** The learner's finished utterance, segmented for cpcd + matched against their cards. */
  type: 'userFinal';
  turnIndex: number;
  text: string;
  parts: LongDefinitionPart[] | null;
  lowConfidenceWords: string[];
  matches: Record<string, VoiceWordMatch>;
}

export interface VoiceAssistantTextEvent {
  /** One tutor sentence, sent just before that sentence's audio frame. */
  type: 'assistantText';
  turnId: number;
  turnIndex: number;
  sentenceIndex: number;
  text: string;
  parts: LongDefinitionPart[] | null;
  matches: Record<string, VoiceWordMatch>;
}

export interface VoiceRecastEvent {
  /** The tutor recast a line (silent `note_recast`, § 7): highlight its new words. */
  type: 'recast';
  turnIndex: number;
  recast: VoiceRecast;
}

export interface VoiceTurnEndEvent {
  /** The tutor's reply is complete (or was interrupted). */
  type: 'turnEnd';
  turnId: number;
  interrupted: boolean;
}

export interface VoiceEndedEvent {
  /** The session is finalized; the end-of-session card's data (§ 9.2). */
  type: 'ended';
  summary: VoiceSessionSummary;
}

export interface VoiceErrorEvent {
  type: 'error';
  /** `capReached` = daily voice minutes spent; `fatal` closes the session. */
  code: 'capReached' | 'unauthorized' | 'unavailable' | 'badRequest' | 'internal';
  message: string;
  fatal: boolean;
}

export type VoiceServerEvent =
  | VoiceReadyEvent
  | VoiceStateEvent
  | VoiceUserPartialEvent
  | VoiceUserFinalEvent
  | VoiceAssistantTextEvent
  | VoiceRecastEvent
  | VoiceTurnEndEvent
  | VoiceEndedEvent
  | VoiceErrorEvent;

// ─────────────────────────────────────────────────────────────────────────────
// Stored / REST shapes
// ─────────────────────────────────────────────────────────────────────────────

/** The `note_recast` tool's input, stored on the assistant turn (`voice_turns.recast`). */
export interface VoiceRecast {
  /** What the learner said (their words, possibly Chinglish). */
  learnerSaid: string;
  /** The all-Chinese version the tutor modelled. */
  better: string;
  /** At most two words the recast introduced. */
  newWords: string[];
}

/** One row of the saved-session list (GET /api/voice/sessions). */
export interface VoiceSessionListItem {
  id: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
  turnCount: number;
  /** The learner's first line, as a preview; null when they never spoke. */
  preview: string | null;
}

/** One transcript line, segmented for cpcd (GET /api/voice/sessions/:id). */
export interface VoiceTranscriptTurn {
  turnIndex: number;
  role: 'user' | 'assistant';
  text: string;
  parts: LongDefinitionPart[] | null;
  lowConfidenceWords: string[];
  recast: VoiceRecast | null;
  /** The recast's `better` line, segmented (assistant turns with a recast only). */
  recastParts: LongDefinitionPart[] | null;
  interrupted: boolean;
}

export interface VoiceSessionTranscript {
  session: VoiceSessionListItem;
  turns: VoiceTranscriptTurn[];
  /** Known/learning tint for every Chinese word in the transcript, against CURRENT cards. */
  matches: Record<string, VoiceWordMatch>;
}

/** The end-of-session card (§ 9.2) — built from data the session already holds. */
export interface VoiceSessionSummary {
  sessionId: string;
  durationSeconds: number;
  turnCount: number;
  /** Cards the learner added (from the transcript) while the session was open. */
  wordsAdded: string[];
  /** Up to five learner-line ↔ better-version pairs, from note_recast. */
  recasts: VoiceRecast[];
  /** Card words the learner used in their own lines. */
  cardWordsUsed: Array<{ word: string; match: VoiceWordMatch }>;
}

/** POST /api/voice/speak — replay one line in the tutor's voice (§ 9.3). */
export interface VoiceSpeakRequest {
  text: string;
  voice: TutorVoiceRole;
}

/** The longest line /api/voice/speak will synthesize (a tutor sentence is far shorter). */
export const VOICE_SPEAK_MAX_CHARS = 300;
