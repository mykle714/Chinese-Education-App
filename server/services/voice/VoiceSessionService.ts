import type Anthropic from '@anthropic-ai/sdk';
import { getVoiceAiClient } from '../anthropicClient.js';
import { RateLimitError, NotFoundError } from '../../types/dal.js';
import { streakDateOf, resolveTimezone } from '../../utils/streakDate.js';
import type { LongDefinitionPart } from '../../contracts/wire.js';
import type {
  TutorVoiceRole,
  VoiceRecast,
  VoiceSessionListItem,
  VoiceSessionSummary,
  VoiceSessionTranscript,
  VoiceWordMatch,
} from '../../contracts/voice.js';
import type { IDictionaryDAL } from '../../dal/interfaces/IDictionaryDAL.js';
import type { IVoiceSessionDAL, VoiceSessionRow } from '../../dal/interfaces/IVoiceSessionDAL.js';
import type { SpeechToTextProvider } from './stt/SpeechToTextProvider.js';
import type { VoiceTTS, VoiceClip } from './VoiceTTS.js';
import {
  DAILY_VOICE_SECONDS,
  KNOWN_WORDS_LIMIT,
  STT_PHRASE_HINT_LIMIT,
} from './voiceConfig.js';
import { buildProfileBlock, speakingRateForLevel, type VoiceLearnerProfile } from './voicePrompt.js';

/** Narrow view of StarterPacksService — only its level estimate is borrowed. */
export interface VoiceLevelEstimator {
  estimateLevel(userId: string, language: string): Promise<number>;
}

/** Everything a LiveVoiceSession needs, resolved once when the session opens. */
export interface VoiceSessionContext {
  session: VoiceSessionRow;
  userId: string;
  language: string;
  tz: string;
  usageDate: string;
  /** Voice seconds already used today BEFORE this session (cap accounting). */
  secondsUsedBefore: number;
  profileBlock: string;
  phraseHints: string[];
  speakingRate: number;
  voice: TutorVoiceRole;
  anthropic: Anthropic;
}

const SESSION_LIST_LIMIT = 50;

/**
 * VoiceSessionService — the voice tutor's stateless half (docs/VOICE_ASSISTANT.md § 2).
 *
 * Owns the policies around a session: whether voice is available at all, the daily minute
 * cap (§ 6.5, summed from voice_sessions — no usage table, § 11), the learner profile (§ 6.3),
 * segmentation + card matching of transcript text (§ 4.3), persistence of turns and totals,
 * the end-of-session card (§ 9.2), and the saved-transcript reads + replay (§ 9.3).
 *
 * The per-connection turn state machine is LiveVoiceSession, which calls back into this
 * service for everything that touches the database. This service writes no SQL.
 *
 * Layer: service. Constructed in server/dal/setup.ts; used by VoiceSessionController and
 * LiveVoiceSession.
 */
export class VoiceSessionService {
  constructor(
    private readonly dal: IVoiceSessionDAL,
    private readonly dictionaryDAL: IDictionaryDAL,
    private readonly levelEstimator: VoiceLevelEstimator,
    readonly stt: SpeechToTextProvider,
    readonly tts: VoiceTTS,
  ) {}

  /** Why voice cannot run right now, or null when it can. */
  unavailableReason(): string | null {
    if (!getVoiceAiClient()) return 'The voice tutor is not configured (VOICE_AI_API_KEY is missing).';
    if (!this.stt.available || !this.tts.available) return 'The voice tutor is not configured (Google credentials are missing).';
    return null;
  }

  /** Seconds of voice used today and the daily limit (GET /api/voice/usage). */
  async getUsage(userId: string, tzRaw: unknown): Promise<{ secondsUsed: number; secondsLimit: number }> {
    const tz = resolveTimezone(tzRaw);
    const usageDate = streakDateOf(new Date(), tz);
    const secondsUsed = await this.dal.sumSecondsForDay(userId, tz, usageDate);
    return { secondsUsed, secondsLimit: DAILY_VOICE_SECONDS };
  }

  /**
   * Open a session: enforce the cap, build the learner profile + phrase hints, create the row.
   * Throws RateLimitError when today's voice minutes are spent.
   */
  async openSession(
    userId: string,
    params: { language: string; voice: TutorVoiceRole; tz: unknown },
  ): Promise<VoiceSessionContext> {
    const anthropic = getVoiceAiClient();
    const reason = this.unavailableReason();
    if (!anthropic || reason) throw new Error(reason ?? 'voice unavailable');

    const { language, voice } = params;
    const tz = resolveTimezone(params.tz);
    const usageDate = streakDateOf(new Date(), tz);
    const secondsUsedBefore = await this.dal.sumSecondsForDay(userId, tz, usageDate);
    if (secondsUsedBefore >= DAILY_VOICE_SECONDS) {
      throw new RateLimitError("You've used today's voice practice time. Come back tomorrow!");
    }

    const [level, bandCounts, knownWords, phraseHints] = await Promise.all([
      this.levelEstimator.estimateLevel(userId, language),
      this.dal.countBands(userId, language),
      this.dal.findKnownWords(userId, language, KNOWN_WORDS_LIMIT),
      this.dal.findLearningWords(userId, language, STT_PHRASE_HINT_LIMIT),
    ]);
    const profile: VoiceLearnerProfile = { level, bandCounts, knownWords };
    const session = await this.dal.createSession(userId, language);

    return {
      session,
      userId,
      language,
      tz,
      usageDate,
      secondsUsedBefore,
      profileBlock: buildProfileBlock(profile),
      phraseHints,
      speakingRate: speakingRateForLevel(level),
      voice,
      anthropic,
    };
  }

  /** Seconds left today given this session's running totals. */
  secondsRemaining(ctx: VoiceSessionContext, sessionSeconds: number): number {
    return Math.max(0, DAILY_VOICE_SECONDS - ctx.secondsUsedBefore - sessionSeconds);
  }

  /**
   * gsa-segment each text for cpcd and match its Chinese words against the learner's
   * CURRENT cards (§ 4.3): Mastered/Comfortable → known, Unfamiliar/Target → learning.
   * Words that are not cards are left out of `matches`.
   */
  async segmentAndMatch(
    userId: string,
    language: string,
    texts: string[],
  ): Promise<{ parts: (LongDefinitionPart[] | null)[]; matches: Record<string, VoiceWordMatch> }> {
    const parts = texts.length ? await this.dictionaryDAL.segmentTexts(texts, language) : [];
    const words = new Set<string>();
    for (const p of parts) {
      for (const part of p ?? []) {
        if (part.type === 'foreign') for (const seg of part._segments) if (/\p{Script=Han}/u.test(seg)) words.add(seg);
      }
    }
    const categories = await this.dal.findCardCategories(userId, language, [...words]);
    const matches: Record<string, VoiceWordMatch> = {};
    for (const [word, category] of categories) {
      matches[word] = category === 'Mastered' || category === 'Comfortable' ? 'known' : 'learning';
    }
    return { parts, matches };
  }

  recordTurn(
    sessionId: string,
    turn: {
      turnIndex: number;
      role: 'user' | 'assistant';
      text: string;
      lowConfidenceWords?: string[];
      recast?: VoiceRecast | null;
      interrupted?: boolean;
    },
  ): Promise<void> {
    return this.dal.insertTurn(sessionId, {
      turnIndex: turn.turnIndex,
      role: turn.role,
      text: turn.text,
      lowConfidenceWords: turn.lowConfidenceWords ?? null,
      recast: turn.recast ?? null,
      interrupted: turn.interrupted ?? false,
    });
  }

  /** Write the session's totals and build the end-of-session card (§ 9.2). No Claude call. */
  async finalizeSession(
    ctx: VoiceSessionContext,
    totals: {
      userSeconds: number;
      assistantSeconds: number;
      turnCount: number;
      recasts: VoiceRecast[];
      cardWordsUsed: Map<string, VoiceWordMatch>;
    },
  ): Promise<VoiceSessionSummary> {
    await this.dal.finalizeSession(ctx.session.id, {
      userSeconds: round1(totals.userSeconds),
      assistantSeconds: round1(totals.assistantSeconds),
      turnCount: totals.turnCount,
    });
    const startedAt = new Date(ctx.session.startedAt);
    const now = new Date();
    const wordsAdded = await this.dal
      .findWordsAddedBetween(ctx.userId, ctx.language, startedAt, now)
      .catch((err) => {
        console.error('[voice] wordsAdded lookup failed:', err instanceof Error ? err.message : err);
        return [] as string[];
      });
    return {
      sessionId: ctx.session.id,
      durationSeconds: Math.round((now.getTime() - startedAt.getTime()) / 1000),
      turnCount: totals.turnCount,
      wordsAdded,
      recasts: totals.recasts.slice(0, 5),
      cardWordsUsed: [...totals.cardWordsUsed].map(([word, match]) => ({ word, match })),
    };
  }

  async listSessions(userId: string, language: string): Promise<VoiceSessionListItem[]> {
    const rows = await this.dal.listSessions(userId, language, SESSION_LIST_LIMIT);
    return rows.map((r) => ({ ...toListItem(r), preview: r.preview }));
  }

  /** A saved session as a segmented transcript, tinted against the learner's current cards. */
  async getTranscript(userId: string, sessionId: string): Promise<VoiceSessionTranscript> {
    const session = await this.dal.findSession(userId, sessionId);
    if (!session) throw new NotFoundError('Voice session not found');
    const turns = await this.dal.listTurns(sessionId);

    // One segmentation pass over every line plus every recast's better version.
    const texts: string[] = [];
    const recastIdx: number[] = [];
    for (const t of turns) texts.push(t.text);
    turns.forEach((t) => recastIdx.push(t.recast ? texts.push(t.recast.better) - 1 : -1));
    const { parts, matches } = await this.segmentAndMatch(userId, session.language, texts);

    const preview = turns.find((t) => t.role === 'user')?.text ?? null;
    return {
      session: { ...toListItem(session), preview },
      turns: turns.map((t, i) => ({
        turnIndex: t.turnIndex,
        role: t.role,
        text: t.text,
        parts: parts[i] ?? null,
        lowConfidenceWords: t.lowConfidenceWords ?? [],
        recast: t.recast,
        recastParts: recastIdx[i] >= 0 ? parts[recastIdx[i]] ?? null : null,
        interrupted: t.interrupted,
      })),
      matches,
    };
  }

  /** Replay one line in the tutor's voice (§ 9.3). Synthesized fresh; nothing is cached. */
  async speakLine(text: string, voice: TutorVoiceRole, userId: string, language: string): Promise<VoiceClip> {
    const level = await this.levelEstimator.estimateLevel(userId, language);
    return this.tts.synthesize(text, voice, speakingRateForLevel(level));
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function toListItem(r: VoiceSessionRow): Omit<VoiceSessionListItem, 'preview'> {
  const started = new Date(r.startedAt);
  const ended = r.endedAt ? new Date(r.endedAt) : null;
  return {
    id: r.id,
    startedAt: started.toISOString(),
    endedAt: ended ? ended.toISOString() : null,
    durationSeconds: ended
      ? Math.max(0, Math.round((ended.getTime() - started.getTime()) / 1000))
      : Math.round(Number(r.userSeconds) + Number(r.assistantSeconds)),
    turnCount: r.turnCount,
  };
}
