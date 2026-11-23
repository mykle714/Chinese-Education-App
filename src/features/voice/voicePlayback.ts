/**
 * voicePlayback — plays the tutor's sentences gaplessly, in order, and stops instantly on a
 * barge-in (docs/VOICE_ASSISTANT.md § 4.4, § 8).
 *
 * Each S→C audio frame is one sentence's MP3. They are decoded as they arrive and scheduled
 * back to back on the shared AudioContext's clock, so sentence N+1 starts exactly when N
 * ends. Every clip carries its `turnId`; `stop()` cuts everything playing or queued, and
 * `dropTurnsBefore` makes late-arriving audio from an interrupted turn a no-op.
 *
 * `onDrained(turnId)` fires when the last scheduled clip of a turn finishes — the hook turns
 * it into the `playbackEnded` message once the server has also said the turn is complete.
 * `isRecentSentenceStart()` lets the local VAD ignore the first ~150 ms of each sentence,
 * where an echo-cancelled speaker is most likely to leak (§ 12).
 *
 * Layer: feature audio helper (src/features/voice). Used by useVoiceSession.ts.
 */

const ECHO_GUARD_MS = 150;

export class VoicePlayback {
  private nextStartAt = 0;
  private readonly sources = new Set<AudioBufferSourceNode>();
  private minTurnId = 0;
  private decodeChain: Promise<void> = Promise.resolve();
  private lastSentenceStartedAt = -Infinity;
  private readonly pendingPerTurn = new Map<number, number>();

  private readonly context: AudioContext;
  private readonly onDrained: (turnId: number) => void;
  private readonly onPlayingChange?: (playing: boolean) => void;

  constructor(
    context: AudioContext,
    onDrained: (turnId: number) => void,
    onPlayingChange?: (playing: boolean) => void,
  ) {
    this.context = context;
    this.onDrained = onDrained;
    this.onPlayingChange = onPlayingChange;
  }

  /** True while any clip is playing or scheduled. */
  get playing(): boolean {
    return this.sources.size > 0;
  }

  /** Queue one sentence. Decoding is serialized so clips always play in arrival order. */
  enqueue(turnId: number, mp3: ArrayBuffer): void {
    if (turnId < this.minTurnId) return;
    this.pendingPerTurn.set(turnId, (this.pendingPerTurn.get(turnId) ?? 0) + 1);
    this.decodeChain = this.decodeChain
      .then(async () => {
        const buffer = await this.context.decodeAudioData(mp3);
        if (turnId < this.minTurnId) return this.settle(turnId);
        const source = this.context.createBufferSource();
        source.buffer = buffer;
        source.connect(this.context.destination);
        const startAt = Math.max(this.context.currentTime + 0.02, this.nextStartAt);
        this.nextStartAt = startAt + buffer.duration;
        // Wall-clock moment this sentence begins, for the echo guard.
        const delayMs = (startAt - this.context.currentTime) * 1000;
        window.setTimeout(() => { this.lastSentenceStartedAt = performance.now(); }, Math.max(0, delayMs));
        source.onended = () => {
          this.sources.delete(source);
          if (this.sources.size === 0) this.onPlayingChange?.(false);
          this.settle(turnId);
        };
        this.sources.add(source);
        if (this.sources.size === 1) this.onPlayingChange?.(true);
        source.start(startAt);
      })
      .catch((err) => {
        console.error('voicePlayback: could not decode a clip', err);
        this.settle(turnId);
      });
  }

  /** Cut everything now and ignore audio from turns up to and including `turnId`. */
  stop(turnId: number): void {
    this.dropTurnsBefore(turnId + 1);
    for (const s of this.sources) {
      s.onended = null;
      try { s.stop(); } catch { /* not started yet */ }
    }
    this.sources.clear();
    this.pendingPerTurn.clear();
    this.nextStartAt = 0;
    this.onPlayingChange?.(false);
  }

  dropTurnsBefore(turnId: number): void {
    this.minTurnId = Math.max(this.minTurnId, turnId);
  }

  /** Within the echo guard window after a sentence began playing. */
  isRecentSentenceStart(): boolean {
    return performance.now() - this.lastSentenceStartedAt < ECHO_GUARD_MS;
  }

  /** Whether every clip received for `turnId` has finished. */
  isTurnDrained(turnId: number): boolean {
    return (this.pendingPerTurn.get(turnId) ?? 0) === 0;
  }

  private settle(turnId: number): void {
    const left = (this.pendingPerTurn.get(turnId) ?? 1) - 1;
    if (left <= 0) {
      this.pendingPerTurn.delete(turnId);
      this.onDrained(turnId);
    } else {
      this.pendingPerTurn.set(turnId, left);
    }
  }
}
