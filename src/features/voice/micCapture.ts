/**
 * micCapture — the voice tutor's microphone: getUserMedia → AudioWorklet → 16 kHz PCM16
 * frames of 20 ms (640 bytes), plus a per-frame loudness for the local barge-in VAD
 * (docs/VOICE_ASSISTANT.md § 8).
 *
 *   - Echo cancellation stays ON (with noise suppression and auto gain): without it the
 *     tutor's own voice from the speaker would trigger barge-in.
 *   - The worklet downsamples from the context's rate (usually 48 kHz) to 16 kHz by averaging
 *     — adequate for speech recognition, and dependency-free.
 *   - The worklet source is inlined and loaded from a Blob URL, so no bundler config or
 *     public asset is needed.
 *
 * Web only (Q4). The iOS audio-session notes in § 8 apply once the native shell is in scope.
 *
 * Layer: feature audio helper (src/features/voice). Used by useVoiceSession.ts.
 */
import { VOICE_INPUT_FRAME_BYTES, VOICE_INPUT_SAMPLE_RATE } from '../../../server/contracts/voice';

const WORKLET_NAME = 'voice-pcm16-capture';

/** AudioWorkletProcessor source: resample to 16 kHz, emit Int16 frames + their RMS (0…1). */
const WORKLET_SOURCE = `
class VoicePcm16Capture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.ratio = sampleRate / ${VOICE_INPUT_SAMPLE_RATE};
    this.frameSamples = ${VOICE_INPUT_FRAME_BYTES / 2};
    this.frame = new Int16Array(this.frameSamples);
    this.filled = 0;
    this.acc = 0;
    this.accCount = 0;
    this.pos = 0;
    this.sumSq = 0;
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      this.acc += input[i];
      this.accCount++;
      this.pos += 1;
      if (this.pos >= this.ratio) {
        this.pos -= this.ratio;
        const v = Math.max(-1, Math.min(1, this.acc / this.accCount));
        this.acc = 0;
        this.accCount = 0;
        this.sumSq += v * v;
        this.frame[this.filled++] = v < 0 ? v * 0x8000 : v * 0x7fff;
        if (this.filled === this.frameSamples) {
          const rms = Math.sqrt(this.sumSq / this.frameSamples);
          this.port.postMessage({ pcm: this.frame.buffer, rms }, [this.frame.buffer]);
          this.frame = new Int16Array(this.frameSamples);
          this.filled = 0;
          this.sumSq = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('${WORKLET_NAME}', VoicePcm16Capture);
`;

export interface MicCapture {
  /** Stop the mic and release the device (the OS recording indicator goes off). */
  stop(): void;
  /** Pause sending without releasing the device (Mute mic). */
  setMuted(muted: boolean): void;
}

export interface MicFrame {
  pcm: ArrayBuffer;
  /** Frame loudness, RMS of samples in −1…1. */
  rms: number;
}

/** Thrown when the learner (or the OS) refused microphone access. */
export class MicPermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MicPermissionError';
  }
}

/**
 * Open the mic on `context` and call `onFrame` for every 20 ms frame. The caller owns the
 * AudioContext (it is shared with playback, so one user gesture unlocks both).
 */
export async function startMicCapture(context: AudioContext, onFrame: (frame: MicFrame) => void): Promise<MicCapture> {
  if (!navigator.mediaDevices?.getUserMedia) throw new MicPermissionError('This browser cannot record audio.');
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
  } catch (err) {
    const name = err instanceof DOMException ? err.name : '';
    throw new MicPermissionError(
      name === 'NotAllowedError' || name === 'SecurityError'
        ? 'Microphone access was denied.'
        : 'Could not open the microphone.',
    );
  }

  const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
  try {
    await context.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  const source = context.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(context, WORKLET_NAME, { numberOfInputs: 1, numberOfOutputs: 0 });
  let muted = false;
  node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; rms: number }>) => {
    if (!muted) onFrame(e.data);
  };
  source.connect(node);

  return {
    stop() {
      node.port.onmessage = null;
      try { source.disconnect(); } catch { /* already disconnected */ }
      try { node.disconnect(); } catch { /* already disconnected */ }
      stream.getTracks().forEach((t) => t.stop());
    },
    setMuted(next: boolean) {
      muted = next;
      stream.getAudioTracks().forEach((t) => { t.enabled = !next; });
    },
  };
}
