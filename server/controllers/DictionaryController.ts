import { Request, Response } from 'express';
import { DictionaryService } from '../services/DictionaryService.js';
import { IUserDAL } from '../dal/interfaces/IUserDAL.js';
import { IVocabEntryDAL } from '../dal/interfaces/IVocabEntryDAL.js';
import { RateLimitError } from '../types/dal.js';
import { resolveTimezone, streakDateOf } from '../utils/streakDate.js';

/**
 * Dictionary Controller - Handles HTTP requests for dictionary operations
 * Delegates business logic to DictionaryService
 */
export class DictionaryController {
  constructor(
    private dictionaryService: DictionaryService,
    private userDAL: IUserDAL,
    private vocabEntryDAL: IVocabEntryDAL
  ) {}

  /**
   * Look up a dictionary entry by term (uses user's selected language)
   * GET /api/dictionary/lookup/:term
   */
  async lookupTerm(req: Request, res: Response): Promise<void> {
    try {
      const { term } = req.params;
      const userId = (req as any).user?.userId;

      if (!term) {
        res.status(400).json({ error: 'Term parameter is required' });
        return;
      }

      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      // Get user's selected language
      const user = await this.userDAL.findById(userId);
      const language = user?.selectedLanguage || 'zh';

      const entry = await this.dictionaryService.lookupTerm(term, language);

      if (!entry) {
        res.status(404).json({ error: 'Dictionary entry not found' });
        return;
      }

      // Example sentences in the dictionary table are stored without per-token
      // pinyin metadata. Enrich them on read so consumers (the EIP child panel
      // opened from a breakdown tap) get the same _segments/segmentMetadata
      // shape that flashcards do — otherwise pinyin won't render above each token.
      const [withExampleMeta] = await this.dictionaryService.enrichExampleSentencesMetadataBatch([entry], language);
      // Split the long definition into English prose + embedded-Chinese runs so the EIP
      // Definition tab can render inline cpcd (with the segment popup) for any Chinese it contains.
      const [withLongDefMeta] = await this.dictionaryService.enrichLongDefinitionMetadataBatch([withExampleMeta], language);
      // Attaches definitionsApproved (validated 'definitions' field) so the client
      // knows whether to render the longDefinition/partsOfSpeech AI-generated styling.
      const [enrichedEntry] = await this.dictionaryService.enrichDefinitionsApprovalBatch([withLongDefMeta], language);

      // For single-character zh entries, also attach the per-user "used in"
      // list (up to 4 multi-char words containing this character, capped at
      // 4 chars per entry). The EIP swaps the breakdown tab for a "used in"
      // tab on single-char cards, and without this enrichment that tab is
      // empty for child panels.
      let withUsedIn: typeof enrichedEntry & { usedIn?: unknown } = enrichedEntry;
      if (language === 'zh' && [...enrichedEntry.word1].length === 1) {
        try {
          const usedIn = await this.vocabEntryDAL.findUsedInForCharacter(userId, enrichedEntry.word1, language, 4);
          withUsedIn = { ...enrichedEntry, usedIn };
        } catch (err) {
          console.error(`Failed to attach usedIn for "${enrichedEntry.word1}":`, err);
        }
      }

      res.json(withUsedIn);
    } catch (error: any) {
      console.error('Error looking up dictionary term:', error);
      res.status(500).json({ error: error.message || 'Failed to lookup term' });
    }
  }

  /**
   * Search dictionary entries with pagination
   * GET /api/dictionary/search?term=<query>&language=<lang>&page=<num>&limit=<num>
   */
  async search(req: Request, res: Response): Promise<void> {
    try {
      const { term, language, page = '1', limit = '50' } = req.query;
      const userId = (req as any).user?.userId;

      if (!term || typeof term !== 'string') {
        res.status(400).json({ error: 'Search term is required' });
        return;
      }

      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      // Get user's selected language if not provided
      let searchLanguage = language as string;
      if (!searchLanguage) {
        const user = await this.userDAL.findById(userId);
        searchLanguage = user?.selectedLanguage || 'zh';
      }

      const pageNum = parseInt(page as string, 10);
      const limitNum = parseInt(limit as string, 10);

      if (isNaN(pageNum) || pageNum < 1) {
        res.status(400).json({ error: 'Invalid page number' });
        return;
      }

      if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
        res.status(400).json({ error: 'Invalid limit (must be between 1 and 100)' });
        return;
      }

      const offset = (pageNum - 1) * limitNum;
      const result = await this.dictionaryService.searchDictionary(term, searchLanguage, limitNum, offset);

      res.json({
        entries: result.entries,
        // AI synthetic-entry fallback (docs/DICTIONARY_AI_FALLBACK_SEARCH.md): canAskAi tells the
        // client to offer the "AI" button; aiEntry is a cached AI answer to auto-render (orange);
        // aiNoMatch flags a cached EMPTY answer (show the "couldn't find a match" note).
        canAskAi: result.canAskAi,
        aiEntry: result.aiEntry,
        aiNoMatch: result.aiNoMatch,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: result.total,
          totalPages: Math.ceil(result.total / limitNum)
        }
      });
    } catch (error: any) {
      console.error('Error searching dictionary:', error);
      res.status(500).json({ error: error.message || 'Failed to search dictionary' });
    }
  }

  /**
   * Generate an AI synthetic dictionary entry for a pinyin query with no real match — the "AI"
   * button target (docs/DICTIONARY_AI_FALLBACK_SEARCH.md). Returns `{ entry }`, where `entry` is a
   * display-only AiDictionaryEntry, or `null` for an empty result / disabled feature / invalid input.
   * POST /api/dictionary/ai-entry  { term, language? }
   */
  async aiEntry(req: Request, res: Response): Promise<void> {
    try {
      const { term, language, tz } = req.body;
      const userId = (req as any).user?.userId;

      if (!term || typeof term !== 'string') {
        res.status(400).json({ error: 'Term is required' });
        return;
      }

      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      let searchLanguage = language as string;
      if (!searchLanguage) {
        const user = await this.userDAL.findById(userId);
        searchLanguage = user?.selectedLanguage || 'zh';
      }

      // The daily AI-lookup limit resets on the caller's local streak-day (same 4 AM-bounded
      // boundary as streaks). The client sends its IANA tz (app convention, see minutePoints);
      // resolveTimezone defaults a missing/invalid value. See docs/DICTIONARY_AI_FALLBACK_SEARCH.md.
      const usageDate = streakDateOf(new Date(), resolveTimezone(tz));

      const entry = await this.dictionaryService.generateAiEntry(term, searchLanguage, userId, usageDate);
      res.json({ entry });
    } catch (error: any) {
      // Daily abuse limit exceeded → 429 with the user-facing message (RateLimitError.statusCode).
      if (error instanceof RateLimitError) {
        res.status(error.statusCode).json({ error: error.message, code: error.code });
        return;
      }
      console.error('Error generating AI dictionary entry:', error);
      res.status(500).json({ error: error.message || 'Failed to generate AI entry' });
    }
  }

  /**
   * Generate (or return cached) a comparison paragraph for two words — the eip Compare tab's
   * target (docs/WORD_COMPARE_FEATURE.md). Returns `{ comparison }`, or `{ comparison: null }` for
   * an invalid pair / disabled feature / transient model failure.
   * POST /api/dictionary/compare  { wordA, wordB, language?, tz }
   */
  async compare(req: Request, res: Response): Promise<void> {
    try {
      const { wordA, wordB, language, tz } = req.body;
      const userId = (req as any).user?.userId;

      if (!wordA || typeof wordA !== 'string' || !wordB || typeof wordB !== 'string') {
        res.status(400).json({ error: 'wordA and wordB are required' });
        return;
      }

      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      let compareLanguage = language as string;
      if (!compareLanguage) {
        const user = await this.userDAL.findById(userId);
        compareLanguage = user?.selectedLanguage || 'zh';
      }

      // Same 4 AM-bounded local streak-day boundary as the dictionary AI fallback's daily limit,
      // which this feature shares (docs/WORD_COMPARE_FEATURE.md).
      const usageDate = streakDateOf(new Date(), resolveTimezone(tz));

      const result = await this.dictionaryService.compareWords(wordA, wordB, compareLanguage, userId, usageDate);
      // comparisonParts: embedded-Chinese runs GSA-segmented + pinyin-annotated, same treatment
      // as longDefinition (docs/WORD_COMPARE_FEATURE.md) — the client renders it via the shared
      // LongDefinitionDisplay component.
      res.json({ comparison: result?.comparison ?? null, comparisonParts: result?.comparisonParts ?? null });
    } catch (error: any) {
      // Shared daily abuse limit exceeded → 429 with the user-facing message.
      if (error instanceof RateLimitError) {
        res.status(error.statusCode).json({ error: error.message, code: error.code });
        return;
      }
      console.error('Error generating word comparison:', error);
      res.status(500).json({ error: error.message || 'Failed to generate comparison' });
    }
  }

  /**
   * Segment input text via the GSA and return matching dictionary entries,
   * grouped by segment and sorted longest-segment-first.
   * GET /api/dictionary/segment?text=<input>
   *
   * Response shape:
   *   { segments: Array<{ segment: string; exactEntries: DictionaryEntry[]; prefixEntries: DictionaryEntry[] }> }
   * exactEntries: word1 === segment exactly. prefixEntries: word1 starts with segment but isn't exact.
   */
  async segmentSearch(req: Request, res: Response): Promise<void> {
    try {
      const { text } = req.query;
      const userId = (req as any).user?.userId;

      if (!text || typeof text !== 'string') {
        res.status(400).json({ error: 'Text parameter is required' });
        return;
      }

      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      const user = await this.userDAL.findById(userId);
      const language = user?.selectedLanguage || 'zh';

      const segments = await this.dictionaryService.segmentAndLookup(text, language);

      // AI fallback (docs/DICTIONARY_AI_FALLBACK_SEARCH.md): when the full typed string isn't itself
      // a headword (only breakdown/prefix matches came back), offer the "AI" button for it too. A
      // "complete match" is a segment group for the whole trimmed input that has an exact entry.
      const trimmed = text.trim();
      const hasCompleteMatch = segments.some(g => g.segment === trimmed && g.exactEntries.length > 0);
      const { canAskAi, aiEntry, aiNoMatch } = await this.dictionaryService.resolveChineseAiFallback(trimmed, language, hasCompleteMatch);

      res.json({ segments, canAskAi, aiEntry, aiNoMatch });
    } catch (error: any) {
      console.error('Error in segment search:', error);
      res.status(500).json({ error: error.message || 'Failed to perform segment search' });
    }
  }

  /**
   * Get total dictionary entry count
   * GET /api/dictionary/count
   */
  async getCount(req: Request, res: Response): Promise<void> {
    try {
      const count = await this.dictionaryService.getTotalCount();
      res.json({ count });
    } catch (error: any) {
      console.error('Error getting dictionary count:', error);
      res.status(500).json({ error: error.message || 'Failed to get dictionary count' });
    }
  }
}
