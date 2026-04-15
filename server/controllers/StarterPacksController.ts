import { Request, Response } from 'express';
import { StarterPacksService } from '../services/StarterPacksService.js';
import { ValidationError, NotFoundError, DALError } from '../types/dal.js';

/**
 * Starter Packs Controller
 * Handles HTTP requests for starter pack operations
 */
export class StarterPacksController {
  constructor(private starterPacksService: StarterPacksService) {}

  /**
   * Get starter pack cards for a specific language
   * GET /api/starter-packs/:language
   * Response: { cards: DiscoverCard[], userHskLevel: number }
   */
  getStarterPackCards = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.userId;
      const { language } = req.params;

      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      if (!language || !['zh', 'ja', 'ko', 'vi'].includes(language)) {
        res.status(400).json({ error: 'Invalid language parameter' });
        return;
      }

      const result = await this.starterPacksService.getStarterPackCards(language, userId);
      res.json(result);
    } catch (error: any) {
      this.handleError(error, res);
    }
  };

  /**
   * Load more starter pack cards, excluding cards the client already has.
   * POST /api/starter-packs/:language/more
   * Body: { excludeIds: number[] }
   * Response: { cards: DiscoverCard[], userHskLevel: number, provisionalMode: boolean }
   */
  loadMoreCards = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.userId;
      const { language } = req.params;
      const { excludeIds } = req.body;

      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      if (!language || !['zh', 'ja', 'ko', 'vi'].includes(language)) {
        res.status(400).json({ error: 'Invalid language parameter' });
        return;
      }

      // Validate excludeIds is an array of numbers (default to empty)
      const validatedExcludeIds: number[] = Array.isArray(excludeIds)
        ? excludeIds.filter((id: any) => typeof id === 'number' && Number.isInteger(id))
        : [];

      const result = await this.starterPacksService.getStarterPackCards(language, userId, validatedExcludeIds);
      res.json(result);
    } catch (error: any) {
      this.handleError(error, res);
    }
  };

  /**
   * Get user's progress on a starter pack
   * GET /api/starter-packs/:language/progress
   */
  getProgress = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.userId;
      const { language } = req.params;

      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      if (!language || !['zh', 'ja', 'ko', 'vi'].includes(language)) {
        res.status(400).json({ error: 'Invalid language parameter' });
        return;
      }

      const progress = await this.starterPacksService.getProgress(language, userId);
      res.json(progress);
    } catch (error: any) {
      this.handleError(error, res);
    }
  };

  /**
   * Sort a card into a bucket
   * POST /api/starter-packs/sort
   * Body: { cardId: number, bucket: string, language: string }
   * Response: { success, message, bucket, userHskLevel }
   */
  sortCard = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.userId;
      const { cardId, bucket, language } = req.body;

      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      if (!cardId || !bucket || !language) {
        res.status(400).json({ error: 'Missing required fields: cardId, bucket, language' });
        return;
      }

      const validBuckets = ['already-learned', 'library', 'skip', 'learn-later'];
      if (!validBuckets.includes(bucket)) {
        res.status(400).json({ error: 'Invalid bucket type' });
        return;
      }

      const result = await this.starterPacksService.sortCard(userId, cardId, bucket, language);
      res.json(result);
    } catch (error: any) {
      this.handleError(error, res);
    }
  };

  /**
   * Undo last card sort
   * POST /api/starter-packs/undo
   * Body: { cardId: number, language: string }
   */
  undoSort = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.userId;
      const { cardId, language } = req.body;

      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      if (!cardId || !language) {
        res.status(400).json({ error: 'Missing required fields: cardId, language' });
        return;
      }

      const result = await this.starterPacksService.undoSort(userId, cardId, language);
      res.json(result);
    } catch (error: any) {
      this.handleError(error, res);
    }
  };

  /**
   * Handle and convert errors to appropriate HTTP responses
   */
  private handleError(error: any, res: Response): void {
    console.error('StarterPacksController error:', {
      message: error.message,
      stack: error.stack,
      code: error.code,
      statusCode: error.statusCode,
      timestamp: new Date().toISOString()
    });
    
    if (error instanceof ValidationError) {
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

    // FK constraint violation on userId — user's account no longer exists in the DB
    // but they still hold a valid JWT. Return 401 so the client's fetch interceptor
    // clears the stale session and redirects to /login automatically.
    if (error.code === '23503' && error.message?.includes('vocabentries_userId_fkey')) {
      res.status(401).json({ error: 'Session invalid. Please log in again.' });
      return;
    }

    res.status(500).json({
      error: 'Internal server error',
      code: 'ERR_INTERNAL_SERVER_ERROR'
    });
  }
}
