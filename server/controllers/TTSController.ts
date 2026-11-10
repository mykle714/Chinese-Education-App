import { Request, Response } from 'express';
import { toTTSVoiceKey } from '../services/TTSService.js';
import type { CardAudioService } from '../services/CardAudioService.js';

/**
 * TTSController
 *
 * POST /api/tts/synthesize
 *   body: { text, language?, pronunciation?, voice?, stamp? }
 *   returns: audio/mpeg MP3 stream (with long-lived Cache-Control)
 *
 * Flow: validate → CardAudioService.synthesizeForRequest (TTSService disk cache +
 * the det `ttsVoice` stamp on a cache miss) → stream MP3 back. Browser caches it forever via immutable Cache-Control.
 */
export class TTSController {
  /**
   * Constructor-injected like every other controller. This class used to import a
   * module-level `ttsService` singleton and export itself as one, which made both
   * invisible from dal/setup.ts and impossible to substitute in a test.
   */
  constructor(private cardAudioService: CardAudioService) {}

  async synthesize(req: Request, res: Response): Promise<void> {
    try {
      const body = req.body || {};
      const text: string = typeof body.text === 'string' ? body.text.trim() : '';
      // Default to English (a neutral fallback) when the client omits language,
      // rather than assuming Chinese.
      const language: string = typeof body.language === 'string' ? body.language : 'en';
      // Optional tone-marked pinyin (space-separated, one syllable per hanzi).
      // When present, TTSService folds it into the cache key and uses it as an
      // SSML phoneme hint so polyphones cache and play distinctly.
      const pronunciation: string | null =
        typeof body.pronunciation === 'string' && body.pronunciation.trim()
          ? body.pronunciation.trim()
          : null;

      // WHICH voice within the language: 'default' | 'male' | 'female' (see TTSVoiceKey).
      // ⛔ An abstract ROLE, never a provider voice name — `toTTSVoiceKey` rejects anything
      // else back to 'default'. Accepting a name here would let any authenticated caller
      // synthesize through an arbitrary (and arbitrarily priced) Google voice on our billing
      // account, and would let a typo become a 400 from the provider instead of a default.
      const voiceKey = toTTSVoiceKey(body.voice);

      // Whether to stamp det."ttsVoice" on a cache miss. See the stamp block below.
      const stamp: boolean = body.stamp !== false;

      if (!text) {
        res.status(400).json({ error: 'text is required' });
        return;
      }
      // Sanity cap — flashcard entries are short; anything longer is misuse.
      if (text.length > 200) {
        res.status(400).json({ error: 'text too long (max 200 chars)' });
        return;
      }

      // Synthesizes and, on a cache miss, stamps det."ttsVoice" — skipped for `stamp: false`
      // (text that is not a headword, e.g. an NPC sentence) and for any non-default voice
      // (one learner's /settings choice must not rewrite shared dictionary data). The whole
      // policy lives in CardAudioService.recordAudioVoice.
      const result = await this.cardAudioService.synthesizeForRequest(
        text, language, pronunciation, voiceKey, stamp
      );

      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Content-Length', String(result.audio.length));
      res.end(result.audio);
    } catch (err: any) {
      console.error('[TTSController] synthesize error:', err);
      res.status(500).json({ error: err?.message || 'TTS synthesis failed' });
    }
  }
}
