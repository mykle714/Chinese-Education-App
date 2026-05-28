import { Request, Response } from 'express';
import { DictionaryService } from '../services/DictionaryService.js';
import { IUserDAL } from '../dal/interfaces/IUserDAL.js';
import { IVocabEntryDAL } from '../dal/interfaces/IVocabEntryDAL.js';

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
      const [enrichedEntry] = await this.dictionaryService.enrichExampleSentencesMetadataBatch([entry], language);

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
      res.json({ segments });
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
