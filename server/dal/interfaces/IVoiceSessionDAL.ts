import type { VoiceRecast } from '../../contracts/voice.js';

/** One stored `voice_sessions` row (migration 202). */
export interface VoiceSessionRow {
  id: string;
  userId: string;
  language: string;
  startedAt: string;
  endedAt: string | null;
  userSeconds: number;
  assistantSeconds: number;
  turnCount: number;
}

/** One stored `voice_turns` row (migration 202). */
export interface VoiceTurnRow {
  turnIndex: number;
  role: 'user' | 'assistant';
  text: string;
  lowConfidenceWords: string[] | null;
  recast: VoiceRecast | null;
  interrupted: boolean;
}

/** A session-list row: the session plus its first learner line as a preview. */
export interface VoiceSessionListRow extends VoiceSessionRow {
  preview: string | null;
}

/** Card counts per utcm band (core bar) for the learner profile. */
export interface VoiceBandCounts {
  unfamiliar: number;
  target: number;
  comfortable: number;
  mastered: number;
}

/**
 * Data access for the voice tutor (docs/VOICE_ASSISTANT.md § 11): the two voice tables, plus
 * the narrow, language-scoped reads of the learner's cards the tutor needs (profile, phrase
 * hints, per-word matching, words added during a session). Pure storage — the cap policy,
 * what goes into the profile and when to write are VoiceSessionService's calls.
 *
 * Every card read uses SORTED cards only (`vetSortedClause`): the profile and the tinting
 * describe the learner's own deck, never provisional (lent) cards (docs/PROVISIONAL_CARDS.md).
 */
export interface IVoiceSessionDAL {
  // ── voice_sessions / voice_turns ──
  createSession(userId: string, language: string): Promise<VoiceSessionRow>;
  finalizeSession(
    sessionId: string,
    totals: { userSeconds: number; assistantSeconds: number; turnCount: number },
  ): Promise<void>;
  insertTurn(sessionId: string, turn: VoiceTurnRow): Promise<void>;
  /**
   * Voice seconds (user + assistant) the learner has used in sessions that STARTED on
   * `usageDate` — the 04:00-local day in `tz` (shared/streakDay.ts).
   */
  sumSecondsForDay(userId: string, tz: string, usageDate: string): Promise<number>;
  listSessions(userId: string, language: string, limit: number): Promise<VoiceSessionListRow[]>;
  /** The learner's own session, or null when it does not exist or belongs to someone else. */
  findSession(userId: string, sessionId: string): Promise<VoiceSessionRow | null>;
  listTurns(sessionId: string): Promise<VoiceTurnRow[]>;

  // ── Card reads (vet × det, sorted cards only) ──
  countBands(userId: string, language: string): Promise<VoiceBandCounts>;
  /** Mastered + Comfortable headwords, most frequent first (det frequencyScore). */
  findKnownWords(userId: string, language: string, limit: number): Promise<string[]>;
  /** Non-mastered headwords, most recently added first — the STT phrase hints. */
  findLearningWords(userId: string, language: string, limit: number): Promise<string[]>;
  /** For each of `words` the learner has as a card: its core-bar category (Unfamiliar…Mastered). */
  findCardCategories(userId: string, language: string, words: string[]): Promise<Map<string, string>>;
  /** Headwords sorted into Learning in [from, to] — the end card's "words added". */
  findWordsAddedBetween(userId: string, language: string, from: Date, to: Date): Promise<string[]>;
}
