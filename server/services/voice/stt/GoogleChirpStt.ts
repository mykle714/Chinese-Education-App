import fs from 'fs';
import { v2 as speechV2 } from '@google-cloud/speech';
import { STT_LANGUAGE_CODES, STT_LOCATION, STT_MODEL } from '../voiceConfig.js';
import type {
  SpeechToTextProvider,
  SttResult,
  SttUtterance,
  SttUtteranceOptions,
  SttWord,
} from './SpeechToTextProvider.js';

/**
 * Google Speech-to-Text v2 streaming recognition with Chirp 3 (docs/VOICE_ASSISTANT.md § 5.1).
 *
 * Settings: chirp_3 in the `us` multi-region with languageCodes [cmn-Hans-CN, en-US], so a
 * Chinglish utterance keeps its English words (the v1 models pick ONE language per utterance).
 * Verified streaming 2026-11-21 (server/scripts/voice-bench/stt-stream-spike.ts): exact
 * transcript of a code-switched line; ~0.65 s from half-close to the final result at
 * real-time pacing. Speech adaptation (phrase hints) is accepted; word confidence is NOT.
 *
 * Optional features degrade instead of failing: phrase hints (speech adaptation) and word
 * confidence are requested, and if Google rejects the config (INVALID_ARGUMENT) the stream is
 * retried without them, one feature at a time, and each rejected feature is switched off for
 * the life of the process.
 *
 * Auth: the same service account as TTSService (GOOGLE_APPLICATION_CREDENTIALS). The
 * project id is read from that key file. Uses the dependency `@google-cloud/speech` (gRPC).
 *
 * Layer: service adapter. Constructed in server/dal/setup.ts, used by LiveVoiceSession.
 */
export class GoogleChirpStt implements SpeechToTextProvider {
  private client: InstanceType<typeof speechV2.SpeechClient> | null = null;
  private projectId: string | null = null;
  /** Switched off on the first rejection (see class comment). */
  private adaptationSupported = true;
  /**
   * OFF from the start: chirp_3 rejects `enableWordConfidence` (measured 2026-11-21), so
   * asking would cost every process's first utterance a failed stream + retry. The consequence
   * is that § 5.1's low-confidence `[?]` annotations and the transcript's "unsure" underline
   * have no data on this model. Flip to true when switching to a model that reports it.
   */
  private wordConfidenceSupported = false;

  constructor(private readonly credentialsPath: string | undefined = process.env.GOOGLE_APPLICATION_CREDENTIALS) {}

  get available(): boolean {
    return !!this.credentialsPath && fs.existsSync(this.credentialsPath);
  }

  private ensureClient(): { client: InstanceType<typeof speechV2.SpeechClient>; recognizer: string } {
    if (!this.credentialsPath) throw new Error('GoogleChirpStt: GOOGLE_APPLICATION_CREDENTIALS is not set');
    if (!this.client) {
      this.projectId = JSON.parse(fs.readFileSync(this.credentialsPath, 'utf8')).project_id;
      this.client = new speechV2.SpeechClient({
        keyFilename: this.credentialsPath,
        apiEndpoint: `${STT_LOCATION}-speech.googleapis.com`,
      });
    }
    return { client: this.client, recognizer: `projects/${this.projectId}/locations/${STT_LOCATION}/recognizers/_` };
  }

  openUtterance(options: SttUtteranceOptions): SttUtterance {
    return new GoogleUtterance(this, options);
  }

  /** @internal — used by GoogleUtterance to open (and on a feature rejection, reopen) a stream. */
  openStream(useAdaptation: boolean, useWordConfidence: boolean, phraseHints: string[]) {
    const { client, recognizer } = this.ensureClient();
    const stream = client._streamingRecognize();
    const hints = useAdaptation && this.adaptationSupported ? phraseHints.filter(Boolean) : [];
    stream.write({
      recognizer,
      streamingConfig: {
        config: {
          explicitDecodingConfig: { encoding: 'LINEAR16', sampleRateHertz: 16000, audioChannelCount: 1 },
          languageCodes: STT_LANGUAGE_CODES,
          model: STT_MODEL,
          features: {
            enableAutomaticPunctuation: true,
            ...(useWordConfidence && this.wordConfidenceSupported ? { enableWordConfidence: true } : {}),
          },
          ...(hints.length
            ? { adaptation: { phraseSets: [{ inlinePhraseSet: { phrases: hints.map((value) => ({ value, boost: 5 })) } }] } }
            : {}),
        },
        streamingFeatures: { interimResults: true },
      },
    });
    return { stream, usedAdaptation: hints.length > 0, usedWordConfidence: useWordConfidence && this.wordConfidenceSupported };
  }

  /** @internal — a feature was rejected for this model; stop requesting it. */
  disableFeature(feature: 'adaptation' | 'wordConfidence'): void {
    if (feature === 'adaptation') this.adaptationSupported = false;
    else this.wordConfidenceSupported = false;
    console.warn(`[voice] GoogleChirpStt: ${feature} rejected by ${STT_MODEL}; disabled for this process`);
  }
}

/**
 * One utterance's stream. Frames written before a feature-rejection retry are kept and
 * replayed into the new stream, so a retry never loses the start of what the learner said.
 */
class GoogleUtterance implements SttUtterance {
  private stream: ReturnType<GoogleChirpStt['openStream']>['stream'] | null = null;
  private frames: Buffer[] = [];
  private finals: string[] = [];
  private words: SttWord[] = [];
  private sawWordConfidence = false;
  private finished = false;
  private aborted = false;
  private retries = 0;
  private resolveFinish: ((r: SttResult) => void) | null = null;
  private readonly done: Promise<SttResult>;

  constructor(private readonly provider: GoogleChirpStt, private readonly options: SttUtteranceOptions) {
    this.done = new Promise((resolve) => { this.resolveFinish = resolve; });
    this.open(true, true);
  }

  private open(useAdaptation: boolean, useWordConfidence: boolean): void {
    let opened: ReturnType<GoogleChirpStt['openStream']>;
    try {
      opened = this.provider.openStream(useAdaptation, useWordConfidence, this.options.phraseHints);
    } catch (err) {
      console.error('[voice] GoogleChirpStt: failed to open stream:', err instanceof Error ? err.message : err);
      this.settle();
      return;
    }
    const { stream, usedAdaptation, usedWordConfidence } = opened;
    this.stream = stream;

    stream.on('data', (resp: any) => {
      for (const r of resp?.results ?? []) {
        const alt = r.alternatives?.[0];
        const text: string = alt?.transcript ?? '';
        if (r.isFinal) {
          if (text) this.finals.push(text);
          for (const w of alt?.words ?? []) {
            const confidence = typeof w.confidence === 'number' && w.confidence > 0 ? w.confidence : null;
            if (confidence !== null) this.sawWordConfidence = true;
            if (w.word) this.words.push({ word: String(w.word), confidence });
          }
        } else if (text) {
          this.options.onPartial?.([...this.finals, text].join(''));
        }
      }
    });
    stream.on('error', (err: Error & { code?: number }) => {
      if (this.aborted || this.stream !== stream) return;
      const msg = err.message || '';
      // INVALID_ARGUMENT (gRPC 3) — Google says only "Config contains unsupported fields", not
      // WHICH field, so peel the optional features off one at a time: adaptation first, then
      // word confidence. Each rejection switches that feature off for the process.
      if (err.code === 3 && this.retries < 2) {
        if (usedAdaptation) { this.provider.disableFeature('adaptation'); return this.retry(); }
        if (usedWordConfidence) { this.provider.disableFeature('wordConfidence'); return this.retry(); }
      }
      console.error('[voice] GoogleChirpStt stream error:', msg);
      this.stream = null;
      this.settle();
    });
    stream.on('end', () => { if (this.stream === stream) this.settle(); });

    // Replay anything already written (a retry), then honour a finish that already happened.
    for (const f of this.frames) stream.write({ audio: f });
    if (this.finished) stream.end();
  }

  private retry(): void {
    this.retries += 1;
    const dead = this.stream;
    this.stream = null;
    dead?.removeAllListeners();
    dead?.on('error', () => {});
    dead?.destroy();
    this.finals = [];
    this.words = [];
    this.open(true, true);
  }

  write(frame: Buffer): void {
    if (this.finished || this.aborted) return;
    this.frames.push(frame);
    this.stream?.write({ audio: frame });
  }

  finish(): Promise<SttResult> {
    if (!this.finished && !this.aborted) {
      this.finished = true;
      this.stream?.end();
    }
    return this.done;
  }

  abort(): void {
    if (this.aborted) return;
    this.aborted = true;
    this.stream?.removeAllListeners();
    this.stream?.on('error', () => {}); // a late gRPC CANCELLED must not crash the process
    this.stream?.destroy();
    this.frames = [];
    this.resolveFinish?.({ text: '', words: null });
  }

  private settle(): void {
    this.frames = [];
    this.resolveFinish?.({
      text: this.finals.join('').trim(),
      words: this.sawWordConfidence ? this.words : null,
    });
  }
}
