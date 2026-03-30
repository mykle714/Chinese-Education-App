import { Request, Response } from 'express';
import { OnDeckVocabService } from '../services/OnDeckVocabService.js';
import { ValidationError, NotFoundError, DALError } from '../types/dal.js';

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
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      const libraryCards = await this.onDeckVocabService.getLibraryCards(userId);
      res.json(libraryCards);
    } catch (error: any) {
      this.handleError(error, res);
    }
  };

  /**
   * Get all learn later cards (vocab entries from *-learn-later OnDeck sets)
   * GET /api/onDeck/learn-later-cards
   */
  getLearnLaterCards = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      const learnLaterCards = await this.onDeckVocabService.getLearnLaterCards(userId);
      res.json(learnLaterCards);
    } catch (error: any) {
      this.handleError(error, res);
    }
  };

  /**
   * Get mastered library cards (library cards with category = 'Mastered')
   * GET /api/onDeck/mastered-library-cards
   */
  getMasteredLibraryCards = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      const masteredCards = await this.onDeckVocabService.getMasteredLibraryCards(userId);
      res.json(masteredCards);
    } catch (error: any) {
      this.handleError(error, res);
    }
  };

  /**
   * Get non-mastered library cards (library cards without category = 'Mastered')
   * GET /api/onDeck/non-mastered-library-cards
   */
  getNonMasteredLibraryCards = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      const nonMasteredCards = await this.onDeckVocabService.getNonMasteredLibraryCards(userId);
      res.json(nonMasteredCards);
    } catch (error: any) {
      this.handleError(error, res);
    }
  };

  /**
   * Get distributed working loop (1 Mastered, 2 Comfortable, 2 Unfamiliar, 5 Target)
   * GET /api/onDeck/distributed-working-loop?category=<optional>
   */
  getDistributedWorkingLoop = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      const categoryFilter = req.query.category as string | undefined;
      const workingLoop = await this.onDeckVocabService.getDistributedWorkingLoop(userId, categoryFilter);
      res.json(workingLoop);
    } catch (error: any) {
      this.handleError(error, res);
    }
  };

  /**
   * Handle and convert errors to appropriate HTTP responses
   * Uses sanitized error messages to prevent sensitive information exposure
   */
  private handleError(error: any, res: Response): void {
    // Log full error details server-side for debugging
    console.error('OnDeckVocabController error:', {
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
