import { Request, Response } from 'express';
import { OnDeckVocabService, type StudyMode } from '../services/OnDeckVocabService.js';
import { requireUserId, getUserLanguage, handleControllerError } from '../utils/controllerUtils.js';

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

      const language = await getUserLanguage(userId);
      const libraryCards = await this.onDeckVocabService.getLibraryCards(userId, language);
      res.json(libraryCards);
    } catch (error: any) {
      handleControllerError(error, res, 'OnDeckVocabController.getLibraryCards');
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

      const language = await getUserLanguage(userId);
      const masteredCards = await this.onDeckVocabService.getMasteredLibraryCards(userId, language);
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

      const language = await getUserLanguage(userId);
      const nonMasteredCards = await this.onDeckVocabService.getNonMasteredLibraryCards(userId, language);
      res.json(nonMasteredCards);
    } catch (error: any) {
      handleControllerError(error, res, 'OnDeckVocabController.getNonMasteredLibraryCards');
    }
  };

  /**
   * Get distributed working loop (1 Mastered, 2 Comfortable, 2 Unfamiliar, 5 Target by default).
   * GET /api/onDeck/distributed-working-loop?category=<optional>&mode=<easy|hard|optional>
   * The optional `mode` swaps in a difficulty-targeted distribution (see MODE_CONFIGS).
   */
  getDistributedWorkingLoop = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const categoryFilter = req.query.category as string | undefined;
      const rawMode = req.query.mode as string | undefined;
      const mode: StudyMode | undefined =
        rawMode === 'easy' || rawMode === 'hard' ? rawMode : undefined;
      const language = await getUserLanguage(userId);
      const workingLoop = await this.onDeckVocabService.getDistributedWorkingLoop(userId, language, categoryFilter, mode);
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

      const language = await getUserLanguage(userId);
      const counts = await this.onDeckVocabService.getCategoryCounts(userId, language);
      res.json(counts);
    } catch (error: any) {
      handleControllerError(error, res, 'OnDeckVocabController.getCategoryCounts');
    }
  };

  // Categories the game pool may request counts for (mirrors the SR buckets).
  private static readonly GAME_POOL_CATEGORIES = ['Unfamiliar', 'Target', 'Comfortable', 'Mastered'];

  /**
   * Build the bubble-match game pool.
   * GET /api/onDeck/game-pool?Unfamiliar=2&Target=10&Comfortable=6&Mastered=2
   * Defaults to 2 Unfamiliar + 10 Target + 6 Comfortable + 2 Mastered (20 total)
   * when no recognised category params are supplied. The service tops the pool
   * up to its total from fallback buckets when a quota can't be met, so this is
   * a best-effort fill. Returns { cards, requested, available, total, sufficient }.
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
        distribution.Unfamiliar = 2;
        distribution.Target = 10;
        distribution.Comfortable = 6;
        distribution.Mastered = 2;
      }

      const language = await getUserLanguage(userId);
      const pool = await this.onDeckVocabService.getGameVocabPool(userId, language, distribution);
      res.json(pool);
    } catch (error: any) {
      handleControllerError(error, res, 'OnDeckVocabController.getGamePool');
    }
  };

  /**
   * Build the Word Search game grid.
   * GET /api/onDeck/word-search-grid?Unfamiliar=2&Target=10&Comfortable=6&Mastered=2
   * Same requested distribution + fallback semantics as the bubble-match pool,
   * plus a substring de-dup pass and snaking grid generation. Returns
   * { grid, words, rows, cols, total, available, sufficient, reason? }.
   */
  getWordSearchGrid = async (req: Request, res: Response): Promise<void> => {
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
        distribution.Unfamiliar = 2;
        distribution.Target = 10;
        distribution.Comfortable = 6;
        distribution.Mastered = 2;
      }

      const language = await getUserLanguage(userId);
      const result = await this.onDeckVocabService.getWordSearchGrid(userId, language, distribution);
      res.json(result);
    } catch (error: any) {
      handleControllerError(error, res, 'OnDeckVocabController.getWordSearchGrid');
    }
  };
}
