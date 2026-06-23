import { Request, Response } from 'express';
import { StarterPacksService } from '../services/StarterPacksService.js';
import { requireUserId, handleControllerError } from '../utils/controllerUtils.js';

// Supported language codes — used for validation in multiple endpoints
const VALID_LANGUAGES = ['zh', 'es'] as const;

/**
 * Starter Packs Controller
 * Handles HTTP requests for starter pack operations
 */
export class StarterPacksController {
  constructor(private starterPacksService: StarterPacksService) {}

  /**
   * Get the initial starter-pack queue for a language (the client holds a short FIFO
   * queue — the service default fills 2: head + one buffer).
   * GET /api/starter-packs/:language
   * Response: { cards: DiscoverCard[], exhausted: boolean }
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
   * Sort a card into a bucket. The response carries the single replacement card for
   * the client's FIFO tail (a sort always shrinks the queue by one), so there is no
   * separate "load more" call.
   * POST /api/starter-packs/sort
   * Body: { cardId: number, bucket: string, language: string, excludeIds?: number[] }
   * Response: { success, message, bucket, nextCard: DiscoverCard | null, exhausted }
   */
  sortCard = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const { cardId, bucket, language, excludeIds } = req.body;

      if (!cardId || !bucket || !language) {
        res.status(400).json({ error: 'Missing required fields: cardId, bucket, language' });
        return;
      }

      const validBuckets = ['already-learned', 'library', 'skip'];
      if (!validBuckets.includes(bucket)) {
        res.status(400).json({ error: 'Invalid bucket type' });
        return;
      }

      // excludeIds = the ids the client still holds in its queue, so the returned
      // replacement card is never a duplicate. Validate to a clean int array.
      const validatedExcludeIds: number[] = Array.isArray(excludeIds)
        ? excludeIds.filter((id: any) => typeof id === 'number' && Number.isInteger(id))
        : [];

      const result = await this.starterPacksService.sortCard(userId, cardId, bucket, language, validatedExcludeIds);
      res.json(result);
    } catch (error: any) {
      handleControllerError(error, res, 'StarterPacksController.sortCard');
    }
  };

  /**
   * Undo last card sort. The client passes the bucket it sorted into so the service
   * reverses the exact trace (skip → discover_skips row; otherwise → vet row).
   * POST /api/starter-packs/undo
   * Body: { cardId: number, bucket: string, language: string }
   */
  undoSort = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const { cardId, bucket, language } = req.body;

      if (!cardId || !bucket || !language) {
        res.status(400).json({ error: 'Missing required fields: cardId, bucket, language' });
        return;
      }

      const result = await this.starterPacksService.undoSort(userId, cardId, bucket, language);
      res.json(result);
    } catch (error: any) {
      handleControllerError(error, res, 'StarterPacksController.undoSort');
    }
  };
}
