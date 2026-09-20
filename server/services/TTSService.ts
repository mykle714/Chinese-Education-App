import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleAuth } from 'google-auth-library';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cache location (relative to server/). Holds .mp3 files keyed by sha256(voice+':'+text).
const CACHE_DIR = path.resolve(__dirname, '..', 'cache', 'tts');

export interface SynthesisResult {
  audio: Buffer;
  cacheHit: boolean;
  voice: string;
}

/**
 * WHICH voice within a language, as an ABSTRACT ROLE rather than a provider voice name.
 *
 * The client sends one of these three strings and nothing else — never a Google voice name.
 * A raw name on the wire would let any authenticated caller synthesize through an arbitrary
 * (and arbitrarily expensive) voice on our billing account, so the mapping from role to
 * provider voice stays entirely server-side in `VOICE_TABLE`.
 *
 * `'female'` deliberately resolves to the SAME provider voice as `'default'`. That keeps
 * every already-cached MP3 (whose cache key contains the voice NAME, not the role) a hit
 * after this feature ships, and means the flashcard voice and a female NPC are one voice
 * rather than two that happen to sound alike.
 *
 * Consumers: `server/controllers/TTSController.ts` (validation), `src/services/tts/types.ts`
 * (the client mirror). Docs: docs/AUDIO_PLAYBACK.md § 6.
 */
export type TTSVoiceKey = 'default' | 'male' | 'female';

export const TTS_VOICE_KEYS: readonly TTSVoiceKey[] = ['default', 'male', 'female'];

/** Narrow an untrusted request field to a voice role. Anything else falls back to 'default'. */
export function toTTSVoiceKey(value: unknown): TTSVoiceKey {
  return typeof value === 'string' && (TTS_VOICE_KEYS as readonly string[]).includes(value)
    ? (value as TTSVoiceKey)
    : 'default';
}

/** The language buckets `voiceForLang` resolves into. Anything unrecognized reads as 'zh'. */
type VoiceLangKey = 'zh' | 'es' | 'en';

/**
 * TTSService — provider-pluggable text-to-speech with on-disk caching.
 *
 * Current provider: Google Cloud Text-to-Speech (REST endpoint, service-account
 * auth via google-auth-library — credentials loaded from the JSON file at
 * GOOGLE_APPLICATION_CREDENTIALS).
 *
 * Cache: infinite TTL on disk. Keyed by
 * sha256(`${provider}:${resolvedVoiceName}:${text}:${pinyin}`) — see `cacheKey`. The voice
 * name is in the key, so adding a voice adds cache slots and never invalidates existing ones.
 * The text our flashcards expose is immutable; if it ever changes, the row's
 * `ttsVoice` column should be nulled to trigger re-synthesis.
 *
 * Note: Google uses `cmn-CN` for Mandarin (not `zh-CN`). The mapping happens
 * inside `callGoogle` so callers can still pass standard BCP-47 tags.
 */
export class TTSService {
  private readonly provider: string;
  /**
   * Provider voice names by (language bucket, voice role). The voice is resolved from the
   * request language (see `voiceForLang`) so a Spanish word never gets read by the Mandarin
   * voice and vice-versa, and from the role so a male NPC is not read by a female voice.
   * Every entry is overridable via env, so swapping a voice needs no code change.
   *
   * ⚠️ A **two-dimensional** table, not two independent settings: the voice NAME and the
   * `languageCode` sent to Google must agree, and both are derived here from the same
   * language bucket. Replacing an entry with a voice from another locale breaks synthesis.
   */
  private readonly voices: Record<VoiceLangKey, Record<TTSVoiceKey, string>>;
  private readonly credentialsPath: string;
  // GoogleAuth handles JWT signing and access-token caching/refresh internally,
  // so subsequent calls in the same hour reuse the same OAuth token.
  private auth: GoogleAuth | null = null;

  constructor() {
    this.provider = (process.env.TTS_PROVIDER || 'google').toLowerCase();
    // The default (= female) voices, and their male counterparts. Genders below are the
    // provider's own `ssmlGender`, verified against `GET texttospeech/v1/voices` on our
    // service account (2026-09-09) rather than taken from the docs.
    //
    // The male voices are deliberately from the SAME family as their language's default, so
    // an NPC cast does not mix synthesis generations — `Wavenet` with `Wavenet` for Mandarin,
    // `Neural2` with `Neural2` for Spanish and English. Newer `Chirp3-HD-*` voices exist for
    // all three locales (30 for Mandarin alone, so one voice per NPC is possible) and sound
    // better, but they are a different price tier and do not accept SSML — which would
    // silently drop the pinyin <phoneme> hint that keeps a polyphone's audio matching the
    // reading on screen. Do not swap a Chirp3 voice in for the zh default without reading
    // `buildPinyinSsml` first.
    //
    // Mandarin: female A/D, male B/C in both Wavenet and Standard; `cmn-TW-*` is Taiwanese.
    // Spanish: Mexican / Latin-American lives under `es-US` (there is no `es-MX` voice) —
    // female Neural2-A, male Neural2-B/C. (`es-ES-*` would be Castilian.)
    // English: the neutral fallback for an unknown language; Neural2-C is FEMALE (it is the
    // language fallback, not a gender-neutral voice), male counterparts are Neural2-A/D/I/J.
    const zhDefault = process.env.GOOGLE_TTS_VOICE_ZH || 'cmn-CN-Wavenet-A';
    const esDefault = process.env.GOOGLE_TTS_VOICE_ES || 'es-US-Neural2-A';
    const enDefault = process.env.GOOGLE_TTS_VOICE_EN || 'en-US-Neural2-C';
    this.voices = {
      // 'female' mirrors 'default' by construction — see the TTSVoiceKey doc for why that is
      // deliberate (it is what keeps every pre-existing cached MP3 a hit).
      zh: {
        default: zhDefault,
        female: zhDefault,
        male: process.env.GOOGLE_TTS_VOICE_ZH_MALE || 'cmn-CN-Wavenet-B',
      },
      es: {
        default: esDefault,
        female: esDefault,
        male: process.env.GOOGLE_TTS_VOICE_ES_MALE || 'es-US-Neural2-B',
      },
      en: {
        default: enDefault,
        female: enDefault,
        male: process.env.GOOGLE_TTS_VOICE_EN_MALE || 'en-US-Neural2-D',
      },
    };
    // Path is resolved relative to the server/ directory (one level up from this file).
    const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS || '';
    this.credentialsPath = raw
      ? path.isAbsolute(raw)
        ? raw
        : path.resolve(__dirname, '..', raw)
      : '';
  }

  /**
   * Resolve the provider voice name for a (language, role) pair. Accepts either the
   * short code (`es`, `zh`) or a BCP-47 tag (`es-US`, `zh-CN`) — we match on the
   * leading subtag. Defaults to the Mandarin voice for anything unrecognized.
   */
  private voiceForLang(lang: string, voiceKey: TTSVoiceKey = 'default'): string {
    const primary = (lang || '').toLowerCase().split('-')[0];
    const bucket: VoiceLangKey = primary === 'es' ? 'es' : primary === 'en' ? 'en' : 'zh';
    return this.voices[bucket][voiceKey];
  }

  /**
   * The voice tag we stamp on det.ttsVoice once a row is cached.
   * Mismatch with the current voice means we should re-synthesize.
   * Language-scoped because each language uses a different voice.
   *
   * ⚠️ Also the cache-key component (see `cacheKey`), which is why it carries the resolved
   * voice NAME rather than the role: two roles pointing at one voice must share one MP3, and
   * renaming a role must not orphan the files synthesized under it.
   */
  voiceTag(lang: string, voiceKey: TTSVoiceKey = 'default'): string {
    return `${this.provider}:${this.voiceForLang(lang, voiceKey)}`;
  }

  /**
   * Whether this (language, role) resolves to the language's DEFAULT voice.
   *
   * Exists for the `det."ttsVoice"` stamp, which is shared dictionary data: the column means
   * "this row has cached audio in the voice the app reads with", so a request in some other
   * voice must not write it. Lives here because voice resolution is this service's business —
   * the controller cannot know that 'female' and 'default' are the same voice.
   */
  isDefaultVoice(lang: string, voiceKey: TTSVoiceKey): boolean {
    return this.voiceForLang(lang, voiceKey) === this.voiceForLang(lang, 'default');
  }

  isConfigured(): boolean {
    return Boolean(this.credentialsPath);
  }

  /**
   * Lazily build a GoogleAuth client. Done on first synthesis (not in the
   * constructor) so module import doesn't fail if credentials are missing —
   * callers without TTS configured still get a clean fallback to Web Speech.
   */
  private getAuth(): GoogleAuth {
    if (this.auth) return this.auth;
    if (!this.credentialsPath) {
      throw new Error('TTS provider not configured (missing GOOGLE_APPLICATION_CREDENTIALS)');
    }
    this.auth = new GoogleAuth({
      keyFile: this.credentialsPath,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    return this.auth;
  }

  /**
   * Returns MP3 bytes for the given text, hitting disk cache first.
   * Throws if the upstream provider call fails AND cache misses.
   *
   * `pinyin` (when provided) is the space-separated tone-marked pronunciation
   * for `text` — one syllable per hanzi character. It's folded into the cache
   * key (so 中 zhōng and 中 zhòng cache as separate MP3s) and sent to Google
   * as an SSML <phoneme> hint so the audio matches the pronunciation we
   * display. Omitting pinyin reverts to the older text-only path where
   * Google guesses the reading.
   *
   * `voiceKey` picks WHICH voice within the language — see {@link TTSVoiceKey}. It resolves
   * to a voice name that is part of the cache key, so a male and a female rendering of the
   * same sentence are two cached MP3s rather than one shared (and wrong) one.
   */
  async synthesize(
    text: string,
    lang: string = 'zh-CN',
    pinyin?: string | null,
    voiceKey: TTSVoiceKey = 'default',
  ): Promise<SynthesisResult> {
    const cacheKey = this.cacheKey(text, lang, pinyin, voiceKey);
    const filePath = path.join(CACHE_DIR, `${cacheKey}.mp3`);

    // Fast path: serve from disk if we already synthesized this exact (voice, text, pinyin).
    try {
      const audio = await fs.readFile(filePath);
      return { audio, cacheHit: true, voice: this.voiceTag(lang, voiceKey) };
    } catch {
      // miss — fall through to provider call
    }

    if (!this.isConfigured()) {
      throw new Error('TTS provider not configured (missing GOOGLE_APPLICATION_CREDENTIALS)');
    }

    const audio = await this.callGoogle(text, lang, pinyin, voiceKey);

    // Persist to disk for all future requests. Best-effort: if the write fails we
    // still return the audio so the caller isn't blocked on filesystem hiccups.
    await fs.mkdir(CACHE_DIR, { recursive: true }).catch(() => {});
    await fs.writeFile(filePath, audio).catch(err => {
      console.warn(`[TTSService] failed to write cache file ${filePath}:`, err);
    });

    return { audio, cacheHit: false, voice: this.voiceTag(lang, voiceKey) };
  }

  /**
   * Whether a cached MP3 file already exists on disk for this (voice, text, pinyin).
   * Used as the source-of-truth check; the DB's ttsVoice column is just a hint.
   */
  async hasCachedFile(
    text: string,
    lang: string,
    pinyin?: string | null,
    voiceKey: TTSVoiceKey = 'default',
  ): Promise<boolean> {
    const filePath = path.join(CACHE_DIR, `${this.cacheKey(text, lang, pinyin, voiceKey)}.mp3`);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private cacheKey(
    text: string,
    lang: string,
    pinyin?: string | null,
    voiceKey: TTSVoiceKey = 'default',
  ): string {
    // Normalize so callers can pass null/undefined/'' interchangeably without
    // splitting the cache.
    const normalized = (pinyin || '').trim();
    return crypto
      .createHash('sha256')
      .update(`${this.voiceTag(lang, voiceKey)}:${text}:${normalized}`)
      .digest('hex');
  }

  // Google Cloud Text-to-Speech REST API with service-account (OAuth) auth.
  // Docs: https://cloud.google.com/text-to-speech/docs/reference/rest/v1/text/synthesize
  private async callGoogle(
    text: string,
    lang: string,
    pinyin?: string | null,
    voiceKey: TTSVoiceKey = 'default',
  ): Promise<Buffer> {
    // Google uses `cmn-CN` / `cmn-TW` for Mandarin, not `zh-*`. Spanish wants a
    // full locale (`es-US` for Mexican/Latin-American, `es-ES` for Castilian);
    // a bare `es` is rejected. Map at the edge so callers can pass short codes.
    const languageCode = lang === 'zh-CN' || lang === 'zh' ? 'cmn-CN'
      : lang === 'zh-TW' ? 'cmn-TW'
      : lang === 'es' ? 'es-US'
      : lang === 'en' ? 'en-US'
      : lang;

    // Resolve the voice for this (language, role); the voice name and languageCode must agree.
    const voice = this.voiceForLang(lang, voiceKey);

    const client = await this.getAuth().getClient();
    const tokenResp = await client.getAccessToken();
    const accessToken = typeof tokenResp === 'string' ? tokenResp : tokenResp.token;
    if (!accessToken) throw new Error('Failed to obtain Google access token');

    // Pinyin <phoneme> hints only make sense for Mandarin. For other languages
    // (e.g. Spanish) always synthesize the plain text — buildPinyinSsml would
    // otherwise mis-tag a short word whose pronunciation happens to align 1:1.
    const ssml = languageCode.startsWith('cmn') ? buildPinyinSsml(text, pinyin) : null;
    const input: { ssml: string } | { text: string } = ssml ? { ssml } : { text };

    const res = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input,
        voice: { languageCode, name: voice },
        audioConfig: { audioEncoding: 'MP3' },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Google TTS request failed: ${res.status} ${res.statusText} ${body}`);
    }

    const json = await res.json() as { audioContent?: string };
    if (!json.audioContent) {
      throw new Error('Google TTS returned no audioContent');
    }
    const buf = Buffer.from(json.audioContent, 'base64');
    if (buf.length === 0) throw new Error('Google TTS returned empty audio');
    return buf;
  }
}

// NOTE: no module-level singleton here. TTSService is constructed once in
// dal/setup.ts like every other service, so it is visible from the composition
// root and can be substituted in a test (docs/ARCHITECTURE_REVIEW.md finding 8).

// --- SSML pinyin helpers -----------------------------------------------------
//
// These live outside the class because they're pure functions over text — no
// auth/cache state, trivially testable, and reusable if we add another provider.

// Tone-marked vowel → [bareVowel, toneNumber]. Covers a/e/i/o/u plus ü.
const TONE_MARKS: Record<string, [string, number]> = {
  'ā': ['a', 1], 'á': ['a', 2], 'ǎ': ['a', 3], 'à': ['a', 4],
  'ē': ['e', 1], 'é': ['e', 2], 'ě': ['e', 3], 'è': ['e', 4],
  'ī': ['i', 1], 'í': ['i', 2], 'ǐ': ['i', 3], 'ì': ['i', 4],
  'ō': ['o', 1], 'ó': ['o', 2], 'ǒ': ['o', 3], 'ò': ['o', 4],
  'ū': ['u', 1], 'ú': ['u', 2], 'ǔ': ['u', 3], 'ù': ['u', 4],
  'ǖ': ['ü', 1], 'ǘ': ['ü', 2], 'ǚ': ['ü', 3], 'ǜ': ['ü', 4],
};

/**
 * Convert one tone-marked pinyin syllable to numbered form for Google.
 *   "zhōng" -> "zhong1", "lǚ" -> "lü3", "de" -> "de5" (neutral)
 * Returns null when the input contains nothing recognizable as pinyin
 * (e.g. punctuation slipped in) so the caller can fall back to plain text.
 */
export function toNumberedPinyin(syllable: string): string | null {
  if (!syllable) return null;
  let tone = 5; // neutral by default; no tone mark means tone 5
  let base = '';
  for (const ch of syllable) {
    const mark = TONE_MARKS[ch];
    if (mark) {
      tone = mark[1];
      base += mark[0];
    } else {
      base += ch;
    }
  }
  // Reject syllables with no alphabetic content — keeps junk out of the SSML.
  if (!/[a-zü]/i.test(base)) return null;
  return base.toLowerCase() + tone;
}

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
};
function xmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, c => XML_ESCAPES[c]);
}

// A Han ideograph — the only kind of character a pinyin syllable can belong to.
// Punctuation, latin letters and digits are passed through to the SSML untouched.
const HAN_CHAR = /\p{Script=Han}/u;

/**
 * Build SSML wrapping each hanzi with a <phoneme alphabet="pinyin" ph="..."/>
 * hint. Returns null when we can't safely build a hint — caller should fall
 * back to the plain-text `input.text` path.
 *
 * Syllables are aligned to the text's **Han characters only**. Everything else —
 * 「，」「。」, latin letters, digits — is emitted as escaped SSML text between the
 * phoneme tags, so Google still gets the punctuation it needs for sentence prosody.
 * This is what makes a whole EXAMPLE SENTENCE hintable: the previous rule (one
 * syllable per character, punctuation included) could never match a real sentence,
 * so every sentence fell through to the plain-text path and the provider guessed
 * each reading — narrating 行家 as *xíng jiā* against the *háng jiā* on screen.
 *
 * Bail-out conditions (in order):
 *   1. No pinyin at all.
 *   2. Syllable count ≠ Han-character count. "中" + "zhōng" works, "你好吗" +
 *      "nǐ hǎo ma" works, "说到茶，他…" + its per-segment pinyin works; anything
 *      misaligned (儿化音 fusions, a segment whose pinyin went missing) is still
 *      too risky to guess, because one extra syllable shifts every reading after it.
 *   3. Any syllable fails normalization (junk char).
 */
export function buildPinyinSsml(text: string, pinyin?: string | null): string | null {
  if (!pinyin) return null;
  const syllables = pinyin.trim().split(/\s+/).filter(Boolean);
  const chars = [...text];
  const hanCount = chars.filter(c => HAN_CHAR.test(c)).length;
  if (syllables.length === 0 || syllables.length !== hanCount) return null;

  const parts: string[] = [];
  let s = 0;
  for (const ch of chars) {
    if (!HAN_CHAR.test(ch)) {
      parts.push(xmlEscape(ch));
      continue;
    }
    const ph = toNumberedPinyin(syllables[s++]);
    if (!ph) return null;
    parts.push(`<phoneme alphabet="pinyin" ph="${ph}">${xmlEscape(ch)}</phoneme>`);
  }
  return `<speak>${parts.join('')}</speak>`;
}
