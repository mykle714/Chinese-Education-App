/**
 * Server-side voice activity detection + endpointing for the voice tutor
 * (docs/VOICE_ASSISTANT.md § 4.2).
 *
 * Why ours and not Google's: the 2026-11-21 streaming spike (server/scripts/voice-bench/
 * stt-stream-spike.ts) measured chirp_3 finalizing ~1.8 s after the speaker stopped, and
 * its interim results are sparse. So the server decides when the learner is done — an
 * energy VAD with a long silence timeout — and then half-closes the STT stream to force the
 * final transcript.
 *
 * The Endpointer is a pure state machine fed one 20 ms PCM16 frame at a time. It never does
 * I/O; LiveVoiceSession reacts to the events it returns:
 *
 *   'speechStart' — an utterance opened. `preRoll` holds the frames buffered from just
 *                   before onset (so the first syllable is not clipped); stream them to STT
 *                   first, then the current frame.
 *   'speechEnd'   — the learner finished (silence ≥ the timeout, or the utterance cap).
 *                   `speechMs` is the voiced time, for the cap accounting and noise filter.
 *
 * Holds (§ 4.2): the caller passes the latest partial transcript via `setPartial`. If it
 * ends in a filler / connective, or in a repeated word, the silence timeout is extended by
 * ENDPOINT_HOLD_MS — learners pause mid-sentence to search for a word. (Chirp's interims
 * are sparse, so in practice a hold fires only when one happens to land in the pause.)
 *
 * Layer: service (pure). Tested by server/__tests__/voiceEndpointer.test.ts.
 */
import {
  ENDPOINT_HOLD_MS,
  ENDPOINT_SILENCE_MS,
  MAX_UTTERANCE_MS,
  PRE_ROLL_MS,
  SPEECH_START_MS,
  VAD_MIN_RMS,
  VAD_NOISE_FACTOR,
} from './voiceConfig.js';

export const FRAME_MS = 20;

export type EndpointEvent =
  | { type: 'speechStart'; preRoll: Buffer[] }
  | { type: 'speechEnd'; speechMs: number; reason: 'silence' | 'maxLength' }
  | null;

/** RMS of a little-endian PCM16 buffer. Odd trailing bytes are ignored. */
export function pcm16Rms(frame: Buffer): number {
  const samples = Math.floor(frame.length / 2);
  if (samples === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const s = frame.readInt16LE(i * 2);
    sum += s * s;
  }
  return Math.sqrt(sum / samples);
}

// Fillers / connectives a learner trails off on while searching for the next word.
// Chinese ones match as a suffix; English ones as a final whole word.
// NOT included: 的 / 啊 / 那 — they end complete replies too (好的, 是啊), so a hold on them
// would stretch every such turn by ENDPOINT_HOLD_MS. 是 stays: a trailing 是 (我是…) is
// almost always mid-thought.
const ZH_FILLERS = ['那个', '这个', '就是', '然后', '是', '嗯', '呃', '额'];
const EN_FILLERS = new Set(['um', 'uh', 'erm', 'like', 'and', 'so', 'the', 'a', 'to', 'is', 'but']);

/**
 * True when a partial transcript ends in a way that says "I'm not done": a filler or
 * connective, or a repeated word / syllable (`我我`, `那个那个`, `the the`). Exported for tests.
 */
export function partialSuggestsHold(partial: string): boolean {
  const text = partial.replace(/[\s。，、！？.,!?…~-]+$/u, '').trim();
  if (!text) return false;
  if (ZH_FILLERS.some((f) => text.endsWith(f))) return true;
  const words = text.toLowerCase().split(/\s+/);
  const last = words[words.length - 1].replace(/[^a-z']/g, '');
  if (EN_FILLERS.has(last)) return true;
  // Repeated trailing English word.
  if (words.length >= 2 && last && words[words.length - 2].replace(/[^a-z']/g, '') === last) return true;
  // Repeated trailing Han run of 1–2 characters: 我我 / 那个那个.
  const chars = [...text];
  for (const n of [1, 2]) {
    if (chars.length >= n * 2) {
      const tail = chars.slice(-n).join('');
      const before = chars.slice(-2 * n, -n).join('');
      if (tail === before && /\p{Script=Han}/u.test(tail)) return true;
    }
  }
  return false;
}

export class Endpointer {
  private noiseFloor = VAD_MIN_RMS / VAD_NOISE_FACTOR;
  private inSpeech = false;
  private voicedRun = 0; // consecutive voiced frames before onset
  private silenceMs = 0; // trailing silence inside an utterance
  private speechMs = 0; // voiced time inside the utterance
  private utteranceMs = 0;
  private partial = '';
  private readonly preRoll: Buffer[] = [];
  private readonly preRollFrames = Math.ceil(PRE_ROLL_MS / FRAME_MS);
  private readonly startFrames = Math.ceil(SPEECH_START_MS / FRAME_MS);

  /** Whether an utterance is open (frames should be streamed to STT). */
  get speaking(): boolean {
    return this.inSpeech;
  }

  /** The latest partial transcript of the open utterance, for the filler/repeat holds. */
  setPartial(text: string): void {
    this.partial = text;
  }

  /** Drop any open utterance and buffered audio (barge-in handling, session reset). */
  reset(): void {
    this.inSpeech = false;
    this.voicedRun = 0;
    this.silenceMs = 0;
    this.speechMs = 0;
    this.utteranceMs = 0;
    this.partial = '';
    this.preRoll.length = 0;
  }

  /**
   * Force an utterance open now (barge-in): the client's VAD already heard speech, so the
   * buffered pre-roll is handed back for streaming without waiting for SPEECH_START_MS.
   */
  forceStart(): EndpointEvent {
    if (this.inSpeech) return null;
    this.inSpeech = true;
    this.silenceMs = 0;
    this.speechMs = 0;
    this.utteranceMs = 0;
    const preRoll = this.preRoll.splice(0);
    return { type: 'speechStart', preRoll };
  }

  /** Feed one ~20 ms frame. Returns the event it triggers, if any. */
  push(frame: Buffer): EndpointEvent {
    const rms = pcm16Rms(frame);
    const voiced = rms > Math.max(VAD_MIN_RMS, this.noiseFloor * VAD_NOISE_FACTOR);

    if (!this.inSpeech) {
      // Track the noise floor only on unvoiced frames (slow EMA), so speech never raises it.
      if (!voiced) this.noiseFloor = this.noiseFloor * 0.95 + rms * 0.05;
      this.preRoll.push(frame);
      if (this.preRoll.length > this.preRollFrames) this.preRoll.shift();
      this.voicedRun = voiced ? this.voicedRun + 1 : 0;
      if (this.voicedRun >= this.startFrames) {
        this.inSpeech = true;
        this.voicedRun = 0;
        this.silenceMs = 0;
        this.speechMs = this.startFrames * FRAME_MS;
        this.utteranceMs = this.preRoll.length * FRAME_MS;
        this.partial = '';
        // The current frame is the last pre-roll entry; the caller streams them all.
        return { type: 'speechStart', preRoll: this.preRoll.splice(0) };
      }
      return null;
    }

    this.utteranceMs += FRAME_MS;
    if (voiced) {
      this.speechMs += FRAME_MS;
      this.silenceMs = 0;
    } else {
      this.silenceMs += FRAME_MS;
    }

    if (this.utteranceMs >= MAX_UTTERANCE_MS) return this.end('maxLength');
    const timeout = ENDPOINT_SILENCE_MS + (partialSuggestsHold(this.partial) ? ENDPOINT_HOLD_MS : 0);
    if (this.silenceMs >= timeout) return this.end('silence');
    return null;
  }

  private end(reason: 'silence' | 'maxLength'): EndpointEvent {
    const speechMs = this.speechMs;
    this.inSpeech = false;
    this.silenceMs = 0;
    this.speechMs = 0;
    this.utteranceMs = 0;
    this.partial = '';
    return { type: 'speechEnd', speechMs, reason };
  }
}
