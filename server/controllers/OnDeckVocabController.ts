import { Request, Response } from 'express';
import { OnDeckVocabService } from '../services/OnDeckVocabService.js';
import { requireUserId, handleControllerError } from '../utils/controllerUtils.js';

/**
 * OnDeck Vocabulary Controller
 * Handles HTTP requests for active on-deck card operations.
 */
export class OnDeckVocabController {
  constructor(private onDeckVocabService: OnDeckVocabService) {}

  /**
   * Get all library cards (vocab entries from *-library OnDeck sets)
   * GET /api/onDeck/library-cards
   */
  getLibraryCards = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const libraryCards = await this.onDeckVocabService.getLibraryCards(userId);
      res.json(libraryCards);
    } catch (error: any) {
      handleControllerError(error, res, 'OnDeckVocabController.getLibraryCards');
    }
  };

  /**
   * Get all learn later cards (vocab entries from *-learn-later OnDeck sets)
   * GET /api/onDeck/learn-later-cards
   */
  getLearnLaterCards = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const learnLaterCards = await this.onDeckVocabService.getLearnLaterCards(userId);
      res.json(learnLaterCards);
    } catch (error: any) {
      handleControllerError(error, res, 'OnDeckVocabController.getLearnLaterCards');
    }
  };

  /**
   * Get mastered library cards (library cards with category = 'Mastered')
   * GET /api/onDeck/mastered-library-cards
   */
  getMasteredLibraryCards = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const masteredCards = await this.onDeckVocabService.getMasteredLibraryCards(userId);
      res.json(masteredCards);
    } catch (error: any) {
      handleControllerError(error, res, 'OnDeckVocabController.getMasteredLibraryCards');
    }
  };

  /**
   * Get non-mastered library cards (library cards without category = 'Mastered')
   * GET /api/onDeck/non-mastered-library-cards
   */
  getNonMasteredLibraryCards = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const nonMasteredCards = await this.onDeckVocabService.getNonMasteredLibraryCards(userId);
      res.json(nonMasteredCards);
    } catch (error: any) {
      handleControllerError(error, res, 'OnDeckVocabController.getNonMasteredLibraryCards');
    }
  };

  /**
   * Get distributed working loop (1 Mastered, 2 Comfortable, 2 Unfamiliar, 5 Target)
   * GET /api/onDeck/distributed-working-loop?category=<optional>
   */
  getDistributedWorkingLoop = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const categoryFilter = req.query.category as string | undefined;
      const workingLoop = await this.onDeckVocabService.getDistributedWorkingLoop(userId, categoryFilter);
      res.json(workingLoop);
    } catch (error: any) {
      handleControllerError(error, res, 'OnDeckVocabController.getDistributedWorkingLoop');
    }
  };

  /**
   * Get per-category library card counts (Unfamiliar / Target / Comfortable / Mastered).
   * GET /api/onDeck/category-counts
   */
  getCategoryCounts = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const counts = await this.onDeckVocabService.getCategoryCounts(userId);
      res.json(counts);
    } catch (error: any) {
      handleControllerError(error, res, 'OnDeckVocabController.getCategoryCounts');
    }
  };

  // Categories the game pool may request counts for (mirrors the SR buckets).
  private static readonly GAME_POOL_CATEGORIES = ['Unfamiliar', 'Target', 'Comfortable', 'Mastered'];

  /**
   * Build the bubble-match game pool.
   * GET /api/onDeck/game-pool?Target=15&Comfortable=10
   * Defaults to 15 Target + 10 Comfortable when no recognised category params
   * are supplied. Returns { cards, requested, available, sufficient }.
   */
  getGamePool = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const distribution: Record<string, number> = {};
      for (const cat of OnDeckVocabController.GAME_POOL_CATEGORIES) {
        const raw = req.query[cat];
        if (raw != null) {
          const n = parseInt(String(raw), 10);
          if (Number.isFinite(n) && n > 0) distribution[cat] = n;
        }
      }
      if (Object.keys(distribution).length === 0) {
        distribution.Target = 15;
        distribution.Comfortable = 10;
      }

      const pool = await this.onDeckVocabService.getGameVocabPool(userId, distribution);
      res.json(pool);
    } catch (error: any) {
      handleControllerError(error, res, 'OnDeckVocabController.getGamePool');
    }
  };
}
