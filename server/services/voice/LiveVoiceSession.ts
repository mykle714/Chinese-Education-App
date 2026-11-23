import type Anthropic from '@anthropic-ai/sdk';
import {
  VOICE_AUDIO_HEADER_BYTES,
  type TutorVoiceRole,
  type VoiceOrbState,
  type VoiceRecast,
  type VoiceServerEvent,
  type VoiceSessionSummary,
  type VoiceWordMatch,
} from '../../contracts/voice.js';
import { Endpointer, FRAME_MS } from './endpointer.js';
import { SentenceChunker } from './sentenceChunker.js';
import { NOTE_RECAST_TOOL, NOTE_RECAST_TOOL_NAME, parseRecastInput } from './voiceTools.js';
import { VOICE_SYSTEM_PROMPT, buildUserTurnContent } from './voicePrompt.js';
import {
  DAILY_VOICE_SECONDS,
  IDLE_END_MS,
  MIN_UTTERANCE_SPEECH_MS,
  PRE_ROLL_MS,
  STT_LOW_CONFIDENCE,
  VOICE_MAX_TOKENS,
  VOICE_MODEL,
} from './voiceConfig.js';
import type { SttUtterance } from './stt/SpeechToTextProvider.js';
import type { VoiceSessionContext, VoiceSessionService } from './VoiceSessionService.js';

/** What the controller gives the session to talk to its socket. */
export interface VoiceSocketSink {
  sendEvent(event: VoiceServerEvent): void;
  sendAudio(frame: Buffer): void;
  close(code?: number, reason?: string): void;
}

/** A fixed, neutral line spoken when the whole model chain refuses (§ 6.1). */
const REFUSAL_LINE = '这个我们换个话题吧。你今天过得怎么样？';
/** A fixed line spoken when Claude errors out mid-turn, so the learner is not left in silence. */
const ERROR_LINE = '不好意思，我刚才没听清楚。你可以再说一遍吗？';
/** Upper bound on tool round-trips in one reply (note_recast is the only tool). */
const MAX_TOOL_ROUNDS = 3;
/** Grace after the last sentence's estimated end before listening resumes without a client report. */
const PLAYBACK_GRACE_MS = 1500;

/**
 * LiveVoiceSession — one learner's live voice conversation: the turn state machine of
 * docs/VOICE_ASSISTANT.md § 4.1, one instance per WebSocket.
 *
 *   LISTENING ──(endpoint)──► THINKING ──(first audio sent)──► SPEAKING ──(playback ended)──► LISTENING
 *       ▲                         │                                │
 *       └──────── interrupt ──────┴────────── interrupt ───────────┘
 *
 * Listening: every mic frame goes through the Endpointer (endpointer.ts). Speech onset opens
 * one STT stream per utterance (with the pre-roll), the endpoint half-closes it for the final
 * transcript. While THINKING/SPEAKING the mic is treated as possible echo of the tutor and only
 * kept in a short ring buffer; the CLIENT's local VAD decides a real barge-in and sends
 * `interrupt`, at which point the ring is replayed into a fresh utterance so the learner's first
 * words are not lost.
 *
 * A reply: Claude streams (Opus 5.5, low effort, refusal fallbacks), text deltas are cut into
 * sentences (SentenceChunker), each sentence is synthesized AS SOON AS it exists (so N+1
 * synthesizes while N plays) but SENT in order through a promise chain. An interrupt aborts
 * the stream and the chain via one AbortController per turn and bumps `turnId` so the client
 * drops audio already in flight.
 *
 * History: the full assistant content (thinking blocks included) is appended after a complete
 * reply — Opus 5.5 ties thinking blocks to the conversation, so they are passed back unchanged.
 * An interrupted reply is appended as plain text of what was actually SPOKEN, which is what
 * the learner heard.
 *
 * Layer: service (orchestrator). Writes no SQL — persistence goes through VoiceSessionService.
 * Constructed by server/controllers/VoiceSessionController.ts.
 */
export class LiveVoiceSession {
  private state: VoiceOrbState = 'listening';
  private readonly endpointer = new Endpointer();
  private utterance: SttUtterance | null = null;
  /** Mic frames kept while not listening, replayed on barge-in. */
  private readonly echoRing: Buffer[] = [];
  private readonly echoRingFrames = Math.ceil(PRE_ROLL_MS / FRAME_MS) + 10;

  private readonly messages: Anthropic.Beta.BetaMessageParam[] = [];
  /** Mid-conversation notes (card adds) waiting to follow the next user message. */
  private pendingSystemNotes: string[] = [];

  private turnIndex = 0;
  private turnId = 0;
  private turnAbort: AbortController | null = null;
  /** The reply being generated / sent, so an interrupt can save what was actually spoken. */
  private currentReply: { turnIndex: number; spoken: string[] } | null = null;
  private playbackTimer: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;

  private userSeconds = 0;
  private assistantSeconds = 0;
  private readonly recasts: VoiceRecast[] = [];
  private readonly cardWordsUsed = new Map<string, VoiceWordMatch>();
  private voice: TutorVoiceRole;
  private ending = false;
  private ended = false;
  private finalizePromise: Promise<VoiceSessionSummary | null> | null = null;

  constructor(
    private readonly service: VoiceSessionService,
    private readonly ctx: VoiceSessionContext,
    private readonly sink: VoiceSocketSink,
  ) {
    this.voice = ctx.voice;
  }

  /** Announce readiness and start listening. */
  start(): void {
    this.sink.sendEvent({
      type: 'ready',
      sessionId: this.ctx.session.id,
      secondsRemaining: this.service.secondsRemaining(this.ctx, 0),
    });
    this.setState('listening');
    this.armIdleTimer();
  }

  // ── Inbound ────────────────────────────────────────────────────────────────

  onAudio(frame: Buffer): void {
    if (this.ended || this.ending) return;
    if (this.state !== 'listening') {
      this.echoRing.push(frame);
      if (this.echoRing.length > this.echoRingFrames) this.echoRing.shift();
      return;
    }
    const ev = this.endpointer.push(frame);
    if (ev?.type === 'speechStart') {
      this.openUtterance(ev.preRoll);
    } else if (this.endpointer.speaking) {
      this.utterance?.write(frame);
    }
    if (ev?.type === 'speechEnd') {
      void this.closeUtterance(ev.speechMs).catch((err) => this.fail('closeUtterance', err));
    }
  }

  /** Client VAD heard the learner over the tutor: stop talking, start listening (§ 4.4). */
  onInterrupt(): void {
    if (this.ended || this.ending || this.state === 'listening') return;
    this.abortTurn(true);
    this.setState('listening');
    this.endpointer.reset();
    const ev = this.endpointer.forceStart();
    if (ev?.type === 'speechStart') this.openUtterance(this.echoRing.splice(0));
  }

  onSetVoice(voice: TutorVoiceRole): void {
    this.voice = voice;
  }

  onPlaybackEnded(turnId: number): void {
    if (turnId !== this.turnId || this.state !== 'speaking') return;
    this.toListening();
  }

  onCardAdded(word: string): void {
    const w = word.trim().slice(0, 20);
    if (w) this.pendingSystemNotes.push(`The learner just added ${w} to their flashcards from the transcript. You may use it naturally; do not mention flashcards.`);
  }

  /** The learner tapped End: finalize, send the end card, close. */
  async onEnd(): Promise<void> {
    const summary = await this.finalize();
    if (summary) this.sink.sendEvent({ type: 'ended', summary });
    this.sink.close(1000, 'ended');
  }

  /** The socket closed (any reason): finalize quietly. */
  onClose(): void {
    void this.finalize();
  }

  // ── Utterances ─────────────────────────────────────────────────────────────

  private openUtterance(preRoll: Buffer[]): void {
    this.utterance?.abort();
    this.clearIdleTimer();
    const utterance = this.service.stt.openUtterance({
      phraseHints: this.ctx.phraseHints,
      onPartial: (text) => {
        if (this.utterance !== utterance) return;
        this.endpointer.setPartial(text);
        this.sink.sendEvent({ type: 'userPartial', text });
      },
    });
    this.utterance = utterance;
    for (const f of preRoll) utterance.write(f);
  }

  private async closeUtterance(speechMs: number): Promise<void> {
    const utterance = this.utterance;
    this.utterance = null;
    if (!utterance) return;
    if (speechMs < MIN_UTTERANCE_SPEECH_MS) {
      utterance.abort();
      this.armIdleTimer();
      return;
    }
    this.setState('thinking');
    const result = await utterance.finish();
    if (this.ended || this.ending) return;
    // A barge-in or a newer utterance superseded this one while STT was finishing.
    if (this.state !== 'thinking' || this.turnAbort) return;
    const text = result.text.trim();
    if (!text) {
      this.toListening();
      return;
    }
    this.userSeconds += speechMs / 1000;
    const lowConfidence = (result.words ?? [])
      .filter((w) => w.confidence !== null && w.confidence < STT_LOW_CONFIDENCE && /\p{Script=Han}/u.test(w.word))
      .map((w) => w.word);
    await this.handleUserFinal(text, lowConfidence);
  }

  private async handleUserFinal(text: string, lowConfidence: string[]): Promise<void> {
    const turnIndex = this.turnIndex++;
    const { parts, matches } = await this.service.segmentAndMatch(this.ctx.userId, this.ctx.language, [text]);
    for (const [word, match] of Object.entries(matches)) this.cardWordsUsed.set(word, match);
    this.sink.sendEvent({ type: 'userFinal', turnIndex, text, parts: parts[0] ?? null, lowConfidenceWords: lowConfidence, matches });
    this.persist({ turnIndex, role: 'user', text, lowConfidenceWords: lowConfidence });

    this.messages.push({ role: 'user', content: buildUserTurnContent(text, matches, lowConfidence) });
    // Mid-conversation system messages must follow a user message (§ 6.3).
    for (const note of this.pendingSystemNotes.splice(0)) {
      this.messages.push({ role: 'system', content: note } as unknown as Anthropic.Beta.BetaMessageParam);
    }
    if (this.capExceeded()) return this.endForCap();
    await this.runAssistantTurn();
  }

  // ── The tutor's reply ──────────────────────────────────────────────────────

  private async runAssistantTurn(): Promise<void> {
    const turnId = ++this.turnId;
    const turnIndex = this.turnIndex++;
    const abort = new AbortController();
    this.turnAbort = abort;
    this.setState('thinking');

    const chunker = new SentenceChunker();
    const spoken: string[] = [];
    this.currentReply = { turnIndex, spoken };
    let sentenceIndex = 0;
    let recast: VoiceRecast | null = null;
    // Ordered send chain; each sentence's synthesis starts the moment it exists.
    let sendChain: Promise<void> = Promise.resolve();
    let lastAudioEndsAt = Date.now();

    const enqueue = (sentence: string) => {
      const index = sentenceIndex++;
      const clipPromise = this.service.tts
        .synthesize(sentence, this.voice, this.ctx.speakingRate, abort.signal)
        .catch((err) => {
          if (!abort.signal.aborted) console.error('[voice] TTS failed:', err instanceof Error ? err.message : err);
          return null;
        });
      sendChain = sendChain.then(async () => {
        const clip = await clipPromise;
        if (abort.signal.aborted || !clip) return;
        const { parts, matches } = await this.service
          .segmentAndMatch(this.ctx.userId, this.ctx.language, [sentence])
          .catch(() => ({ parts: [null], matches: {} as Record<string, VoiceWordMatch> }));
        if (abort.signal.aborted) return;
        this.sink.sendEvent({ type: 'assistantText', turnId, turnIndex, sentenceIndex: index, text: sentence, parts: parts[0] ?? null, matches });
        const header = Buffer.alloc(VOICE_AUDIO_HEADER_BYTES);
        header.writeUInt32BE(turnId, 0);
        header.writeUInt32BE(index, 4);
        this.sink.sendAudio(Buffer.concat([header, clip.audio]));
        spoken.push(sentence);
        this.assistantSeconds += clip.durationSeconds;
        lastAudioEndsAt = Math.max(lastAudioEndsAt, Date.now()) + clip.durationSeconds * 1000;
        if (this.state === 'thinking') this.setState('speaking');
      });
    };

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const requestedAt = Date.now();
        let firstTokenMs: number | null = null;
        const stream = this.ctx.anthropic.beta.messages.stream(this.buildRequest() as any, { signal: abort.signal });
        stream.on('text', (delta: string) => {
          if (firstTokenMs === null) firstTokenMs = Date.now() - requestedAt;
          for (const s of chunker.push(delta)) enqueue(s);
        });
        const final = await stream.finalMessage();
        if (abort.signal.aborted) return;
        // Rollout telemetry (§ 6.4): a cache_read of 0 after the first turn means something
        // volatile crept into the prefix; firstTokenMs is the Claude share of the latency budget.
        const usage = final.usage as unknown as Record<string, number | null>;
        console.log(
          `[voice] turn ${turnId} round ${round}: ttft=${firstTokenMs ?? '—'}ms total=${Date.now() - requestedAt}ms ` +
          `in=${usage.input_tokens} cacheRead=${usage.cache_read_input_tokens ?? 0} cacheWrite=${usage.cache_creation_input_tokens ?? 0} ` +
          `out=${usage.output_tokens} stop=${final.stop_reason}`,
        );

        if (final.stop_reason === 'refusal') {
          console.warn('[voice] reply refused:', (final as any).stop_details?.category ?? 'unknown');
          chunker.flush();
          enqueue(REFUSAL_LINE);
          this.messages.push({ role: 'assistant', content: REFUSAL_LINE });
          break;
        }
        for (const s of chunker.flush()) enqueue(s);
        // Pass the full content (thinking blocks included) back unchanged.
        this.messages.push({ role: 'assistant', content: final.content as Anthropic.Beta.BetaContentBlockParam[] });
        if (final.stop_reason === 'max_tokens') console.warn('[voice] reply hit max_tokens — a prompt bug (§ 6.1)');

        const toolUses = final.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
        if (final.stop_reason !== 'tool_use' || toolUses.length === 0) break;

        // Every tool_use gets its tool_result in ONE user message.
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = toolUses.map((use) => {
          if (use.name !== NOTE_RECAST_TOOL_NAME) {
            return { type: 'tool_result', tool_use_id: use.id, content: 'Unknown tool.', is_error: true };
          }
          const parsed = parseRecastInput(use.input);
          if (!parsed) return { type: 'tool_result', tool_use_id: use.id, content: 'INVALID_JSON: input did not match the schema.', is_error: true };
          recast = parsed;
          return { type: 'tool_result', tool_use_id: use.id, content: 'noted' };
        });
        this.messages.push({ role: 'user', content: results });
        // note_recast is silent bookkeeping: once the reply has said something, do NOT ask
        // for a continuation — the model would re-explain the recast (seen 2026-11-21: "I
        // added two words…"). The tool_result stays at the end of the history and merges
        // with the learner's next line (consecutive user messages are combined). Only a reply
        // that called the tool BEFORE saying anything gets another round.
        if (sentenceIndex > 0) break;
      }
    } catch (err) {
      if (abort.signal.aborted) return;
      console.error('[voice] Claude stream failed:', err instanceof Error ? err.message : err);
      if (spoken.length === 0 && sentenceIndex === 0) {
        enqueue(ERROR_LINE);
        this.messages.push({ role: 'assistant', content: ERROR_LINE });
      } else {
        this.messages.push({ role: 'assistant', content: spoken.join('') || ERROR_LINE });
      }
    }

    await sendChain;
    if (abort.signal.aborted || this.turnAbort !== abort) return;
    this.turnAbort = null;
    this.currentReply = null;

    const text = spoken.join('');
    if (recast) {
      this.recasts.push(recast);
      this.sink.sendEvent({ type: 'recast', turnIndex, recast });
    }
    this.persist({ turnIndex, role: 'assistant', text, recast, interrupted: false });
    this.sink.sendEvent({ type: 'turnEnd', turnId, interrupted: false });

    if (this.capExceeded()) return this.endForCap();
    if (this.state === 'speaking') {
      // Wait for the client's playbackEnded; fall back to the estimated end of the audio.
      this.clearPlaybackTimer();
      this.playbackTimer = setTimeout(() => {
        if (this.turnId === turnId && this.state === 'speaking') this.toListening();
      }, Math.max(0, lastAudioEndsAt - Date.now()) + PLAYBACK_GRACE_MS);
    } else {
      this.toListening();
    }
  }

  /** The request body. Stable prefix first: system prompt, then the profile (§ 6.4). */
  private buildRequest(): Record<string, unknown> {
    return {
      model: VOICE_MODEL,
      max_tokens: VOICE_MAX_TOKENS,
      system: [
        { type: 'text', text: VOICE_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: this.ctx.profileBlock, cache_control: { type: 'ephemeral' } },
      ],
      // Auto-cache the growing history too (the third of four breakpoints).
      cache_control: { type: 'ephemeral' },
      tools: [NOTE_RECAST_TOOL],
      messages: this.messages,
      // Thinking cannot be disabled on Opus 5.5; low effort is the latency control (§ 6.1).
      output_config: { effort: 'low' },
      // Server-side refusal fallbacks, routed by category (§ 6.1).
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    };
  }

  /**
   * Stop the reply in flight. When `interrupted`, the part the learner actually heard is
   * kept: appended to the history as plain text and saved with `interrupted = true`.
   */
  private abortTurn(interrupted: boolean): void {
    this.clearPlaybackTimer();
    const abort = this.turnAbort;
    if (!abort) {
      // Already done generating — the learner cut into the tail of playback. Mark the last
      // saved reply? It is persisted already; just tell the client.
      if (interrupted && this.state === 'speaking') this.sink.sendEvent({ type: 'turnEnd', turnId: this.turnId, interrupted: true });
      this.turnId++;
      return;
    }
    abort.abort();
    this.turnAbort = null;
    const reply = this.currentReply;
    this.currentReply = null;
    const turnId = this.turnId;
    this.turnId++; // the client drops any audio still tagged with the old id
    if (interrupted) {
      this.sink.sendEvent({ type: 'turnEnd', turnId, interrupted: true });
      const heard = reply?.spoken.join('') ?? '';
      // Keep the history valid and truthful: if the reply never got appended (the stream was
      // cut mid-generation), append what the learner actually heard.
      const last = this.messages[this.messages.length - 1];
      if (last && last.role !== 'assistant') this.messages.push({ role: 'assistant', content: heard || '……' });
      if (reply) this.persist({ turnIndex: reply.turnIndex, role: 'assistant', text: heard, interrupted: true });
    }
  }

  // ── State, timers, cap ─────────────────────────────────────────────────────

  private setState(state: VoiceOrbState): void {
    if (this.state === state && state !== 'listening') return;
    this.state = state;
    this.sink.sendEvent({ type: 'state', state });
  }

  private toListening(): void {
    this.clearPlaybackTimer();
    this.echoRing.length = 0;
    this.endpointer.reset();
    this.setState('listening');
    this.armIdleTimer();
  }

  private armIdleTimer(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      if (this.state === 'listening' && !this.endpointer.speaking) void this.onEnd();
    }, IDLE_END_MS);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private clearPlaybackTimer(): void {
    if (this.playbackTimer) clearTimeout(this.playbackTimer);
    this.playbackTimer = null;
  }

  private capExceeded(): boolean {
    return this.ctx.secondsUsedBefore + this.userSeconds + this.assistantSeconds >= DAILY_VOICE_SECONDS;
  }

  private async endForCap(): Promise<void> {
    this.sink.sendEvent({
      type: 'error',
      code: 'capReached',
      message: "That's today's voice practice time. Come back tomorrow!",
      fatal: true,
    });
    await this.onEnd();
  }

  private persist(turn: Parameters<VoiceSessionService['recordTurn']>[1]): void {
    void this.service.recordTurn(this.ctx.session.id, turn).catch((err) => {
      console.error('[voice] failed to save turn:', err instanceof Error ? err.message : err);
    });
  }

  private fail(where: string, err: unknown): void {
    console.error(`[voice] ${where} failed:`, err instanceof Error ? err.message : err);
    if (!this.ended && !this.ending) this.toListening();
  }

  /** Idempotent: abort everything in flight, write totals, build the end card. */
  private finalize(): Promise<VoiceSessionSummary | null> {
    if (this.finalizePromise) return this.finalizePromise;
    this.ending = true;
    this.clearIdleTimer();
    this.clearPlaybackTimer();
    this.turnAbort?.abort();
    this.turnAbort = null;
    this.utterance?.abort();
    this.utterance = null;
    this.finalizePromise = this.service
      .finalizeSession(this.ctx, {
        userSeconds: this.userSeconds,
        assistantSeconds: this.assistantSeconds,
        turnCount: this.turnIndex,
        recasts: this.recasts,
        cardWordsUsed: this.cardWordsUsed,
      })
      .catch((err) => {
        console.error('[voice] finalize failed:', err instanceof Error ? err.message : err);
        return null;
      })
      .finally(() => {
        this.ended = true;
      });
    return this.finalizePromise;
  }
}
