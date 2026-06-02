import { Request, Response } from 'express';
import { ttsService } from '../services/TTSService.js';
import db from '../db.js';
import { dictTableForLanguage } from '../dal/shared/dictTable.js';

/**
 * TTSController
 *
 * POST /api/tts/synthesize
 *   body: { entryId: number }
 *   returns: audio/mpeg MP3 stream (with long-lived Cache-Control)
 *
 * Flow: look up the det row → ask TTSService for audio (disk-cache aware) →
 * stamp det.ttsVoice on cache miss so future queries know audio exists →
 * stream MP3 back. Browser caches it forever via immutable Cache-Control.
 */
export class TTSController {
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

      if (!text) {
        res.status(400).json({ error: 'text is required' });
        return;
      }
      // Sanity cap — flashcard entries are short; anything longer is misuse.
      if (text.length > 200) {
        res.status(400).json({ error: 'text too long (max 200 chars)' });
        return;
      }

      // Map short language code → BCP-47 TTS tag. Expand here as new langs get TTS.
      const ttsLang = language === 'zh' ? 'zh-CN' : language;

      const result = await ttsService.synthesize(text, ttsLang, pronunciation);

      // Best-effort: stamp the matching det row(s) so we can later query "which
      // det rows have cached audio". Matched by (word1, language) since the client
      // doesn't know det's primary key, and routed to the per-language det table
      // so Spanish words land in dictionaryentries_es. Skipped on cache hit (the
      // column was set during the original miss).
      if (!result.cacheHit) {
        const detTable = dictTableForLanguage(language);
        const c = await db.getClient();
        try {
          await c.query(
            `UPDATE ${detTable} SET "ttsVoice" = $1 WHERE word1 = $2 AND language = $3`,
            [result.voice, text, language]
          );
        } catch (err) {
          console.warn('[TTSController] failed to stamp ttsVoice:', err);
        } finally {
          c.release();
        }
      }

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

export const ttsController = new TTSController();
