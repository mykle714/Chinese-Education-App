/**
 * Voice Assistant tuning knobs, in one place (docs/VOICE_ASSISTANT.md).
 *
 * Every number here is a first guess meant to be tuned after hearing free talk work; the
 * section each one comes from is cited so a tuning pass can find the reasoning.
 *
 * Layer: service config (no I/O). Referenced by server/services/voice/*.
 */

/**
 * The tutor's brain (§ 6.1, Q8: no benchmark — start here, switch only if it feels slow).
 * `VOICE_MODEL` in the env overrides it for latency experiments on dev; production leaves it
 * unset. Measured 2026-11-21 (scripts/voice-bench/live-session-smoke.ts): Opus 5.5 at low
 * effort ≈ 2.2–2.4 s to first token, the largest share of the turn latency.
 */
export const VOICE_MODEL = process.env.VOICE_MODEL || 'claude-opus-5-5';
/** Spoken replies are short; a reply that hits this is a prompt bug (§ 6.1). */
export const VOICE_MAX_TOKENS = 1024;

// ── Endpointing (§ 4.2) ──────────────────────────────────────────────────────
/** Silence that ends a learner's turn. Longer than an English assistant's ~500 ms on purpose. */
export const ENDPOINT_SILENCE_MS = 900;
/** Extra wait after a trailing filler (那个…, um) or a repeated word (我我…). */
export const ENDPOINT_HOLD_MS = 600;
/** Speech this long (consecutive voiced frames) opens an utterance — filters clicks/coughs. */
export const SPEECH_START_MS = 120;
/** Audio kept from before speech onset, so the first syllable is not clipped. */
export const PRE_ROLL_MS = 400;
/** An utterance shorter than this (voiced time) is dropped as noise. */
export const MIN_UTTERANCE_SPEECH_MS = 250;
/** A single utterance is cut off here (Google streams cap at ~5 min; learners never need this). */
export const MAX_UTTERANCE_MS = 45_000;

// ── Energy VAD (server, § 4.2) ───────────────────────────────────────────────
/** Absolute floor for "voiced": RMS of PCM16 samples (≈ −42 dBFS). */
export const VAD_MIN_RMS = 260;
/** A frame is voiced when its RMS exceeds the tracked noise floor by this factor. */
export const VAD_NOISE_FACTOR = 3;

// ── Session limits (§ 6.5, § 12) ─────────────────────────────────────────────
/** The session auto-ends after this long with no learner speech (open-mic cost guard). */
export const IDLE_END_MS = 60_000;
/**
 * Daily voice seconds per learner (user + tutor speech). PLACEHOLDER: Q9 says measure the
 * cost per voice minute on PPE first, then set the number. 30 minutes is generous for dev.
 */
export const DAILY_VOICE_SECONDS = 30 * 60;

// ── Speech-to-text (§ 5.1) ───────────────────────────────────────────────────
/**
 * Google Speech-to-Text v2. chirp_3 streams code-switched zh/en correctly — measured
 * 2026-11-21 by server/scripts/voice-bench/stt-stream-spike.ts (it also showed Chirp only
 * finalizes ~1.8 s after the speaker stops, which is why endpointing is ours, not Google's).
 */
export const STT_MODEL = 'chirp_3';
export const STT_LOCATION = 'us';
export const STT_LANGUAGE_CODES = ['cmn-Hans-CN', 'en-US'];
/** Learning cards sent as phrase hints (top N by recency, § 5.1). */
export const STT_PHRASE_HINT_LIMIT = 200;
/** A Chinese word below this STT confidence is passed to Claude as `[?]` (§ 5.1). */
export const STT_LOW_CONFIDENCE = 0.6;

// ── Text-to-speech (§ 5.3) ───────────────────────────────────────────────────
/** Sentence boundary buffer cap: flush a sentence after this many characters (§ 4.4). */
export const SENTENCE_MAX_CHARS = 40;

// ── Learner profile (§ 6.3) ──────────────────────────────────────────────────
/** Known-word list cap (Mastered + Comfortable, most frequent first). */
export const KNOWN_WORDS_LIMIT = 1500;
