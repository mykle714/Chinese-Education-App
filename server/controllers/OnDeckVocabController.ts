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
}
