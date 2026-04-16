import { Request, Response } from 'express';
import { StarterPacksService } from '../services/StarterPacksService.js';
import { requireUserId, handleControllerError } from '../utils/controllerUtils.js';

// Supported language codes — used for validation in multiple endpoints
const VALID_LANGUAGES = ['zh', 'ja', 'ko', 'vi'] as const;

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
      const userId = requireUserId(req, res);
      if (!userId) return;

      const { language } = req.params;
      if (!language || !VALID_LANGUAGES.includes(language as any)) {
        res.status(400).json({ error: 'Invalid language parameter' });
        return;
      }

      const result = await this.starterPacksService.getStarterPackCards(language, userId);
      res.json(result);
    } catch (error: any) {
      handleControllerError(error, res, 'StarterPacksController.getStarterPackCards');
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
      const userId = requireUserId(req, res);
      if (!userId) return;

      const { language } = req.params;
      const { excludeIds } = req.body;

      if (!language || !VALID_LANGUAGES.includes(language as any)) {
        res.status(400).json({ error: 'Invalid language parameter' });
        return;
      }

      // Validate excludeIds is an array of integers (default to empty if not provided)
      const validatedExcludeIds: number[] = Array.isArray(excludeIds)
        ? excludeIds.filter((id: any) => typeof id === 'number' && Number.isInteger(id))
        : [];

      const result = await this.starterPacksService.getStarterPackCards(language, userId, validatedExcludeIds);
      res.json(result);
    } catch (error: any) {
      handleControllerError(error, res, 'StarterPacksController.loadMoreCards');
    }
  };

  /**
   * Get user's progress on a starter pack
   * GET /api/starter-packs/:language/progress
   */
  getProgress = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const { language } = req.params;
      if (!language || !VALID_LANGUAGES.includes(language as any)) {
        res.status(400).json({ error: 'Invalid language parameter' });
        return;
      }

      const progress = await this.starterPacksService.getProgress(language, userId);
      res.json(progress);
    } catch (error: any) {
      handleControllerError(error, res, 'StarterPacksController.getProgress');
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
      const userId = requireUserId(req, res);
      if (!userId) return;

      const { cardId, bucket, language } = req.body;

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
      handleControllerError(error, res, 'StarterPacksController.sortCard');
    }
  };

  /**
   * Undo last card sort
   * POST /api/starter-packs/undo
   * Body: { cardId: number, language: string }
   */
  undoSort = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const { cardId, language } = req.body;

      if (!cardId || !language) {
        res.status(400).json({ error: 'Missing required fields: cardId, language' });
        return;
      }

      const result = await this.starterPacksService.undoSort(userId, cardId, language);
      res.json(result);
    } catch (error: any) {
      handleControllerError(error, res, 'StarterPacksController.undoSort');
    }
  };
}
