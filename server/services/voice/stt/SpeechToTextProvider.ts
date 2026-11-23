/**
 * Streaming speech-to-text behind an interface (docs/VOICE_ASSISTANT.md § 2, § 5.1).
 *
 * The voice session opens ONE stream per learner utterance: LiveVoiceSession's endpointer
 * decides when the utterance starts and ends (see endpointer.ts for why Google's own
 * endpointing is not used), streams its frames in, and calls `finish()` to half-close the
 * stream and get the final transcript.
 *
 * Keeping this an interface is the § 5.1 "known risk" mitigation: if real learner speech
 * transcribes poorly, another vendor's adapter can be compared on the same saved speech.
 *
 * Layer: service adapter (interface). The one implementation: GoogleChirpStt.ts.
 */

export interface SttWord {
  word: string;
  /** 0…1, or null when the model did not report one. */
  confidence: number | null;
}

export interface SttResult {
  text: string;
  /** Per-word confidences, when the model provides them; null otherwise. */
  words: SttWord[] | null;
}

export interface SttUtteranceOptions {
  /** Words to bias recognition toward (the learner's Learning cards, § 5.1). */
  phraseHints: string[];
  /** Live partial transcript, for the caption and the endpointer's filler holds. */
  onPartial?: (text: string) => void;
}

export interface SttUtterance {
  /** Stream one PCM16 16 kHz mono frame. Safe to call before the stream is ready (buffered). */
  write(frame: Buffer): void;
  /** Half-close and resolve with the final transcript (empty text when nothing was heard). */
  finish(): Promise<SttResult>;
  /** Tear the stream down without waiting for a result (barge-in, session end). */
  abort(): void;
}

export interface SpeechToTextProvider {
  readonly available: boolean;
  openUtterance(options: SttUtteranceOptions): SttUtterance;
}
