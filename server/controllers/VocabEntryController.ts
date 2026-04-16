import { Request, Response } from 'express';
import { VocabEntryService } from '../services/VocabEntryService.js';
import { DictionaryService } from '../services/DictionaryService.js';
import { requireUserId, handleControllerError } from '../utils/controllerUtils.js';

/**
 * VocabEntry Controller - Handles HTTP requests and responses for vocabulary operations
 * Delegates business logic to VocabEntryService
 */
export class VocabEntryController {
  constructor(
    private vocabEntryService: VocabEntryService,
    private dictionaryService?: DictionaryService
  ) {}

  /**
   * Get all vocabulary entries for authenticated user
   * GET /api/vocabEntries
   */
  async getAllEntries(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const entries = await this.vocabEntryService.getUserEntries(userId);
      res.json(entries.entries);
    } catch (error) {
      handleControllerError(error, res, 'VocabEntryController.getAllEntries');
    }
  }

  /**
   * Get paginated vocabulary entries for authenticated user
   * GET /api/vocabEntries/paginated
   */
  async getPaginatedEntries(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const limit = parseInt(req.query.limit as string) || 10;
      const offset = parseInt(req.query.offset as string) || 0;

      const result = await this.vocabEntryService.getUserEntries(userId, limit, offset);

      res.json({
        entries: result.entries,
        total: result.total,
        hasMore: result.hasMore
      });
    } catch (error) {
      handleControllerError(error, res, 'VocabEntryController.getPaginatedEntries');
    }
  }

  /**
   * Get vocabulary entry by ID
   * GET /api/vocabEntries/:id
   */
  async getEntryById(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const entryId = parseInt(req.params.id);
      if (isNaN(entryId)) {
        res.status(400).json({
          error: 'Invalid entry ID',
          code: 'ERR_INVALID_ENTRY_ID'
        });
        return;
      }

      const entry = await this.vocabEntryService.getEntry(userId, entryId);
      res.json(entry);
    } catch (error) {
      handleControllerError(error, res, 'VocabEntryController.getEntryById');
    }
  }

  /**
   * Create new vocabulary entry
   * POST /api/vocabEntries
   */
  async createEntry(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const { entryKey, entryValue, hskLevel } = req.body;

      // Get user's selected language to tag the new entry
      const { userDAL } = await import('../dal/setup.js');
      const user = await userDAL.findById(userId);
      const language = user?.selectedLanguage || 'zh';

      const newEntry = await this.vocabEntryService.createEntry(userId, {
        entryKey,
        entryValue,
        hskLevel,
        language
      });

      res.status(201).json(newEntry);
    } catch (error) {
      handleControllerError(error, res, 'VocabEntryController.createEntry');
    }
  }

  /**
   * Update vocabulary entry
   * PUT /api/vocabEntries/:id
   */
  async updateEntry(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const entryId = parseInt(req.params.id);
      if (isNaN(entryId)) {
        res.status(400).json({
          error: 'Invalid entry ID',
          code: 'ERR_INVALID_ENTRY_ID'
        });
        return;
      }

      const { entryKey, entryValue, hskLevel } = req.body;
      const updatedEntry = await this.vocabEntryService.updateEntry(userId, entryId, {
        entryKey,
        entryValue,
        hskLevel
      });

      res.json(updatedEntry);
    } catch (error) {
      handleControllerError(error, res, 'VocabEntryController.updateEntry');
    }
  }

  /**
   * Delete vocabulary entry
   * DELETE /api/vocabEntries/:id
   */
  async deleteEntry(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const entryId = parseInt(req.params.id);
      if (isNaN(entryId)) {
        res.status(400).json({
          error: 'Invalid entry ID',
          code: 'ERR_INVALID_ENTRY_ID'
        });
        return;
      }

      await this.vocabEntryService.deleteEntry(userId, entryId);
      res.status(204).end();
    } catch (error) {
      handleControllerError(error, res, 'VocabEntryController.deleteEntry');
    }
  }

  /**
   * Search vocabulary entries
   * GET /api/vocabEntries/search
   */
  async searchEntries(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const searchTerm = req.query.q as string;
      const limit = parseInt(req.query.limit as string) || 50;

      if (!searchTerm) {
        res.status(400).json({
          error: 'Search term is required',
          code: 'ERR_MISSING_SEARCH_TERM'
        });
        return;
      }

      const entries = await this.vocabEntryService.searchEntries(userId, searchTerm, limit);
      res.json(entries);
    } catch (error) {
      handleControllerError(error, res, 'VocabEntryController.searchEntries');
    }
  }

  /**
   * Get vocabulary statistics for user
   * GET /api/vocabEntries/stats
   */
  async getUserStats(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const stats = await this.vocabEntryService.getUserVocabStats(userId);
      res.json(stats);
    } catch (error) {
      handleControllerError(error, res, 'VocabEntryController.getUserStats');
    }
  }

  /**
   * Get recent entries
   * GET /api/vocabEntries/recent
   */
  async getRecentEntries(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const days = parseInt(req.query.days as string) || 7;
      const entries = await this.vocabEntryService.getRecentEntries(userId, days);
      res.json(entries);
    } catch (error) {
      handleControllerError(error, res, 'VocabEntryController.getRecentEntries');
    }
  }

  /**
   * Import vocabulary entries from CSV file
   * POST /api/vocabEntries/import
   */
  async importFromCSV(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      if (!req.file) {
        res.status(400).json({
          error: 'No file uploaded',
          code: 'ERR_NO_FILE'
        });
        return;
      }

      if (!req.file.originalname.toLowerCase().endsWith('.csv')) {
        res.status(400).json({
          error: 'File must be a CSV file',
          code: 'ERR_INVALID_FILE_TYPE'
        });
        return;
      }

      console.log('🔄 Using NEW DAL architecture for CSV import');

      const result = await this.vocabEntryService.importFromCSV(userId, req.file.buffer);

      if (result.success) {
        res.json({
          message: result.message,
          results: result.results
        });
      } else {
        res.status(400).json({
          error: result.message,
          code: 'ERR_IMPORT_FAILED',
          results: result.results
        });
      }
    } catch (error) {
      handleControllerError(error, res, 'VocabEntryController.importFromCSV');
    }
  }

  /**
   * Get vocabulary entries by tokens for reader feature
   * POST /api/vocabEntries/by-tokens
   */
  async getEntriesByTokens(req: Request, res: Response): Promise<void> {
    const requestStart = performance.now();

    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const { tokens } = req.body;

      console.log(`[VOCAB-SERVER] 📥 Token lookup request received:`, {
        userId: `${userId.substring(0, 8)}...`,
        requestSize: `${JSON.stringify(req.body).length} bytes`,
        userAgent: req.get('User-Agent')?.substring(0, 50) + '...',
        timestamp: new Date().toISOString()
      });

      if (!tokens || !Array.isArray(tokens)) {
        res.status(400).json({
          error: 'Tokens array is required',
          code: 'ERR_MISSING_TOKENS'
        });
        return;
      }

      if (tokens.length === 0) {
        res.json({ personalEntries: [], dictionaryEntries: [] });
        return;
      }

      // Guard against abusive request sizes
      if (tokens.length > 1000) {
        res.status(400).json({
          error: 'Too many tokens requested (max 1000)',
          code: 'ERR_TOO_MANY_TOKENS'
        });
        return;
      }

      // Validate that all tokens are strings before passing to DB
      const invalidTokens = tokens.filter(token => typeof token !== 'string');
      if (invalidTokens.length > 0) {
        res.status(400).json({
          error: 'All tokens must be strings',
          code: 'ERR_INVALID_TOKEN_TYPE'
        });
        return;
      }

      console.log(`[VOCAB-SERVER] 🔍 Processing ${tokens.length} tokens for user ${userId.substring(0, 8)}...`);

      const serviceStart = performance.now();

      // Get user's language for dictionary lookups
      const { userDAL } = await import('../dal/setup.js');
      const user = await userDAL.findById(userId);
      const language = user?.selectedLanguage || 'zh';

      // Fetch personal vocab and dictionary entries in parallel
      const [personalEntries, dictionaryEntries] = await Promise.all([
        this.vocabEntryService.getEntriesByTokens(userId, tokens),
        this.dictionaryService ? this.dictionaryService.lookupMultipleTerms(tokens, language) : Promise.resolve([])
      ]);

      const serviceTime = performance.now() - serviceStart;
      const totalTime = performance.now() - requestStart;

      console.log(`[VOCAB-SERVER] 📤 Responding: ${personalEntries.length} personal, ${dictionaryEntries.length} dictionary entries in ${totalTime.toFixed(2)}ms (service: ${serviceTime.toFixed(2)}ms)`);

      res.json({ personalEntries, dictionaryEntries });
    } catch (error) {
      const errorTime = performance.now() - requestStart;
      console.error(`[VOCAB-SERVER] ❌ Request failed in ${errorTime.toFixed(2)}ms`);
      handleControllerError(error, res, 'VocabEntryController.getEntriesByTokens');
    }
  }
}
