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
 * TTSService — provider-pluggable text-to-speech with on-disk caching.
 *
 * Current provider: Google Cloud Text-to-Speech (REST endpoint, service-account
 * auth via google-auth-library — credentials loaded from the JSON file at
 * GOOGLE_APPLICATION_CREDENTIALS).
 *
 * Cache: infinite TTL on disk. Keyed by sha256(`${provider}:${voice}:${text}`).
 * The text our flashcards expose is immutable; if it ever changes, the row's
 * `ttsVoice` column should be nulled to trigger re-synthesis.
 *
 * Note: Google uses `cmn-CN` for Mandarin (not `zh-CN`). The mapping happens
 * inside `callGoogle` so callers can still pass standard BCP-47 tags.
 */
export class TTSService {
  private readonly provider: string;
  // Per-language voice names. The voice is resolved from the request language
  // (see `voiceForLang`) so a Spanish word never gets read by the Mandarin
  // voice and vice-versa. Override via env to swap voices without code changes.
  private readonly voiceZh: string;
  private readonly voiceEs: string;
  private readonly voiceEn: string;
  private readonly credentialsPath: string;
  // GoogleAuth handles JWT signing and access-token caching/refresh internally,
  // so subsequent calls in the same hour reuse the same OAuth token.
  private auth: GoogleAuth | null = null;

  constructor() {
    this.provider = (process.env.TTS_PROVIDER || 'google').toLowerCase();
    // Default to a Wavenet Mandarin female voice. Other options:
    //   cmn-CN-Wavenet-A/B/C/D, cmn-CN-Standard-A/B/C/D,
    //   cmn-CN-Neural2-A (female), cmn-CN-Neural2-B/C/D (male),
    //   cmn-TW-* for Taiwanese Mandarin.
    this.voiceZh = process.env.GOOGLE_TTS_VOICE_ZH || 'cmn-CN-Wavenet-A';
    // Mexican / Latin-American Spanish. Google Cloud TTS exposes Mexican-style
    // Spanish under the `es-US` locale (there is no `es-MX` voice); es-US-Neural2-A
    // is a natural female voice. Other options: es-US-Neural2-B/C (male),
    // es-US-Wavenet-A/B/C, es-US-Standard-A/B/C. (es-ES-* would be Castilian.)
    this.voiceEs = process.env.GOOGLE_TTS_VOICE_ES || 'es-US-Neural2-A';
    // US English — the neutral fallback voice when no/unknown language is given.
    this.voiceEn = process.env.GOOGLE_TTS_VOICE_EN || 'en-US-Neural2-C';
    // Path is resolved relative to the server/ directory (one level up from this file).
    const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS || '';
    this.credentialsPath = raw
      ? path.isAbsolute(raw)
        ? raw
        : path.resolve(__dirname, '..', raw)
      : '';
  }

  /**
   * Resolve the provider voice name for a request language. Accepts either the
   * short code (`es`, `zh`) or a BCP-47 tag (`es-US`, `zh-CN`) — we match on the
   * leading subtag. Defaults to the Mandarin voice for anything unrecognized.
   */
  private voiceForLang(lang: string): string {
    const primary = (lang || '').toLowerCase().split('-')[0];
    if (primary === 'es') return this.voiceEs;
    if (primary === 'en') return this.voiceEn;
    return this.voiceZh;
  }

  /**
   * The voice tag we stamp on det.ttsVoice once a row is cached.
   * Mismatch with the current voice means we should re-synthesize.
   * Language-scoped because each language uses a different voice.
   */
  voiceTag(lang: string): string {
    return `${this.provider}:${this.voiceForLang(lang)}`;
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
   */
  async synthesize(text: string, lang: string = 'zh-CN', pinyin?: string | null): Promise<SynthesisResult> {
    const cacheKey = this.cacheKey(text, lang, pinyin);
    const filePath = path.join(CACHE_DIR, `${cacheKey}.mp3`);

    // Fast path: serve from disk if we already synthesized this exact (voice, text, pinyin).
    try {
      const audio = await fs.readFile(filePath);
      return { audio, cacheHit: true, voice: this.voiceTag(lang) };
    } catch {
      // miss — fall through to provider call
    }

    if (!this.isConfigured()) {
      throw new Error('TTS provider not configured (missing GOOGLE_APPLICATION_CREDENTIALS)');
    }

    const audio = await this.callGoogle(text, lang, pinyin);

    // Persist to disk for all future requests. Best-effort: if the write fails we
    // still return the audio so the caller isn't blocked on filesystem hiccups.
    await fs.mkdir(CACHE_DIR, { recursive: true }).catch(() => {});
    await fs.writeFile(filePath, audio).catch(err => {
      console.warn(`[TTSService] failed to write cache file ${filePath}:`, err);
    });

    return { audio, cacheHit: false, voice: this.voiceTag(lang) };
  }

  /**
   * Whether a cached MP3 file already exists on disk for this (voice, text, pinyin).
   * Used as the source-of-truth check; the DB's ttsVoice column is just a hint.
   */
  async hasCachedFile(text: string, lang: string, pinyin?: string | null): Promise<boolean> {
    const filePath = path.join(CACHE_DIR, `${this.cacheKey(text, lang, pinyin)}.mp3`);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private cacheKey(text: string, lang: string, pinyin?: string | null): string {
    // Normalize so callers can pass null/undefined/'' interchangeably without
    // splitting the cache.
    const normalized = (pinyin || '').trim();
    return crypto
      .createHash('sha256')
      .update(`${this.voiceTag(lang)}:${text}:${normalized}`)
      .digest('hex');
  }

  // Google Cloud Text-to-Speech REST API with service-account (OAuth) auth.
  // Docs: https://cloud.google.com/text-to-speech/docs/reference/rest/v1/text/synthesize
  private async callGoogle(text: string, lang: string, pinyin?: string | null): Promise<Buffer> {
    // Google uses `cmn-CN` / `cmn-TW` for Mandarin, not `zh-*`. Spanish wants a
    // full locale (`es-US` for Mexican/Latin-American, `es-ES` for Castilian);
    // a bare `es` is rejected. Map at the edge so callers can pass short codes.
    const languageCode = lang === 'zh-CN' || lang === 'zh' ? 'cmn-CN'
      : lang === 'zh-TW' ? 'cmn-TW'
      : lang === 'es' ? 'es-US'
      : lang === 'en' ? 'en-US'
      : lang;

    // Resolve the voice for this language; the voice name and languageCode must agree.
    const voice = this.voiceForLang(lang);

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

export const ttsService = new TTSService();

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

/**
 * Build SSML wrapping each hanzi with a <phoneme alphabet="pinyin" ph="..."/>
 * hint. Returns null when we can't safely build a hint — caller should fall
 * back to the plain-text `input.text` path.
 *
 * Bail-out conditions (in order):
 *   1. No pinyin at all.
 *   2. Syllable count ≠ character count. The original "中" + "zhōng" works,
 *      "你好吗" + "nǐ hǎo ma" works, but anything misaligned (e.g. compounds
 *      with embedded punctuation, or 儿化音 fusions) is too risky to guess.
 *   3. Any syllable fails normalization (junk char).
 */
export function buildPinyinSsml(text: string, pinyin?: string | null): string | null {
  if (!pinyin) return null;
  const syllables = pinyin.trim().split(/\s+/).filter(Boolean);
  const chars = [...text];
  if (syllables.length === 0 || syllables.length !== chars.length) return null;

  const parts: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    const ph = toNumberedPinyin(syllables[i]);
    if (!ph) return null;
    parts.push(`<phoneme alphabet="pinyin" ph="${ph}">${xmlEscape(chars[i])}</phoneme>`);
  }
  return `<speak>${parts.join('')}</speak>`;
}
