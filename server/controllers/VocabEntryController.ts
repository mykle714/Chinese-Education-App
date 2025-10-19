import { Request, Response } from 'express';
import { VocabEntryService } from '../services/VocabEntryService.js';
import { DictionaryService } from '../services/DictionaryService.js';
import { ValidationError, DuplicateError, NotFoundError, DALError } from '../types/dal.js';

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
      const userId = (req as any).user?.userId;
      
      if (!userId) {
        res.status(401).json({ 
          error: 'User not authenticated',
          code: 'ERR_NOT_AUTHENTICATED'
        });
        return;
      }
      
      const entries = await this.vocabEntryService.getUserEntries(userId);
      res.json(entries.entries);
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * Get paginated vocabulary entries for authenticated user
   * GET /api/vocabEntries/paginated
   */
  async getPaginatedEntries(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      
      if (!userId) {
        res.status(401).json({ 
          error: 'User not authenticated',
          code: 'ERR_NOT_AUTHENTICATED'
        });
        return;
      }
      
      const limit = parseInt(req.query.limit as string) || 10;
      const offset = parseInt(req.query.offset as string) || 0;
      
      const result = await this.vocabEntryService.getUserEntries(userId, limit, offset);
      
      res.json({
        entries: result.entries,
        total: result.total,
        hasMore: result.hasMore
      });
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * Get vocabulary entry by ID
   * GET /api/vocabEntries/:id
   */
  async getEntryById(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      const entryId = parseInt(req.params.id);
      
      if (!userId) {
        res.status(401).json({ 
          error: 'User not authenticated',
          code: 'ERR_NOT_AUTHENTICATED'
        });
        return;
      }
      
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
      this.handleError(error, res);
    }
  }

  /**
   * Create new vocabulary entry
   * POST /api/vocabEntries
   */
  async createEntry(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      const { entryKey, entryValue, hskLevelTag } = req.body;
      
      if (!userId) {
        res.status(401).json({ 
          error: 'User not authenticated',
          code: 'ERR_NOT_AUTHENTICATED'
        });
        return;
      }
      
      // Get user's language
      const { userDAL } = await import('../dal/setup.js');
      const user = await userDAL.findById(userId);
      const language = user?.selectedLanguage || 'zh';
      
      const newEntry = await this.vocabEntryService.createEntry(userId, {
        entryKey,
        entryValue,
        hskLevelTag,
        language
      });
      
      res.status(201).json(newEntry);
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * Update vocabulary entry
   * PUT /api/vocabEntries/:id
   */
  async updateEntry(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      const entryId = parseInt(req.params.id);
      const { entryKey, entryValue, hskLevelTag } = req.body;
      
      if (!userId) {
        res.status(401).json({ 
          error: 'User not authenticated',
          code: 'ERR_NOT_AUTHENTICATED'
        });
        return;
      }
      
      if (isNaN(entryId)) {
        res.status(400).json({ 
          error: 'Invalid entry ID',
          code: 'ERR_INVALID_ENTRY_ID'
        });
        return;
      }
      
      const updatedEntry = await this.vocabEntryService.updateEntry(userId, entryId, {
        entryKey,
        entryValue,
        hskLevelTag
      });
      
      res.json(updatedEntry);
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * Delete vocabulary entry
   * DELETE /api/vocabEntries/:id
   */
  async deleteEntry(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      const entryId = parseInt(req.params.id);
      
      if (!userId) {
        res.status(401).json({ 
          error: 'User not authenticated',
          code: 'ERR_NOT_AUTHENTICATED'
        });
        return;
      }
      
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
      this.handleError(error, res);
    }
  }

  /**
   * Search vocabulary entries
   * GET /api/vocabEntries/search
   */
  async searchEntries(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      const searchTerm = req.query.q as string;
      const limit = parseInt(req.query.limit as string) || 50;
      
      if (!userId) {
        res.status(401).json({ 
          error: 'User not authenticated',
          code: 'ERR_NOT_AUTHENTICATED'
        });
        return;
      }
      
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
      this.handleError(error, res);
    }
  }

  /**
   * Get vocabulary statistics for user
   * GET /api/vocabEntries/stats
   */
  async getUserStats(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      
      if (!userId) {
        res.status(401).json({ 
          error: 'User not authenticated',
          code: 'ERR_NOT_AUTHENTICATED'
        });
        return;
      }
      
      const stats = await this.vocabEntryService.getUserVocabStats(userId);
      res.json(stats);
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * Get recent entries
   * GET /api/vocabEntries/recent
   */
  async getRecentEntries(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      const days = parseInt(req.query.days as string) || 7;
      
      if (!userId) {
        res.status(401).json({ 
          error: 'User not authenticated',
          code: 'ERR_NOT_AUTHENTICATED'
        });
        return;
      }
      
      const entries = await this.vocabEntryService.getRecentEntries(userId, days);
      res.json(entries);
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * Import vocabulary entries from CSV file
   * POST /api/vocabEntries/import
   */
  async importFromCSV(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      
      if (!userId) {
        res.status(401).json({ 
          error: 'User not authenticated',
          code: 'ERR_NOT_AUTHENTICATED'
        });
        return;
      }
      
      if (!req.file) {
        res.status(400).json({ 
          error: 'No file uploaded',
          code: 'ERR_NO_FILE'
        });
        return;
      }
      
      // Check file type
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
      this.handleError(error, res);
    }
  }

  /**
   * Get vocabulary entries by tokens for reader feature
   * POST /api/vocabEntries/by-tokens
   */
  async getEntriesByTokens(req: Request, res: Response): Promise<void> {
    const requestStart = performance.now();
    
    try {
      const userId = (req as any).user?.userId;
      const { tokens } = req.body;
      
      console.log(`[VOCAB-SERVER] 📥 Token lookup request received:`, {
        userId: userId ? `${userId.substring(0, 8)}...` : 'undefined',
        requestSize: `${JSON.stringify(req.body).length} bytes`,
        userAgent: req.get('User-Agent')?.substring(0, 50) + '...',
        timestamp: new Date().toISOString()
      });
      
      if (!userId) {
        console.warn(`[VOCAB-SERVER] ❌ Authentication failed:`, {
          error: 'User not authenticated',
          requestTime: `${(performance.now() - requestStart).toFixed(2)}ms`
        });
        res.status(401).json({ 
          error: 'User not authenticated',
          code: 'ERR_NOT_AUTHENTICATED'
        });
        return;
      }
      
      if (!tokens || !Array.isArray(tokens)) {
        console.warn(`[VOCAB-SERVER] ❌ Invalid request format:`, {
          userId: `${userId.substring(0, 8)}...`,
          error: 'Tokens array is required',
          receivedType: typeof tokens,
          requestTime: `${(performance.now() - requestStart).toFixed(2)}ms`
        });
        res.status(400).json({ 
          error: 'Tokens array is required',
          code: 'ERR_MISSING_TOKENS'
        });
        return;
      }
      
      console.log(`[VOCAB-SERVER] 🔍 Processing token lookup:`, {
        userId: `${userId.substring(0, 8)}...`,
        tokensReceived: tokens.length,
        sampleTokens: tokens.slice(0, 10), // Show first 10 tokens
        allTokens: tokens.length <= 20 ? tokens : `${tokens.slice(0, 20).join(', ')}... (+${tokens.length - 20} more)`,
        tokenLengthDistribution: {
          length1: tokens.filter(t => t.length === 1).length,
          length2: tokens.filter(t => t.length === 2).length,
          length3: tokens.filter(t => t.length === 3).length,
          length4: tokens.filter(t => t.length === 4).length,
          other: tokens.filter(t => t.length > 4).length
        }
      });
      
      if (tokens.length === 0) {
        console.log(`[VOCAB-SERVER] 📝 Empty token array:`, {
          userId: `${userId.substring(0, 8)}...`,
          response: 'returning empty response',
          requestTime: `${(performance.now() - requestStart).toFixed(2)}ms`
        });
        res.json({
          personalEntries: [],
          dictionaryEntries: []
        });
        return;
      }
      
      // Limit the number of tokens to prevent abuse
      if (tokens.length > 1000) {
        console.warn(`[VOCAB-SERVER] ⚠️ Token limit exceeded:`, {
          userId: `${userId.substring(0, 8)}...`,
          tokensRequested: tokens.length,
          maxAllowed: 1000,
          requestTime: `${(performance.now() - requestStart).toFixed(2)}ms`
        });
        res.status(400).json({ 
          error: 'Too many tokens requested (max 1000)',
          code: 'ERR_TOO_MANY_TOKENS'
        });
        return;
      }
      
      // Validate that all tokens are strings
      const invalidTokens = tokens.filter(token => typeof token !== 'string');
      if (invalidTokens.length > 0) {
        console.warn(`[VOCAB-SERVER] ❌ Invalid token types found:`, {
          userId: `${userId.substring(0, 8)}...`,
          invalidTokenCount: invalidTokens.length,
          invalidTokens: invalidTokens.slice(0, 5), // Show first 5 invalid tokens
          requestTime: `${(performance.now() - requestStart).toFixed(2)}ms`
        });
        res.status(400).json({ 
          error: 'All tokens must be strings',
          code: 'ERR_INVALID_TOKEN_TYPE'
        });
        return;
      }
      
      console.log(`[VOCAB-SERVER] ✅ Request validation passed, forwarding to service layer:`, {
        userId: `${userId.substring(0, 8)}...`,
        validatedTokens: tokens.length,
        validationTime: `${(performance.now() - requestStart).toFixed(2)}ms`
      });
      
      const serviceStart = performance.now();
      
      // Get user's language for dictionary lookups
      const { userDAL } = await import('../dal/setup.js');
      const user = await userDAL.findById(userId);
      const language = user?.selectedLanguage || 'zh';
      
      // Get both personal vocab entries and dictionary entries
      const [personalEntries, dictionaryEntries] = await Promise.all([
        this.vocabEntryService.getEntriesByTokens(userId, tokens),
        this.dictionaryService ? this.dictionaryService.lookupMultipleTerms(tokens, language) : Promise.resolve([])
      ]);
      
      const serviceTime = performance.now() - serviceStart;
      const totalTime = performance.now() - requestStart;
      
      console.log(`[VOCAB-SERVER] 📤 Sending response:`, {
        userId: `${userId.substring(0, 8)}...`,
        tokensRequested: tokens.length,
        personalEntriesFound: personalEntries.length,
        dictionaryEntriesFound: dictionaryEntries.length,
        personalMatchRate: `${(personalEntries.length / tokens.length * 100).toFixed(1)}%`,
        dictionaryMatchRate: `${(dictionaryEntries.length / tokens.length * 100).toFixed(1)}%`,
        serviceTime: `${serviceTime.toFixed(2)}ms`,
        totalRequestTime: `${totalTime.toFixed(2)}ms`,
        responseSize: `${JSON.stringify({ personalEntries, dictionaryEntries }).length} bytes`
      });
      
      res.json({
        personalEntries,
        dictionaryEntries
      });
    } catch (error) {
      const errorTime = performance.now() - requestStart;
      console.error(`[VOCAB-SERVER] ❌ Request failed:`, {
        userId: (req as any).user?.userId ? `${(req as any).user.userId.substring(0, 8)}...` : 'undefined',
        error: error instanceof Error ? error.message : 'Unknown error',
        requestTime: `${errorTime.toFixed(2)}ms`,
        stack: error instanceof Error ? error.stack : undefined
      });
      this.handleError(error, res);
    }
  }

  /**
   * Handle and convert errors to appropriate HTTP responses
   * Uses sanitized error messages to prevent sensitive information exposure
   */
  private handleError(error: any, res: Response): void {
    // Log full error details server-side for debugging
    console.error('VocabEntryController error:', {
      message: error.message,
      stack: error.stack,
      code: error.code,
      statusCode: error.statusCode,
      timestamp: new Date().toISOString()
    });
    
    // Handle DAL errors with sanitization
    if (error instanceof ValidationError) {
      const clientError = error.toClientError();
      res.status(clientError.statusCode).json({
        error: clientError.message,
        code: clientError.code
      });
      return;
    }
    
    if (error instanceof DuplicateError) {
      const clientError = error.toClientError();
      res.status(clientError.statusCode).json({
        error: clientError.message,
        code: clientError.code
      });
      return;
    }
    
    if (error instanceof NotFoundError) {
      const clientError = error.toClientError();
      res.status(clientError.statusCode).json({
        error: clientError.message,
        code: clientError.code
      });
      return;
    }
    
    if (error instanceof DALError) {
      const clientError = error.toClientError();
      res.status(clientError.statusCode).json({
        error: clientError.message,
        code: clientError.code
      });
      return;
    }
    
    // Handle legacy custom errors from existing code
    if (error.code && error.statusCode) {
      // For legacy errors, sanitize manually
      let sanitizedMessage = error.message;
      sanitizedMessage = sanitizedMessage.replace(/mykle\.database\.windows\.net/gi, '[server]');
      sanitizedMessage = sanitizedMessage.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[server]');
      sanitizedMessage = sanitizedMessage.replace(/:\d{4,5}/g, '');
      sanitizedMessage = sanitizedMessage.replace(/in \d+ms/g, '');
      
      res.status(error.statusCode).json({
        error: sanitizedMessage,
        code: error.code
      });
      return;
    }
    
    // Generic server error - never expose internal details
    res.status(500).json({
      error: 'Internal server error',
      code: 'ERR_INTERNAL_SERVER_ERROR'
    });
  }
}
