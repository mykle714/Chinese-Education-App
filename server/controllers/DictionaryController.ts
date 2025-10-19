import { Request, Response } from 'express';
import { DictionaryService } from '../services/DictionaryService.js';
import { IUserDAL } from '../dal/interfaces/IUserDAL.js';

/**
 * Dictionary Controller - Handles HTTP requests for dictionary operations
 * Delegates business logic to DictionaryService
 */
export class DictionaryController {
  constructor(
    private dictionaryService: DictionaryService,
    private userDAL: IUserDAL
  ) {}

  /**
   * Look up a dictionary entry by term (uses user's selected language)
   * GET /api/dictionary/lookup/:term
   */
  async lookupTerm(req: Request, res: Response): Promise<void> {
    try {
      const { term } = req.params;
      const userId = (req as any).user?.userId;

      if (!term) {
        res.status(400).json({ error: 'Term parameter is required' });
        return;
      }

      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      // Get user's selected language
      const user = await this.userDAL.findById(userId);
      const language = user?.selectedLanguage || 'zh';

      const entry = await this.dictionaryService.lookupTerm(term, language);

      if (!entry) {
        res.status(404).json({ error: 'Dictionary entry not found' });
        return;
      }

      res.json(entry);
    } catch (error: any) {
      console.error('Error looking up dictionary term:', error);
      res.status(500).json({ error: error.message || 'Failed to lookup term' });
    }
  }

  /**
   * Get total dictionary entry count
   * GET /api/dictionary/count
   */
  async getCount(req: Request, res: Response): Promise<void> {
    try {
      const count = await this.dictionaryService.getTotalCount();
      res.json({ count });
    } catch (error: any) {
      console.error('Error getting dictionary count:', error);
      res.status(500).json({ error: error.message || 'Failed to get dictionary count' });
    }
  }
}
