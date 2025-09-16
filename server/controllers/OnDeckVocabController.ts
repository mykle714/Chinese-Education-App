import { Request, Response } from 'express';
import { OnDeckVocabService } from '../services/OnDeckVocabService.js';
import { ValidationError, NotFoundError, DALError } from '../types/dal.js';

/**
 * OnDeck Vocabulary Set Controller
 * Handles HTTP requests for OnDeck vocabulary set operations
 */
export class OnDeckVocabController {
  constructor(private onDeckVocabService: OnDeckVocabService) {}

  /**
   * Get all on-deck vocab sets for the authenticated user
   * GET /api/onDeckPage
   */
  getAllSets = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      const sets = await this.onDeckVocabService.getAllSetsForUser(userId);
      res.json(sets);
    } catch (error: any) {
      this.handleError(error, res);
    }
  };

  /**
   * Get a specific on-deck vocab set by feature name
   * GET /api/onDeckPage/:featureName
   */
  getSetByFeatureName = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.userId;
      const { featureName } = req.params;

      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      if (!featureName) {
        res.status(400).json({ error: 'Feature name is required' });
        return;
      }

      const set = await this.onDeckVocabService.getSetByUserAndFeature(userId, featureName);
      res.json(set);
    } catch (error: any) {
      this.handleError(error, res);
    }
  };

  /**
   * Create or update an on-deck vocab set
   * POST /api/onDeckPage
   */
  createOrUpdateSet = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.userId;
      const { featureName, vocabEntryIds } = req.body;

      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      if (!featureName) {
        res.status(400).json({ error: 'Feature name is required' });
        return;
      }

      const setData = {
        featureName,
        vocabEntryIds: vocabEntryIds || []
      };

      const result = await this.onDeckVocabService.createOrUpdateSet(userId, setData);
      res.json(result);
    } catch (error: any) {
      this.handleError(error, res);
    }
  };

  /**
   * Delete an on-deck vocab set
   * DELETE /api/onDeckPage/:featureName
   */
  deleteSet = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.userId;
      const { featureName } = req.params;

      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      if (!featureName) {
        res.status(400).json({ error: 'Feature name is required' });
        return;
      }

      await this.onDeckVocabService.deleteSet(userId, featureName);
      res.json({ success: true, message: 'OnDeck set deleted successfully' });
    } catch (error: any) {
      this.handleError(error, res);
    }
  };

  /**
   * Get user's on-deck set statistics
   * GET /api/onDeckPage/stats
   */
  getUserStats = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      const stats = await this.onDeckVocabService.getUserSetStats(userId);
      res.json(stats);
    } catch (error: any) {
      this.handleError(error, res);
    }
  };

  /**
   * Get all feature names for the user
   * GET /api/onDeckPage/features
   */
  getFeatureNames = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      const featureNames = await this.onDeckVocabService.getFeatureNamesForUser(userId);
      res.json({ featureNames });
    } catch (error: any) {
      this.handleError(error, res);
    }
  };

  /**
   * Add entries to an existing set
   * POST /api/onDeckPage/:featureName/add
   */
  addEntriesToSet = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.userId;
      const { featureName } = req.params;
      const { entryIds } = req.body;

      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      if (!featureName) {
        res.status(400).json({ error: 'Feature name is required' });
        return;
      }

      if (!Array.isArray(entryIds) || entryIds.length === 0) {
        res.status(400).json({ error: 'Entry IDs array is required and cannot be empty' });
        return;
      }

      const result = await this.onDeckVocabService.addEntriesToSet(userId, featureName, entryIds);
      res.json(result);
    } catch (error: any) {
      this.handleError(error, res);
    }
  };

  /**
   * Remove entries from an existing set
   * POST /api/onDeckPage/:featureName/remove
   */
  removeEntriesFromSet = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.userId;
      const { featureName } = req.params;
      const { entryIds } = req.body;

      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      if (!featureName) {
        res.status(400).json({ error: 'Feature name is required' });
        return;
      }

      if (!Array.isArray(entryIds) || entryIds.length === 0) {
        res.status(400).json({ error: 'Entry IDs array is required and cannot be empty' });
        return;
      }

      const result = await this.onDeckVocabService.removeEntriesFromSet(userId, featureName, entryIds);
      res.json(result);
    } catch (error: any) {
      this.handleError(error, res);
    }
  };

  /**
   * Clear all entries from a set
   * POST /api/onDeckPage/:featureName/clear
   */
  clearSet = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.userId;
      const { featureName } = req.params;

      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      if (!featureName) {
        res.status(400).json({ error: 'Feature name is required' });
        return;
      }

      const result = await this.onDeckVocabService.clearSet(userId, featureName);
      res.json(result);
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
